import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let scheduleBackfill: typeof import('../src/rules/backfill.js').scheduleBackfill;
let getDb: typeof import('../src/storage/db.js').getDb;
let setSetting: typeof import('../src/config.js').setSetting;
let SETTINGS: typeof import('../src/config.js').SETTINGS;

beforeEach(async () => {
  vi.resetModules();
  process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'cw-backfill-')), 'cw.db');
  ({ getDb } = await import('../src/storage/db.js'));
  ({ setSetting, SETTINGS } = await import('../src/config.js'));
  ({ scheduleBackfill } = await import('../src/rules/backfill.js'));
  setSetting(SETTINGS.chain_eth_ws_url, 'wss://example.invalid', 'test');
  setSetting(SETTINGS.chain_eth_usdt, '0xdAC17F958D2ee523a2206206994597C13D831ec7', 'test');
  setSetting(SETTINGS.backfill_concurrency, 1, 'test');
  setSetting(SETTINGS.backfill_history_window, 5, 'test');
});

describe('scheduleBackfill', () => {
  it('does not crash on a malformed (non-EVM) address — returns gracefully', async () => {
    // BTC-style address inadvertently dispatched to EVM backfill (regression
    // for a real-world misroute path)
    expect(() => scheduleBackfill('eth', 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh', 'out')).not.toThrow();
    // Drain the pLimit queue deterministically — the guard returns synchronously
    // so a few microtask ticks suffice. Avoid wall-clock sleeps that can be racy on slow CI.
    await vi.waitFor(
      () => {
        const row = getDb()
          .prepare(`SELECT 1 FROM windows WHERE chain = ? AND address = ? AND direction = ?`)
          .get('eth', 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh', 'out');
        // The guard MUST short-circuit before markBackfilled runs → no row.
        expect(row).toBeUndefined();
      },
      { timeout: 2000 },
    );
  });
});
