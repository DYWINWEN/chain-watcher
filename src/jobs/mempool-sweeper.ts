import { getDb } from '../storage/db.js';
import { bus, EVENTS } from '../utils/event-bus.js';
import { logger } from '../utils/logger.js';
import { getSetting } from '../config.js';

const DEFAULT_THRESHOLD = 12;
const SWEEP_INTERVAL_MS = 30_000;

let timer: NodeJS.Timeout | null = null;

function getHead(chain: string): number {
  const row = getDb()
    .prepare(`SELECT last_block FROM checkpoints WHERE chain = ?`)
    .get(chain) as { last_block: number } | undefined;
  return row?.last_block ?? 0;
}

/** Single-pass sweep. Exported for tests; production loop calls via setInterval. */
export async function sweepOnce(): Promise<number> {
  const threshold = Number(getSetting('mempool.reorg_threshold' as any, DEFAULT_THRESHOLD)) || DEFAULT_THRESHOLD;
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  let dropped = 0;

  // For each chain with mempool data:
  const chains = db
    .prepare(`SELECT DISTINCT chain FROM mempool_pending WHERE confirmed_block IS NULL AND dropped = 0`)
    .all() as Array<{ chain: string }>;
  for (const { chain } of chains) {
    const head = getHead(chain);
    if (head === 0) continue;
    const cutoff = head - threshold;
    const candidates = db
      .prepare(
        `SELECT chain, tx_hash FROM mempool_pending
           WHERE chain = ? AND first_seen_block < ? AND confirmed_block IS NULL AND dropped = 0`,
      )
      .all(chain, cutoff) as Array<{ chain: string; tx_hash: string }>;
    for (const m of candidates) {
      const affected = db
        .prepare(
          `UPDATE alerts SET status = 'dropped' WHERE trigger_tx_hash = ? AND status = 'pending' RETURNING id`,
        )
        .all(m.tx_hash) as Array<{ id: number }>;
      const insertAction = db.prepare(
        `INSERT INTO alert_actions (alert_id, action, actor, ts) VALUES (?, 'reorg_drop', 'system', ?)`,
      );
      for (const a of affected) {
        insertAction.run(a.id, now);
        bus.emit(EVENTS.AlertDropped, { id: a.id });
        dropped += 1;
      }
      db.prepare(`UPDATE mempool_pending SET dropped = 1 WHERE chain = ? AND tx_hash = ?`).run(m.chain, m.tx_hash);
    }
  }

  if (dropped > 0) logger.info({ dropped }, 'mempool sweeper: dropped pending alerts');
  return dropped;
}

export function startMempoolSweeper(): void {
  if (timer) return;
  timer = setInterval(() => {
    void sweepOnce().catch((err) => logger.warn({ err: (err as Error).message }, 'mempool sweeper error'));
  }, SWEEP_INTERVAL_MS);
  if (timer && typeof timer.unref === 'function') timer.unref();
  logger.info('mempool sweeper started');
}

export function stopMempoolSweeper(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
