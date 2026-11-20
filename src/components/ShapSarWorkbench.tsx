import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Cpu,
  FileText,
  Fingerprint,
  Send,
  ShieldCheck,
  UserCheck,
} from 'lucide-react';
import { Tier3AlertRecord } from '../engine/types';

interface Props {
  alert: Tier3AlertRecord | null;
  onDisposition: (
    accountId: string,
    disposition: 'confirmed_sar' | 'closed_benign',
    editedNarrative?: string
  ) => void;
}

export const ShapSarWorkbench: React.FC<Props> = ({ alert, onDisposition }) => {
  const [sarText, setSarText] = useState('');

  useEffect(() => {
    setSarText(alert?.sarDraft?.narrative ?? '');
  }, [alert?.accountId, alert?.sarDraft?.narrative]);

  if (!alert) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-600">
        Select an account from the Alert Triage Queue or Graph Explorer to inspect its Tier 1–4 scores, SHAP attributions, and SAR narrative.
      </div>
    );
  }

  const { account, tier1, tier2, legacyAlert, shapAttributions, calibratedRiskScore, baseValue } =
    alert;
  const maxAbsShap = Math.max(
    0.05,
    ...shapAttributions.map((s) => Math.abs(s.shapValue))
  );
  const shapSum = shapAttributions.reduce((s, a) => s + a.shapValue, 0);

  return (
    <div className="space-y-4">
      {/* Account & 4-Tier Header Card */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg font-bold text-[#0b1f3f]">{account.name}</h2>
              <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-mono text-slate-700">
                {account.id}
              </span>
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                  alert.triageBand === 'high_risk'
                    ? 'bg-rose-50 text-rose-600 border border-rose-200'
                    : alert.triageBand === 'medium_review'
                    ? 'bg-amber-50 text-amber-600 border border-amber-200'
                    : 'bg-[#1d5fe0] text-[#0b1f3f] border border-[#1d5fe0]'
                }`}
              >
                {alert.triageBand === 'high_risk'
                  ? 'HIGH RISK — SENIOR INVESTIGATOR'
                  : alert.triageBand === 'medium_review'
                  ? 'MEDIUM PRIORITY REVIEW'
                  : 'AUTO-SUPPRESSED (< 0.25 BENIGN)'}
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-600">
              {account.handle} · {account.bank} ({account.governorate}) · KYC: {account.kycDocType} · Tenure: {account.accountAgeDays} days
            </p>
          </div>

          <div className="text-left sm:text-right">
            <div className="text-[11px] uppercase tracking-wider text-slate-600">
              Tier 3 Calibrated Score
            </div>
            <div
              className={`text-3xl font-bold font-mono ${
                alert.triageBand === 'high_risk'
                  ? 'text-rose-600'
                  : alert.triageBand === 'medium_review'
                  ? 'text-amber-600'
                  : 'text-emerald-600'
              }`}
            >
              {(calibratedRiskScore * 100).toFixed(1)}%
            </div>
          </div>
        </div>

        {/* Telemetry Grid */}
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 text-xs">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="text-slate-600 text-[11px]">5-Day Volume / Max Tx</div>
            <div className="mt-1 font-semibold text-slate-800">
              {tier1.totalVolumeEGP.toLocaleString()} EGP
            </div>
            <div className="text-[11px] text-slate-500">
              Max single: {tier1.maxAmountEGP.toLocaleString()} EGP
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="text-slate-600 text-[11px]">Tier 1 Behavioral Baseline</div>
            <div className="mt-1 font-semibold text-sky-700">
              IsoForest: {tier1.isolationForestScore.toFixed(2)} · AE: {tier1.autoencoderReconError.toFixed(2)}
            </div>
            <div className="text-[11px] text-slate-500">
              Circadian dev: {(tier1.circadianDeviation * 100).toFixed(0)}%
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="text-slate-600 text-[11px]">Tier 2 Graph Intelligence</div>
            <div className="mt-1 font-semibold text-violet-700">
              GAT Risk: {tier2.gnnAttentionRisk.toFixed(2)} · Ring: {tier2.sharedDevicePeers} peers
            </div>
            <div className="text-[11px] text-slate-500">
              Pass-through: {(tier2.rapidForwardingScore * 100).toFixed(0)}% · Fan-in: {tier2.fanInScore.toFixed(2)}
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="text-slate-600 text-[11px] flex items-center gap-1">
              <Fingerprint className="h-3 w-3 text-fuchsia-700" /> Device &amp; Legacy Rule
            </div>
            <div className="mt-1 font-mono text-[11px] text-slate-800 truncate">
              {account.deviceId}
            </div>
            <div className="text-[11px] text-slate-500">
              {legacyAlert ? (
                <span className="text-amber-600">Legacy Fired ({legacyAlert.triggeredRules.length})</span>
              ) : (
                <span className="text-rose-600">Legacy Blind (0 rules)</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Tier 4 SHAP Explainability Visualizer */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
          <div>
            <h3 className="text-sm font-semibold text-[#0b1f3f] flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-sky-700" />
              Tier 4 Verified TreeSHAP Local Feature Attributions
            </h3>
            <p className="text-xs text-slate-600 mt-0.5">
              Exact additive decomposition for CBE / EMLCU auditors: Base ({(baseValue * 100).toFixed(1)}%) + Σ SHAP ({shapSum >= 0 ? '+' : ''}{(shapSum * 100).toFixed(1)}%) ={' '}
              <span className="text-[#0b1f3f] font-semibold">{(calibratedRiskScore * 100).toFixed(1)}%</span>
            </p>
          </div>
          <span className="inline-flex items-center gap-1 rounded bg-sky-50 border border-sky-200 px-2 py-0.5 text-[11px] text-sky-700">
            <Cpu className="h-3 w-3" /> Zero Black-Box Opacity
          </span>
        </div>

        <div className="space-y-2.5">
          {shapAttributions.slice(0, 8).map((attr) => {
            const pctWidth = Math.min(100, (Math.abs(attr.shapValue) / maxAbsShap) * 100);
            const isPos = attr.shapValue >= 0;
            return (
              <div key={attr.featureKey} className="grid grid-cols-12 items-center gap-2 text-xs">
                <div className="col-span-5 sm:col-span-5 truncate">
                  <span className="text-slate-800 font-medium">{attr.featureLabel}</span>
                  <span className="ml-1.5 text-[10px] font-mono text-slate-500">
                    ({attr.displayValue})
                  </span>
                </div>
                <div className="col-span-5 sm:col-span-5 flex items-center">
                  <div className="w-1/2 flex justify-end pr-1">
                    {!isPos && (
                      <div
                        className="h-2.5 rounded-l bg-emerald-500/80"
                        style={{ width: `${pctWidth}%` }}
                      />
                    )}
                  </div>
                  <div className="h-4 w-px bg-slate-700" />
                  <div className="w-1/2 flex justify-start pl-1">
                    {isPos && (
                      <div
                        className="h-2.5 rounded-r bg-rose-500/80"
                        style={{ width: `${pctWidth}%` }}
                      />
                    )}
                  </div>
                </div>
                <div
                  className={`col-span-2 text-right font-mono text-[11px] font-semibold ${
                    isPos ? 'text-rose-600' : 'text-emerald-600'
                  }`}
                >
                  {isPos ? '+' : ''}
                  {(attr.shapValue * 100).toFixed(1)}%
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Tier 4 Automated SAR Narrative & Human Accountability Controls */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-[#0b1f3f] flex items-center gap-2">
              <FileText className="h-4 w-4 text-amber-600" />
              Tier 4 Automated SAR Narrative Draft (EMLCU Law No. 80)
            </h3>
            <p className="text-xs text-slate-600 mt-0.5">
              Pre-drafted from case facts, graph evidence &amp; SHAP attributions. Investigator edits, approves, and remains accountable for filing.
            </p>
          </div>
          {alert.disposition === 'confirmed_sar' && (
            <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 border border-rose-200 px-2.5 py-1 text-xs font-semibold text-rose-200">
              <ShieldCheck className="h-3.5 w-3.5" /> Filed with EMLCU
            </span>
          )}
          {alert.disposition === 'closed_benign' && (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-1 text-xs font-semibold text-emerald-700">
              <CheckCircle2 className="h-3.5 w-3.5" /> Closed Benign
            </span>
          )}
        </div>

        {alert.sarDraft ? (
          <textarea
            value={sarText}
            onChange={(e) => setSarText(e.target.value)}
            rows={12}
            className="w-full rounded-lg border border-slate-300 bg-slate-50 p-3 font-mono text-xs text-slate-800 leading-relaxed focus:border-emerald-500 focus:outline-none"
          />
        ) : (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600 flex items-start gap-2.5">
            <AlertTriangle className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
            <div>
              This account scored below the 0.25 auto-suppression threshold ({(calibratedRiskScore * 100).toFixed(1)}%) and matches its benign peer baseline. No SAR draft is required unless an investigator manually escalates it.
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-3">
          <div className="flex items-center gap-1.5 text-[11px] text-slate-600">
            <UserCheck className="h-3.5 w-3.5 text-sky-700" />
            <span>Dispositions feed back as labeled training data for Tier 3 GBDT retraining.</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onDisposition(account.id, 'closed_benign')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 hover:bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 transition cursor-pointer"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              Mark Benign (False Positive)
            </button>
            <button
              onClick={() => onDisposition(account.id, 'confirmed_sar', sarText)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 px-3 py-1.5 text-xs font-semibold text-[#0b1f3f] transition cursor-pointer"
            >
              <Send className="h-3.5 w-3.5" />
              Approve &amp; File SAR (EMLCU)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
