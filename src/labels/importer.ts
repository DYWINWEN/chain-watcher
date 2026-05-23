import { parseStringPromise } from 'xml2js';
import { readFileSync, existsSync } from 'node:fs';
import { logger } from '../utils/logger.js';
import { getDb } from '../storage/db.js';
import { bus, EVENTS } from '../utils/event-bus.js';
import type { Chain } from '../types.js';
import type { Category, Label, Source } from './types.js';
import { CATEGORY_RISK } from './score.js';

type SdnRow = Omit<Label, 'createdAt' | 'updatedAt'>;

const CURRENCY_TO_CHAIN: Record<string, Chain | undefined> = {
  ETH: 'eth',
  ETC: undefined,
  XBT: 'btc',
  BTC: 'btc',
  BSC: 'bsc',
};

/**
 * Treasury SDN XML → label rows. Only entries that have at least one
 * Digital Currency Address are returned. ETH addresses are lowercased.
 * BTC addresses keep their original case (segwit/bech32 are case-sensitive).
 */
export async function parseOfacSdn(xml: string): Promise<SdnRow[]> {
  let doc: any;
  try {
    doc = await parseStringPromise(xml, { explicitArray: true });
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'parseOfacSdn: XML parse failed');
    return [];
  }
  const entries = doc?.sdnList?.sdnEntry ?? [];
  const out: SdnRow[] = [];
  for (const e of entries) {
    const name = String(e?.lastName?.[0] ?? '').trim();
    if (!name) continue;
    const idList = e?.idList?.[0]?.id ?? [];
    for (const id of idList) {
      const idType = String(id?.idType?.[0] ?? '');
      const idNumber = String(id?.idNumber?.[0] ?? '').trim();
      if (!idType.startsWith('Digital Currency Address') || !idNumber) continue;
      const currency = idType.replace(/^Digital Currency Address\s*-\s*/i, '').trim();
      const chain = CURRENCY_TO_CHAIN[currency];
      if (!chain) continue;
      const address = chain === 'btc' ? idNumber : idNumber.toLowerCase();
      out.push({
        chain,
        address,
        label: name,
        category: 'ofac',
        source: 'ofac_sdn' as Source,
        riskScore: CATEGORY_RISK['ofac' as Category],
      });
    }
  }
  return out;
}

const EXCHANGE_RX = /Binance|OKX|Bybit|Coinbase|Kraken|Bitfinex|Bitstamp|Huobi|Gate\.io/i;
const MIXER_RX = /Tornado|Wasabi|JoinMarket|ChipMixer|Sinbad/i;
const BRIDGE_RX = /Stargate|cBridge|Wormhole|Across|Hop|Synapse|Multichain/i;

function classify(label: string): Category {
  if (EXCHANGE_RX.test(label)) return 'cex';
  if (MIXER_RX.test(label)) return 'mixer';
  if (BRIDGE_RX.test(label)) return 'bridge';
  return 'project';
}

/** Idempotent upsert: same (chain, address, label) replaces; updated_at refreshed. */
export function upsertLabels(rows: SdnRow[]): number {
  if (rows.length === 0) return 0;
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const stmt = db.prepare(
    `INSERT INTO labels (chain, address, label, category, source, risk_score, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (chain, address, label) DO UPDATE SET
         category = excluded.category,
         source = excluded.source,
         risk_score = excluded.risk_score,
         updated_at = excluded.updated_at`,
  );
  const tx = db.transaction((batch: SdnRow[]) => {
    for (const r of batch) {
      stmt.run(r.chain, r.address, r.label, r.category, r.source, r.riskScore, now, now);
      bus.emit(EVENTS.LabelsChanged, { chain: r.chain, address: r.address });
    }
  });
  tx(rows);
  return rows.length;
}

/** Seed loader: reads a vendored brianleect snapshot from disk and bulk-imports.
 *  No-op if the labels table already has rows from this source for this chain. */
export function seedEtherscanLabels(chain: 'eth' | 'bsc', seedPath: string): number {
  if (!existsSync(seedPath)) {
    logger.warn({ seedPath }, 'seedEtherscanLabels: file not found, skipping');
    return 0;
  }
  const db = getDb();
  const existing = db
    .prepare(`SELECT COUNT(*) AS n FROM labels WHERE chain = ? AND source = 'etherscan-labels'`)
    .get(chain) as { n: number };
  if (existing.n > 0) {
    logger.info({ chain, existing: existing.n }, 'etherscan-labels already seeded, skipping');
    return 0;
  }
  let json: Array<{ address: string; label: string; category?: string }>;
  try {
    json = JSON.parse(readFileSync(seedPath, 'utf8'));
  } catch (err) {
    logger.warn({ err: (err as Error).message, seedPath }, 'seedEtherscanLabels: parse failed');
    return 0;
  }
  const rows: SdnRow[] = json.map((j) => {
    const category = (j.category as Category) ?? classify(j.label);
    return {
      chain,
      address: j.address.toLowerCase(),
      label: j.label,
      category,
      source: 'etherscan-labels' as Source,
      riskScore: CATEGORY_RISK[category],
    };
  });
  const n = upsertLabels(rows);
  recordSourceFetch('etherscan-labels' as Source, n, 'ok');
  return n;
}

/** Convenience helper for the OFAC pipeline. */
export async function fetchAndImportOfacSdn(url: string): Promise<number> {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      recordSourceFetch('ofac_sdn' as Source, 0, 'error', `${res.status} ${res.statusText}`);
      return 0;
    }
    const xml = await res.text();
    const rows = await parseOfacSdn(xml);
    const n = upsertLabels(rows);
    recordSourceFetch('ofac_sdn' as Source, n, 'ok');
    return n;
  } catch (err) {
    recordSourceFetch('ofac_sdn' as Source, 0, 'error', (err as Error).message);
    return 0;
  }
}

function recordSourceFetch(source: Source, _rowCount: number, status: 'ok' | 'error', lastError?: string): void {
  // NOTE: row_count is no longer persisted here — see API /api/labels/sources
  // which computes the live count from the labels table itself. We keep the
  // function signature (with _rowCount unused) so existing call sites stay
  // unchanged. The schema column is left in place for backward compat.
  const now = Math.floor(Date.now() / 1000);
  getDb()
    .prepare(
      `INSERT INTO label_sources (source, last_fetched_at, row_count, status, last_error)
         VALUES (?, ?, 0, ?, ?)
         ON CONFLICT(source) DO UPDATE SET
           last_fetched_at = excluded.last_fetched_at,
           status = excluded.status,
           last_error = excluded.last_error`,
    )
    .run(source, now, status, lastError ?? null);
}
