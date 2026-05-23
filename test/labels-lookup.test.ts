import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let getDb: typeof import('../src/storage/db.js').getDb;
let getLabels: typeof import('../src/labels/lookup.js').getLabels;
let invalidateLabel: typeof import('../src/labels/lookup.js').invalidateLabel;
let upsertOne: (chain: string, address: string, label: string, category: string, source: string, risk: number) => void;

beforeEach(async () => {
  vi.resetModules();
  process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'cw-labels-')), 'cw.db');
  ({ getDb } = await import('../src/storage/db.js'));
  ({ getLabels, invalidateLabel } = await import('../src/labels/lookup.js'));
  const db = getDb();
  upsertOne = (chain, address, label, category, source, risk) => {
    const now = Math.floor(Date.now() / 1000);
    db.prepare(
      `INSERT OR REPLACE INTO labels (chain, address, label, category, source, risk_score, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(chain, address, label, category, source, risk, now, now);
  };
});

describe('getLabels', () => {
  it('returns [] for an unknown address', () => {
    expect(getLabels('eth', '0xunknown')).toEqual([]);
  });

  it('returns all matching labels for an address', () => {
    upsertOne('eth', '0xa', 'Binance Hot 14', 'cex', 'etherscan-labels', 10);
    upsertOne('eth', '0xa', 'OFAC SDN', 'ofac', 'ofac_sdn', 95);
    const rows = getLabels('eth', '0xa');
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.category).sort()).toEqual(['cex', 'ofac']);
  });

  it('serves repeated queries from the cache (no extra DB roundtrip)', () => {
    upsertOne('eth', '0xb', 'X', 'cex', 'etherscan-labels', 10);
    const a = getLabels('eth', '0xb');
    // mutate DB out-of-band; cache should still return stale value
    getDb().prepare(`DELETE FROM labels WHERE address = '0xb'`).run();
    const b = getLabels('eth', '0xb');
    expect(b).toEqual(a);
    expect(b).toHaveLength(1);
  });

  it('invalidateLabel clears the entry from the cache', () => {
    upsertOne('eth', '0xc', 'X', 'cex', 'etherscan-labels', 10);
    getLabels('eth', '0xc'); // prime
    getDb().prepare(`DELETE FROM labels WHERE address = '0xc'`).run();
    invalidateLabel('eth', '0xc');
    expect(getLabels('eth', '0xc')).toEqual([]);
  });
});
