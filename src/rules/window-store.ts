import { getDb } from '../storage/db.js';
import type { Chain, Direction } from '../types.js';

export type WindowRow = {
  chain: Chain;
  address: string;
  direction: Direction;
  counterparties: string[];
  lastTxHashes: string[];
  updatedAt: number;
  backfilled: boolean;
};

export function getWindow(chain: Chain, address: string, direction: Direction): WindowRow | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT counterparties, last_tx_hashes, updated_at, backfilled
         FROM windows WHERE chain = ? AND address = ? AND direction = ?`,
    )
    .get(chain, address, direction) as
    | { counterparties: string; last_tx_hashes: string; updated_at: number; backfilled: number }
    | undefined;
  if (!row) return null;
  return {
    chain,
    address,
    direction,
    counterparties: JSON.parse(row.counterparties),
    lastTxHashes: JSON.parse(row.last_tx_hashes),
    updatedAt: row.updated_at,
    backfilled: !!row.backfilled,
  };
}

export function isBackfilled(chain: Chain, address: string, direction: Direction): boolean {
  const db = getDb();
  const row = db
    .prepare(`SELECT backfilled FROM windows WHERE chain = ? AND address = ? AND direction = ?`)
    .get(chain, address, direction) as { backfilled: number } | undefined;
  return row ? !!row.backfilled : false;
}

export function markBackfilled(chain: Chain, address: string, direction: Direction): void {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  db.prepare(
    `INSERT INTO windows (chain, address, direction, counterparties, last_tx_hashes, updated_at, backfilled)
       VALUES (?, ?, ?, '[]', '[]', ?, 1)
       ON CONFLICT(chain, address, direction) DO UPDATE SET backfilled = 1`,
  ).run(chain, address, direction, now);
}

export type PushResult = {
  hit: boolean;
  counterparties: string[];
  windowTxHashes: string[];
};

/** Append a (counterparty, txHash) to the rolling window of size N. Hit if all N entries match. */
export function pushAndCheck(
  chain: Chain,
  address: string,
  direction: Direction,
  counterparty: string,
  txHash: string,
  windowSize: number,
): PushResult {
  const db = getDb();
  const existing = getWindow(chain, address, direction);
  const cps = (existing?.counterparties ?? []).slice();
  const hashes = (existing?.lastTxHashes ?? []).slice();
  cps.push(counterparty);
  hashes.push(txHash);
  while (cps.length > windowSize) cps.shift();
  while (hashes.length > windowSize) hashes.shift();
  const now = Math.floor(Date.now() / 1000);
  db.prepare(
    `INSERT INTO windows (chain, address, direction, counterparties, last_tx_hashes, updated_at, backfilled)
       VALUES (?, ?, ?, ?, ?, ?, COALESCE((SELECT backfilled FROM windows WHERE chain = ? AND address = ? AND direction = ?), 0))
       ON CONFLICT(chain, address, direction) DO UPDATE SET
         counterparties = excluded.counterparties,
         last_tx_hashes = excluded.last_tx_hashes,
         updated_at = excluded.updated_at`,
  ).run(chain, address, direction, JSON.stringify(cps), JSON.stringify(hashes), now, chain, address, direction);

  let hit = false;
  if (cps.length === windowSize && windowSize >= 2) {
    const first = cps[0];
    if (first && cps.every((c) => c === first)) hit = true;
  }
  return { hit, counterparties: cps, windowTxHashes: hashes };
}

export function clearAllWindows(): void {
  getDb().prepare('DELETE FROM windows').run();
}
