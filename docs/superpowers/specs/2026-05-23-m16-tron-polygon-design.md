# M16 — Tron (TRC20) + Polygon Multi-chain Design

**Date**: 2026-05-23
**Predecessor**: v2 design doc §7 M16
**Successor plan**: `docs/superpowers/plans/2026-05-23-m16-tron-polygon.md`
**Branch**: `feat/v2-m16-tron-polygon`

---

## 1. Context

v1 → M15 supports ETH / BSC / BTC. M16 adds **Polygon** (EVM, trivial — reuse `EvmIngestor`) and **Tron** (non-EVM, custom — TronGrid WS or HTTP poll). USDT is the universal contract type:

- **Polygon USDT**: `0xc2132D05D31c914a87C6611C10748AEb04B58e8F` (ERC20, decimals=6)
- **Tron USDT (TRC20)**: `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t` (decimals=6)

Brainstorm decisions inline:

| | |
|---|---|
| **Polygon** | Use existing `EvmIngestor` — instantiate with chain='polygon' (after extending the Chain type). RpcPool reads `chain_polygon_ws_url(s)`. Price oracle adds POL/USDT (and falls back to MATIC/USDT for the legacy ticker). Zero new ingestor code. |
| **Tron data source** | TronGrid HTTP API (`https://api.trongrid.io`). Public + free tier (15 req/s). No native WS subscription for TRC20 transfers; poll with `/v1/contracts/{contract}/events?event_name=Transfer&limit=200&order_by=block_timestamp,desc&min_block_timestamp={cutoff}` every 5s — bounded by checkpoint. |
| **Tron address format** | Base58Check (e.g., `TR7NHq...`); 21 raw bytes. Don't lowercase. Hex equivalent prefixed `41` (mainnet) used in some APIs — we store the Base58 form. |
| **Risk** | M15 / Mempool was higher risk; M16 is mostly plumbing. Main risk: TronGrid rate limits on busy startup backfill — bounded by `backfill_history_window` (already 5). |

---

## 2. Goals & Non-Goals

**Goals**
- Polygon block ingestor via existing `EvmIngestor`; chain='polygon' added everywhere (types, config, settings, schema)
- Tron block ingestor as new `TronIngestor` using TronGrid HTTP poll
- USDT-only on both chains; reuse decoder/erc20 for Polygon; new `decodeTrc20Transfer` for Tron
- Price oracle covers POL/USDT (and MATICUSDT fallback); TRX/USDT for change-amount semantics on Tron native if ever needed
- UI: chain selector + filter chip + sidebar/dashboard auto-extend to 5 chains; chain colors set
- Settings page exposes chain.polygon.* and chain.tron.* knobs

**Non-Goals (M17 / v3)**
- Tron mempool (TronGrid HTTP polling already gives near-pending data via `block_timestamp`, but no formal mempool API)
- Solana / Avalanche / Arbitrum — separate v3 evaluation
- Tron freeze/energy economics (TRC20 transfers cost bandwidth, not gas; we don't track this)

---

## 3. Schema

`v1_008_polygon_tron.sql`:

```sql
-- M16: add polygon and tron to known chains. The chain column is TEXT so no
-- schema change strictly required for the chains themselves; this migration
-- adds a settings seed nudge + future-proof index. Mostly a no-op.
CREATE INDEX IF NOT EXISTS idx_tx_chain_ts ON tx(chain, ts DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_chain_created ON alerts(chain, created_at DESC);
```

(The schema is already chain-agnostic. M16 only adds indexes that benefit multi-chain queries — the existing per-chain idx_tx_from / idx_tx_to are still primary.)

---

## 4. Types + config extension

**Chain type** (`src/types.ts`):

```ts
export type Chain = 'eth' | 'bsc' | 'btc' | 'polygon' | 'tron';
```

**Config schema** (`src/config.ts` — RootConfigSchema):

```ts
  chains: z.object({
    eth: ChainCfgEvm,
    bsc: ChainCfgEvm,
    btc: ChainCfgBtc,
    polygon: ChainCfgEvm.optional(),     // optional — older configs don't have it
    tron: ChainCfgTron.optional(),
  }),
```

New `ChainCfgTron`:

```ts
const ChainCfgTron = z.object({
  enabled: z.boolean(),
  api_base: z.string().min(1),           // 'https://api.trongrid.io'
  usdt_contract: z.string().min(1),      // 'TR7NHq...'
  poll_interval_ms: z.number().int().positive().default(5000),
});
```

New SETTINGS keys:
- `chain.polygon.enabled`, `chain.polygon.ws_url`, `chain.polygon.ws_urls`, `chain.polygon.usdt_contract`
- `chain.tron.enabled`, `chain.tron.api_base`, `chain.tron.usdt_contract`, `chain.tron.poll_interval_ms`

**RawEvent** gains a new union arm:

```ts
| {
    kind: 'tron-trc20-transfer';
    chain: 'tron';
    txHash: string;       // 64-hex string from TronGrid
    blockNumber: number;
    timestamp: number;
    from: string;         // Base58 address
    to: string;
    valueRaw: string;
    source?: 'block';
  }
```

(EVM mempool variant already has `chain: 'eth' | 'bsc'` — Polygon mempool is out-of-scope for M16. If we add later, expand to `'eth' | 'bsc' | 'polygon'`.)

---

## 5. Code layout

```
src/ingestors/
├── evm.ts                  ✎ accept chain='polygon' (just extend the union type guard)
├── tron.ts                 ★ new — HTTP-poll TronGrid /events
├── index.ts                ✎ instantiate polygon (block) + tron at start

src/decoder/
├── erc20.ts                (handles all EVM USDT incl. polygon — no change)
├── tron.ts                 ★ new — decodeTrc20Transfer(rawEvent)
└── index.ts                ✎ dispatch tron-trc20-transfer

src/decoder/price-oracle.ts ✎ add POLYGON / MATIC + TRX symbol mappings

src/config.ts               ✎ schemas, SETTINGS_KEYS, flatten, seed
src/types.ts                ✎ Chain type + new RawEvent arm + NormalizedTx token
src/storage/migrations/
└── v1_008_polygon_tron.sql ★ new

config/rules.yaml           ✎ seed polygon + tron sections (enabled: false default)

src/dashboard/public/css/tokens.css        ✎ --chain-polygon + --chain-tron CSS vars
src/dashboard/public/js/pages/alerts.js    ✎ filter-bar adds polygon + tron chips
src/dashboard/public/js/ui/filter-bar.js   ✎ widen the chain set + label

test/
├── decoder-tron.test.ts    ★ 4 cases
├── tron-ingestor.test.ts   ★ 3 structural cases (poll fetch + dedupe + checkpoint persist)
└── migrations.test.ts      ✎ +1 case
```

Target: **+8 tests** (120 → 128).

---

## 6. Tron ingestor design

TronGrid endpoint structure (subset we use):

```
GET https://api.trongrid.io/v1/contracts/{usdt_contract}/events?event_name=Transfer&limit=200&order_by=block_timestamp,desc&min_block_timestamp={ms}
→ {
    "data": [
      {
        "block_number": 12345678,
        "block_timestamp": 1700000000000,   // ms
        "transaction_id": "0xabc...",        // 64 hex chars
        "event_name": "Transfer",
        "result": {
          "0": "TFromAddr...",               // from (Base58)
          "1": "TToAddr...",                  // to
          "2": "1000000000",                  // value (6-decimal USDT)
          "from": "TFromAddr...",
          "to": "TToAddr...",
          "value": "1000000000"
        }
      },
      ...
    ]
  }
```

Poll loop (every 5s by default):

1. Read checkpoint `last_block` for chain='tron'
2. `min_block_timestamp = last_known_timestamp + 1` (millisecond cursor)
3. `fetch(url)` → 200 events max
4. For each event:
   - If `block_number <= checkpoint`, skip
   - Dedup by `(chain, transaction_id)` against an in-memory LRU (5000 entries, 60s TTL)
   - Enqueue `RawEvent.kind='tron-trc20-transfer'`
5. Update checkpoint to `max(block_number)` seen
6. Sleep `poll_interval_ms`; loop

Rate budget: 15 req/s public; 5s poll = 0.2 req/s. Well under cap.

Failure modes:
- HTTP 429: exponential backoff via `exponentialBackoff()` utility
- HTTP 5xx: same
- Network: same; ingestor's `start()` loop in `base.ts` retries with max 12 attempts before giving up

---

## 7. Tron decoder

`src/decoder/tron.ts`:

```ts
export async function decodeTrc20Transfer(ev: Extract<RawEvent, { kind: 'tron-trc20-transfer' }>): Promise<NormalizedTx> {
  // TronGrid returns the value as a uint256 string in 6-decimal USDT units.
  // Convert to USDT float by dividing by 1e6.
  const usdt = Number(ev.valueRaw) / 1e6;
  return {
    chain: 'tron',
    txHash: ev.txHash,
    blockNumber: ev.blockNumber,
    timestamp: ev.timestamp,
    from: ev.from,         // Base58 — keep case
    to: ev.to,             // Base58 — keep case
    token: 'USDT',
    amountRaw: ev.valueRaw,
    amountUsdt: usdt,
    source: 'block',
  };
}
```

No price oracle needed for USDT — value IS USDT directly.

---

## 8. Polygon

`EvmIngestor` already accepts a chain type. After extending `Chain` to include 'polygon', the existing constructor's narrow `'eth' | 'bsc'` becomes `'eth' | 'bsc' | 'polygon'`. Mechanically:

1. Update `EvmIngestor` constructor signature: `constructor(chain: 'eth' | 'bsc' | 'polygon')`
2. Update `readContract` + `buildPool` to support polygon's SETTINGS keys
3. Add polygon to `startIngestors` at boot — only if `chain.polygon.enabled=true`

Polygon's RPC endpoints (public, in `.env.example`):
- `wss://polygon-rpc.publicnode.com`
- `wss://polygon-bor.publicnode.com`

USDT on Polygon decimals=6 (same as ETH USDT).

---

## 9. Decoder/index.ts dispatch update

```ts
export async function decode(ev: RawEvent): Promise<NormalizedTx> {
  let base: NormalizedTx;
  if (ev.kind === 'evm-transfer') {
    base = decodeEvmTransfer(ev);
    base.source = 'block';
  } else if (ev.kind === 'evm-mempool-tx') {
    base = decodeEvmTransfer({ ...ev, kind: 'evm-transfer' });
    base.source = 'mempool';
  } else if (ev.kind === 'tron-trc20-transfer') {
    base = await decodeTrc20Transfer(ev);
  } else {
    base = await decodeBtcVout(ev);
    base.source = 'block';
  }
  base.fromLabels = getLabels(base.chain, base.from).map((l) => l.label);
  base.toLabels = getLabels(base.chain, base.to).map((l) => l.label);
  return base;
}
```

---

## 10. UI changes

Tokens (`src/dashboard/public/css/tokens.css`):

```css
  --chain-polygon: #8b5cf6;   /* matching the existing brand purple but slightly different */
  --chain-tron: #ef4444;      /* red — Tron brand */
```

Filter bar (`src/dashboard/public/js/ui/filter-bar.js`):

```js
  el.appendChild(chainChip('eth'));
  el.appendChild(chainChip('bsc'));
  el.appendChild(chainChip('btc'));
  el.appendChild(chainChip('polygon'));
  el.appendChild(chainChip('tron'));
```

Default `state.chains` becomes `new Set(['eth', 'bsc', 'btc', 'polygon', 'tron'])`.

Alerts card (no code change needed — `var(--chain-${a.chain})` already lookups dynamically).

Settings page already renders all `chain.*` settings via the generic UI from M11.1; the new keys will appear automatically once they're seeded into the settings table.

---

## 11. Testing

| File | Cases | Covers |
|---|---|---|
| `test/decoder-tron.test.ts` | 4 | valid event → NormalizedTx / large value (200M USDT) / address case preserved / source defaults to 'block' |
| `test/tron-ingestor.test.ts` | 3 | poll endpoint hit with right params / dedup via LRU / checkpoint updates on max block_number |
| `test/migrations.test.ts` | +1 | v1_008 indexes present |

Total **+8 tests** (120 → 128).

Tron ingestor tests use a small fake-server (Express on ephemeral port) returning fixture JSON — same pattern as `test/webhook.test.ts` (M13).

---

## 12. Done criteria

- `Chain` type extends to 5 chains
- Polygon `EvmIngestor` boot conditional on `chain.polygon.enabled`
- Tron `TronIngestor` boot conditional on `chain.tron.enabled` (both default false)
- 128 / 128 tests pass
- Filter bar UI shows 5 chains with colored dots
- Default seed config has polygon + tron sections with `enabled: false`
