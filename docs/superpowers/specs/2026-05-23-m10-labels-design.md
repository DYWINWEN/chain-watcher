# M10 — Address Label System Design

**Date**: 2026-05-23
**Predecessor**: v2 design doc §7 M10 (high-level), this doc is the detailed spec.
**Successor**: `docs/superpowers/plans/2026-05-23-m10-labels.md` (impl plan)
**Branch**: `feat/v2-m10-labels` (to be created)

---

## 1. Context

v2 spec earmarked M10 as the label system: surface real-world identity for chain addresses (OFAC SDN, CEX hot wallets, mixers, bridges, projects). Brainstorm narrowed the data sources and policy:

- **OFAC SDN**: pulled daily from `https://www.treasury.gov/ofac/downloads/sdn.xml`, persisted into `labels` table with `source='ofac_sdn'`.
- **CEX / project / mixer / bridge**: vendored snapshot from the open-source `brianleect/etherscan-labels` repo into `config/labels-seed/{eth,bsc}.json`. One-time seed at first launch.
- **User-defined**: regular CRUD via API + Dashboard.
- **BTC**: OFAC-only (brianleect has no BTC coverage).

The system feeds the rule engine (`tx.fromLabels`, `tx.toLabels`) and powers UI label chips on Alerts cards + risk score in the Watchlist drawer.

---

## 2. Goals & Non-Goals

**Goals**
- Persist labels for known addresses across EVM (ETH/BSC) and BTC.
- Auto-refresh OFAC SDN; one-time seed of community CEX labels.
- Surface labels on every `NormalizedTx` via in-memory cache.
- Surface labels on Alerts page + add a "Label sources" card to Settings.
- Provide CRUD API for user-defined labels.

**Non-Goals (v3 candidates)**
- AML risk scoring beyond static category mapping.
- Cross-chain label correlation (same entity on ETH/BSC).
- Label confidence scores / community voting.
- Chainabuse / scam-database integrations.
- Tron / Polygon / Solana labels (Tron/Polygon enabled in M16; their label files added then).
- Auto-tagging via heuristics (e.g., "address has 1000+ inbound tx in 24h → label 'high-volume'").

---

## 3. Data sources

### 3.1 OFAC SDN (all chains)

- **URL**: `https://www.treasury.gov/ofac/downloads/sdn.xml`
- **Schema**: Treasury's SDN XML format with `<sdnEntry>` nodes; each entry may have `<digitalCurrencyAddresses>` containing `<digitalCurrencyAddress>` children with `type` (XBT / ETH / USDT-ERC20 / ...) and `value` (the address string).
- **Frequency**: at startup check `label_sources.last_fetched_at`; if NULL or > 24h ago, fetch immediately. Then `setInterval(24h)` for the lifetime of the process.
- **Failure mode**: log warn, keep existing rows (don't truncate); `label_sources.status='error'` for the UI.
- **Parser**: `xml2js` (we already have it; pure JS, ESM-friendly).
- **Label string**: `OFAC SDN` (and additionally, per-entry `<remarks>` is parsed and used as an extra label like `Tornado.Cash` when remarks mentions sanctioned mixers/projects).
- **Category**: `ofac`. Risk score: `95`.

### 3.2 etherscan-labels (EVM only)

- **Source repo**: `brianleect/etherscan-labels`
- **License**: MIT.
- **Snapshot**: download once at M10 PR time (manually), curate into `config/labels-seed/{eth,bsc}.json`. The repo has per-chain JSON files keyed by category — we'll flatten + dedupe into one file per chain with structure `[{ address, label, category }]`.
- **Size budget**: target each per-chain file ≤ 15MB unpacked / ≤ 4MB gzipped. If brianleect's full export is bigger, trim to top ~50k addresses by reputation. (M10 PR will measure and report actuals.)
- **One-time seed**: on startup, if `SELECT COUNT(*) FROM labels WHERE source='etherscan-labels' AND chain=?` = 0 → import the vendored file into SQLite.
- **Category mapping** (regex on label name, applied during seed):
  ```
  /Binance|OKX|Bybit|Coinbase|Kraken|Bitfinex|Bitstamp|Huobi|Gate\.io/ → cex
  /Tornado|Wasabi|JoinMarket|ChipMixer|Sinbad/                         → mixer
  /Stargate|cBridge|Wormhole|Across|Hop|Synapse|Multichain/             → bridge
  default                                                                → project
  ```
- **Risk score** per category: cex=10, mixer=80, bridge=40, project=5.

### 3.3 User-defined

- Via `POST /api/labels` body `{ chain, address, label, category? }`. If category omitted, default to `user`. Risk score: `user=0` (no contribution).
- Stored with `source='user'`.

---

## 4. Schema (matches v2 spec, refined)

Migration: `src/storage/migrations/v1_002_labels.sql`

```sql
CREATE TABLE IF NOT EXISTS labels (
  chain TEXT NOT NULL,                -- 'eth' | 'bsc' | 'btc'
  address TEXT NOT NULL,              -- lowercase for EVM; original case for BTC
  label TEXT NOT NULL,                -- 'Binance Hot 14' | 'OFAC SDN' | 'Tornado.Cash'
  category TEXT NOT NULL,             -- 'ofac' | 'sanctions' | 'mixer' | 'cex' | 'bridge' | 'project' | 'user'
  source TEXT NOT NULL,               -- 'ofac_sdn' | 'etherscan-labels' | 'user' | 'auto'
  risk_score INTEGER NOT NULL,        -- 0-100, static map
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (chain, address, label)
);
CREATE INDEX IF NOT EXISTS idx_labels_addr ON labels(chain, address);
CREATE INDEX IF NOT EXISTS idx_labels_cat  ON labels(category);

CREATE TABLE IF NOT EXISTS label_sources (
  source TEXT PRIMARY KEY,            -- 'ofac_sdn' | 'etherscan-labels'
  last_fetched_at INTEGER,
  row_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending', -- 'ok' | 'error' | 'pending'
  last_error TEXT
);
```

**Composite PK** `(chain, address, label)` allows the same address to have multiple labels (e.g., a CEX hot wallet that's also on OFAC).

---

## 5. Code structure

```
src/labels/
├── lookup.ts             # LRU cache; getLabels(chain, address) → Label[]
├── importer.ts           # parseOfacSdn(xml), seedEtherscanLabels(chain, json), upsertLabels(rows[])
├── refresher.ts          # startOfacRefresher() (interval); refreshOfacOnce() (manual trigger)
├── score.ts              # CATEGORY_RISK = { ofac: 95, sanctions: 95, mixer: 80, ... }
│                         # maxRiskScore(labels: Label[]) → number
└── types.ts              # type Label = { chain, address, label, category, source, riskScore }

src/api/labels.ts         # Express router: GET/POST/DELETE /api/labels endpoints (extracted from server.ts)
src/storage/migrations/
└── v1_002_labels.sql     # migration above

config/labels-seed/
├── eth.json              # vendored, format: [{ "address": "0x..", "label": "Binance Hot 14", "category": "cex" }, ...]
└── bsc.json
```

`src/dashboard/server.ts` mounts `labelsRouter` for the new endpoints (refactor: extract `apis/` directory pattern — currently all routes inline).

`src/types.ts` `NormalizedTx` gains:
```ts
fromLabels: string[];    // label STRINGS only (e.g., ['Binance Hot 14'])
toLabels: string[];      // for full Label objects, query getLabels() separately in UI
```

(Why strings only on NormalizedTx: keeps the type lean for the rule engine + makes alert serialization trivial. Full Label objects with category/risk live in the labels table, queried on-demand by the UI.)

---

## 6. Pipeline integration

`src/decoder/index.ts` `decode()` function (existing entry point):

```ts
export async function decode(ev: RawEvent): Promise<NormalizedTx> {
  const base = await decodeBase(ev);  // existing logic (erc20.ts / btc.ts)
  base.fromLabels = getLabels(base.chain, base.from).map(l => l.label);
  base.toLabels = getLabels(base.chain, base.to).map(l => l.label);
  return base;
}
```

`lookup.ts` uses a singleton LRU (max 10k entries, 10s TTL). On cache miss it queries SQLite — `idx_labels_addr` makes this O(log n).

---

## 7. API

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/labels?chain=X&address=Y` | — | `Label[]` (full objects) |
| POST | `/api/labels` | `{ chain, address, label, category? }` | `{ ok: true }` |
| DELETE | `/api/labels/:chain/:address/:label` | — | `{ ok: true }` |
| GET | `/api/labels/sources` | — | `{ ofac_sdn: { ... }, 'etherscan-labels': { ... } }` |
| POST | `/api/labels/refresh` | `{ source?: 'ofac_sdn' }` | `{ started: true }` (async; status visible via /sources) |
| POST | `/api/labels/import` | multipart `file=<json>` | `{ imported: N }` |

All endpoints emit `bus.emit(EVENTS.LabelsChanged, { chain, address })` on mutation; `lookup.ts` listens and invalidates its cache for that key.

---

## 8. UI changes (minimal — full management page in M11.2)

### 8.1 Alerts card (`src/dashboard/public/js/pages/alerts.js`)

After the `<code class="mono">${shortHash(pivot)}</code>` element, render `${pivot}_labels` chips when `fromLabels.length > 0`. Color by category — query `/api/labels?address=...` lazily OR rely on a server-side join that already includes category in the SSE alert payload.

**Decision**: include `pivotLabels` and `counterpartyLabels` (full Label objects) directly in the SSE alert payload + REST `/api/alerts` response. This avoids an extra round-trip per alert. The engine pulls them from the labels table via the lookup cache when recording the alert.

`alerts` table gets two new columns:
```sql
ALTER TABLE alerts ADD COLUMN pivot_labels TEXT NOT NULL DEFAULT '[]';
ALTER TABLE alerts ADD COLUMN counterparty_labels TEXT NOT NULL DEFAULT '[]';
```
Both store JSON arrays of `{ label, category, riskScore }`. Migration `v1_003_alert_labels.sql`.

### 8.2 Settings page — Label sources card

A small new section card listing both sources:
```
Label sources
─────────────
OFAC SDN              43,212 rows · last sync 1h 23m ago · OK   [Refresh now]
etherscan-labels      48,750 rows · seeded 2h ago · OK
```

The Refresh button POSTs `/api/labels/refresh` and updates the timestamp via the existing SSE config event mechanism.

### 8.3 Watchlist drawer (M11.2 / mockup-only for M10)

Mockup already shows label chips + risk score; the underlying data is available via the API now. Full drawer enhancements land in M11.2.

---

## 9. Risk score logic

`src/labels/score.ts`:

```ts
export const CATEGORY_RISK: Record<string, number> = {
  ofac: 95,
  sanctions: 95,
  mixer: 80,
  bridge: 40,
  cex: 10,
  project: 5,
  user: 0,
};

export function maxRiskScore(labels: { category: string }[]): number {
  return labels.reduce((max, l) => Math.max(max, CATEGORY_RISK[l.category] ?? 0), 0);
}
```

UI displays the max score across all of an address's labels.

---

## 10. Testing

| File | Cases | Covers |
|---|---|---|
| `test/labels-importer.test.ts` | 6 | OFAC SDN XML parsing (entry with single addr / multiple addrs / no addrs / unsupported currency / malformed XML / mixer remarks → secondary label) |
| `test/labels-lookup.test.ts` | 4 | cache hit / cache miss → DB query / TTL expiry / invalidation on labelsChanged event |
| `test/labels-api.test.ts` | 5 | GET by address / POST user / DELETE / GET sources / POST refresh idempotency |
| `test/labels-score.test.ts` | 2 | category → risk mapping / max across multi-label |
| `test/migrations.test.ts` | +1 | v1_002 migration applied + idx present (extends existing migration test) |

Total: **18 new tests**. Target: **46 → 64**.

---

## 11. Open risks + mitigations

- **OFAC XML schema drift**: parser must tolerate added/removed nodes. Mitigation: schema-free parse via xml2js + zod validation per `<sdnEntry>`; invalid entries logged + skipped, not fatal.
- **brianleect snapshot stale**: bundled snapshot is from a specific commit. Mitigation: include `config/labels-seed/SOURCE.md` documenting commit SHA + date + upstream URL so the next refresh is reproducible.
- **`labels` table grows large**: ~50k EVM + ~5k OFAC + user adds = ~60k rows. SQLite handles 60k rows trivially (idx_labels_addr index + WAL = ~5ms lookup). No special mitigation.
- **LRU cache hit rate**: if traffic is dominated by unique addresses, the 10k LRU has poor hit rate. M10 ships fixed at 10k; M14 (custom rules) can revisit if profiling shows it.
- **PII / user IP leak via OFAC fetch**: the Treasury URL is HTTPS, no body. Acceptable.

---

## 12. Sequencing inside M10 (for the impl plan)

1. Schema + migration
2. `src/labels/types.ts` + `score.ts` (pure, easy)
3. `importer.ts` parseOfacSdn (TDD with XML fixtures)
4. `lookup.ts` (LRU + DB read + bus invalidation)
5. `refresher.ts` (interval + on-startup-stale-check)
6. API endpoints + extract `src/api/labels.ts`
7. Vendor `config/labels-seed/{eth,bsc}.json` + seed loader
8. Decoder integration (`NormalizedTx.fromLabels/toLabels`)
9. Engine integration (alert table stores `pivot_labels` / `counterparty_labels`)
10. Settings page "Label sources" card UI
11. Alerts card label chips UI
12. Final verification + PR

Each step a single git commit. ~12 commits total.

---

## 13. Done criteria

- All 18 new tests pass; total ≥ 64.
- `npm run dev` boots, OFAC fetch starts within 5s, `labels` table populated to ≥ 100 rows within 30s.
- Live alert (when one fires) carries `pivot_labels` and `counterparty_labels` correctly.
- Settings page shows label sources card with both rows.
- Alerts page renders chips when labels are present.
- Adding a user label via POST /api/labels and the next alert involving that address shows the chip.
- No regression on existing 46 tests.
