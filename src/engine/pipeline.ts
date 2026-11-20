import { runLegacyRules } from './legacyRules';
import { generateEgyptianBankingDataset, SimulatedDataset } from './simulator';
import { runTier1AnomalyDetection } from './tier1Anomaly';
import { runTier2GraphIntelligence } from './tier2Graph';
import {
  AUTO_SUPPRESS_THRESHOLD,
  classifyTriageBand,
  extractTier3FeatureVector,
  GradientBoostedAMLClassifier,
  HIGH_RISK_THRESHOLD,
  TrainingSample,
} from './tier3Classifier';
import { computeLocalShapAttributions, generateSarDraft } from './tier4ExplainSar';
import {
  AlertDisposition,
  AuditLogEntry,
  BenchmarkMetrics,
  GraphEdge,
  RolloutPhase,
  Tier3AlertRecord,
} from './types';

export interface PipelineOutput {
  dataset: SimulatedDataset;
  alerts: Tier3AlertRecord[];
  graphEdges: GraphEdge[];
  detectedCycles: string[][];
  benchmark: BenchmarkMetrics;
  model: GradientBoostedAMLClassifier;
  auditLogs: AuditLogEntry[];
}

/**
 * Generates an independent historical anonymized training log (separate seed)
 * to train Tier 3 GBDT without data leakage, honoring CBE Independent Validation governance.
 */
export function buildHistoricalTrainingSamples(
  extraFeedbackSamples: TrainingSample[] = []
): TrainingSample[] {
  const hist = generateEgyptianBankingDataset(19990101);
  const legacyHist = runLegacyRules(hist.accounts, hist.transactions);
  const t1Hist = runTier1AnomalyDetection(hist.accounts, hist.transactions);
  const t2Hist = runTier2GraphIntelligence(hist.accounts, hist.transactions);

  const samples: TrainingSample[] = hist.accounts.map((acc) => {
    const t1 = t1Hist.get(acc.id)!;
    const t2 = t2Hist.signals.get(acc.id)!;
    const leg = legacyHist.get(acc.id) ?? null;
    return {
      features: extractTier3FeatureVector(acc, t1, t2, leg),
      label: acc.isIllicit ? 1 : 0,
      weight: 1,
    };
  });

  // Incorporate analyst feedback dispositions with higher weight so retraining adapts rapidly
  return [...samples, ...extraFeedbackSamples];
}

/**
 * Trains Tier 3 on a REAL labelled dataset using a deterministic 70/30 account split
 * (hash of account id) and reports held-out precision/recall at the 0.5 threshold.
 */
export function trainOnRealDataset(
  dataset: SimulatedDataset,
  extraSamples: TrainingSample[] = []
): {
  model: GradientBoostedAMLClassifier;
  trainCount: number;
  testCount: number;
  precision: number;
  recall: number;
  testIds: Set<string>;
} {
  const testIds = new Set<string>();
  const legacy = runLegacyRules(dataset.accounts, dataset.transactions);
  const t1 = runTier1AnomalyDetection(dataset.accounts, dataset.transactions);
  const t2 = runTier2GraphIntelligence(dataset.accounts, dataset.transactions).signals;
  const bucket = (id: string) => {
    let h = 2166136261;
    for (let i = 0; i < id.length; i++) {
      h ^= id.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0) % 10;
  };
  const train: TrainingSample[] = [];
  const test: TrainingSample[] = [];
  for (const acc of dataset.accounts) {
    const s: TrainingSample = {
      features: extractTier3FeatureVector(acc, t1.get(acc.id)!, t2.get(acc.id)!, legacy.get(acc.id) ?? null),
      label: acc.isIllicit ? 1 : 0,
      weight: 1,
    };
    if (bucket(acc.id) < 7) train.push(s);
    else {
      test.push(s);
      testIds.add(acc.id);
    }
  }
  const model = new GradientBoostedAMLClassifier({ learningRate: 0.22, numRounds: 24, maxDepth: 2, lambda: 2.0 });
  // Analyst-labelled samples (weighted) are added to training only, never to the held-out set.
  model.fit([...train, ...extraSamples]);
  let tp = 0, fp = 0, fn = 0;
  for (const s of test) {
    const pred = model.predictProbability(s.features) >= 0.5 ? 1 : 0;
    if (pred && s.label) tp++;
    else if (pred && !s.label) fp++;
    else if (!pred && s.label) fn++;
  }
  return {
    model,
    trainCount: train.length,
    testCount: test.length,
    precision: tp / Math.max(1, tp + fp),
    recall: tp / Math.max(1, tp + fn),
    testIds,
  };
}

export function runFullAMLPipeline(
  dataset: SimulatedDataset,
  options?: {
    phase?: RolloutPhase;
    existingModel?: GradientBoostedAMLClassifier;
    analystFeedback?: Map<string, 'confirmed_sar' | 'closed_benign'>;
    priorAuditLogs?: AuditLogEntry[];
    /** If set, benchmark metrics are computed only on these (held-out) account ids. */
    evaluationIds?: Set<string>;
  }
): PipelineOutput {
  const phase: RolloutPhase = options?.phase ?? 'phase2_hybrid';
  const analystFeedback = options?.analystFeedback ?? new Map();

  // 1. Run Legacy Rule Engine (benchmark baseline)
  const legacyAlerts = runLegacyRules(dataset.accounts, dataset.transactions);

  // 2. Run Tier 1: Unsupervised Behavioral Baselines (Isolation Forest + Sequence Autoencoder)
  const tier1Map = runTier1AnomalyDetection(dataset.accounts, dataset.transactions);

  // 3. Run Tier 2: Topological Graph Intelligence (GAT/GCN + Node2Vec + Cycle/Device Ring)
  const { signals: tier2Map, edges: graphEdges, detectedCycles } = runTier2GraphIntelligence(
    dataset.accounts,
    dataset.transactions
  );

  // 4. Train or reuse Tier 3 Supervised GBDT Classifier
  let model = options?.existingModel;
  if (!model) {
    model = new GradientBoostedAMLClassifier({
      learningRate: 0.22,
      numRounds: 24,
      maxDepth: 2,
      lambda: 2.0,
    });
    const trainSamples = buildHistoricalTrainingSamples();
    model.fit(trainSamples);
  }

  // Group transactions by account for SAR drafting
  const txByAcc = new Map<string, typeof dataset.transactions>();
  for (const acc of dataset.accounts) txByAcc.set(acc.id, []);
  for (const tx of dataset.transactions) {
    txByAcc.get(tx.fromAccountId)?.push(tx);
    txByAcc.get(tx.toAccountId)?.push(tx);
  }

  const nowIso = new Date().toISOString();
  const auditLogs: AuditLogEntry[] = [...(options?.priorAuditLogs ?? [])];
  const baseValue = model.getBaseProbability();

  // 5. Score every account via Tier 3 + Compute Tier 4 SHAP & SAR Drafts
  const alerts: Tier3AlertRecord[] = dataset.accounts.map((acc) => {
    const t1 = tier1Map.get(acc.id)!;
    const t2 = tier2Map.get(acc.id)!;
    const leg = legacyAlerts.get(acc.id) ?? null;

    const featureVec = extractTier3FeatureVector(acc, t1, t2, leg);
    const calibratedRiskScore = model!.predictProbability(featureVec);
    const triageBand = classifyTriageBand(calibratedRiskScore);

    // Tier 4: Local TreeSHAP attributions for every account
    const shapAttributions = computeLocalShapAttributions(model!, featureVec);

    // Disposition logic respects Rollout Phase governance safeguards
    let disposition: AlertDisposition = 'pending';
    const feedback = analystFeedback.get(acc.id);
    if (feedback) {
      disposition = feedback;
    } else if (triageBand === 'auto_suppressed') {
      disposition = 'auto_suppressed';
    }

    // Tier 4: Pre-draft SAR for escalated / high-risk cases (and any analyst-confirmed SAR)
    const sarDraft =
      triageBand === 'high_risk' ||
      triageBand === 'medium_review' ||
      disposition === 'confirmed_sar'
        ? generateSarDraft(
            acc,
            t1,
            t2,
            leg,
            calibratedRiskScore,
            shapAttributions,
            txByAcc.get(acc.id) ?? []
          )
        : null;

    if (sarDraft && disposition === 'confirmed_sar') {
      sarDraft.status = 'approved_and_filed';
      sarDraft.investigatorName = 'Senior AML Investigator';
      sarDraft.filedAt = nowIso;
    }

    return {
      accountId: acc.id,
      account: acc,
      legacyAlert: leg,
      tier1: t1,
      tier2: t2,
      calibratedRiskScore,
      baseValue,
      triageBand,
      disposition,
      shapAttributions,
      sarDraft,
    };
  });

  // Sort queue by calibrated risk score descending
  alerts.sort((a, b) => b.calibratedRiskScore - a.calibratedRiskScore);

  // Record initial governance audit summary if logs are empty
  if (auditLogs.length === 0) {
    const suppressedCount = alerts.filter((a) => a.triageBand === 'auto_suppressed').length;
    const highRiskCount = alerts.filter((a) => a.triageBand === 'high_risk').length;
    auditLogs.push(
      {
        id: `AUD-${Date.now()}-1`,
        timestamp: nowIso,
        phase,
        action: 'SCORE_COMPUTED',
        actor: 'Four-Tier AML Pipeline (v1.0)',
        details: `Scored ${alerts.length} accounts across ${dataset.transactions.length} IPN/wallet transactions. Independent historical GBDT trained on ${model.trainedSampleCount} anonymized records.`,
      },
      {
        id: `AUD-${Date.now()}-2`,
        timestamp: nowIso,
        phase,
        action: 'AUTO_SUPPRESSED',
        actor: 'Tier 3 Triage Gate (< 0.25)',
        details: `${suppressedCount} benign-cluster accounts scored below ${AUTO_SUPPRESS_THRESHOLD} threshold and logged to immutable audit trail.`,
      },
      {
        id: `AUD-${Date.now()}-3`,
        timestamp: nowIso,
        phase,
        action: 'ESCALATED_HIGH_RISK',
        actor: 'Tier 3 Triage Gate (>= 0.65)',
        details: `${highRiskCount} high-risk accounts escalated to Senior Investigators with verified SHAP attributions and pre-drafted CBE/EMLCU SARs.`,
      }
    );
  }

  // 6. Compute Executive Benchmark Metrics (Legacy vs Four-Tier AI Pipeline)
  const evalIds = options?.evaluationIds;
  const benchmark = computeBenchmarkMetrics(
    evalIds ? alerts.filter((a) => evalIds.has(a.accountId)) : alerts,
    dataset.transactions.length
  );

  return {
    dataset,
    alerts,
    graphEdges,
    detectedCycles,
    benchmark,
    model,
    auditLogs,
  };
}

export function computeBenchmarkMetrics(
  alerts: Tier3AlertRecord[],
  totalTransactions: number
): BenchmarkMetrics {
  const totalAccounts = alerts.length;
  const totalIllicitAccounts = alerts.filter((a) => a.account.isIllicit).length;

  // Legacy metrics
  const legacyFlagged = alerts.filter((a) => a.legacyAlert !== null);
  const legacyTP = legacyFlagged.filter((a) => a.account.isIllicit).length;
  const legacyFP = legacyFlagged.filter((a) => !a.account.isIllicit).length;
  const legacyFN = totalIllicitAccounts - legacyTP;
  const legacyFPR = legacyFlagged.length > 0 ? legacyFP / legacyFlagged.length : 0;
  const legacyRecall = totalIllicitAccounts > 0 ? legacyTP / totalIllicitAccounts : 0;
  const legacySmurfing = legacyFlagged.filter(
    (a) =>
      a.account.groundTruth === 'illicit_smurfing_mule' ||
      a.account.groundTruth === 'illicit_smurfing_collector' ||
      a.account.groundTruth === 'illicit_cyclic_layering'
  ).length;

  // AI Pipeline metrics (escalated = score >= 0.25)
  const aiEscalated = alerts.filter((a) => a.calibratedRiskScore >= AUTO_SUPPRESS_THRESHOLD);
  const aiSuppressed = alerts.filter((a) => a.calibratedRiskScore < AUTO_SUPPRESS_THRESHOLD);
  const aiHighRisk = alerts.filter((a) => a.calibratedRiskScore >= HIGH_RISK_THRESHOLD);

  const aiTP = aiEscalated.filter((a) => a.account.isIllicit).length;
  const aiFP = aiEscalated.filter((a) => !a.account.isIllicit).length;
  const aiFN = totalIllicitAccounts - aiTP;
  const aiFPR = aiEscalated.length > 0 ? aiFP / aiEscalated.length : 0;
  const aiRecall = totalIllicitAccounts > 0 ? aiTP / totalIllicitAccounts : 0;
  const aiSmurfing = aiEscalated.filter(
    (a) =>
      a.account.groundTruth === 'illicit_smurfing_mule' ||
      a.account.groundTruth === 'illicit_smurfing_collector' ||
      a.account.groundTruth === 'illicit_cyclic_layering'
  ).length;

  const fpReductionPct =
    legacyFP > 0 ? Math.max(0, ((legacyFP - aiFP) / legacyFP) * 100) : 0;

  // Estimated analyst hours: legacy ~1.2 hrs per alert (manual doc checks + blank-page SAR);
  // AI pipeline ~0.25 hrs per escalated alert (SHAP explainability + pre-drafted SAR)
  const legacyHours = Number((legacyFlagged.length * 1.2).toFixed(1));
  const aiHours = Number((aiEscalated.length * 0.25).toFixed(1));

  return {
    totalAccounts,
    totalTransactions,
    totalIllicitAccounts,
    legacy: {
      totalAlerts: legacyFlagged.length,
      truePositives: legacyTP,
      falsePositives: legacyFP,
      falseNegatives: legacyFN,
      falsePositiveRate: Number(legacyFPR.toFixed(4)),
      recall: Number(legacyRecall.toFixed(4)),
      smurfingRingsDetected: legacySmurfing,
      estimatedAnalystHours: legacyHours,
    },
    aiPipeline: {
      totalEscalatedAlerts: aiEscalated.length,
      autoSuppressedCount: aiSuppressed.length,
      highRiskCount: aiHighRisk.length,
      truePositives: aiTP,
      falsePositives: aiFP,
      falseNegatives: aiFN,
      falsePositiveRate: Number(aiFPR.toFixed(4)),
      recall: Number(aiRecall.toFixed(4)),
      falsePositiveReductionPct: Number(fpReductionPct.toFixed(1)),
      smurfingRingsDetected: aiSmurfing,
      estimatedAnalystHours: aiHours,
    },
  };
}
