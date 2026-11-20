import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  Filter,
  Search,
  ShieldAlert,
  ShieldOff,
} from 'lucide-react';
import { RolloutPhase, Tier3AlertRecord } from '../engine/types';

interface Props {
  alerts: Tier3AlertRecord[];
  selectedAccountId: string | null;
  onSelectAccount: (accountId: string) => void;
  phase: RolloutPhase;
}

type QueueFilter =
  | 'escalated'
  | 'high_risk'
  | 'auto_suppressed'
  | 'legacy_blind_spots'
  | 'legacy_fp_cleared'
  | 'all';

export const AlertTriageQueue: React.FC<Props> = ({
  alerts,
  selectedAccountId,
  onSelectAccount,
  phase,
}) => {
  const [filter, setFilter] = useState<QueueFilter>('escalated');
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    return alerts.filter((a) => {
      if (filter === 'escalated' && a.triageBand === 'auto_suppressed') return false;
      if (filter === 'high_risk' && a.triageBand !== 'high_risk') return false;
      if (filter === 'auto_suppressed' && a.triageBand !== 'auto_suppressed') return false;
      if (
        filter === 'legacy_blind_spots' &&
        !(a.triageBand !== 'auto_suppressed' && a.legacyAlert === null)
      ) {
        return false;
      }
      if (
        filter === 'legacy_fp_cleared' &&
        !(a.triageBand === 'auto_suppressed' && a.legacyAlert !== null)
      ) {
        return false;
      }

      if (query.trim()) {
        const q = query.toLowerCase();
        return (
          a.account.name.toLowerCase().includes(q) ||
          a.account.id.toLowerCase().includes(q) ||
          a.account.handle.toLowerCase().includes(q) ||
          a.account.bank.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [alerts, filter, query]);

  const counts = useMemo(
    () => ({
      escalated: alerts.filter((a) => a.triageBand !== 'auto_suppressed').length,
      high_risk: alerts.filter((a) => a.triageBand === 'high_risk').length,
      auto_suppressed: alerts.filter((a) => a.triageBand === 'auto_suppressed').length,
      legacy_blind_spots: alerts.filter(
        (a) => a.triageBand !== 'auto_suppressed' && a.legacyAlert === null
      ).length,
      legacy_fp_cleared: alerts.filter(
        (a) => a.triageBand === 'auto_suppressed' && a.legacyAlert !== null
      ).length,
    }),
    [alerts]
  );

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-4 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-[#0b1f3f] flex items-center gap-2">
            <Filter className="h-4 w-4 text-emerald-600" />
            Tier 3 Calibrated Alert Triage Queue
          </h2>
          <p className="text-xs text-slate-600 mt-0.5">
            {phase === 'phase1_shadow'
              ? 'Shadow Mode: displaying AI scores in parallel with legacy engine.'
              : phase === 'phase2_hybrid'
              ? 'Hybrid Decision Support: ranked queue with SHAP explanations for analyst review.'
              : 'Automated L1 Triage: scores < 0.25 auto-suppressed into immutable audit logs.'}
          </p>
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-500" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search account, handle, bank..."
            className="w-full rounded-lg border border-slate-300 bg-slate-50 pl-8 pr-3 py-1.5 text-xs text-slate-800 placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
          />
        </div>
      </div>

      {/* Filter Pills */}
      <div className="flex flex-wrap gap-2">
        {(
          [
            { id: 'escalated', label: `Escalated Queue (>=0.25)`, count: counts.escalated },
            { id: 'high_risk', label: `High Risk (>=0.65)`, count: counts.high_risk },
            {
              id: 'legacy_blind_spots',
              label: `Legacy Blind Spots (Rules Missed)`,
              count: counts.legacy_blind_spots,
            },
            {
              id: 'legacy_fp_cleared',
              label: `Legacy False Positives Cleared`,
              count: counts.legacy_fp_cleared,
            },
            {
              id: 'auto_suppressed',
              label: `Auto-Suppressed Audit (<0.25)`,
              count: counts.auto_suppressed,
            },
            { id: 'all', label: `All Accounts`, count: alerts.length },
          ] as { id: QueueFilter; label: string; count: number }[]
        ).map((tab) => (
          <button
            key={tab.id}
            onClick={() => setFilter(tab.id)}
            className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition cursor-pointer ${
              filter === tab.id
                ? 'bg-[#1d5fe0] text-[#0b1f3f] border border-[#1d5fe0]'
                : 'bg-slate-50 text-slate-600 border border-slate-200 hover:border-slate-300 hover:text-slate-800'
            }`}
          >
            {tab.label}{' '}
            <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-700">
              {tab.count}
            </span>
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="overflow-x-auto max-h-[540px] overflow-y-auto">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-white text-slate-600 border-b border-slate-200 z-10">
            <tr>
              <th className="py-2.5 pr-3 font-medium">Account / Handle</th>
              <th className="py-2.5 px-3 font-medium">Tier 3 Risk</th>
              <th className="py-2.5 px-3 font-medium">Tier 1 / Tier 2</th>
              <th className="py-2.5 px-3 font-medium">Legacy Engine</th>
              <th className="py-2.5 px-3 font-medium">Graph &amp; Behavior Signals</th>
              <th className="py-2.5 pl-3 font-medium text-right">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {filtered.map((item) => {
              const isSelected = item.accountId === selectedAccountId;
              const scorePct = (item.calibratedRiskScore * 100).toFixed(1);
              const barColor =
                item.triageBand === 'high_risk'
                  ? 'bg-rose-500'
                  : item.triageBand === 'medium_review'
                  ? 'bg-amber-400'
                  : 'bg-emerald-500';

              return (
                <tr
                  key={item.accountId}
                  onClick={() => onSelectAccount(item.accountId)}
                  className={`cursor-pointer transition ${
                    isSelected
                      ? 'bg-emerald-50'
                      : 'hover:bg-slate-50'
                  }`}
                >
                  <td className="py-3 pr-3">
                    <div className="font-semibold text-slate-800">{item.account.name}</div>
                    <div className="text-[11px] text-slate-600">
                      {item.account.id} · {item.account.bank} · {item.account.handle}
                    </div>
                  </td>

                  <td className="py-3 px-3">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-16 rounded-full bg-slate-100 overflow-hidden">
                        <div
                          className={`h-full ${barColor}`}
                          style={{ width: `${Math.min(100, item.calibratedRiskScore * 100)}%` }}
                        />
                      </div>
                      <span
                        className={`font-mono font-semibold ${
                          item.triageBand === 'high_risk'
                            ? 'text-rose-600'
                            : item.triageBand === 'medium_review'
                            ? 'text-amber-600'
                            : 'text-emerald-600'
                        }`}
                      >
                        {scorePct}%
                      </span>
                    </div>
                  </td>

                  <td className="py-3 px-3 font-mono text-[11px] text-slate-700">
                    <div>T1: {item.tier1.tier1AnomalyScore.toFixed(2)}</div>
                    <div className="text-violet-700">
                      T2: {item.tier2.tier2TopologicalScore.toFixed(2)}
                    </div>
                  </td>

                  <td className="py-3 px-3">
                    {item.legacyAlert ? (
                      <span className="inline-flex items-center gap-1 rounded bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-600 border border-amber-200">
                        <AlertCircle className="h-3 w-3" />
                        Rule Fired ({item.legacyAlert.triggeredRules.length})
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                        <ShieldOff className="h-3 w-3" />
                        Missed by Rules
                      </span>
                    )}
                  </td>

                  <td className="py-3 px-3 max-w-[240px]">
                    {item.tier2.detectedPatterns.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {item.tier2.detectedPatterns.slice(0, 2).map((p) => (
                          <span
                            key={p}
                            className="rounded bg-violet-50 border border-violet-200 px-1.5 py-0.5 text-[10px] text-violet-700"
                          >
                            {p}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-[11px] text-slate-500">
                        Normal peer baseline ({item.account.peerGroup.replace('_', ' ')})
                      </span>
                    )}
                  </td>

                  <td className="py-3 pl-3 text-right">
                    {item.disposition === 'confirmed_sar' ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-600">
                        <ShieldAlert className="h-3 w-3" />
                        SAR Filed
                      </span>
                    ) : item.disposition === 'closed_benign' ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                        <CheckCircle2 className="h-3 w-3" />
                        Closed Benign
                      </span>
                    ) : item.triageBand === 'auto_suppressed' ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                        Suppressed
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-medium text-sky-700">
                        <Eye className="h-3 w-3" />
                        Inspect
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="py-8 text-center text-xs text-slate-500">
                  No accounts match the selected filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
