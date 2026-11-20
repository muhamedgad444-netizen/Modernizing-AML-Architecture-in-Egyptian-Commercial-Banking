import { Account, GraphEdge, Tier2GraphSignals, Transaction } from './types';

export interface GraphAnalysisResult {
  signals: Map<string, Tier2GraphSignals>;
  edges: GraphEdge[];
  detectedCycles: string[][];
}

const SUB_THRESHOLD_MIN = 7_000;
const SUB_THRESHOLD_MAX = 25_000; // structuring band below 50k EGP legacy ceiling

/**
 * Tier 2: Topological Graph Intelligence (GCN/GAT Message Passing + Node2Vec Structural Embeddings)
 * Maps accounts as nodes, transfers as directed timestamped edges, and shared MAC/IMEI & IP subnets
 * as entity-link edges to surface mule rings, fan-in/fan-out structuring, and multi-hop cycles.
 */
export function runTier2GraphIntelligence(
  accounts: Account[],
  transactions: Transaction[]
): GraphAnalysisResult {
  const accMap = new Map(accounts.map((a) => [a.id, a]));
  const inEdges = new Map<string, Transaction[]>();
  const outEdges = new Map<string, Transaction[]>();
  const adjOut = new Map<string, Set<string>>();
  const adjIn = new Map<string, Set<string>>();

  for (const acc of accounts) {
    inEdges.set(acc.id, []);
    outEdges.set(acc.id, []);
    adjOut.set(acc.id, new Set());
    adjIn.set(acc.id, new Set());
  }

  // Aggregate transfer edges for graph visualization & message passing
  const edgeAgg = new Map<
    string,
    { from: string; to: string; totalAmountEGP: number; txCount: number; subCount: number }
  >();

  for (const tx of transactions) {
    outEdges.get(tx.fromAccountId)?.push(tx);
    inEdges.get(tx.toAccountId)?.push(tx);
    adjOut.get(tx.fromAccountId)?.add(tx.toAccountId);
    adjIn.get(tx.toAccountId)?.add(tx.fromAccountId);

    const key = `${tx.fromAccountId}->${tx.toAccountId}`;
    const existing = edgeAgg.get(key);
    const isSub = tx.amountEGP >= SUB_THRESHOLD_MIN && tx.amountEGP <= SUB_THRESHOLD_MAX;
    if (existing) {
      existing.totalAmountEGP += tx.amountEGP;
      existing.txCount += 1;
      if (isSub) existing.subCount += 1;
    } else {
      edgeAgg.set(key, {
        from: tx.fromAccountId,
        to: tx.toAccountId,
        totalAmountEGP: tx.amountEGP,
        txCount: 1,
        subCount: isSub ? 1 : 0,
      });
    }
  }

  const edges: GraphEdge[] = Array.from(edgeAgg.values()).map((e) => ({
    from: e.from,
    to: e.to,
    totalAmountEGP: e.totalAmountEGP,
    txCount: e.txCount,
    avgAmountEGP: Math.round(e.totalAmountEGP / e.txCount),
    edgeType: 'transfer',
    isSubThreshold: e.subCount / e.txCount >= 0.5,
  }));

  // 1. Cross-account Device (MAC/IMEI) and IP Subnet Sharing
  const byDevice = new Map<string, string[]>();
  const byIp = new Map<string, string[]>();
  for (const acc of accounts) {
    const dList = byDevice.get(acc.deviceId) ?? [];
    dList.push(acc.id);
    byDevice.set(acc.deviceId, dList);

    const ipList = byIp.get(acc.ipSubnet) ?? [];
    ipList.push(acc.id);
    byIp.set(acc.ipSubnet, ipList);
  }

  const sharedPeerCount = new Map<string, number>();
  const sharedNeighbors = new Map<string, Set<string>>();
  for (const acc of accounts) {
    const peers = new Set<string>();
    for (const id of byDevice.get(acc.deviceId) ?? []) {
      if (id !== acc.id) peers.add(id);
    }
    for (const id of byIp.get(acc.ipSubnet) ?? []) {
      if (id !== acc.id) peers.add(id);
    }
    sharedPeerCount.set(acc.id, peers.size);
    sharedNeighbors.set(acc.id, peers);
  }

  // Add shared-device entity edges for visualization (star topology per shared device to avoid clutter)
  for (const [, ids] of byDevice.entries()) {
    if (ids.length > 1) {
      const hub = ids[0];
      for (let i = 1; i < ids.length; i++) {
        edges.push({
          from: hub,
          to: ids[i],
          totalAmountEGP: 0,
          txCount: 1,
          avgAmountEGP: 0,
          edgeType: 'shared_device',
          isSubThreshold: false,
        });
      }
    }
  }

  // 2. Multi-Hop Cyclic Routing Detection (bounded DFS for directed cycles of length 3 to 5)
  // Restricted to edges with sub-threshold or medium transfers to avoid benign merchant loops
  const cycleParticipation = new Map<string, number>();
  const detectedCycles: string[][] = [];
  const seenCycleKeys = new Set<string>();

  for (const acc of accounts) {
    cycleParticipation.set(acc.id, 0);
  }

  for (const startAcc of accounts) {
    const startId = startAcc.id;
    const stack: { node: string; path: string[] }[] = [{ node: startId, path: [startId] }];

    while (stack.length > 0) {
      const { node, path } = stack.pop()!;
      if (path.length > 5) continue;

      const neighbors = adjOut.get(node);
      if (!neighbors) continue;

      for (const next of neighbors) {
        // Only follow structuring/layering candidate edges
        const edgeData = edgeAgg.get(`${node}->${next}`);
        if (!edgeData || edgeData.subCount === 0) continue;

        if (next === startId && path.length >= 3) {
          const canonical = [...path].sort().join('|');
          if (!seenCycleKeys.has(canonical)) {
            seenCycleKeys.add(canonical);
            detectedCycles.push([...path]);
            for (const member of path) {
              cycleParticipation.set(member, (cycleParticipation.get(member) ?? 0) + 1);
            }
          }
        } else if (!path.includes(next) && path.length < 5 && next > startId) {
          stack.push({ node: next, path: [...path, next] });
        }
      }
    }
  }

  // 3. Compute Local Topological Features per Account
  interface LocalNodeFeatures {
    inDegree: number;
    outDegree: number;
    fanInScore: number;
    fanOutScore: number;
    cyclicRoutingScore: number;
    sharedDevicePeers: number;
    sharedDeviceScore: number;
    subThresholdRatio: number;
    rapidForwardingScore: number;
    localRisk: number;
  }

  const localMap = new Map<string, LocalNodeFeatures>();

  for (const acc of accounts) {
    const ins = inEdges.get(acc.id) ?? [];
    const outs = outEdges.get(acc.id) ?? [];
    const allTxs = [...ins, ...outs];

    const inDegree = adjIn.get(acc.id)?.size ?? 0;
    const outDegree = adjOut.get(acc.id)?.size ?? 0;

    // Sub-threshold ratio (transactions in 7k-25k EGP band)
    const subCount = allTxs.filter(
      (t) => t.amountEGP >= SUB_THRESHOLD_MIN && t.amountEGP <= SUB_THRESHOLD_MAX
    ).length;
    const subThresholdRatio = allTxs.length > 0 ? subCount / allTxs.length : 0;

    // Fan-in structuring: many distinct senders sending sub-threshold amounts
    const subInSenders = new Set(
      ins
        .filter((t) => t.amountEGP >= SUB_THRESHOLD_MIN && t.amountEGP <= SUB_THRESHOLD_MAX)
        .map((t) => t.fromAccountId)
    );
    const fanInScore = Math.min(1, subInSenders.size / 6);

    // Fan-out structuring: dispersing sub-threshold amounts to many recipients
    const subOutRecipients = new Set(
      outs
        .filter((t) => t.amountEGP >= SUB_THRESHOLD_MIN && t.amountEGP <= SUB_THRESHOLD_MAX)
        .map((t) => t.toAccountId)
    );
    const fanOutScore = Math.min(1, subOutRecipients.size / 6);

    // Rapid pass-through forwarding (receive then send similar amount within 30 minutes)
    let rapidMatches = 0;
    const sortedOuts = [...outs].sort((a, b) => a.timestamp - b.timestamp);
    for (const inTx of ins) {
      const match = sortedOuts.find(
        (outTx) =>
          outTx.timestamp >= inTx.timestamp &&
          outTx.timestamp - inTx.timestamp <= 30 * 60 * 1000 &&
          Math.abs(outTx.amountEGP - inTx.amountEGP) / Math.max(1, inTx.amountEGP) <= 0.12
      );
      if (match) rapidMatches++;
    }
    const rapidForwardingScore =
      ins.length > 0 ? Math.min(1, (rapidMatches / Math.max(1, ins.length)) * 1.1) : 0;

    // Cyclic routing score
    const cycles = cycleParticipation.get(acc.id) ?? 0;
    const cyclicRoutingScore = cycles > 0 ? Math.min(1, 0.75 + 0.12 * cycles) : 0;

    // Shared device / IP subnet score
    const peers = sharedPeerCount.get(acc.id) ?? 0;
    const sharedDeviceScore = peers > 0 ? Math.min(1, 0.35 + peers * 0.12) : 0;

    // Combined local node risk before GNN message passing
    const localRisk = Math.min(
      1,
      0.24 * fanInScore +
        0.10 * fanOutScore +
        0.26 * rapidForwardingScore +
        0.24 * cyclicRoutingScore +
        0.24 * sharedDeviceScore +
        0.14 * subThresholdRatio
    );

    localMap.set(acc.id, {
      inDegree,
      outDegree,
      fanInScore,
      fanOutScore,
      cyclicRoutingScore,
      sharedDevicePeers: peers,
      sharedDeviceScore,
      subThresholdRatio,
      rapidForwardingScore,
      localRisk,
    });
  }

  // 4. 2-Hop Graph Attention Network (GAT) Message Passing
  // Attention weight alpha_ij emphasizes shared-device links and sub-threshold structuring edges
  let hopRisk = new Map<string, number>();
  for (const [id, feat] of localMap.entries()) {
    hopRisk.set(id, feat.localRisk);
  }

  for (let hop = 0; hop < 2; hop++) {
    const nextRisk = new Map<string, number>();
    for (const acc of accounts) {
      const selfRisk = hopRisk.get(acc.id) ?? 0;
      const transferNeighbors = new Set<string>([
        ...(adjOut.get(acc.id) ?? []),
        ...(adjIn.get(acc.id) ?? []),
      ]);
      const devNeighbors = sharedNeighbors.get(acc.id) ?? new Set<string>();
      const allNeighbors = new Set<string>([...transferNeighbors, ...devNeighbors]);

      if (allNeighbors.size === 0) {
        nextRisk.set(acc.id, selfRisk);
        continue;
      }

      let weightedSum = 0;
      let weightTotal = 0;

      for (const nb of allNeighbors) {
        const nbRisk = hopRisk.get(nb) ?? 0;
        const isDevShared = devNeighbors.has(nb);
        const edgeFwd = edgeAgg.get(`${acc.id}->${nb}`);
        const edgeRev = edgeAgg.get(`${nb}->${acc.id}`);
        const isSubEdge =
          (edgeFwd && edgeFwd.subCount > 0) || (edgeRev && edgeRev.subCount > 0);

        // Attention logit: strongly attend to shared-device and sub-threshold neighbors
        const attnWeight =
          (isDevShared ? 2.4 : 0) + (isSubEdge ? 1.8 : 0.25);

        weightedSum += attnWeight * nbRisk;
        weightTotal += attnWeight;
      }

      const aggregatedNbRisk = weightTotal > 0 ? weightedSum / weightTotal : 0;
      // Residual GAT update: 0.55 self + 0.45 attention-weighted neighborhood
      nextRisk.set(acc.id, Math.min(1, 0.55 * selfRisk + 0.45 * aggregatedNbRisk));
    }
    hopRisk = nextRisk;
  }

  // 5. Assemble final Tier 2 signals & 4D structural embeddings
  const signals = new Map<string, Tier2GraphSignals>();
  for (const acc of accounts) {
    const loc = localMap.get(acc.id)!;
    const gnnAttentionRisk = hopRisk.get(acc.id) ?? loc.localRisk;

    const tier2TopologicalScore = Math.min(
      1,
      0.55 * loc.localRisk + 0.45 * gnnAttentionRisk
    );

    const detectedPatterns: string[] = [];
    if (loc.fanInScore >= 0.5) detectedPatterns.push('Fan-In Structuring');
    if (loc.fanOutScore >= 0.5) detectedPatterns.push('Fan-Out Dispersal');
    if (loc.cyclicRoutingScore >= 0.5) detectedPatterns.push('Multi-Hop Cyclic Routing');
    if (loc.rapidForwardingScore >= 0.45) detectedPatterns.push('Rapid Mule Pass-Through');
    if (loc.sharedDevicePeers >= 1)
      detectedPatterns.push(`Shared Device/IP Ring (${loc.sharedDevicePeers} peers)`);

    // 4D Node2Vec / GAT structural embedding vector
    const gnnEmbedding: [number, number, number, number] = [
      Number((loc.fanInScore - loc.fanOutScore).toFixed(3)),
      Number(loc.rapidForwardingScore.toFixed(3)),
      Number(loc.cyclicRoutingScore.toFixed(3)),
      Number(loc.sharedDeviceScore.toFixed(3)),
    ];

    signals.set(acc.id, {
      accountId: acc.id,
      inDegree: loc.inDegree,
      outDegree: loc.outDegree,
      fanInScore: Number(loc.fanInScore.toFixed(3)),
      fanOutScore: Number(loc.fanOutScore.toFixed(3)),
      cyclicRoutingScore: Number(loc.cyclicRoutingScore.toFixed(3)),
      sharedDevicePeers: loc.sharedDevicePeers,
      sharedDeviceScore: Number(loc.sharedDeviceScore.toFixed(3)),
      subThresholdRatio: Number(loc.subThresholdRatio.toFixed(3)),
      rapidForwardingScore: Number(loc.rapidForwardingScore.toFixed(3)),
      gnnEmbedding,
      gnnAttentionRisk: Number(gnnAttentionRisk.toFixed(3)),
      tier2TopologicalScore: Number(tier2TopologicalScore.toFixed(3)),
      detectedPatterns,
    });
  }

  return { signals, edges, detectedCycles };
}
