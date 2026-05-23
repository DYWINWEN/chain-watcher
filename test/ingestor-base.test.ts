import { describe, it, expect } from 'vitest';
import { safeJobId } from '../src/queues/job-id.js';

describe('safeJobId', () => {
  it('joins parts with underscore', () => {
    expect(safeJobId('eth', '0xabc', 0)).toBe('eth_0xabc_0');
  });

  it('scrubs the BullMQ-illegal colon', () => {
    expect(safeJobId('eth', '0xabc:def')).toBe('eth_0xabc_def');
  });

  it('scrubs the BTC vout # separator', () => {
    // BTC NormalizedTx.txHash is `${txid}#${voutIndex}` — must be scrubbed.
    expect(safeJobId('btc', '7f4a...d3e2#0')).toBe('btc_7f4a___d3e2_0');
  });

  it('preserves alphanumeric + underscore + dash', () => {
    expect(safeJobId('eth', '0xAbC_123-Def')).toBe('eth_0xAbC_123-Def');
  });

  it('coerces numeric parts', () => {
    expect(safeJobId('eth', '0xa', 42)).toBe('eth_0xa_42');
  });
});

describe('jobId construction sites (regression pins)', () => {
  it('ingestors/base.ts enqueue() uses safeJobId — no raw colon templates', async () => {
    const { readFileSync } = await import('node:fs');
    const path = new URL('../src/ingestors/base.ts', import.meta.url);
    const src = readFileSync(path, 'utf8');
    const start = src.indexOf('protected async enqueue(');
    const end = src.indexOf('protected saveCheckpoint', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = src.slice(start, end);
    expect(body).not.toMatch(/jobId:\s*`\$\{[^}]+\}:/);
    expect(body).toMatch(/safeJobId\(/);
  });

  it('workers/decoder.ts uses safeJobId — no raw colon templates', async () => {
    const { readFileSync } = await import('node:fs');
    const path = new URL('../src/workers/decoder.ts', import.meta.url);
    const src = readFileSync(path, 'utf8');
    expect(src).not.toMatch(/jobId:\s*`\$\{[^}]+\}:/);
    expect(src).toMatch(/safeJobId\(/);
  });
});
