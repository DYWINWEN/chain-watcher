import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let onNormalizedTx: typeof import('../src/rules/engine.js').onNormalizedTx;
let getDb: typeof import('../src/storage/db.js').getDb;
let setSetting: typeof import('../src/config.js').setSetting;
let SETTINGS: typeof import('../src/config.js').SETTINGS;

async function freshModules() {
  vi.resetModules();
  process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'cw-')), 'cw.db');
  ({ getDb } = await import('../src/storage/db.js'));
  ({ setSetting, SETTINGS } = await import('../src/config.js'));
  ({ onNormalizedTx } = await import('../src/rules/engine.js'));
  // seed minimal settings the engine reads
  setSetting(SETTINGS.threshold_usdt, 100, 'test');
  setSetting(SETTINGS.rule_sender_enabled, true, 'test');
  setSetting(SETTINGS.rule_sender_window, 5, 'test');
  setSetting(SETTINGS.rule_receiver_enabled, true, 'test');
  setSetting(SETTINGS.rule_receiver_window, 5, 'test');
  setSetting(SETTINGS.blacklist_cex, true, 'test');
  setSetting(SETTINGS.backfill_enabled, false, 'test');
}

function tx(i: number, from: string, to: string, amt = 200) {
  return {
    chain: 'eth' as const,
    txHash: `0xt${i}`,
    blockNumber: 100 + i,
    timestamp: 1700000000 + i,
    from,
    to,
    token: 'USDT' as const,
    amountRaw: String(amt * 1_000_000),
    amountUsdt: amt,
  };
}

beforeEach(freshModules);

describe('engine', () => {
  it('drops txs at or below threshold', async () => {
    await onNormalizedTx(tx(0, '0xa', '0xb', 50));
    const n = (getDb().prepare('SELECT COUNT(*) AS n FROM tx').get() as { n: number }).n;
    expect(n).toBe(0);
  });

  it('fires sender_repeats_to after 5 txs to same recipient', async () => {
    for (let i = 0; i < 5; i++) await onNormalizedTx(tx(i, '0xa', '0xb', 200));
    const alerts = getDb().prepare('SELECT * FROM alerts').all() as any[];
    expect(alerts.length).toBe(2); // sender_repeats_to + receiver_repeats_from both fire (same 5 pairs)
    const rules = alerts.map((a) => a.rule).sort();
    expect(rules).toContain('sender_repeats_to');
    expect(rules).toContain('receiver_repeats_from');
  });

  it('respects threshold change at runtime', async () => {
    setSetting(SETTINGS.threshold_usdt, 1000, 'test');
    await onNormalizedTx(tx(0, '0xa', '0xb', 500));
    const n = (getDb().prepare('SELECT COUNT(*) AS n FROM tx').get() as { n: number }).n;
    expect(n).toBe(0);
  });

  it('skips alert when counterparty is CEX-blacklisted', async () => {
    const cex = '0xcex';
    getDb().prepare(
      `INSERT INTO address_lists (list_type, chain, address, label, created_at) VALUES ('cex_blacklist', 'eth', ?, 'test', ?)`,
    ).run(cex, Math.floor(Date.now() / 1000));
    for (let i = 0; i < 5; i++) await onNormalizedTx(tx(i, '0xa', cex, 200));
    const alerts = getDb().prepare(`SELECT * FROM alerts WHERE rule = 'sender_repeats_to'`).all() as any[];
    expect(alerts.length).toBe(0); // sender→cex blacklisted: suppressed
  });

  it('disabling rule prevents alert', async () => {
    setSetting(SETTINGS.rule_sender_enabled, false, 'test');
    setSetting(SETTINGS.rule_receiver_enabled, false, 'test');
    for (let i = 0; i < 5; i++) await onNormalizedTx(tx(i, '0xa', '0xb', 200));
    const alerts = getDb().prepare('SELECT * FROM alerts').all();
    expect(alerts.length).toBe(0);
  });
});
