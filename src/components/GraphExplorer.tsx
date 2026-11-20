import React, { useMemo, useState } from 'react';
import { Network, Share2, Sparkles } from 'lucide-react';
import { GraphEdge, Tier3AlertRecord } from '../engine/types';

interface Props {
  alerts: Tier3AlertRecord[];
  edges: GraphEdge[];
  detectedCycles: string[][];
  selectedAccountId: string | null;
  onSelectAccount: (accountId: string) => void;
}

type GraphScope = 'illicit_rings' | 'selected_neighborhood' | 'merchant_vs_mule';

export const GraphExplorer: React.FC<Props> = ({
  alerts,
  edges,
  detectedCycles,
  selectedAccountId,
  onSelectAccount,
}) => {
  const [scope, setScope] = useState<GraphScope>('illicit_rings');
  const [showSharedDeviceEdges, setShowSharedDeviceEdges] = useState(true);

  const alertMap = useMemo(() => new Map(alerts.map((a) => [a.accountId, a])), [alerts]);

  const { visibleNodes, visibleEdges } = useMemo(() => {
    const nodeIds = new Set<string>();

    if (scope === 'illicit_rings') {
      for (const a of alerts) {
        if (a.calibratedRiskScore >= 0.35 || a.tier2.sharedDevicePeers > 0) {
          nodeIds.add(a.accountId);
        }
      }
    } else if (scope === 'selected_neighborhood' && selectedAccountId) {
      nodeIds.add(selectedAccountId);
      // 1-hop + 2-hop neighbors
      const hop1 = new Set<string>();
      for (const e of edges) {
        if (e.from === selectedAccountId) hop1.add(e.to);
        if (e.to === selectedAccountId) hop1.add(e.from);
      }
      for (const id of hop1) nodeIds.add(id);
      for (const e of edges) {
        if (nodeIds.size >= 36) break;
        if (hop1.has(e.from)) nodeIds.add(e.to);
        if (hop1.has(e.to)) nodeIds.add(e.from);
      }
    } else {
      // Compare top 16 high-risk nodes alongside 10 cleared seasonal merchants
      alerts.slice(0, 18).forEach((a) => nodeIds.add(a.accountId));
      alerts
        .filter((a) => a.account.peerGroup === 'seasonal_merchant')
        .slice(0, 10)
        .forEach((a) => nodeIds.add(a.accountId));
    }

    const vNodes = Array.from(nodeIds)
      .map((id) => alertMap.get(id))
      .filter((x): x is Tier3AlertRecord => Boolean(x));

    const vEdges = edges.filter(
      (e) =>
        nodeIds.has(e.from) &&
        nodeIds.has(e.to) &&
        (showSharedDeviceEdges || e.edgeType === 'transfer')
    );

    return { visibleNodes: vNodes, visibleEdges: vEdges };
  }, [alerts, alertMap, edges, scope, selectedAccountId, showSharedDeviceEdges]);

  // Deterministic clustered radial layout: collectors at center, mules in ring, cycles in separate cluster, benign on right
  const positions = useMemo(() => {
    const pos = new Map<string, { x: number; y: number }>();
    const collectors = visibleNodes.filter(
      (n) => n.tier2.fanInScore >= 0.5 || n.account.peerGroup === 'collector_account'
    );
    const cyclic = visibleNodes.filter(
      (n) =>
        !collectors.includes(n) &&
        (n.tier2.cyclicRoutingScore >= 0.5 || n.account.groundTruth === 'illicit_cyclic_layering')
    );
    const mules = visibleNodes.filter(
      (n) =>
        !collectors.includes(n) &&
        !cyclic.includes(n) &&
        n.calibratedRiskScore >= 0.25
    );
    const benign = visibleNodes.filter(
      (n) => !collectors.includes(n) && !cyclic.includes(n) && !mules.includes(n)
    );

    // Collectors near left-center hub
    collectors.forEach((n, idx) => {
      const yOffset = collectors.length === 1 ? 0 : (idx - (collectors.length - 1) / 2) * 85;
      pos.set(n.accountId, { x: 260, y: 220 + yOffset });
    });

    // Mules in ring around collectors
    mules.forEach((n, idx) => {
      const angle = (2 * Math.PI * idx) / Math.max(1, mules.length) - Math.PI / 2;
      const rx = 185;
      const ry = 165;
      pos.set(n.accountId, {
        x: 260 + Math.cos(angle) * rx,
        y: 220 + Math.sin(angle) * ry,
      });
    });

    // Cyclic layering ring on upper-right
    cyclic.forEach((n, idx) => {
      const angle = (2 * Math.PI * idx) / Math.max(1, cyclic.length) - Math.PI / 2;
      pos.set(n.accountId, {
        x: 640 + Math.cos(angle) * 95,
        y: 165 + Math.sin(angle) * 95,
      });
    });

    // Benign merchants / retail on lower-right
    benign.forEach((n, idx) => {
      const cols = 4;
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      pos.set(n.accountId, {
        x: 545 + col * 62,
        y: 325 + row * 48,
      });
    });

    return pos;
  }, [visibleNodes]);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-4 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-[#0b1f3f] flex items-center gap-2">
            <Network className="h-4 w-4 text-violet-700" />
            Tier 2 Topological Graph Relationship Explorer (GAT / Node2Vec)
          </h2>
          <p className="text-xs text-slate-600 mt-0.5">
            Visualizes directed sub-threshold InstaPay transfers, fan-in collector hubs, multi-hop cycles ({detectedCycles.length} detected), and shared MAC/IP device rings.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {(
            [
              { id: 'illicit_rings', label: 'Mule & Cycle Rings' },
              { id: 'selected_neighborhood', label: 'Selected 2-Hop Ego' },
              { id: 'merchant_vs_mule', label: 'Mules vs Cleared Merchants' },
            ] as { id: GraphScope; label: string }[]
          ).map((s) => (
            <button
              key={s.id}
              onClick={() => setScope(s.id)}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium transition cursor-pointer ${
                scope === s.id
                  ? 'bg-[#1d5fe0] text-[#0b1f3f] border border-[#1d5fe0]'
                  : 'bg-slate-50 text-slate-600 border border-slate-200 hover:text-slate-800'
              }`}
            >
              {s.label}
            </button>
          ))}
          <button
            onClick={() => setShowSharedDeviceEdges((v) => !v)}
            className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium border transition cursor-pointer ${
              showSharedDeviceEdges
                ? 'border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700'
                : 'border-slate-200 bg-slate-50 text-slate-600'
            }`}
          >
            <Share2 className="h-3 w-3" />
            Device/IP Links
          </button>
        </div>
      </div>

      {/* SVG Network Canvas */}
      <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
        <svg viewBox="0 0 820 440" className="w-full h-[420px] select-none">
          <defs>
            <marker
              id="arrow-sub"
              viewBox="0 0 10 10"
              refX="20"
              refY="5"
              markerWidth="5"
              markerHeight="5"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#f43f5e" opacity="0.8" />
            </marker>
            <marker
              id="arrow-norm"
              viewBox="0 0 10 10"
              refX="20"
              refY="5"
              markerWidth="5"
              markerHeight="5"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#64748b" opacity="0.6" />
            </marker>
          </defs>

          {/* Subtle cluster labels */}
          {scope === 'illicit_rings' && (
            <>
              <text x="260" y="24" textAnchor="middle" className="fill-rose-400/70 text-[11px] font-semibold">
                SMURFING MULE RING &amp; FAN-IN COLLECTORS (~9,500 EGP)
              </text>
              <text x="640" y="38" textAnchor="middle" className="fill-amber-400/70 text-[11px] font-semibold">
                MULTI-HOP CYCLIC LAYERING RING
              </text>
            </>
          )}

          {/* Edges */}
          {visibleEdges.map((edge, idx) => {
            const p1 = positions.get(edge.from);
            const p2 = positions.get(edge.to);
            if (!p1 || !p2) return null;

            const isHighlighted =
              edge.from === selectedAccountId || edge.to === selectedAccountId;

            if (edge.edgeType === 'shared_device') {
              return (
                <line
                  key={`dev-${idx}`}
                  x1={p1.x}
                  y1={p1.y}
                  x2={p2.x}
                  y2={p2.y}
                  stroke="#d946ef"
                  strokeWidth={isHighlighted ? 2 : 1}
                  strokeDasharray="4 4"
                  opacity={isHighlighted ? 0.85 : 0.35}
                />
              );
            }

            return (
              <line
                key={`tx-${idx}`}
                x1={p1.x}
                y1={p1.y}
                x2={p2.x}
                y2={p2.y}
                stroke={edge.isSubThreshold ? '#f43f5e' : '#94a3b8'}
                strokeWidth={isHighlighted ? 2.2 : edge.isSubThreshold ? 1.3 : 1}
                opacity={isHighlighted ? 0.95 : edge.isSubThreshold ? 0.55 : 0.35}
                markerEnd={edge.isSubThreshold ? 'url(#arrow-sub)' : 'url(#arrow-norm)'}
              />
            );
          })}

          {/* Nodes */}
          {visibleNodes.map((node) => {
            const p = positions.get(node.accountId);
            if (!p) return null;
            const isSelected = node.accountId === selectedAccountId;
            const isCollector =
              node.tier2.fanInScore >= 0.5 || node.account.peerGroup === 'collector_account';
            const radius = isCollector ? 16 : node.triageBand === 'high_risk' ? 11 : 9;

            const fill =
              node.triageBand === 'high_risk'
                ? '#e11d48'
                : node.triageBand === 'medium_review'
                ? '#f59e0b'
                : '#10b981';

            return (
              <g
                key={node.accountId}
                transform={`translate(${p.x}, ${p.y})`}
                onClick={() => onSelectAccount(node.accountId)}
                className="cursor-pointer"
              >
                {isSelected && (
                  <circle
                    r={radius + 6}
                    fill="none"
                    stroke="#38bdf8"
                    strokeWidth="2"
                    strokeDasharray="3 2"
                  />
                )}
                <circle
                  r={radius}
                  fill={fill}
                  stroke={isSelected ? '#0b1f3f' : '#ffffff'}
                  strokeWidth={isSelected ? 2.5 : 1.5}
                />
                <text
                  y={radius + 12}
                  textAnchor="middle"
                  className="fill-slate-300 text-[9px] font-mono pointer-events-none"
                >
                  {node.accountId.replace('ACC-', '')}
                </text>
                <title>
                  {`${node.account.name} (${node.accountId})\nRisk: ${(
                    node.calibratedRiskScore * 100
                  ).toFixed(1)}%\nPatterns: ${
                    node.tier2.detectedPatterns.join(', ') || 'None'
                  }`}
                </title>
              </g>
            );
          })}
        </svg>

        {/* Legend */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white px-4 py-2 text-[11px] text-slate-600">
          <div className="flex flex-wrap items-center gap-4">
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-rose-600" /> High Risk (&ge;0.65)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-amber-500" /> Medium Review
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" /> Cleared Benign (&lt;0.25)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-0.5 w-4 bg-rose-500" /> Sub-Threshold Transfer
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-0.5 w-4 border-t border-dashed border-fuchsia-500" /> Shared MAC/IP Link
            </span>
          </div>
          <span className="flex items-center gap-1 text-slate-500">
            <Sparkles className="h-3 w-3 text-sky-700" /> Click any node to inspect SHAP &amp; SAR
          </span>
        </div>
      </div>
    </div>
  );
};

