import { getDb } from '../storage/db.js';
import { bus, EVENTS } from '../utils/event-bus.js';
import type { Chain } from '../types.js';
import type { Label, Category, Source } from './types.js';

const CACHE_MAX = 10_000;
const TTL_MS = 10_000;

type Entry = { expiresAt: number; rows: Label[] };
// JS Map maintains insertion order — using it as a poor-man's LRU.
const cache = new Map<string, Entry>();

function key(chain: Chain, address: string): string {
  return `${chain}|${address}`;
}

export function getLabels(chain: Chain, address: string): Label[] {
  const k = key(chain, address);
  const now = Date.now();
  const hit = cache.get(k);
  if (hit && hit.expiresAt > now) {
    // re-insert to mark as MRU
    cache.delete(k);
    cache.set(k, hit);
    return hit.rows;
  }
  const rows = getDb()
    .prepare(
      `SELECT chain, address, label, category, source, risk_score AS riskScore,
              created_at AS createdAt, updated_at AS updatedAt
         FROM labels WHERE chain = ? AND address = ?`,
    )
    .all(chain, address) as Array<{
      chain: Chain;
      address: string;
      label: string;
      category: Category;
      source: Source;
      riskScore: number;
      createdAt: number;
      updatedAt: number;
    }>;
  const entry: Entry = { expiresAt: now + TTL_MS, rows };
  cache.set(k, entry);
  // Evict oldest until under cap.
  while (cache.size > CACHE_MAX) {
    const first = cache.keys().next().value;
    if (first === undefined) break;
    cache.delete(first);
  }
  return rows;
}

export function invalidateLabel(chain: Chain, address: string): void {
  cache.delete(key(chain, address));
}

export function clearLabelCache(): void {
  cache.clear();
}

// Listen for mutation events from the API layer.
bus.on(EVENTS.LabelsChanged, (payload: { chain: Chain; address: string }) => {
  invalidateLabel(payload.chain, payload.address);
});
