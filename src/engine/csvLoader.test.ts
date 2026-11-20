import { describe, expect, it } from 'vitest';
import { loadRealDatasetFromFile } from './csvLoader';
import { runFullAMLPipeline } from './pipeline';

function buildIbmCsv(): string {
  const lines = [
    'Timestamp,From Bank,Account,To Bank,Account,Amount Received,Receiving Currency,Amount Paid,Payment Currency,Payment Format,Is Laundering',
  ];
  // benign background traffic
  for (let i = 0; i < 400; i++) {
    const a = `B${i % 60}`;
    const b = `B${(i * 7 + 3) % 60}`;
    if (a === b) continue;
    lines.push(`2022/09/01 ${String(i % 24).padStart(2, '0')}:10,1,${a},2,${b},${500 + (i % 50) * 20},USD,${500 + (i % 50) * 20},USD,ACH,0`);
  }
  // laundering ring: 12 mules -> 1 collector, similar amounts
  for (let m = 0; m < 12; m++) {
    for (let k = 0; k < 3; k++) {
      lines.push(`2022/09/02 0${k}:${10 + m},3,M${m},4,COLL,9500,USD,9500,USD,ACH,1`);
    }
  }
  return lines.join('\n');
}

describe('real CSV loader (IBM AML format)', () => {
  it('parses labels and runs the full pipeline', async () => {
    const file = new File([buildIbmCsv()], 'HI-Small_Trans.csv', { type: 'text/csv' });
    const { dataset, summary } = await loadRealDatasetFromFile(file);
    expect(summary).toContain('REAL data');
    expect(dataset.accounts.some((a) => a.isIllicit)).toBe(true);
    expect(dataset.transactions.length).toBeGreaterThan(400);
    const out = runFullAMLPipeline(dataset);
    expect(out.alerts.length).toBe(dataset.accounts.length);
    expect(out.benchmark.totalIllicitAccounts).toBeGreaterThan(0);
  });
});
