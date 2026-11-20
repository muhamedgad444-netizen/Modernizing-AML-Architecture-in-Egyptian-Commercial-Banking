import React from 'react';
import { ClipboardCheck, Lock, ShieldCheck } from 'lucide-react';
import { AuditLogEntry, BenchmarkMetrics, RolloutPhase } from '../engine/types';

interface Props {
  auditLogs: AuditLogEntry[];
  benchmark: BenchmarkMetrics;
  phase: RolloutPhase;
}

export const GovernanceAuditLog: React.FC<Props> = ({ auditLogs, benchmark, phase }) => {
  const principles = [
    {
      title: 'Human Accountability',
      detail: 'People, not models, decide and file every EMLCU Law No. 80 SAR. AI recommends, ranks, and pre-drafts.',
    },
    {
      title: 'Full Traceability',
      detail: 'Every risk score, <0.25 auto-suppression, SHAP attribution, and SAR filing is logged immutably below.',
    },
    {
      title: 'Independent Validation',
      detail: 'Tier 3 GBDT trained on a separate anonymized historical seed — zero train/test leakage.',
    },
    {
      title: 'Data Protection & Anonymization',
      detail: 'Training pipelines consume anonymized behavioral & topological vectors with RBAC-gated graph views.',
    },
    {
      title: 'CBE Change Control',
      detail: 'Threshold changes (0.25 / 0.65) and retraining runs are logged and packaged for CBE audit submission.',
    },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 lg:col-span-2 shadow-sm">
          <h2 className="text-base font-semibold text-[#0b1f3f] flex items-center gap-2 mb-3">
            <ShieldCheck className="h-4 w-4 text-emerald-600" />
            Model Governance &amp; CBE / EMLCU Control Pillars
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {principles.map((p) => (
              <div
                key={p.title}
                className="rounded-lg border border-slate-200 bg-slate-50 p-3"
              >
                <div className="text-xs font-semibold text-emerald-700">{p.title}</div>
                <p className="mt-1 text-[11px] text-slate-600 leading-relaxed">{p.detail}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 flex flex-col justify-between">
          <div>
            <h3 className="text-sm font-semibold text-[#0b1f3f] flex items-center gap-2">
              <ClipboardCheck className="h-4 w-4 text-sky-700" />
              CBE Algorithmic Validation Package
            </h3>
            <p className="mt-1 text-xs text-slate-600">
              Live readiness summary for Central Bank of Egypt supervisory review.
            </p>
            <div className="mt-4 space-y-2 text-xs">
              <div className="flex justify-between border-b border-slate-200 pb-1.5">
                <span className="text-slate-600">Active Rollout Gate</span>
                <span className="font-mono text-emerald-700">{phase}</span>
              </div>
              <div className="flex justify-between border-b border-slate-200 pb-1.5">
                <span className="text-slate-600">False-Positive Reduction</span>
                <span className="font-mono text-emerald-700">
                  {benchmark.aiPipeline.falsePositiveReductionPct.toFixed(1)}%
                </span>
              </div>
              <div className="flex justify-between border-b border-slate-200 pb-1.5">
                <span className="text-slate-600">Auto-Suppress Cutoff</span>
                <span className="font-mono text-slate-800">&lt; 0.25 (logged)</span>
              </div>
              <div className="flex justify-between border-b border-slate-200 pb-1.5">
                <span className="text-slate-600">Explainability Method</span>
                <span className="font-mono text-sky-700">Exact TreeSHAP</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">Audit Records Logged</span>
                <span className="font-mono text-slate-800">{auditLogs.length}</span>
              </div>
            </div>
          </div>
          <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-2.5 text-[11px] text-emerald-700 flex items-center gap-2">
            <Lock className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
            All suppressed alerts remain reconstructible for Law No. 80 audits.
          </div>
        </div>
      </div>

      {/* Immutable Audit Log Table */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <h3 className="text-sm font-semibold text-[#0b1f3f] mb-3">
          Immutable Compliance &amp; Decision Audit Trail
        </h3>
        <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-white text-slate-600 border-b border-slate-200">
              <tr>
                <th className="py-2 pr-3 font-medium">Timestamp (UTC)</th>
                <th className="py-2 px-3 font-medium">Phase</th>
                <th className="py-2 px-3 font-medium">Action</th>
                <th className="py-2 px-3 font-medium">Actor</th>
                <th className="py-2 pl-3 font-medium">Audit Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-slate-700">
              {[...auditLogs].reverse().map((log) => (
                <tr key={log.id} className="hover:bg-slate-50">
                  <td className="py-2.5 pr-3 font-mono text-[11px] text-slate-600 whitespace-nowrap">
                    {log.timestamp.replace('T', ' ').slice(0, 19)}
                  </td>
                  <td className="py-2.5 px-3 font-mono text-[11px] text-slate-600">
                    {log.phase}
                  </td>
                  <td className="py-2.5 px-3">
                    <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-[10px] text-sky-700">
                      {log.action}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-slate-800 whitespace-nowrap">{log.actor}</td>
                  <td className="py-2.5 pl-3 text-slate-700">{log.details}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
