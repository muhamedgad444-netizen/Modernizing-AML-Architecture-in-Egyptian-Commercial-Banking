import { Account, LegacyRuleAlert, Tier1Features, Tier2GraphSignals } from './types';

export interface FeatureSpec {
  key: string;
  label: string;
  format: (v: number) => string;
}

export const TIER3_FEATURES: FeatureSpec[] = [
  { key: 'tier1_iso_forest', label: 'Tier 1: Isolation Forest Anomaly', format: (v) => v.toFixed(2) },
  { key: 'tier1_autoencoder', label: 'Tier 1: LSTM Autoencoder Recon Error', format: (v) => v.toFixed(2) },
  { key: 'tier1_circadian_dev', label: 'Tier 1: Circadian Timing Deviation', format: (v) => `${(v * 100).toFixed(0)}%` },
  { key: 'tier2_gnn_risk', label: 'Tier 2: GNN (GAT) Neighborhood Risk', format: (v) => v.toFixed(2) },
  { key: 'tier2_shared_device', label: 'Tier 2: Shared Device / IP Ring Score', format: (v) => v.toFixed(2) },
  { key: 'tier2_rapid_forward', label: 'Tier 2: Rapid Pass-Through Forwarding', format: (v) => `${(v * 100).toFixed(0)}%` },
  { key: 'tier2_fan_in', label: 'Tier 2: Fan-In Structuring Density', format: (v) => v.toFixed(2) },
  { key: 'tier2_cyclic_routing', label: 'Tier 2: Multi-Hop Cyclic Routing', format: (v) => v.toFixed(2) },
  { key: 'tier2_sub_threshold', label: 'Tier 2: Sub-Threshold Band Ratio', format: (v) => `${(v * 100).toFixed(0)}%` },
  { key: 'account_recency', label: 'Account Recency Risk (1 / Age)', format: (v) => v.toFixed(2) },
  { key: 'legacy_rule_flag', label: 'Legacy Static Rule Triggered', format: (v) => (v > 0.5 ? 'Yes (50k/100k)' : 'No') },
];

export function extractTier3FeatureVector(
  account: Account,
  tier1: Tier1Features,
  tier2: Tier2GraphSignals,
  legacyAlert: LegacyRuleAlert | null
): number[] {
  const recencyRisk = Math.min(1, 30 / Math.max(5, account.accountAgeDays));
  return [
    tier1.isolationForestScore,
    tier1.autoencoderReconError,
    tier1.circadianDeviation,
    tier2.gnnAttentionRisk,
    tier2.sharedDeviceScore,
    tier2.rapidForwardingScore,
    tier2.fanInScore,
    tier2.cyclicRoutingScore,
    tier2.subThresholdRatio,
    Number(recencyRisk.toFixed(3)),
    legacyAlert ? 1 : 0,
  ];
}

export interface GBDTNode {
  isLeaf: boolean;
  leafValue: number; // expected log-odds delta at this node (used for exact TreeSHAP path attribution)
  cover: number; // sum of hessians
  featureIdx?: number;
  threshold?: number;
  left?: GBDTNode;
  right?: GBDTNode;
}

export interface TrainingSample {
  features: number[];
  label: 0 | 1; // 0 = benign, 1 = confirmed suspicious
  weight?: number;
}

function sigmoid(x: number): number {
  if (x >= 0) {
    const z = Math.exp(-x);
    return 1 / (1 + z);
  }
  const z = Math.exp(x);
  return z / (1 + z);
}

/**
 * Real XGBoost-style Gradient Boosted Decision Tree Classifier
 * Fits depth-2 trees via second-order Newton steps (gradient g_i, hessian h_i)
 * with L2 leaf regularization (lambda), outputting calibrated probabilities in [0, 1].
 */
export class GradientBoostedAMLClassifier {
  public trees: GBDTNode[] = [];
  public baseLogOdds = 0;
  public learningRate: number;
  public numRounds: number;
  public maxDepth: number;
  public lambda: number;
  public trainedSampleCount = 0;

  constructor(options?: {
    learningRate?: number;
    numRounds?: number;
    maxDepth?: number;
    lambda?: number;
  }) {
    this.learningRate = options?.learningRate ?? 0.22;
    this.numRounds = options?.numRounds ?? 24;
    this.maxDepth = options?.maxDepth ?? 2;
    this.lambda = options?.lambda ?? 2.0;
  }

  fit(samples: TrainingSample[]): void {
    this.trees = [];
    this.trainedSampleCount = samples.length;
    if (samples.length === 0) return;

    const posCount = samples.reduce((s, x) => s + (x.label === 1 ? (x.weight ?? 1) : 0), 0);
    const totalWeight = samples.reduce((s, x) => s + (x.weight ?? 1), 0);
    const baseProb = Math.min(0.95, Math.max(0.05, posCount / Math.max(1, totalWeight)));
    this.baseLogOdds = Math.log(baseProb / (1 - baseProb));

    const preds = new Array<number>(samples.length).fill(this.baseLogOdds);

    for (let round = 0; round < this.numRounds; round++) {
      const grads: number[] = [];
      const hess: number[] = [];
      for (let i = 0; i < samples.length; i++) {
        const w = samples[i].weight ?? 1;
        const p = sigmoid(preds[i]);
        grads.push((p - samples[i].label) * w);
        hess.push(Math.max(1e-4, p * (1 - p) * w));
      }

      const indices = Array.from({ length: samples.length }, (_, i) => i);
      // Deterministic XGBoost-style colsample_bytree (~70% features per tree)
      // prevents over-reliance on any single correlated feature
      const numFeatures = samples[0].features.length;
      const allowedFeatures = new Set<number>();
      for (let f = 0; f < numFeatures; f++) {
        if ((f + round * 3) % 10 < 7) {
          allowedFeatures.add(f);
        }
      }
      const tree = this.buildTree(samples, indices, grads, hess, 0, allowedFeatures);
      this.trees.push(tree);

      for (let i = 0; i < samples.length; i++) {
        preds[i] += this.learningRate * this.predictTree(tree, samples[i].features);
      }
    }
  }

  private buildTree(
    samples: TrainingSample[],
    indices: number[],
    grads: number[],
    hess: number[],
    depth: number,
    allowedFeatures: Set<number>
  ): GBDTNode {
    let G = 0;
    let H = 0;
    for (const idx of indices) {
      G += grads[idx];
      H += hess[idx];
    }
    const leafValue = -G / (H + this.lambda);

    if (depth >= this.maxDepth || indices.length < 4) {
      return { isLeaf: true, leafValue, cover: H };
    }

    const numFeatures = samples[0].features.length;
    let bestGain = 0.01; // minimum split gain gamma
    let bestFeature = -1;
    let bestThreshold = 0;
    let bestLeft: number[] = [];
    let bestRight: number[] = [];

    const parentScore = (G * G) / (H + this.lambda);

    for (let f = 0; f < numFeatures; f++) {
      if (!allowedFeatures.has(f)) continue;
      // Candidate split thresholds from sorted unique feature values
      const sorted = [...indices].sort((a, b) => samples[a].features[f] - samples[b].features[f]);
      let GL = 0;
      let HL = 0;

      for (let i = 0; i < sorted.length - 1; i++) {
        const idx = sorted[i];
        GL += grads[idx];
        HL += hess[idx];

        const curVal = samples[idx].features[f];
        const nextVal = samples[sorted[i + 1]].features[f];
        if (nextVal - curVal < 1e-6) continue;

        const GR = G - GL;
        const HR = H - HL;
        const gain =
          0.5 *
          ((GL * GL) / (HL + this.lambda) + (GR * GR) / (HR + this.lambda) - parentScore);

        if (gain > bestGain) {
          bestGain = gain;
          bestFeature = f;
          bestThreshold = (curVal + nextVal) / 2;
          bestLeft = sorted.slice(0, i + 1);
          bestRight = sorted.slice(i + 1);
        }
      }
    }

    if (bestFeature === -1 || bestLeft.length === 0 || bestRight.length === 0) {
      return { isLeaf: true, leafValue, cover: H };
    }

    return {
      isLeaf: false,
      leafValue,
      cover: H,
      featureIdx: bestFeature,
      threshold: bestThreshold,
      left: this.buildTree(samples, bestLeft, grads, hess, depth + 1, allowedFeatures),
      right: this.buildTree(samples, bestRight, grads, hess, depth + 1, allowedFeatures),
    };
  }

  private predictTree(node: GBDTNode, features: number[]): number {
    if (node.isLeaf || node.featureIdx === undefined || node.threshold === undefined) {
      return node.leafValue;
    }
    if (features[node.featureIdx] <= node.threshold) {
      return this.predictTree(node.left!, features);
    }
    return this.predictTree(node.right!, features);
  }

  predictLogOdds(features: number[]): number {
    let score = this.baseLogOdds;
    for (const tree of this.trees) {
      score += this.learningRate * this.predictTree(tree, features);
    }
    return score;
  }

  predictProbability(features: number[]): number {
    return Number(sigmoid(this.predictLogOdds(features)).toFixed(4));
  }

  getBaseProbability(): number {
    return Number(sigmoid(this.baseLogOdds).toFixed(4));
  }
}

export const AUTO_SUPPRESS_THRESHOLD = 0.25;
export const HIGH_RISK_THRESHOLD = 0.65;

export function classifyTriageBand(
  score: number
): 'auto_suppressed' | 'medium_review' | 'high_risk' {
  if (score < AUTO_SUPPRESS_THRESHOLD) return 'auto_suppressed';
  if (score >= HIGH_RISK_THRESHOLD) return 'high_risk';
  return 'medium_review';
}
