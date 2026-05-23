# M15 — Mempool Monitoring + Reorg Drop Design

**Date**: 2026-05-23
**Predecessor**: v2 design doc §7 M15 (high-level)
**Successor plan**: `docs/superpowers/plans/2026-05-23-m15-mempool.md`
**Branch**: `feat/v2-m15-mempool`

---

## 1. Context

M15 adds pre-confirmation alerting. Currently the engine reacts only after a Transfer log lands in a block — typical end-to-end latency: ~15s on ETH. Mempool monitoring drops that to ~1s by reading `newPendingTransactions` and decoding the USDT calldata directly (pending txs don't have logs yet).

Trade-offs:
- **Pro**: faster alerts, better signal for MEV/runner detection
- **Con**: false positives — some pending txs never confirm (replaced, dropped, sandwiched). M15 handles this by tagging each alert with `status: pending | confirmed | dropped` and emitting a "drop" event when a tx hash hasn't shown up in N blocks.

Brainstorm decisions locked inline:

| | |
|---|---|
| **Scope** | ETH mempool only for M15. USDT-only (token-specific calldata decoder). BSC mempool is even flakier on public RPCs — defer to M16+. |
| **Calldata decode** | Pending txs have no logs. Decode ERC20 `transfer(address,uint256)` directly from `tx.input` field — selector `0xa9059cbb` + 32 bytes recipient + 32 bytes value. |
| **Dedup** | `eth_subscribe newPendingTransactions` from one or more RPC URLs (M9 RpcPool); in-memory LRU (10k entries, 5min TTL) dedupes by tx hash. |
| **Reorg drop heuristic** | "Tx not seen in next N blocks" (N=12, ≈3 min on ETH). NOT actual reorg detection via block hash diff — that's M16+ if ever. |
| **Lifecycle** | Engine fires alert at mempool-decode time with `status='pending'`. Block ingestor flips to `confirmed` on first block sighting. A separate sweeper marks `dropped` after N blocks without sighting. |
| **UI** | Status badge per alert card: pending=yellow pulse, confirmed=green, dropped=gray strikethrough. SSE emits `alert:dropped` events. |

---

## 2. Goals & Non-Goals

**Goals**
- New `MempoolIngestor` for ETH, reusing M9's `RpcPool` for multi-URL.
- Decode `tx.input` calldata for USDT `transfer()` calls; emit `RawEvent.kind='evm-mempool-tx'`.
- `alerts.status` column + lifecycle transitions.
- `mempool_pending` table tracking pending tx hashes + their alerts.
- Sweeper that marks alerts dropped after N blocks unconfirmed.
- Block-ingestor side: on each Transfer log, look up pending → flip to confirmed.
- UI: 3-state badge + dropped SSE event.

**Non-Goals (deferred)**
- BSC mempool (flaky public-RPC coverage; needs paid endpoint)
- Token diversification beyond USDT (calldata decoder is per-selector; M16+ if needed)
- Actual reorg detection (block hash chain diff) — current heuristic is good enough at 12-block depth
- Frontrun / sandwich heuristic — would need pair detection; M17+

---

## 3. Schema (`v1_007_mempool.sql`)

```sql
-- M15: alert lifecycle + mempool tracking

ALTER TABLE alerts ADD COLUMN status TEXT NOT NULL DEFAULT 'confirmed';
-- Existing alerts (M0-M14) default to 'confirmed'. New mempool alerts insert as 'pending'.

ALTER TABLE alerts ADD COLUMN confirmed_block INTEGER;
-- NULL until the trigger_tx_hash is seen in a confirmed block.

ALTER TABLE alerts ADD COLUMN source TEXT NOT NULL DEFAULT 'block';
-- 'block' for confirmed-stream alerts; 'mempool' for pre-confirmation.

CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts(status);
CREATE INDEX IF NOT EXISTS idx_alerts_trigger_tx ON alerts(trigger_tx_hash);

CREATE TABLE IF NOT EXISTS mempool_pending (
  chain TEXT NOT NULL,
  tx_hash TEXT NOT NULL,
  first_seen INTEGER NOT NULL,        -- unix ts when mempool ingestor first saw it
  first_seen_block INTEGER NOT NULL,  -- best-known head block at first_seen
  confirmed_block INTEGER,            -- NULL until seen in a block
  dropped INTEGER NOT NULL DEFAULT 0, -- 1 = marked dropped by sweeper
  alert_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (chain, tx_hash)
);
CREATE INDEX IF NOT EXISTS idx_mempool_pending_first_seen ON mempool_pending(first_seen);
CREATE INDEX IF NOT EXISTS idx_mempool_pending_unconfirmed ON mempool_pending(confirmed_block, dropped);

CREATE TABLE IF NOT EXISTS alert_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  alert_id INTEGER NOT NULL,
  action TEXT NOT NULL,           -- 'reorg_drop' | 'confirmed' | 'manual_ack' (future)
  actor TEXT NOT NULL,            -- 'system' (default) | dashboard user
  note TEXT,
  ts INTEGER NOT NULL,
  FOREIGN KEY (alert_id) REFERENCES alerts(id)
);
CREATE INDEX IF NOT EXISTS idx_alert_actions_alert_id ON alert_actions(alert_id);
```

---

## 4. Pipeline overview

```
                 ┌─────────────────────────────────────┐
                 │  EvmIngestor (existing — confirmed) │
                 │  eth_subscribe + Transfer logs      │
                 └────────────┬────────────────────────┘
                              │ RawEvent.source='block'
                              ▼
                          Decoder
                              │
                              ▼
                          RuleEngine
                              │
              ┌───────────────┴────────────────┐
              ▼                                ▼
       confirmed_block flip?           insert alert
       (check mempool_pending)         status='confirmed'

                 ┌─────────────────────────────────────┐
                 │  MempoolIngestor (new — pre-confirm)│
                 │  eth_subscribe newPendingTransactions│
                 │  fetch tx; decode calldata          │
                 └────────────┬────────────────────────┘
                              │ RawEvent.source='mempool'
                              ▼
                          Decoder (same)
                              │
                              ▼
                          RuleEngine (same)
                              │
                              ▼
                       insert alert
                       status='pending'
                       record in mempool_pending

                 ┌─────────────────────────────────────┐
                 │  MempoolSweeper (new — background)  │
                 │  every 30s:                         │
                 │  SELECT pending where first_seen_block + 12 < head AND confirmed_block IS NULL │
                 │  UPDATE alerts SET status='dropped' │
                 │  INSERT alert_actions (reorg_drop)  │
                 │  emit SSE 'alert:dropped'           │
                 └─────────────────────────────────────┘
```

---

## 5. Code layout

```
src/ingestors/
├── evm.ts                     ✎ on handleLog: if tx_hash matches a pending row, flip status='confirmed', record alert_action, emit SSE 'alert:confirmed'
├── mempool.ts                 ★ new — EVM mempool ingestor
└── (btc.ts unchanged)

src/decoder/
├── mempool-calldata.ts        ★ new — decodes ERC20 transfer() from tx.input
└── (existing decoders unchanged)

src/rules/
└── engine.ts                  ✎ recordAlert takes `source` ('block'|'mempool'); writes status accordingly

src/notifiers/
└── (no changes — router still gates by severity)

src/jobs/
└── mempool-sweeper.ts         ★ new — setInterval; marks unconfirmed-past-threshold as dropped

src/types.ts                   ✎ RawEvent + NormalizedTx gain `source: 'block' | 'mempool'`

src/storage/migrations/
└── v1_007_mempool.sql         ★

src/api/alerts.ts (or server.ts) ✎ existing alerts endpoint joins by status; new GET /api/alerts/:id/actions

src/dashboard/public/js/pages/
└── alerts.js                  ✎ render status badge; listen for SSE alert:dropped + alert:confirmed

src/dashboard/public/css/
└── components.css             ✎ append .badge-pending (yellow pulse), .badge-confirmed (green), .badge-dropped (gray strike)

src/index.ts                   ✎ start MempoolIngestor + MempoolSweeper

test/
├── mempool-calldata.test.ts   ★ 4 cases (USDT transfer / wrong selector / malformed / zero-amount)
├── mempool-sweeper.test.ts    ★ 3 cases (under-threshold not dropped / over-threshold dropped / confirmed doesn't drop)
└── migrations.test.ts         ✎ +1 case
```

Target: **+8 tests** (112 → 120).

---

## 6. Calldata decoder

ERC20 `transfer(address to, uint256 value)`:
- Selector: `0xa9059cbb`
- Param 0 (32 bytes): recipient (12-byte zero-pad + 20-byte address)
- Param 1 (32 bytes): value (uint256)

```ts
const TRANSFER_SELECTOR = '0xa9059cbb';

export function decodeUsdtTransfer(input: string): { to: string; value: string } | null {
  if (!input || input.length < 138) return null;  // selector + 2 × 32 bytes
  if (!input.toLowerCase().startsWith(TRANSFER_SELECTOR)) return null;
  try {
    const to = '0x' + input.slice(34, 74).toLowerCase();
    const valueHex = input.slice(74, 138);
    const value = BigInt('0x' + valueHex).toString();
    return { to, value };
  } catch {
    return null;
  }
}
```

The mempool ingestor receives a tx hash, calls `eth_getTransactionByHash` to get the full tx (including `input`, `to`, `from`, `value`). If `tx.to == USDT_CONTRACT` AND calldata decodes successfully, emit a `RawEvent.kind='evm-mempool-tx'` with the same shape as `evm-transfer` plus `source: 'mempool'`.

---

## 7. Mempool ingestor implementation

```ts
// src/ingestors/mempool.ts (sketch)
import { Ingestor } from './base.js';
import { RpcPool, resolveWsUrls } from '../utils/rpc-pool.js';
import { decodeUsdtTransfer } from '../decoder/mempool-calldata.js';
// ... etc

export class EvmMempoolIngestor extends Ingestor {
  private provider: WebSocketProvider | null;
  private pool: RpcPool | null;
  private seen = new LRU<string, true>({ max: 10_000, ttl: 5 * 60 * 1000 });
  private contract: string;  // USDT address

  async connect() {
    // wsUrl = pool.current()
    // provider.on('pending', async (txHash) => {
    //   if (this.seen.has(txHash)) return;
    //   this.seen.set(txHash, true);
    //   const tx = await this.provider.getTransaction(txHash);
    //   if (!tx || tx.to?.toLowerCase() !== this.contract) return;
    //   const decoded = decodeUsdtTransfer(tx.data);
    //   if (!decoded) return;
    //   await this.enqueue({
    //     kind: 'evm-mempool-tx',
    //     chain: this.chain,
    //     txHash,
    //     blockNumber: 0,        // unknown until mined
    //     timestamp: Math.floor(Date.now() / 1000),
    //     from: tx.from.toLowerCase(),
    //     to: decoded.to,
    //     valueRaw: decoded.value,
    //     source: 'mempool',
    //   });
    // });
    // (await wsClosed; rotate on next reconnect)
  }
}
```

(Pseudocode — real impl in T2 of the plan.)

---

## 8. Engine integration

`recordAlert` already exists from M14 — extended to:
1. Accept `tx.source` as input
2. If `source === 'mempool'`, set `alerts.status='pending'`; insert/update `mempool_pending` row; alert_count++
3. If `source === 'block'`, set `alerts.status='confirmed'` AND `confirmed_block=tx.blockNumber`; ALSO check if `tx.txHash` is in `mempool_pending` — if so, flip ALL existing pending alerts for that tx to `confirmed`, record `alert_actions: confirmed`, emit SSE `alert:confirmed`

---

## 9. Sweeper job

```ts
// src/jobs/mempool-sweeper.ts (sketch)
const REORG_BLOCK_THRESHOLD = 12;  // configurable via SETTINGS.mempool_reorg_threshold
const SWEEP_INTERVAL_MS = 30_000;

export function startMempoolSweeper() {
  setInterval(async () => {
    // For each chain with a known head block:
    const head = await getCurrentHead('eth');  // from checkpoints table
    const threshold = head - REORG_BLOCK_THRESHOLD;
    const rows = getDb().prepare(`
      SELECT chain, tx_hash FROM mempool_pending
      WHERE first_seen_block < ? AND confirmed_block IS NULL AND dropped = 0
    `).all(threshold);
    for (const r of rows) {
      // Mark all alerts for this tx_hash as 'dropped'
      const affected = getDb().prepare(`
        UPDATE alerts SET status = 'dropped' WHERE trigger_tx_hash = ? AND status = 'pending'
        RETURNING id
      `).all(r.tx_hash);
      for (const a of affected) {
        getDb().prepare(`INSERT INTO alert_actions (alert_id, action, actor, ts) VALUES (?, 'reorg_drop', 'system', ?)`).run(a.id, now);
        bus.emit(EVENTS.AlertDropped, { id: a.id });
      }
      getDb().prepare(`UPDATE mempool_pending SET dropped = 1 WHERE chain = ? AND tx_hash = ?`).run(r.chain, r.tx_hash);
    }
  }, SWEEP_INTERVAL_MS);
}
```

---

## 10. UI changes

Alerts page (`pages/alerts.js`):
- Each card gets a status badge in the header row:
  - `pending` — yellow pulse animation (`@keyframes pulse`)
  - `confirmed` — green dot (default for existing alerts)
  - `dropped` — gray + the entire card body gets `text-decoration: line-through; opacity: 0.6`
- SSE listeners:
  - `alert:confirmed` — flip card badge from pending → confirmed
  - `alert:dropped` — flip card badge to dropped + apply strikethrough style

CSS additions in `components.css`:
```css
.badge-status {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 2px 8px; border-radius: var(--r-pill);
  font-size: var(--fs-xs); font-weight: 600;
}
.badge-status.pending { background: color-mix(in srgb, var(--warning) 18%, var(--surface-1)); color: var(--warning); }
.badge-status.pending::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: var(--warning); animation: pulse 1.2s ease-in-out infinite; }
.badge-status.confirmed { background: color-mix(in srgb, var(--success) 18%, var(--surface-1)); color: var(--success); }
.badge-status.dropped { background: color-mix(in srgb, var(--text-subtle) 18%, var(--surface-1)); color: var(--text-subtle); }

.alert-card.dropped .body { text-decoration: line-through; opacity: 0.6; }

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}
```

---

## 11. Settings

Two new keys plumbed via the existing `settings` table:
- `mempool.enabled` (boolean, default `false` — opt-in to start; users with paid RPC enable)
- `mempool.reorg_threshold` (number, default 12)

These are exposed in the Settings page along with other backfill/decoder knobs (already supports arbitrary keys via the generic settings UI from M11.1).

---

## 12. Testing strategy

| File | Cases | Covers |
|---|---|---|
| `test/mempool-calldata.test.ts` | 4 | known-good USDT transfer / wrong selector → null / malformed hex → null / zero-amount edge |
| `test/mempool-sweeper.test.ts` | 3 | under-threshold pending stays / over-threshold flips to dropped + records action / confirmed never drops |
| `test/migrations.test.ts` | +1 | v1_007 schema present + indexes |

**+8 tests total**. Final: **112 → 120**.

Mempool ingestor itself doesn't get a unit test — its connect() loop is hard to test without a live ws. Smoke covers it.

---

## 13. Done criteria

- 8 new tests pass; total ≥ 120
- v1_007 migration applied; existing alerts get `status='confirmed'`, `source='block'` automatically (defaults)
- `mempool.enabled=true` + smoke: at least one pending alert fires within 60s, gets confirmed within 30s after block lands
- Sweeper marks dropped after 12 blocks unconfirmed (verify with a manual SQL row insertion)
- Alerts page shows 3 distinct badges; SSE events flip badges in real time

---

## 14. Risks

- **Public RPC mempool coverage**: PublicNode reports limited pending. Document `mempool.enabled=false` default + recommend Alchemy / QuickNode for production.
- **Tx-hash collisions across confirmed/mempool**: handled by the engine's flip logic — when a block-source alert hits a tx that already has pending alerts, flip them.
- **Sweeper race with confirmation**: confirm path runs first inside the engine's recordAlert flip block; sweeper only acts on rows still unconfirmed after 12 blocks. Race impossible (both gate on `confirmed_block IS NULL`).
- **Token-specific decode**: M15 only decodes USDT transfer(). Future tokens need their own selector logic — M16+ multi-chain expands this.
