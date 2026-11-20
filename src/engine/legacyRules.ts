import { Account, LegacyRuleAlert, Transaction } from './types';

export const LEGACY_SINGLE_TX_THRESHOLD_EGP = 50_000;
export const LEGACY_24H_VELOCITY_THRESHOLD_EGP = 100_000;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Legacy deterministic rule-based AML engine:
 * - Rule 101: Single outbound/inbound transfer >= 50,000 EGP
 * - Rule 104: 24-hour rolling aggregate velocity >= 100,000 EGP
 *
 * Blind to sub-threshold smurfing (e.g. 9,500 EGP transfers across mules)
 * and floods analysts with false positives on seasonal merchants, tuition, and payroll.
 */
export function runLegacyRules(
  accounts: Account[],
  transactions: Transaction[]
): Map<string, LegacyRuleAlert> {
  const alerts = new Map<string, LegacyRuleAlert>();
  const txByAccount = new Map<string, Transaction[]>();

  for (const acc of accounts) {
    txByAccount.set(acc.id, []);
  }
  for (const tx of transactions) {
    txByAccount.get(tx.fromAccountId)?.push(tx);
    txByAccount.get(tx.toAccountId)?.push(tx);
  }

  for (const acc of accounts) {
    const txs = (txByAccount.get(acc.id) ?? []).sort((a, b) => a.timestamp - b.timestamp);
    if (txs.length === 0) continue;

    let maxSingleTxEGP = 0;
    let max24hVolumeEGP = 0;
    const flaggedTxIds = new Set<string>();

    // Sliding 24h window
    let left = 0;
    let windowSum = 0;

    for (let right = 0; right < txs.length; right++) {
      const tx = txs[right];
      if (tx.amountEGP > maxSingleTxEGP) {
        maxSingleTxEGP = tx.amountEGP;
      }
      if (tx.amountEGP >= LEGACY_SINGLE_TX_THRESHOLD_EGP) {
        flaggedTxIds.add(tx.id);
      }

      windowSum += tx.amountEGP;
      while (tx.timestamp - txs[left].timestamp > DAY_MS) {
        windowSum -= txs[left].amountEGP;
        left++;
      }
      if (windowSum > max24hVolumeEGP) {
        max24hVolumeEGP = windowSum;
      }
      if (windowSum >= LEGACY_24H_VELOCITY_THRESHOLD_EGP) {
        flaggedTxIds.add(tx.id);
      }
    }

    const triggeredRules: string[] = [];
    if (maxSingleTxEGP >= LEGACY_SINGLE_TX_THRESHOLD_EGP) {
      triggeredRules.push(
        `Rule 101: Single Transfer >= ${LEGACY_SINGLE_TX_THRESHOLD_EGP.toLocaleString()} EGP`
      );
    }
    if (max24hVolumeEGP >= LEGACY_24H_VELOCITY_THRESHOLD_EGP) {
      triggeredRules.push(
        `Rule 104: 24h Aggregate Velocity >= ${LEGACY_24H_VELOCITY_THRESHOLD_EGP.toLocaleString()} EGP`
      );
    }

    if (triggeredRules.length > 0) {
      alerts.set(acc.id, {
        accountId: acc.id,
        triggeredRules,
        maxSingleTxEGP,
        max24hVolumeEGP,
        flaggedTxIds: Array.from(flaggedTxIds),
      });
    }
  }

  return alerts;
}
