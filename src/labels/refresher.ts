import { getDb } from '../storage/db.js';
import { logger } from '../utils/logger.js';
import { fetchAndImportOfacSdn } from './importer.js';

const OFAC_URL = 'https://www.treasury.gov/ofac/downloads/sdn.xml';
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

let timer: NodeJS.Timeout | null = null;

function lastFetchedMs(): number | null {
  const row = getDb()
    .prepare(`SELECT last_fetched_at FROM label_sources WHERE source = 'ofac_sdn'`)
    .get() as { last_fetched_at: number | null } | undefined;
  return row?.last_fetched_at ? row.last_fetched_at * 1000 : null;
}

export async function refreshOfacOnce(): Promise<number> {
  logger.info({ url: OFAC_URL }, 'OFAC SDN refresh starting');
  const n = await fetchAndImportOfacSdn(OFAC_URL);
  logger.info({ rows: n }, 'OFAC SDN refresh complete');
  return n;
}

/** Idempotent. Starts the OFAC refresh loop if not already running.
 *  If the last fetch is missing or > 24h old, refreshes immediately. */
export function startOfacRefresher(): void {
  if (timer) return;
  void (async () => {
    const last = lastFetchedMs();
    if (last === null || Date.now() - last > ONE_DAY_MS) {
      try {
        await refreshOfacOnce();
      } catch (err) {
        logger.warn({ err: (err as Error).message }, 'OFAC initial refresh failed');
      }
    }
  })();
  timer = setInterval(() => {
    void refreshOfacOnce().catch((err) =>
      logger.warn({ err: (err as Error).message }, 'OFAC scheduled refresh failed'),
    );
  }, ONE_DAY_MS);
  if (timer && typeof timer.unref === 'function') timer.unref();
}

export function stopOfacRefresher(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
