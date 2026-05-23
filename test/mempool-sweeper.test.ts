import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let getDb: typeof import('../src/storage/db.js').getDb;
let sweepOnce: typeof import('../src/jobs/mempool-sweeper.js').sweepOnce;

beforeEach(async () => {
  vi.resetModules();
  process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'cw-sweeper-')), 'cw.db');
  ({ getDb } = await import('../src/storage/db.js'));
  ({ sweepOnce } = await import('../src/jobs/mempool-sweeper.js'));
  getDb();
});

function insertAlert(id: number, txHash: string, status: string, firstSeenBlock = 100): void {
  const now = Math.floor(Date.now() / 1000);
  getDb().prepare(
    `INSERT INTO alerts (id, chain, rule, pivot_address, counterparty, trigger_tx_hash,
                         window_tx_hashes, amount_usdt, created_at,
                         pivot_labels, counterparty_labels, severity, rule_id,
                         status, source, confirmed_block)
       VALUES (?, 'eth', 'r', '0xa', '0xb', ?, '[]', 100, ?, '[]', '[]', 'P2', 'r', ?, 'mempool', NULL)`,
  ).run(id, txHash, now, status);
  getDb().prepare(
    `INSERT OR IGNORE INTO mempool_pending (chain, tx_hash, first_seen, first_seen_block)
       VALUES ('eth', ?, ?, ?)`,
  ).run(txHash, now, firstSeenBlock);
  // Insert/update checkpoint to simulate a head block.
  getDb().prepare(
    `INSERT INTO checkpoints (chain, last_block, updated_at) VALUES ('eth', ?, ?)
       ON CONFLICT(chain) DO UPDATE SET last_block = excluded.last_block`,
  ).run(firstSeenBlock + 20, now);
}

describe('mempool sweeper', () => {
  it('does not drop alerts under the threshold', async () => {
    insertAlert(1, '0xunder', 'pending', 1000);
    // Set head to 1005 — only 5 blocks past first_seen_block; under threshold of 12
    getDb().prepare(`UPDATE checkpoints SET last_block = 1005 WHERE chain = 'eth'`).run();
    await sweepOnce();
    const r = getDb().prepare(`SELECT status FROM alerts WHERE id = 1`).get() as { status: string };
    expect(r.status).toBe('pending');
  });

  it('drops alerts past the 12-block threshold', async () => {
    insertAlert(2, '0xover', 'pending', 1000);
    // Head is already 1020 (1000 + 20) per insertAlert helper. 20 > 12 → drop.
    await sweepOnce();
    const r = getDb().prepare(`SELECT status FROM alerts WHERE id = 2`).get() as { status: string };
    expect(r.status).toBe('dropped');
    const action = getDb().prepare(`SELECT action FROM alert_actions WHERE alert_id = 2`).get();
    expect(action).toBeDefined();
  });

  it('does not drop already-confirmed alerts', async () => {
    insertAlert(3, '0xconfirmed', 'confirmed', 1000);
    getDb().prepare(`UPDATE alerts SET confirmed_block = 1005 WHERE id = 3`).run();
    await sweepOnce();
    const r = getDb().prepare(`SELECT status FROM alerts WHERE id = 3`).get() as { status: string };
    expect(r.status).toBe('confirmed');
  });
});
