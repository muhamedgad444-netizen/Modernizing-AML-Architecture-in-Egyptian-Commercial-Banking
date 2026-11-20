import { Account, GroundTruthLabel, PeerGroup, Transaction } from './types';
import type { SimulatedDataset } from './simulator';

export interface LoadedDataset {
  dataset: SimulatedDataset;
  summary: string;
}

interface RawTx {
  from: string;
  to: string;
  amount: number;
  ts: number;
  laundering: boolean;
  bank: string;
}

const MAX_ROWS = 400_000;
const MAX_ILLICIT_ACCOUNTS = 150;
const MAX_BENIGN_ACCOUNTS = 450;
const MAX_TX = 20_000;

function splitCsv(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') q = !q;
    else if (c === ',' && !q) {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Detects IBM AMLworld (HI/LI-*_Trans.csv) or SAML-D format, or a generic CSV. */
function makeRowParser(header: string[]): (cols: string[]) => RawTx | null {
  const h = header.map((x) => x.toLowerCase());
  const idx = (name: string) => h.indexOf(name);

  // IBM AML: Timestamp,From Bank,Account,To Bank,Account,Amount Received,...,Amount Paid,...,Payment Format,Is Laundering
  if (h[0] === 'timestamp' && h.includes('is laundering')) {
    const iAmt = h.indexOf('amount paid');
    const iLaund = h.indexOf('is laundering');
    return (c) => {
      const amount = parseFloat(c[iAmt]);
      const ts = new Date(c[0].replace(/\//g, '-').replace(' ', 'T')).getTime();
      if (!isFinite(amount) || !isFinite(ts)) return null;
      return {
        from: `${c[1]}-${c[2]}`,
        to: `${c[3]}-${c[4]}`,
        amount,
        ts,
        laundering: c[iLaund] === '1',
        bank: c[1],
      };
    };
  }

  // SAML-D: Time,Date,Sender_account,Receiver_account,Payment_amount,...,Is_laundering
  if (h.includes('sender_account') && h.includes('is_laundering')) {
    const iT = idx('time');
    const iD = idx('date');
    const iS = idx('sender_account');
    const iR = idx('receiver_account');
    const iA = idx('payment_amount');
    const iL = idx('is_laundering');
    const iB = idx('sender_bank_location');
    return (c) => {
      const amount = parseFloat(c[iA]);
      const ts = new Date(`${c[iD]}T${c[iT]}`).getTime();
      if (!isFinite(amount) || !isFinite(ts)) return null;
      return { from: c[iS], to: c[iR], amount, ts, laundering: c[iL] === '1', bank: c[iB] ?? 'N/A' };
    };
  }

  // Generic: needs from, to, amount, timestamp, label columns (case-insensitive names)
  const find = (...names: string[]) => names.map((n) => h.indexOf(n)).find((i) => i >= 0) ?? -1;
  const iF = find('from', 'sender', 'source', 'from_account', 'sender_account');
  const iT = find('to', 'receiver', 'destination', 'to_account', 'receiver_account');
  const iA = find('amount', 'amount_egp', 'value');
  const iTs = find('timestamp', 'date', 'time', 'datetime');
  const iL = find('is_laundering', 'is laundering', 'label', 'is_fraud', 'isfraud');
  if (iF < 0 || iT < 0 || iA < 0 || iTs < 0) {
    throw new Error(
      'Unrecognised CSV format. Use IBM AML (HI-Small_Trans.csv), SAML-D, or a CSV with from/to/amount/timestamp/label columns.'
    );
  }
  return (c) => {
    const amount = parseFloat(c[iA]);
    const ts = new Date(c[iTs]).getTime();
    if (!isFinite(amount) || !isFinite(ts)) return null;
    return {
      from: c[iF],
      to: c[iT],
      amount,
      ts,
      laundering: iL >= 0 && ['1', 'true', 'yes'].includes(c[iL].toLowerCase()),
      bank: 'N/A',
    };
  };
}

export async function loadRealDatasetFromFile(file: File): Promise<LoadedDataset> {
  const reader = file.stream().getReader();
  const decoder = new TextDecoder();
  let buffered = '';
  let parser: ((cols: string[]) => RawTx | null) | null = null;
  const rows: RawTx[] = [];
  let done = false;

  const handleLine = (line: string) => {
    if (!line.trim()) return;
    const cols = splitCsv(line);
    if (!parser) {
      parser = makeRowParser(cols);
      return;
    }
    const r = parser(cols);
    if (r && r.from !== r.to) rows.push(r);
  };

  while (!done && rows.length < MAX_ROWS) {
    const { value, done: d } = await reader.read();
    if (d) break;
    buffered += decoder.decode(value, { stream: true });
    const lines = buffered.split(/\r?\n/);
    buffered = lines.pop() ?? '';
    for (const l of lines) {
      handleLine(l);
      if (rows.length >= MAX_ROWS) {
        done = true;
        break;
      }
    }
  }
  reader.cancel().catch(() => undefined);
  if (!done && buffered) handleLine(buffered);
  if (rows.length === 0) throw new Error('No valid transactions found in the file.');

  // Sample a tractable, label-faithful subgraph: illicit accounts + random benign accounts.
  const illicit = new Set<string>();
  for (const r of rows) {
    if (r.laundering) {
      illicit.add(r.from);
      illicit.add(r.to);
    }
  }
  const illicitPick = [...illicit]
    .sort((a, b) => hash(a) - hash(b))
    .slice(0, MAX_ILLICIT_ACCOUNTS);
  const selected = new Set(illicitPick);
  const benignSeen = new Set<string>();
  for (const r of rows) {
    if (!illicit.has(r.from)) benignSeen.add(r.from);
    if (!illicit.has(r.to)) benignSeen.add(r.to);
  }
  [...benignSeen]
    .sort((a, b) => hash(a) - hash(b))
    .slice(0, MAX_BENIGN_ACCOUNTS)
    .forEach((a) => selected.add(a));

  const picked = new Set(illicitPick);
  const txRows = rows
    .filter(
      (r) =>
        picked.has(r.from) ||
        picked.has(r.to) ||
        (selected.has(r.from) && selected.has(r.to))
    )
    .slice(0, MAX_TX);
  const active = new Set<string>();
  txRows.forEach((r) => {
    active.add(r.from);
    active.add(r.to);
  });

  // Per-account statistics for inferred peer groups
  const stats = new Map<string, { in: number; out: number; vol: number; first: number; last: number; bank: string }>();
  const touch = (id: string, ts: number, bank: string) => {
    let s = stats.get(id);
    if (!s) {
      s = { in: 0, out: 0, vol: 0, first: ts, last: ts, bank };
      stats.set(id, s);
    }
    s.first = Math.min(s.first, ts);
    s.last = Math.max(s.last, ts);
    return s;
  };
  for (const r of txRows) {
    touch(r.from, r.ts, r.bank).out++;
    touch(r.to, r.ts, r.bank).in++;
    stats.get(r.from)!.vol += r.amount;
    stats.get(r.to)!.vol += r.amount;
  }

  const spanMs = Math.max(
    86_400_000,
    Math.max(...txRows.map((r) => r.ts)) - Math.min(...txRows.map((r) => r.ts))
  );
  const spanDays = spanMs / 86_400_000;
  const baseTimestamp = Math.min(...txRows.map((r) => r.ts));

  const accounts: Account[] = [...active].map((id) => {
    const s = stats.get(id)!;
    const isIllicit = illicit.has(id);
    const isCollector = s.in >= 5 && s.in > 2 * s.out;
    const peerGroup: PeerGroup = isIllicit
      ? isCollector
        ? 'collector_account'
        : 'mule_account'
      : s.vol / spanDays > 1_000_000
      ? 'sme_corporate'
      : s.out > s.in * 3
      ? 'seasonal_merchant'
      : 'salaried_retail';
    const groundTruth: GroundTruthLabel = isIllicit
      ? isCollector
        ? 'illicit_smurfing_collector'
        : 'illicit_smurfing_mule'
      : 'benign_normal';
    return {
      id,
      name: `Account ${id}`,
      handle: id,
      bank: s.bank,
      governorate: 'N/A',
      peerGroup,
      kycDocType: 'National ID',
      accountAgeDays: Math.max(1, Math.round((s.last - s.first) / 86_400_000)),
      declaredMonthlyIncomeEGP: Math.max(5000, Math.round((s.vol / spanDays) * 30)),
      deviceId: `DEV-${id}`,
      ipSubnet: `n/a-${id}`,
      proxyPhone: '',
      groundTruth,
      isIllicit,
    };
  });

  const transactions: Transaction[] = txRows.map((r, i) => ({
    id: `TX-${i}`,
    fromAccountId: r.from,
    toAccountId: r.to,
    amountEGP: r.amount,
    timestamp: r.ts,
    channel: 'ACH_WIRE',
    deviceId: `DEV-${r.from}`,
    ipSubnet: `n/a-${r.from}`,
    note: r.laundering ? 'labelled laundering' : '',
  }));

  return {
    dataset: { accounts, transactions, baseTimestamp },
    summary: `Loaded REAL data from ${file.name}: ${rows.length.toLocaleString()} rows read; analysing ${accounts.length} accounts (${illicitPick.length} labelled illicit) and ${transactions.length.toLocaleString()} transfers. Amounts are used as-is, with no FX conversion.`,
  };
}
