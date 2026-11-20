import React from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Layers,
  Network,
  PlusCircle,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { BenchmarkMetrics, RolloutPhase } from '../engine/types';

interface Props {
  benchmark: BenchmarkMetrics;
  phase: RolloutPhase;
  onPhaseChange: (phase: RolloutPhase) => void;
  onInjectScenario: (
    scenario: 'smurfing_ring' | 'cyclic_layering' | 'seasonal_merchant_surge'
  ) => void;
  onRetrainModel: () => void;
  pendingFeedbackCount: number;
  trainedSampleCount: number;
  lastBanner: string | null;
}

const PHASES: {
  id: RolloutPhase;
  title: string;
  months: string;
  desc: string;
  safeguard: string;
}[] = [
  {
    id: 'phase1_shadow',
    title: 'Phase 1: Shadow Deployment',
    months: 'Months 1–3',
    desc: 'Models run in parallel on anonymized logs; legacy engine retains 100% of live decisions.',
    safeguard: 'Zero regulatory risk — benchmarking FP reduction before activation.',
  },
  {
    id: 'phase2_hybrid',
    title: 'Phase 2: Hybrid Decision Support',
    months: 'Months 4–6',
    desc: 'Tier 3 prioritization, SHAP visualizers & Graph Explorer deployed alongside legacy alerts.',
    safeguard: 'Human-in-the-loop review validates model rankings and explanations.',
  },
  {
    id: 'phase3_automated',
    title: 'Phase 3: Automated L1 Triage',
    months: 'Months 7–12',
    desc: 'Auto-suppression (< 0.25) active for verified benign clusters; CBE validation package submitted.',
    safeguard: 'All suppressed alerts retained in immutable CBE/EMLCU audit logs.',
  },
];

export const ExecutiveBenchmark: React.FC<Props> = ({
  benchmark,
  phase,
  onPhaseChange,
  onInjectScenario,
  onRetrainModel,
  pendingFeedbackCount,
  trainedSampleCount,
  lastBanner,
}) => {
  const { legacy, aiPipeline } = benchmark;
  const legacyFprPct = (legacy.falsePositiveRate * 100).toFixed(1);
  const aiFprPct = (aiPipeline.falsePositiveRate * 100).toFixed(1);
  const hoursSaved = Math.max(0, legacy.estimatedAnalystHours - aiPipeline.estimatedAnalystHours).toFixed(1);

  return (
    <div className="space-y-6">
      {lastBanner && (
        <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          <Sparkles className="h-4 w-4 shrink-0 text-emerald-600" />
          <span>{lastBanner}</span>
        </div>
      )}

      {/* Top KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between text-xs font-medium text-slate-600">
            <span>FALSE-POSITIVE REDUCTION</span>
            <ShieldCheck className="h-4 w-4 text-emerald-600" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-bold text-emerald-600">
              {aiPipeline.falsePositiveReductionPct.toFixed(1)}%
            </span>
            <span className="text-xs text-slate-600">noise eliminated</span>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            FPR dropped from <span className="text-rose-600 font-medium">{legacyFprPct}%</span> to{' '}
            <span className="text-emerald-600 font-medium">{aiFprPct}%</span>
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between text-xs font-medium text-slate-600">
            <span>MULE RINGS &amp; SMURFING CAUGHT</span>
            <Network className="h-4 w-4 text-violet-700" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-bold text-violet-700">
              {aiPipeline.smurfingRingsDetected}
              <span className="text-lg text-slate-500">/{benchmark.totalIllicitAccounts}</span>
            </span>
            <span className="text-xs text-slate-600">illicit nodes</span>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Legacy static rules caught only{' '}
            <span className="text-rose-600 font-medium">{legacy.smurfingRingsDetected}</span>
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between text-xs font-medium text-slate-600">
            <span>AUTO-SUPPRESSED BENIGN</span>
            <Layers className="h-4 w-4 text-sky-700" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-bold text-sky-700">
              {aiPipeline.autoSuppressedCount}
            </span>
            <span className="text-xs text-slate-600">accounts (&lt; 0.25)</span>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Retained in immutable audit log; {aiPipeline.highRiskCount} escalated high-risk
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between text-xs font-medium text-slate-600">
            <span>ANALYST CAPACITY SAVED</span>
            <Clock className="h-4 w-4 text-amber-600" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-bold text-amber-600">{hoursSaved}h</span>
            <span className="text-xs text-slate-600">per 5-day cycle</span>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {legacy.estimatedAnalystHours}h legacy vs {aiPipeline.estimatedAnalystHours}h AI + SAR
          </p>
        </div>
      </div>

      {/* Legacy vs Proposed AI Architecture Comparison Table */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-base font-semibold text-[#0b1f3f]">
                Legacy Static Rules vs. Four-Tier Hybrid AI &amp; Graph Pipeline
              </h2>
              <p className="text-xs text-slate-600 mt-0.5">
                Live benchmark across {benchmark.totalAccounts} accounts &amp;{' '}
                {benchmark.totalTransactions.toLocaleString()} IPN/InstaPay &amp; Wallet transfers
              </p>
            </div>
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
              CBE / EMLCU Law No. 80
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-600">
                  <th className="py-2.5 pr-4 font-medium">Evaluation Metric</th>
                  <th className="py-2.5 px-4 font-medium text-rose-600">Legacy Rule Engine (50k / 100k)</th>
                  <th className="py-2.5 pl-4 font-medium text-emerald-700">Four-Tier AI / Graph Pipeline</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-slate-700">
                <tr>
                  <td className="py-3 pr-4 font-medium text-slate-800">Total Alerts in Queue</td>
                  <td className="py-3 px-4">
                    <span className="font-semibold text-rose-600">{legacy.totalAlerts}</span> alerts
                    <span className="block text-[11px] text-slate-500">
                      {legacy.falsePositives} benign merchants / tuition / payroll
                    </span>
                  </td>
                  <td className="py-3 pl-4">
                    <span className="font-semibold text-emerald-600">
                      {aiPipeline.totalEscalatedAlerts}
                    </span>{' '}
                    escalated alerts
                    <span className="block text-[11px] text-slate-500">
                      {aiPipeline.falsePositives} false positives ({aiPipeline.autoSuppressedCount} auto-suppressed)
                    </span>
                  </td>
                </tr>
                <tr>
                  <td className="py-3 pr-4 font-medium text-slate-800">False-Positive Ratio</td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-24 rounded-full bg-slate-100 overflow-hidden">
                        <div
                          className="h-full bg-rose-500"
                          style={{ width: `${Math.min(100, legacy.falsePositiveRate * 100)}%` }}
                        />
                      </div>
                      <span className="font-semibold text-rose-600">{legacyFprPct}%</span>
                    </div>
                  </td>
                  <td className="py-3 pl-4">
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-24 rounded-full bg-slate-100 overflow-hidden">
                        <div
                          className="h-full bg-emerald-500"
                          style={{ width: `${Math.min(100, aiPipeline.falsePositiveRate * 100)}%` }}
                        />
                      </div>
                      <span className="font-semibold text-emerald-600">{aiFprPct}%</span>
                    </div>
                  </td>
                </tr>
                <tr>
                  <td className="py-3 pr-4 font-medium text-slate-800">Illicit Detection Recall</td>
                  <td className="py-3 px-4">
                    <span className="font-semibold text-rose-600">
                      {(legacy.recall * 100).toFixed(1)}%
                    </span>{' '}
                    ({legacy.truePositives}/{benchmark.totalIllicitAccounts})
                  </td>
                  <td className="py-3 pl-4">
                    <span className="font-semibold text-emerald-600">
                      {(aiPipeline.recall * 100).toFixed(1)}%
                    </span>{' '}
                    ({aiPipeline.truePositives}/{benchmark.totalIllicitAccounts})
                  </td>
                </tr>
                <tr>
                  <td className="py-3 pr-4 font-medium text-slate-800">Structuring / Smurfing</td>
                  <td className="py-3 px-4 text-slate-600">
                    Blind to 9,500 EGP micro-transfers &amp; multi-hop cycles
                  </td>
                  <td className="py-3 pl-4 text-emerald-700">
                    Exposed via 2-hop GAT, cycle DFS &amp; shared MAC/IP rings
                  </td>
                </tr>
                <tr>
                  <td className="py-3 pr-4 font-medium text-slate-800">Regulatory Explainability</td>
                  <td className="py-3 px-4 text-slate-600">Crude label ("Rule 104 exceeded")</td>
                  <td className="py-3 pl-4 text-emerald-700">
                    Verified TreeSHAP attributions + Law No. 80 SAR drafts
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Live Scenario Simulator & Retraining Control */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 flex flex-col justify-between space-y-4">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-[#0b1f3f]">
              <Activity className="h-4 w-4 text-emerald-600" />
              <span>Live IPN / InstaPay Scenario Injector</span>
            </div>
            <p className="mt-1 text-xs text-slate-600">
              Simulate real-time Egyptian payment events and observe how Legacy Rules vs. the Four-Tier AI Pipeline react.
            </p>

            <div className="mt-4 space-y-2.5">
              <button
                onClick={() => onInjectScenario('smurfing_ring')}
                className="w-full flex items-start gap-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-left hover:bg-rose-50 transition cursor-pointer"
              >
                <ShieldAlert className="h-4 w-4 text-rose-600 mt-0.5 shrink-0" />
                <div>
                  <div className="text-xs font-semibold text-rose-200">
                    + Inject Smurfing Mule Ring (~9,500 EGP)
                  </div>
                  <div className="text-[11px] text-rose-600/70">
                    6 new mules + 1 collector sharing MAC/IP. Evades 50k/100k rules.
                  </div>
                </div>
              </button>

              <button
                onClick={() => onInjectScenario('cyclic_layering')}
                className="w-full flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-left hover:bg-amber-50 transition cursor-pointer"
              >
                <PlusCircle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                <div>
                  <div className="text-xs font-semibold text-amber-200">
                    + Inject 4-Hop Cyclic Layering Loop
                  </div>
                  <div className="text-[11px] text-amber-600/70">
                    Rapid ~21,500 EGP circular routing returning near origin.
                  </div>
                </div>
              </button>

              <button
                onClick={() => onInjectScenario('seasonal_merchant_surge')}
                className="w-full flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-left hover:bg-emerald-50 transition cursor-pointer"
              >
                <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
                <div>
                  <div className="text-xs font-semibold text-emerald-700">
                    + Inject Benign Ramadan Merchant Surge
                  </div>
                  <div className="text-[11px] text-emerald-700/70">
                    72,500 EGP daytime supplier transfer. Legacy flags; AI clears.
                  </div>
                </div>
              </button>
            </div>
          </div>

          <div className="border-t border-slate-200 pt-3">
            <div className="flex items-center justify-between text-xs text-slate-600 mb-2">
              <span>Tier 3 GBDT Training Set: {trainedSampleCount} records</span>
              {pendingFeedbackCount > 0 && (
                <span className="text-emerald-600 font-medium">
                  +{pendingFeedbackCount} analyst labels
                </span>
              )}
            </div>
            <button
              onClick={onRetrainModel}
              className="w-full flex items-center justify-center gap-2 rounded-lg bg-slate-100 hover:bg-slate-700 border border-slate-300 px-3 py-2 text-xs font-medium text-slate-800 transition cursor-pointer"
            >
              <RefreshCw className="h-3.5 w-3.5 text-sky-700" />
              Retrain Tier 3 GBDT on Analyst Dispositions
            </button>
          </div>
        </div>
      </div>

      {/* 12-Month Phased Implementation Roadmap Selector */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-base font-semibold text-[#0b1f3f]">
              12-Month Phased Rollout &amp; CBE Governance Safeguards
            </h2>
            <p className="text-xs text-slate-600 mt-0.5">
              Switch rollout phase to inspect how governance controls gate auto-suppression and human review.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {PHASES.map((p) => {
            const active = phase === p.id;
            return (
              <button
                key={p.id}
                onClick={() => onPhaseChange(p.id)}
                className={`rounded-2xl border p-4 text-left transition cursor-pointer ${
                  active
                    ? 'border-emerald-500/60 bg-emerald-50 ring-1 ring-emerald-500/30'
                    : 'border-slate-200 bg-slate-50 hover:border-slate-300'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span
                    className={`text-xs font-semibold ${
                      active ? 'text-emerald-700' : 'text-slate-800'
                    }`}
                  >
                    {p.title}
                  </span>
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                    {p.months}
                  </span>
                </div>
                <p className="mt-2 text-xs text-slate-600 leading-relaxed">{p.desc}</p>
                <div className="mt-3 flex items-start gap-1.5 text-[11px] text-slate-700">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-0.5" />
                  <span>{p.safeguard}</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
