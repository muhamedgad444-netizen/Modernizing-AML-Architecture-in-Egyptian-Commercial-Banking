export type PeerGroup =
  | 'seasonal_merchant'
  | 'salaried_retail'
  | 'sme_corporate'
  | 'student_family'
  | 'mule_account'
  | 'collector_account';

export type PaymentChannel = 'IPN_INSTAPAY' | 'MOBILE_WALLET' | 'ACH_WIRE' | 'INTERNAL_TRANSFER';

export type GroundTruthLabel =
  | 'benign_normal'
  | 'benign_seasonal_merchant'
  | 'benign_tuition_or_asset'
  | 'illicit_smurfing_mule'
  | 'illicit_smurfing_collector'
  | 'illicit_cyclic_layering'
  | 'illicit_fan_out_dispersal';

export type RolloutPhase = 'phase1_shadow' | 'phase2_hybrid' | 'phase3_automated';

export type AlertDisposition =
  | 'pending'
  | 'auto_suppressed'
  | 'confirmed_sar'
  | 'closed_benign';

export interface Account {
  id: string;
  name: string;
  handle: string; // e.g. ahmed.bakery@instapay
  bank: string; // NBE, CIB, Banque Misr, QNB Alahli, AAIB
  governorate: string; // Cairo, Giza, Alexandria, Mansoura, etc.
  peerGroup: PeerGroup;
  kycDocType: 'National ID' | 'Segel Togary (Tax Card)' | 'Payroll Letter';
  accountAgeDays: number;
  declaredMonthlyIncomeEGP: number;
  deviceId: string; // MAC/IMEI hash
  ipSubnet: string; // e.g. 197.45.12.0/24
  proxyPhone: string;
  groundTruth: GroundTruthLabel;
  isIllicit: boolean;
}

export interface Transaction {
  id: string;
  fromAccountId: string;
  toAccountId: string;
  amountEGP: number;
  timestamp: number; // epoch ms
  channel: PaymentChannel;
  deviceId: string;
  ipSubnet: string;
  note: string;
  scenarioTag?: string;
}

export interface LegacyRuleAlert {
  accountId: string;
  triggeredRules: string[]; // e.g. ['Rule 101: Single Transfer >= 50,000 EGP', 'Rule 104: 24h Velocity >= 100,000 EGP']
  maxSingleTxEGP: number;
  max24hVolumeEGP: number;
  flaggedTxIds: string[];
}

export interface Tier1Features {
  accountId: string;
  txCount: number;
  totalVolumeEGP: number;
  avgAmountEGP: number;
  maxAmountEGP: number;
  amountVarianceCV: number; // coefficient of variation
  circadianDeviation: number; // 0..1 deviation from peer group normal hours
  counterpartyDispersion: number; // unique counterparties / total tx
  peerVolumeZScore: number; // volume relative to peer group mean/std
  isolationForestScore: number; // 0..1 (higher = more anomalous)
  autoencoderReconError: number; // 0..1 (higher = harder to reconstruct sequence)
  tier1AnomalyScore: number; // 0..1 combined behavioral anomaly
}

export interface GraphEdge {
  from: string;
  to: string;
  totalAmountEGP: number;
  txCount: number;
  avgAmountEGP: number;
  edgeType: 'transfer' | 'shared_device' | 'shared_ip';
  isSubThreshold: boolean;
}

export interface Tier2GraphSignals {
  accountId: string;
  inDegree: number;
  outDegree: number;
  fanInScore: number; // 0..1 sub-threshold fan-in concentration
  fanOutScore: number; // 0..1 sub-threshold fan-out dispersal
  cyclicRoutingScore: number; // 0..1 participation in 3-5 hop cycles
  sharedDevicePeers: number; // number of other accounts sharing MAC/IMEI or IP subnet
  sharedDeviceScore: number; // 0..1 normalized device/network link density
  subThresholdRatio: number; // ratio of tx in 7,000-15,000 EGP structuring band
  rapidForwardingScore: number; // 0..1 pass-through velocity (in then out within minutes)
  gnnEmbedding: [number, number, number, number]; // 4D Node2Vec / GAT structural embedding
  gnnAttentionRisk: number; // 0..1 2-hop GAT neighborhood aggregated risk
  tier2TopologicalScore: number; // 0..1 combined graph intelligence score
  detectedPatterns: string[]; // e.g. ['Fan-In Structuring', 'Shared Device Ring', 'Multi-Hop Cycle']
}

export interface ShapAttribution {
  featureKey: string;
  featureLabel: string;
  featureValue: number;
  displayValue: string;
  shapValue: number; // signed contribution in log-odds / probability space
  impactDirection: 'increases_risk' | 'decreases_risk';
}

export interface SarReport {
  sarId: string;
  accountId: string;
  generatedAt: string;
  regulatoryFramework: 'CBE / EMLCU Law No. 80';
  riskScore: number;
  status: 'draft' | 'approved_and_filed';
  investigatorName?: string;
  filedAt?: string;
  narrative: string;
  keyFindings: string[];
}

export interface Tier3AlertRecord {
  accountId: string;
  account: Account;
  legacyAlert: LegacyRuleAlert | null;
  tier1: Tier1Features;
  tier2: Tier2GraphSignals;
  calibratedRiskScore: number; // 0.0 to 1.0
  baseValue: number; // model baseline probability
  triageBand: 'auto_suppressed' | 'medium_review' | 'high_risk';
  disposition: AlertDisposition;
  shapAttributions: ShapAttribution[];
  sarDraft: SarReport | null;
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  phase: RolloutPhase;
  action:
    | 'SCORE_COMPUTED'
    | 'AUTO_SUPPRESSED'
    | 'ESCALATED_HIGH_RISK'
    | 'ANALYST_CLOSED_BENIGN'
    | 'SAR_APPROVED_FILED'
    | 'MODEL_RETRAINED'
    | 'SCENARIO_INJECTED';
  accountId?: string;
  riskScore?: number;
  actor: string;
  details: string;
}

export interface BenchmarkMetrics {
  totalAccounts: number;
  totalTransactions: number;
  totalIllicitAccounts: number;
  legacy: {
    totalAlerts: number;
    truePositives: number;
    falsePositives: number;
    falseNegatives: number;
    falsePositiveRate: number; // 0..1
    recall: number; // 0..1
    smurfingRingsDetected: number;
    estimatedAnalystHours: number;
  };
  aiPipeline: {
    totalEscalatedAlerts: number; // >= 0.25
    autoSuppressedCount: number; // < 0.25
    highRiskCount: number; // >= 0.65
    truePositives: number;
    falsePositives: number;
    falseNegatives: number;
    falsePositiveRate: number; // 0..1
    recall: number; // 0..1
    falsePositiveReductionPct: number; // % reduction vs legacy
    smurfingRingsDetected: number;
    estimatedAnalystHours: number;
  };
}
