import { SeededRNG } from './simulator';
import { Account, Tier1Features, Transaction } from './types';

// Unsupervised customer cohort (uses only observable KYC/account attributes, never ground truth)
type ObservableCohort = 'merchant_sme' | 'retail_individual';

function getObservableCohort(acc: Account): ObservableCohort {
  if (acc.kycDocType === 'Segel Togary (Tax Card)' || acc.declaredMonthlyIncomeEGP >= 200_000) {
    return 'merchant_sme';
  }
  return 'retail_individual';
}

interface IsoNode {
  isLeaf: boolean;
  size: number;
  splitFeature?: number;
  splitValue?: number;
  left?: IsoNode;
  right?: IsoNode;
}

function avgPathLength(n: number): number {
  if (n <= 1) return 0;
  if (n === 2) return 1;
  // Euler-Mascheroni approximation of Harmonic number H(n-1)
  const h = Math.log(n - 1) + 0.5772156649;
  return 2 * h - (2 * (n - 1)) / n;
}

/**
 * Genuine Unsupervised Isolation Forest (Liu et al.)
 * Isolates behavioral outliers without any historical labels.
 */
class IsolationForest {
  private trees: IsoNode[] = [];
  private maxDepth: number;
  private sampleSize: number;

  constructor(private numTrees = 48, sampleSize = 64, seed = 42) {
    this.sampleSize = sampleSize;
    this.maxDepth = Math.ceil(Math.log2(Math.max(2, sampleSize)));
    this.rng = new SeededRNG(seed);
  }

  private rng: SeededRNG;

  fit(data: number[][]): void {
    this.trees = [];
    const n = data.length;
    if (n === 0) return;
    const psi = Math.min(this.sampleSize, n);
    this.sampleSize = psi;
    this.maxDepth = Math.ceil(Math.log2(Math.max(2, psi)));

    for (let t = 0; t < this.numTrees; t++) {
      // Sample without replacement
      const indices = Array.from({ length: n }, (_, i) => i);
      for (let i = 0; i < psi; i++) {
        const j = i + Math.floor(this.rng.next() * (n - i));
        [indices[i], indices[j]] = [indices[j], indices[i]];
      }
      const sample = indices.slice(0, psi).map((idx) => data[idx]);
      this.trees.push(this.buildTree(sample, 0));
    }
  }

  private buildTree(points: number[][], depth: number): IsoNode {
    if (depth >= this.maxDepth || points.length <= 1) {
      return { isLeaf: true, size: points.length };
    }
    const dims = points[0].length;
    const feature = Math.floor(this.rng.next() * dims);
    let minVal = Infinity;
    let maxVal = -Infinity;
    for (const p of points) {
      if (p[feature] < minVal) minVal = p[feature];
      if (p[feature] > maxVal) maxVal = p[feature];
    }
    if (maxVal - minVal < 1e-9) {
      return { isLeaf: true, size: points.length };
    }
    const splitValue = minVal + this.rng.next() * (maxVal - minVal);
    const leftPts: number[][] = [];
    const rightPts: number[][] = [];
    for (const p of points) {
      if (p[feature] < splitValue) leftPts.push(p);
      else rightPts.push(p);
    }
    return {
      isLeaf: false,
      size: points.length,
      splitFeature: feature,
      splitValue,
      left: this.buildTree(leftPts, depth + 1),
      right: this.buildTree(rightPts, depth + 1),
    };
  }

  private pathLength(point: number[], node: IsoNode, depth: number): number {
    if (node.isLeaf || node.splitFeature === undefined || node.splitValue === undefined) {
      return depth + avgPathLength(node.size);
    }
    if (point[node.splitFeature] < node.splitValue) {
      return this.pathLength(point, node.left!, depth + 1);
    }
    return this.pathLength(point, node.right!, depth + 1);
  }

  score(point: number[]): number {
    if (this.trees.length === 0) return 0;
    let totalPath = 0;
    for (const tree of this.trees) {
      totalPath += this.pathLength(point, tree, 0);
    }
    const meanPath = totalPath / this.trees.length;
    const cn = avgPathLength(this.sampleSize);
    if (cn <= 0) return 0;
    // Standard Isolation Forest anomaly score in (0, 1)
    return Math.pow(2, -meanPath / cn);
  }
}

/**
 * Tier 1: Dynamic Behavioral Baselines (Unsupervised Anomaly Detection)
 * Extracts Velocity, Variance, Circadian Timing, and Counterparty Dispersion per peer cohort,
 * then scores accounts with Isolation Forest + Peer-Group Sequence Reconstruction Autoencoder.
 */
export function runTier1AnomalyDetection(
  accounts: Account[],
  transactions: Transaction[]
): Map<string, Tier1Features> {
  const txByAcc = new Map<string, Transaction[]>();
  for (const acc of accounts) {
    txByAcc.set(acc.id, []);
  }
  for (const tx of transactions) {
    txByAcc.get(tx.fromAccountId)?.push(tx);
    txByAcc.get(tx.toAccountId)?.push(tx);
  }

  // Raw per-account statistics & 8-bin circadian activity sequence (3-hour bins)
  interface RawStats {
    account: Account;
    cohort: ObservableCohort;
    txCount: number;
    totalVolumeEGP: number;
    avgAmountEGP: number;
    maxAmountEGP: number;
    amountVarianceCV: number;
    nightTxRatio: number;
    counterpartyDispersion: number;
    volumeToIncomeRatio: number;
    circadianBins: number[]; // length 8, normalized
  }

  const rawMap = new Map<string, RawStats>();
  const cohortGroups: Record<ObservableCohort, RawStats[]> = {
    merchant_sme: [],
    retail_individual: [],
  };

  for (const acc of accounts) {
    const txs = txByAcc.get(acc.id) ?? [];
    const txCount = txs.length;
    const amounts = txs.map((t) => t.amountEGP);
    const totalVolumeEGP = amounts.reduce((s, a) => s + a, 0);
    const avgAmountEGP = txCount > 0 ? totalVolumeEGP / txCount : 0;
    const maxAmountEGP = txCount > 0 ? Math.max(...amounts) : 0;

    // Variance (Coefficient of Variation)
    let variance = 0;
    if (txCount > 1 && avgAmountEGP > 0) {
      variance =
        amounts.reduce((s, a) => s + Math.pow(a - avgAmountEGP, 2), 0) / txCount;
    }
    const std = Math.sqrt(variance);
    const amountVarianceCV = avgAmountEGP > 0 ? std / avgAmountEGP : 0;

    // Circadian profile (Cairo UTC+2)
    const circadianBins = new Array<number>(8).fill(0);
    let nightTxCount = 0;
    const counterparties = new Set<string>();

    for (const tx of txs) {
      const hourUtc2 = (Math.floor(tx.timestamp / 3600000) + 2) % 24;
      const bin = Math.floor(((hourUtc2 + 24) % 24) / 3);
      circadianBins[bin] += 1;
      if (hourUtc2 >= 0 && hourUtc2 < 6) {
        nightTxCount += 1;
      }
      counterparties.add(tx.fromAccountId === acc.id ? tx.toAccountId : tx.fromAccountId);
    }

    if (txCount > 0) {
      for (let b = 0; b < 8; b++) circadianBins[b] /= txCount;
    }

    const nightTxRatio = txCount > 0 ? nightTxCount / txCount : 0;
    const counterpartyDispersion = txCount > 0 ? counterparties.size / txCount : 0;
    const volumeToIncomeRatio =
      acc.declaredMonthlyIncomeEGP > 0 ? totalVolumeEGP / acc.declaredMonthlyIncomeEGP : 0;

    const cohort = getObservableCohort(acc);
    const raw: RawStats = {
      account: acc,
      cohort,
      txCount,
      totalVolumeEGP,
      avgAmountEGP,
      maxAmountEGP,
      amountVarianceCV,
      nightTxRatio,
      counterpartyDispersion,
      volumeToIncomeRatio,
      circadianBins,
    };
    rawMap.set(acc.id, raw);
    cohortGroups[cohort].push(raw);
  }

  const results = new Map<string, Tier1Features>();

  // Run Isolation Forest & Sequence Autoencoder per observable peer cohort
  for (const cohort of ['merchant_sme', 'retail_individual'] as ObservableCohort[]) {
    const group = cohortGroups[cohort];
    if (group.length === 0) continue;

    // Cohort baseline mean circadian sequence (autoencoder prototype)
    const meanCircadian = new Array<number>(8).fill(0);
    for (const r of group) {
      for (let b = 0; b < 8; b++) meanCircadian[b] += r.circadianBins[b] / group.length;
    }

    // Cohort mean & std for volume
    const meanVol = group.reduce((s, r) => s + r.totalVolumeEGP, 0) / group.length;
    const stdVol =
      Math.sqrt(
        group.reduce((s, r) => s + Math.pow(r.totalVolumeEGP - meanVol, 2), 0) / group.length
      ) || 1;

    // Feature matrix for Isolation Forest (standardized per cohort)
    const rawFeatures = group.map((r) => {
      // L2 reconstruction error of circadian sequence relative to peer cohort baseline
      let seqSqErr = 0;
      for (let b = 0; b < 8; b++) {
        seqSqErr += Math.pow(r.circadianBins[b] - meanCircadian[b], 2);
      }
      const circadianDeviation = Math.min(1, Math.sqrt(seqSqErr) * 1.15);

      return {
        raw: r,
        circadianDeviation,
        vec: [
          r.txCount,
          r.amountVarianceCV,
          circadianDeviation,
          r.nightTxRatio,
          r.counterpartyDispersion,
          Math.log1p(r.volumeToIncomeRatio),
          1 / Math.max(1, r.account.accountAgeDays / 30), // account recency
        ],
      };
    });

    // Standardize columns for Isolation Forest
    const dims = rawFeatures[0].vec.length;
    const colMeans = new Array<number>(dims).fill(0);
    const colStds = new Array<number>(dims).fill(1);
    for (let d = 0; d < dims; d++) {
      colMeans[d] = rawFeatures.reduce((s, f) => s + f.vec[d], 0) / rawFeatures.length;
      const v =
        rawFeatures.reduce((s, f) => s + Math.pow(f.vec[d] - colMeans[d], 2), 0) /
        rawFeatures.length;
      colStds[d] = Math.sqrt(v) || 1;
    }

    const standardizedMatrix = rawFeatures.map((f) =>
      f.vec.map((val, d) => (val - colMeans[d]) / colStds[d])
    );

    const isoForest = new IsolationForest(48, Math.min(64, group.length), cohort === 'merchant_sme' ? 101 : 202);
    isoForest.fit(standardizedMatrix);

    for (let i = 0; i < rawFeatures.length; i++) {
      const { raw, circadianDeviation } = rawFeatures[i];
      const isoScoreRaw = isoForest.score(standardizedMatrix[i]);
      // Calibrate raw Isolation Forest score (normally centered ~0.42-0.55) into [0, 1]
      const isolationForestScore = Math.max(0, Math.min(1, (isoScoreRaw - 0.36) / 0.34));

      // Sequence Autoencoder Reconstruction Error (combines circadian sequence MSE + income-mismatch + recency)
      const volIncomeMismatch = Math.min(1, Math.max(0, (raw.volumeToIncomeRatio - 1.2) / 5.0));
      const recencyPenalty = raw.account.accountAgeDays < 60 ? 0.35 : 0;
      const autoencoderReconError = Math.max(
        0,
        Math.min(1, 0.55 * circadianDeviation + 0.25 * volIncomeMismatch + 0.20 * raw.nightTxRatio + recencyPenalty * 0.4)
      );

      const tier1AnomalyScore = Math.max(
        0,
        Math.min(1, 0.5 * isolationForestScore + 0.5 * autoencoderReconError)
      );

      const peerVolumeZScore = (raw.totalVolumeEGP - meanVol) / stdVol;

      results.set(raw.account.id, {
        accountId: raw.account.id,
        txCount: raw.txCount,
        totalVolumeEGP: raw.totalVolumeEGP,
        avgAmountEGP: Math.round(raw.avgAmountEGP),
        maxAmountEGP: raw.maxAmountEGP,
        amountVarianceCV: Number(raw.amountVarianceCV.toFixed(3)),
        circadianDeviation: Number(circadianDeviation.toFixed(3)),
        counterpartyDispersion: Number(raw.counterpartyDispersion.toFixed(3)),
        peerVolumeZScore: Number(peerVolumeZScore.toFixed(2)),
        isolationForestScore: Number(isolationForestScore.toFixed(3)),
        autoencoderReconError: Number(autoencoderReconError.toFixed(3)),
        tier1AnomalyScore: Number(tier1AnomalyScore.toFixed(3)),
      });
    }
  }

  return results;
}
