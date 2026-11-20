import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  BarChart3,
  FileCheck2,
  Network,
  Shield,
} from 'lucide-react';
import { AlertTriageQueue } from './components/AlertTriageQueue';
import { ExecutiveBenchmark } from './components/ExecutiveBenchmark';
import { GovernanceAuditLog } from './components/GovernanceAuditLog';
import { GraphExplorer } from './components/GraphExplorer';
import { ShapSarWorkbench } from './components/ShapSarWorkbench';
import {
  buildHistoricalTrainingSamples,
  runFullAMLPipeline,
  trainOnRealDataset,
} from './engine/pipeline';
import { loadRealDatasetFromFile } from './engine/csvLoader';
import {
  generateEgyptianBankingDataset,
  injectLiveScenario,
  SimulatedDataset,
} from './engine/simulator';
import {
  extractTier3FeatureVector,
  GradientBoostedAMLClassifier,
  TrainingSample,
} from './engine/tier3Classifier';
import { AuditLogEntry, RolloutPhase } from './engine/types';

type NavTab = 'overview' | 'triage' | 'graph' | 'governance';

export function App() {
  const [activeTab, setActiveTab] = useState<NavTab>('overview');
  const [phase, setPhase] = useState<RolloutPhase>('phase2_hybrid');
  const [dataset, setDataset] = useState<SimulatedDataset>(() =>
    generateEgyptianBankingDataset(20261120)
  );
  const [model, setModel] = useState<GradientBoostedAMLClassifier>(() => {
    const clf = new GradientBoostedAMLClassifier({
      learningRate: 0.22,
      numRounds: 24,
      maxDepth: 2,
      lambda: 2.0,
    });
    clf.fit(buildHistoricalTrainingSamples());
    return clf;
  });
  const [analystFeedback, setAnalystFeedback] = useState<
    Map<string, 'confirmed_sar' | 'closed_benign'>
  >(() => new Map());
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [lastBanner, setLastBanner] = useState<string | null>(null);
  const [isReal, setIsReal] = useState(false);
  const [evalIds, setEvalIds] = useState<Set<string> | null>(null);

  const pipeline = useMemo(() => {
    return runFullAMLPipeline(dataset, {
      phase,
      existingModel: model,
      analystFeedback,
      priorAuditLogs: auditLogs,
      evaluationIds: evalIds ?? undefined,
    });
  }, [dataset, phase, model, analystFeedback, auditLogs, evalIds]);

  const effectiveAuditLogs = pipeline.auditLogs;

  const selectedAlert = useMemo(() => {
    if (!selectedAccountId) return pipeline.alerts[0] ?? null;
    return (
      pipeline.alerts.find((a) => a.accountId === selectedAccountId) ??
      pipeline.alerts[0] ??
      null
    );
  }, [pipeline.alerts, selectedAccountId]);

  const appendAudit = (entry: Omit<AuditLogEntry, 'id' | 'timestamp' | 'phase'>) => {
    setAuditLogs((prev) => [
      ...(prev.length === 0 ? effectiveAuditLogs : prev),
      {
        ...entry,
        id: `AUD-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        timestamp: new Date().toISOString(),
        phase,
      },
    ]);
  };

  const handleInjectScenario = (
    scenario: 'smurfing_ring' | 'cyclic_layering' | 'seasonal_merchant_surge'
  ) => {
    const { dataset: nextDataset, summary, injectedAccountIds } = injectLiveScenario(
      dataset,
      scenario
    );
    setDataset(nextDataset);
    setSelectedAccountId(injectedAccountIds[0] ?? null);
    setLastBanner(summary);
    appendAudit({
      action: 'SCENARIO_INJECTED',
      accountId: injectedAccountIds[0],
      actor: 'IPN / InstaPay Stream Simulator',
      details: summary,
    });
  };

  const handleDisposition = (
    accountId: string,
    disposition: 'confirmed_sar' | 'closed_benign'
  ) => {
    setAnalystFeedback((prev) => {
      const next = new Map(prev);
      next.set(accountId, disposition);
      return next;
    });
    const record = pipeline.alerts.find((a) => a.accountId === accountId);
    const labelText =
      disposition === 'confirmed_sar'
        ? `Approved & filed EMLCU Law No. 80 SAR for ${record?.account.name ?? accountId} (Risk: ${(
            (record?.calibratedRiskScore ?? 0) * 100
          ).toFixed(1)}%).`
        : `Closed ${record?.account.name ?? accountId} as Benign (False Positive) and queued label for Tier 3 GBDT retraining.`;

    setLastBanner(labelText);
    appendAudit({
      action:
        disposition === 'confirmed_sar'
          ? 'SAR_APPROVED_FILED'
          : 'ANALYST_CLOSED_BENIGN',
      accountId,
      riskScore: record?.calibratedRiskScore,
      actor: 'Senior AML Investigator',
      details: labelText,
    });
  };

  const loadFile = async (file: File) => {
    try {
      setLastBanner(`Reading ${file.name}…`);
      const { dataset: real, summary } = await loadRealDatasetFromFile(file);
      const r = trainOnRealDataset(real);
      setDataset(real);
      setModel(r.model);
      setEvalIds(r.testIds);
      setIsReal(true);
      setAnalystFeedback(new Map());
      setSelectedAccountId(null);
      const msg = `${summary} Tier 3 trained on ${r.trainCount} accounts; held-out ${r.testCount} accounts: precision ${(r.precision * 100).toFixed(1)}%, recall ${(r.recall * 100).toFixed(1)}%. Benchmark shows held-out accounts only.`;
      setLastBanner(msg);
      appendAudit({ action: 'MODEL_RETRAINED', actor: 'Real data loader', details: msg });
    } catch (err) {
      setLastBanner(`Failed to load CSV: ${(err as Error).message}`);
    }
  };

  const handleLoadCsv = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) void loadFile(file);
  };

  // Automatically load the bundled real IBM AMLworld sample on startup.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/sample_ibm_aml.csv');
        if (!res.ok) return;
        const blob = await res.blob();
        if (!cancelled) await loadFile(new File([blob], 'sample_ibm_aml.csv'));
      } catch {
        /* fall back to simulated data */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRetrainModel = () => {
    const extraSamples: TrainingSample[] = [];
    for (const [accId, disp] of analystFeedback.entries()) {
      const rec = pipeline.alerts.find((a) => a.accountId === accId);
      if (!rec) continue;
      // On real data, keep held-out accounts out of training so evaluation stays honest.
      if (isReal && evalIds?.has(accId)) continue;
      extraSamples.push({
        features: extractTier3FeatureVector(
          rec.account,
          rec.tier1,
          rec.tier2,
          rec.legacyAlert
        ),
        label: disp === 'confirmed_sar' ? 1 : 0,
        weight: 3.0,
      });
    }

    if (isReal) {
      const r = trainOnRealDataset(dataset, extraSamples);
      setModel(r.model);
      setEvalIds(r.testIds);
      const msg = `Retrained on real data (${r.trainCount} accounts + ${extraSamples.length} analyst labels): held-out precision ${(r.precision * 100).toFixed(1)}%, recall ${(r.recall * 100).toFixed(1)}%. Benchmark shows held-out accounts only.`;
      setLastBanner(msg);
      appendAudit({ action: 'MODEL_RETRAINED', actor: 'Model Risk & MLOps Pipeline', details: msg });
      return;
    }

    const freshModel = new GradientBoostedAMLClassifier({
      learningRate: 0.22,
      numRounds: 24,
      maxDepth: 2,
      lambda: 2.0,
    });
    const allSamples = buildHistoricalTrainingSamples(extraSamples);
    freshModel.fit(allSamples);
    setModel(freshModel);

    const msg = `Retrained Tier 3 XGBoost/GBDT classifier on ${allSamples.length} records (including ${extraSamples.length} analyst disposition labels).`;
    setLastBanner(msg);
    appendAudit({
      action: 'MODEL_RETRAINED',
      actor: 'Model Risk & MLOps Pipeline',
      details: msg,
    });
  };

  const handleSelectAndInspect = (accountId: string) => {
    setSelectedAccountId(accountId);
    if (activeTab === 'overview') {
      setActiveTab('triage');
    }
  };

  const TABS: { id: NavTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'overview', label: 'Executive Benchmark', icon: BarChart3 },
    { id: 'triage', label: 'Alert Triage & SHAP/SAR', icon: Activity },
    { id: 'graph', label: 'Graph Explorer', icon: Network },
    { id: 'governance', label: 'Governance & Audit', icon: FileCheck2 },
  ];
  const heroCopy: Record<NavTab, { eyebrow: string; title: string; sub: string }> = {
    overview: { eyebrow: 'AML MONITORING, REIMAGINED', title: 'Compliance for your next big move.', sub: 'Legacy static rules versus the Four-Tier Hybrid AI & Graph pipeline, benchmarked live on IPN / InstaPay transfers.' },
    triage: { eyebrow: 'TIER 3 · TIER 4', title: 'Alerts that explain themselves.', sub: 'Calibrated risk scores, exact SHAP attributions and analyst-ready SAR drafts.' },
    graph: { eyebrow: 'TIER 2', title: 'See the whole network.', sub: 'Mule rings, fan-in hubs and shared-device links that per-transaction rules never see.' },
    governance: { eyebrow: 'CBE / EMLCU LAW NO. 80', title: 'Built for audit, by design.', sub: 'Human accountability, full traceability and immutable decision logs.' },
  };
  const hero = heroCopy[activeTab];

  return (
    <div className="min-h-screen bg-white text-slate-700 flex flex-col">
      <div className="bg-[#0b1f3f] text-white text-[11px] font-semibold">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-1.5 sm:px-6">
          <span>Anti-money-laundering intelligence with a wider view.</span>
          <span className="hidden sm:inline">CBE &amp; EMLCU Law No. 80</span>
        </div>
      </div>

      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#1d5fe0]">
              <Shield className="h-4 w-4 text-white" />
            </div>
            <span className="text-lg font-extrabold tracking-tight text-[#0b1f3f]">NileShield</span>
          </div>
          <nav className="flex flex-wrap items-center gap-1">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition cursor-pointer ${
                    active
                      ? 'bg-[#1d5fe0] text-white'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-[#0b1f3f]'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span className="hidden md:inline">{tab.label}</span>
                </button>
              );
            })}
          </nav>
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700">
            {isReal ? 'Real data loaded · Load another CSV' : 'Load real CSV (IBM AML / SAML-D)'}
            <input type="file" accept=".csv" className="hidden" onChange={handleLoadCsv} />
          </label>
        </div>
      </header>

      <section className="bg-gradient-to-br from-[#0b1f3f] via-[#0f2a52] to-[#16386b] text-white">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
          <p className="text-[11px] font-bold tracking-[0.2em] text-blue-300">{hero.eyebrow}</p>
          <h1 className="mt-3 max-w-2xl text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl">{hero.title}</h1>
          <p className="mt-4 max-w-xl text-sm text-blue-100/80">{hero.sub}</p>
        </div>
      </section>

      <div className="bg-slate-50 flex-1">
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-10 sm:px-6">
        {activeTab === 'overview' && (
          <ExecutiveBenchmark
            benchmark={pipeline.benchmark}
            phase={phase}
            onPhaseChange={setPhase}
            onInjectScenario={handleInjectScenario}
            onRetrainModel={handleRetrainModel}
            pendingFeedbackCount={analystFeedback.size}
            trainedSampleCount={model.trainedSampleCount}
            lastBanner={lastBanner}
          />
        )}

        {activeTab === 'triage' && (
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
            <div className="xl:col-span-6">
              <AlertTriageQueue
                alerts={pipeline.alerts}
                selectedAccountId={selectedAlert?.accountId ?? null}
                onSelectAccount={setSelectedAccountId}
                phase={phase}
              />
            </div>
            <div className="xl:col-span-6">
              <ShapSarWorkbench
                alert={selectedAlert}
                onDisposition={handleDisposition}
              />
            </div>
          </div>
        )}

        {activeTab === 'graph' && (
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
            <div className="xl:col-span-7">
              <GraphExplorer
                alerts={pipeline.alerts}
                edges={pipeline.graphEdges}
                detectedCycles={pipeline.detectedCycles}
                selectedAccountId={selectedAlert?.accountId ?? null}
                onSelectAccount={handleSelectAndInspect}
              />
            </div>
            <div className="xl:col-span-5">
              <ShapSarWorkbench
                alert={selectedAlert}
                onDisposition={handleDisposition}
              />
            </div>
          </div>
        )}

        {activeTab === 'governance' && (
          <GovernanceAuditLog
            auditLogs={effectiveAuditLogs}
            benchmark={pipeline.benchmark}
            phase={phase}
          />
        )}
      </main>
      </div>
      <footer className="bg-[#0b1f3f] text-blue-100/70">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 px-4 py-6 text-[11px] sm:px-6">
          <span>© 2026 NileShield AML. Real IBM AMLworld (Kaggle) sample data.</span>
          <span>Human investigators remain accountable for every SAR filed.</span>
        </div>
      </footer></div>
  );
}

export default App;

