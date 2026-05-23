# M16 — Tron + Polygon Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** Add Polygon (EVM, reuse EvmIngestor) and Tron (TRC20 USDT, new HTTP-poll TronIngestor) to the supported-chain set. Filter bar, alert colors, settings all extend to 5 chains.

**Architecture:** Polygon is purely additive — extend `Chain` type, register a 3rd EvmIngestor instance, add settings keys. Tron is a new HTTP-poll ingestor: every 5s, fetch TronGrid `/v1/contracts/{usdt}/events?event_name=Transfer&min_block_timestamp=<cursor>`, dedup via LRU, enqueue as `kind='tron-trc20-transfer'`. Decoder + engine + UI all dispatch on the existing seams.

**Tech Stack:** Existing — TypeScript + ethers (for Polygon EVM) + native fetch (for TronGrid HTTP).

---

## Prerequisites

- main HEAD M15 merged, **120/120 passing**
- TronGrid public API reachable from the dev host (`curl https://api.trongrid.io` returns 200)

---

## File structure (target end-state)

```
src/storage/migrations/
└── v1_008_polygon_tron.sql               ★ new (just adds 2 indexes)

src/types.ts                              ✎ Chain = +'polygon' +'tron'; new tron-trc20-transfer RawEvent arm

src/config.ts                             ✎ Chain*Cfg schemas + SETTINGS_KEYS + flatten

config/rules.yaml                         ✎ +polygon + +tron sections (enabled: false)

.env.example                              ✎ +POLYGON_WS_URL + +TRON_API_BASE

src/decoder/
├── tron.ts                               ★ new — decodeTrc20Transfer
├── price-oracle.ts                       ✎ +POL/MATIC/TRX symbols (optional — not load-bearing for USDT chains)
└── index.ts                              ✎ dispatch tron-trc20-transfer

src/ingestors/
├── evm.ts                                ✎ widen constructor chain arg to 'eth'|'bsc'|'polygon'
├── tron.ts                               ★ new — TronIngestor (HTTP poll)
└── index.ts                              ✎ instantiate polygon + tron (gated by enabled flag)

src/dashboard/public/css/tokens.css       ✎ +--chain-polygon +--chain-tron
src/dashboard/public/js/ui/filter-bar.js  ✎ +polygon +tron chips, default set widens

test/
├── decoder-tron.test.ts                  ★ 4 cases
├── tron-ingestor.test.ts                 ★ 3 cases (uses an ephemeral Express fake-trongrid)
└── migrations.test.ts                    ✎ +1 case for v1_008
```

Target: **120 → 128 tests** (+8).

---

## Task 1: Schema + types + config

**Files:** v1_008 migration, types.ts, config.ts, .env.example, config/rules.yaml, migrations.test.ts

- [ ] **Step 1: Baseline**

```bash
cd ~/projects/chain-watcher
git status
git log --oneline -3
npm test 2>&1 | grep -E "Tests "
```

Expected: on `feat/v2-m16-tron-polygon` branch, 120/120.

- [ ] **Step 2: Migration**

Create `src/storage/migrations/v1_008_polygon_tron.sql`:

```sql
-- M16: Polygon + Tron support. The schema is already chain-agnostic
-- (chain column is TEXT); this migration just adds indexes that benefit
-- multi-chain GROUP BY queries we already do (e.g., Stats page).
CREATE INDEX IF NOT EXISTS idx_tx_chain_ts ON tx(chain, ts DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_chain_created ON alerts(chain, created_at DESC);
```

- [ ] **Step 3: Migrations test**

In `test/migrations.test.ts`, after the v1_007 case, append:

```ts
  it('discovers and applies v1_008_polygon_tron.sql', () => {
    const db = getDb();
    const row = db
      .prepare(`SELECT name FROM _migrations WHERE name = 'v1_008_polygon_tron.sql'`)
      .get();
    expect(row).toBeDefined();
    const txIdx = db.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name='idx_tx_chain_ts'`).get();
    const alertIdx = db.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name='idx_alerts_chain_created'`).get();
    expect(txIdx).toBeDefined();
    expect(alertIdx).toBeDefined();
  });
```

- [ ] **Step 4: Extend Chain type + RawEvent**

Open `src/types.ts`. Find:

```ts
export type Chain = 'eth' | 'bsc' | 'btc';
```

Replace with:

```ts
export type Chain = 'eth' | 'bsc' | 'btc' | 'polygon' | 'tron';
```

Find the RawEvent union. The evm-transfer + evm-mempool-tx variants currently use `chain: 'eth' | 'bsc'`. Widen them to include 'polygon':

```ts
| {
    kind: 'evm-transfer';
    chain: 'eth' | 'bsc' | 'polygon';
    // ... rest unchanged ...
  }
| {
    kind: 'evm-mempool-tx';
    chain: 'eth' | 'bsc' | 'polygon';
    // ... rest unchanged ...
  }
```

Add a new arm at the end of the union (after btc-vout):

```ts
| {
    kind: 'tron-trc20-transfer';
    chain: 'tron';
    txHash: string;        // 64-hex from TronGrid (no 0x prefix from upstream; we normalize)
    blockNumber: number;
    timestamp: number;
    from: string;          // Base58 address (case-sensitive — DO NOT lowercase)
    to: string;
    valueRaw: string;      // uint256 string in USDT 6-decimal units
    source?: 'block';
  }
```

- [ ] **Step 5: Extend config.ts**

Open `src/config.ts`. After `ChainCfgBtc`, add `ChainCfgTron`:

```ts
const ChainCfgTron = z.object({
  enabled: z.boolean(),
  api_base: z.string().min(1),
  usdt_contract: z.string().min(1),
  poll_interval_ms: z.number().int().positive().default(5000),
});
```

In `RootConfigSchema.chains`, add the two new optional chains:

```ts
  chains: z.object({
    eth: ChainCfgEvm,
    bsc: ChainCfgEvm,
    btc: ChainCfgBtc,
    polygon: ChainCfgEvm.optional(),
    tron: ChainCfgTron.optional(),
  }),
```

In `SETTINGS_KEYS`, append:

```ts
  chain_polygon_enabled: 'chain.polygon.enabled',
  chain_polygon_ws_url: 'chain.polygon.ws_url',
  chain_polygon_ws_urls: 'chain.polygon.ws_urls',
  chain_polygon_usdt: 'chain.polygon.usdt_contract',
  chain_tron_enabled: 'chain.tron.enabled',
  chain_tron_api_base: 'chain.tron.api_base',
  chain_tron_usdt: 'chain.tron.usdt_contract',
  chain_tron_poll_interval_ms: 'chain.tron.poll_interval_ms',
```

In `flatten(cfg)`, after the existing chain entries, append:

```ts
    [SETTINGS_KEYS.chain_polygon_enabled]: cfg.chains.polygon?.enabled ?? false,
    [SETTINGS_KEYS.chain_polygon_ws_url]: cfg.chains.polygon?.ws_url ?? '',
    [SETTINGS_KEYS.chain_polygon_ws_urls]: cfg.chains.polygon?.ws_urls ?? [],
    [SETTINGS_KEYS.chain_polygon_usdt]: cfg.chains.polygon?.usdt_contract ?? '',
    [SETTINGS_KEYS.chain_tron_enabled]: cfg.chains.tron?.enabled ?? false,
    [SETTINGS_KEYS.chain_tron_api_base]: cfg.chains.tron?.api_base ?? '',
    [SETTINGS_KEYS.chain_tron_usdt]: cfg.chains.tron?.usdt_contract ?? '',
    [SETTINGS_KEYS.chain_tron_poll_interval_ms]: cfg.chains.tron?.poll_interval_ms ?? 5000,
```

- [ ] **Step 6: Update seed config**

In `config/rules.yaml`, find the `chains:` block. After `btc:`, append:

```yaml
  polygon:
    enabled: false
    ws_url: ${POLYGON_WS_URL}
    usdt_contract: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F'
    decimals: 6
  tron:
    enabled: false
    api_base: 'https://api.trongrid.io'
    usdt_contract: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'
    poll_interval_ms: 5000
```

(Use the literal contract addresses verbatim.)

In `.env.example`, append:

```
POLYGON_WS_URL=wss://polygon-rpc.publicnode.com
TRON_API_BASE=https://api.trongrid.io
```

- [ ] **Step 7: Verify**

```bash
npx tsc -p . --noEmit
npm test 2>&1 | tail -5
```

Expected: clean, **121 / 121** (120 + 1 migration test).

- [ ] **Step 8: Commit**

```bash
git add src/storage/migrations/v1_008_polygon_tron.sql src/types.ts src/config.ts config/rules.yaml .env.example test/migrations.test.ts
git commit -m "feat(types/config): M16 — Polygon + Tron in Chain type + config

* v1_008 — multi-chain index hints (tx and alerts by chain+time)
* Chain = +'polygon' +'tron'
* RawEvent: evm-transfer/evm-mempool-tx widen to include 'polygon';
  new tron-trc20-transfer arm
* ChainCfgTron schema + 8 new SETTINGS keys + seed entries
  (both enabled: false by default — opt-in)"
```

---

## Task 2: Tron decoder + 4 tests

**Files:** `src/decoder/tron.ts`, `src/decoder/index.ts`, `test/decoder-tron.test.ts`

- [ ] **Step 1: Write tests**

Create `test/decoder-tron.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { decodeTrc20Transfer } from '../src/decoder/tron.js';

const base = {
  kind: 'tron-trc20-transfer' as const,
  chain: 'tron' as const,
  txHash: 'abc123def456',
  blockNumber: 12345,
  timestamp: 1700000000,
  from: 'TFromAddrCaseSensitive',
  to: 'TToAddrCaseSensitive',
  valueRaw: '1000000', // 1 USDT
};

describe('decodeTrc20Transfer', () => {
  it('converts valueRaw to USDT float (6 decimals)', async () => {
    const out = await decodeTrc20Transfer(base);
    expect(out.amountUsdt).toBe(1);
    expect(out.amountRaw).toBe('1000000');
    expect(out.token).toBe('USDT');
    expect(out.chain).toBe('tron');
  });

  it('handles large value (200M USDT)', async () => {
    const out = await decodeTrc20Transfer({ ...base, valueRaw: '200000000000000' });
    expect(out.amountUsdt).toBe(200_000_000);
  });

  it('preserves Base58 address case', async () => {
    const out = await decodeTrc20Transfer(base);
    expect(out.from).toBe('TFromAddrCaseSensitive');
    expect(out.to).toBe('TToAddrCaseSensitive');
  });

  it('defaults source to block', async () => {
    const out = await decodeTrc20Transfer(base);
    expect(out.source).toBe('block');
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
npx vitest run test/decoder-tron.test.ts 2>&1 | tail -10
```

- [ ] **Step 3: Implement**

Create `src/decoder/tron.ts`:

```ts
import type { NormalizedTx, RawEvent } from '../types.js';

export async function decodeTrc20Transfer(
  ev: Extract<RawEvent, { kind: 'tron-trc20-transfer' }>,
): Promise<NormalizedTx> {
  // TRC20 USDT has 6 decimals; valueRaw is uint256 string in 6-decimal units.
  const amountUsdt = Number(ev.valueRaw) / 1e6;
  return {
    chain: 'tron',
    txHash: ev.txHash,
    blockNumber: ev.blockNumber,
    timestamp: ev.timestamp,
    from: ev.from,         // Base58 — preserve case
    to: ev.to,
    token: 'USDT',
    amountRaw: ev.valueRaw,
    amountUsdt,
    source: ev.source ?? 'block',
  };
}
```

- [ ] **Step 4: Wire into decoder/index.ts**

Open `src/decoder/index.ts`. The current `decode()` dispatches on `ev.kind`. Add a tron arm BEFORE the BTC catch-all branch.

The exact final file should look approximately:

```ts
import type { NormalizedTx, RawEvent } from '../types.js';
import { decodeEvmTransfer } from './erc20.js';
import { decodeBtcVout } from './btc.js';
import { decodeTrc20Transfer } from './tron.js';
import { getLabels } from '../labels/lookup.js';

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

(Adapt to the actual current content of the file — preserve any other logic, just splice in the tron branch.)

- [ ] **Step 5: Verify + commit**

```bash
npx vitest run test/decoder-tron.test.ts 2>&1 | tail -10
npm test 2>&1 | tail -5
```

Expected: 4 / 4 in file; **125 / 125** overall (121 + 4).

```bash
git add src/decoder/tron.ts src/decoder/index.ts test/decoder-tron.test.ts
git commit -m "feat(decoder): Tron TRC20 USDT decoder + dispatch

decodeTrc20Transfer: valueRaw (6-decimal uint256) → amountUsdt;
preserves Base58 address case; source defaults to 'block'.

4 unit tests cover normal value, large value, address case, source default."
```

---

## Task 3: TronIngestor (HTTP poll)

**Files:** `src/ingestors/tron.ts`, `src/ingestors/index.ts`, `test/tron-ingestor.test.ts`

- [ ] **Step 1: Write tests**

Create `test/tron-ingestor.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let TronIngestor: typeof import('../src/ingestors/tron.js').TronIngestor;
let getDb: typeof import('../src/storage/db.js').getDb;
let setSetting: typeof import('../src/config.js').setSetting;
let SETTINGS: typeof import('../src/config.js').SETTINGS;
let server: Server;
let port: number;
let serverHits: any[];

beforeEach(async () => {
  vi.resetModules();
  process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'cw-tron-')), 'cw.db');
  ({ getDb } = await import('../src/storage/db.js'));
  ({ setSetting, SETTINGS } = await import('../src/config.js'));
  ({ TronIngestor } = await import('../src/ingestors/tron.js'));
  getDb();
  serverHits = [];
  const app = express();
  app.get('/v1/contracts/:contract/events', (req, res) => {
    serverHits.push({ contract: req.params.contract, query: req.query });
    res.json({
      data: [
        {
          block_number: 1000,
          block_timestamp: 1700000000000,
          transaction_id: 'tx_abc_123',
          event_name: 'Transfer',
          result: {
            from: 'TFromXyz',
            to: 'TToXyz',
            value: '5000000',  // 5 USDT
          },
        },
        {
          block_number: 1001,
          block_timestamp: 1700000001000,
          transaction_id: 'tx_def_456',
          event_name: 'Transfer',
          result: {
            from: 'TFromXyz',
            to: 'TToXyz',
            value: '10000000',
          },
        },
      ],
    });
  });
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  const addr = server.address();
  port = typeof addr === 'object' && addr ? addr.port : 0;
  setSetting(SETTINGS.chain_tron_enabled, true, 'test');
  setSetting(SETTINGS.chain_tron_api_base, `http://127.0.0.1:${port}`, 'test');
  setSetting(SETTINGS.chain_tron_usdt, 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', 'test');
  setSetting(SETTINGS.chain_tron_poll_interval_ms, 100, 'test');
});

afterEach(() => new Promise<void>((r) => server.close(() => r())));

describe('TronIngestor.fetchOnce', () => {
  it('hits the TronGrid /events endpoint with correct contract', async () => {
    const ing = new TronIngestor();
    const enqueued: any[] = [];
    (ing as any).enqueue = async (ev: any) => { enqueued.push(ev); };
    await (ing as any).fetchOnce();
    expect(serverHits).toHaveLength(1);
    expect(serverHits[0].contract).toBe('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t');
    expect(enqueued.length).toBe(2);
    expect(enqueued[0].chain).toBe('tron');
    expect(enqueued[0].txHash).toBe('tx_abc_123');
  });

  it('dedupes events seen via tx_id LRU on second poll', async () => {
    const ing = new TronIngestor();
    const enqueued: any[] = [];
    (ing as any).enqueue = async (ev: any) => { enqueued.push(ev); };
    await (ing as any).fetchOnce();
    await (ing as any).fetchOnce();
    expect(enqueued.length).toBe(2); // second poll's 2 events are deduped
  });

  it('advances checkpoint to max block_number seen', async () => {
    const ing = new TronIngestor();
    (ing as any).enqueue = async () => {};
    await (ing as any).fetchOnce();
    const cp = getDb().prepare(`SELECT last_block FROM checkpoints WHERE chain='tron'`).get() as { last_block: number };
    expect(cp.last_block).toBe(1001);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
npx vitest run test/tron-ingestor.test.ts 2>&1 | tail -15
```

- [ ] **Step 3: Implement**

Create `src/ingestors/tron.ts`:

```ts
import { Ingestor } from './base.js';
import { getSetting, SETTINGS } from '../config.js';
import { bus, EVENTS, type ConfigChangedPayload } from '../utils/event-bus.js';
import { sleep } from '../utils/reconnect.js';
import { logger } from '../utils/logger.js';
import type { Chain } from '../types.js';

type EventRow = {
  block_number: number;
  block_timestamp: number;
  transaction_id: string;
  event_name: string;
  result: { from?: string; to?: string; value?: string; '0'?: string; '1'?: string; '2'?: string };
};

export class TronIngestor extends Ingestor {
  private apiBase = '';
  private contract = '';
  private intervalMs = 5000;
  private readonly seen = new Map<string, number>();
  private readonly SEEN_MAX = 5000;
  private readonly SEEN_TTL_MS = 60_000;
  private stopRequested = false;
  private readonly configListener = (payload: ConfigChangedPayload) => {
    if (typeof payload.key !== 'string') return;
    if (!payload.key.startsWith('chain.tron.')) return;
    this.log.info({ key: payload.key }, 'tron config changed');
    this.readCfg();
  };

  constructor() {
    super('tron' as Chain);
    this.readCfg();
    bus.on(EVENTS.ConfigChanged, this.configListener);
  }

  override async stop(): Promise<void> {
    this.stopRequested = true;
    bus.off(EVENTS.ConfigChanged, this.configListener);
    await super.stop();
  }

  private readCfg(): void {
    this.apiBase = (getSetting<string>(SETTINGS.chain_tron_api_base, 'https://api.trongrid.io') || '').replace(/\/$/, '');
    this.contract = getSetting<string>(SETTINGS.chain_tron_usdt, '');
    this.intervalMs = Number(getSetting<number>(SETTINGS.chain_tron_poll_interval_ms, 5000)) || 5000;
  }

  private remember(txId: string): boolean {
    const now = Date.now();
    const last = this.seen.get(txId);
    if (last !== undefined && now - last < this.SEEN_TTL_MS) return false;
    this.seen.set(txId, now);
    while (this.seen.size > this.SEEN_MAX) {
      const first = this.seen.keys().next().value;
      if (first === undefined) break;
      this.seen.delete(first);
    }
    return true;
  }

  /** Single poll cycle — exported for tests. */
  async fetchOnce(): Promise<void> {
    const enabled = getSetting<boolean>(SETTINGS.chain_tron_enabled, false);
    if (!enabled || !this.contract) return;
    const cursor = this.getCheckpoint();
    const url = `${this.apiBase}/v1/contracts/${encodeURIComponent(this.contract)}/events?event_name=Transfer&limit=200&order_by=block_timestamp,desc${cursor > 0 ? `&min_block_timestamp=${cursor * 1000}` : ''}`;
    let res: Response;
    try {
      res = await fetch(url, { headers: { Accept: 'application/json' } });
    } catch (err) {
      this.log.warn({ err: (err as Error).message }, 'tron fetch network error');
      return;
    }
    if (!res.ok) {
      this.log.warn({ status: res.status }, 'tron fetch non-2xx');
      return;
    }
    const body = (await res.json()) as { data?: EventRow[] };
    const events = body.data ?? [];
    let maxBlock = cursor;
    for (const e of events) {
      if (e.event_name !== 'Transfer') continue;
      if (!e.transaction_id || !e.block_number || !e.result) continue;
      if (e.block_number <= cursor) continue;
      const from = e.result.from ?? e.result['0'];
      const to = e.result.to ?? e.result['1'];
      const value = e.result.value ?? e.result['2'];
      if (!from || !to || !value) continue;
      if (!this.remember(e.transaction_id)) continue;
      await this.enqueue({
        kind: 'tron-trc20-transfer',
        chain: 'tron',
        txHash: e.transaction_id,
        blockNumber: e.block_number,
        timestamp: Math.floor(e.block_timestamp / 1000),
        from,
        to,
        valueRaw: value,
        source: 'block',
      });
      if (e.block_number > maxBlock) maxBlock = e.block_number;
    }
    if (maxBlock > cursor) this.saveCheckpoint(maxBlock);
  }

  async connect(): Promise<void> {
    const enabled = getSetting<boolean>(SETTINGS.chain_tron_enabled, false);
    if (!enabled) {
      this.log.info('tron disabled, skipping');
      throw new Error('tron disabled');
    }
    if (!this.contract) {
      throw new Error('missing tron config');
    }
    this.log.info({ apiBase: this.apiBase, contract: this.contract, intervalMs: this.intervalMs }, 'tron poll loop starting');
    while (!this.stopRequested && !this.stopped) {
      try {
        await this.fetchOnce();
      } catch (err) {
        this.log.warn({ err: (err as Error).message }, 'tron fetchOnce error');
      }
      await sleep(this.intervalMs);
    }
  }

  async disconnect(): Promise<void> {
    this.stopRequested = true;
  }
}
```

- [ ] **Step 4: Wire into ingestors/index.ts**

Open `src/ingestors/index.ts`. Add Tron alongside the other ingestors. The pattern follows the existing EVM/BTC starts:

```ts
import { TronIngestor } from './tron.js';

let tron: TronIngestor | null = null;

// inside startIngestors:
  tron = new TronIngestor();
  void tron.start();

// inside stopIngestors:
  if (tron) {
    await tron.stop();
    tron = null;
  }
```

Same for Polygon (instantiate `EvmIngestor('polygon')`):

```ts
let polygon: EvmIngestor | null = null;

// inside startIngestors:
  polygon = new EvmIngestor('polygon');
  void polygon.start();

// inside stopIngestors:
  if (polygon) {
    await polygon.stop();
    polygon = null;
  }
```

Both will gracefully throw "disabled" in their connect() when the feature flag is off, and Ingestor.start() will give up after maxConnectAttempts retries — that's expected.

- [ ] **Step 5: Widen EvmIngestor constructor**

Open `src/ingestors/evm.ts`. Find `constructor(chain: 'eth' | 'bsc')`. Widen to `constructor(chain: 'eth' | 'bsc' | 'polygon')`. Also widen `readContract` and `buildPool` if they take the same narrow type:

```ts
function readContract(chain: 'eth' | 'bsc' | 'polygon'): string {
  const cKey =
    chain === 'eth' ? SETTINGS.chain_eth_usdt
    : chain === 'bsc' ? SETTINGS.chain_bsc_usdt
    : SETTINGS.chain_polygon_usdt;
  return (getSetting<string>(cKey, '') || '').toLowerCase();
}

function buildPool(chain: 'eth' | 'bsc' | 'polygon'): RpcPool | null {
  const urls = resolveWsUrls(chain);
  return urls.length > 0 ? new RpcPool(urls) : null;
}
```

`resolveWsUrls` in `src/utils/rpc-pool.ts` already takes `Chain` — should accept 'polygon' once Chain is widened (which T1 did).

Also: the `kickReconnect` cast `this.chain as 'eth' | 'bsc'` needs widening. Find any such cast in evm.ts and update to include 'polygon'.

- [ ] **Step 6: Verify**

```bash
npx vitest run test/tron-ingestor.test.ts 2>&1 | tail -15
npx tsc -p . --noEmit
npm test 2>&1 | tail -5
```

Expected: 3/3 in file; clean typecheck; **128 / 128** overall.

- [ ] **Step 7: Commit**

```bash
git add src/ingestors/tron.ts src/ingestors/evm.ts src/ingestors/index.ts test/tron-ingestor.test.ts
git commit -m "feat(ingestors): TronIngestor (HTTP poll) + Polygon EVM ingestor

* TronIngestor — 5s poll on /v1/contracts/{usdt}/events?event_name=
  Transfer with checkpoint cursor; LRU dedup (5k entries, 60s TTL);
  saves checkpoint to max block_number seen. fetchOnce() exported
  for tests. Gated by chain.tron.enabled (default false).
* EvmIngestor constructor widened to 'eth'|'bsc'|'polygon'.
* startIngestors instantiates both polygon (block) + tron at boot;
  both gate on their enabled flag inside connect() so they no-op
  when disabled.
* 3 ingestor tests with an ephemeral Express fake-trongrid."
```

---

## Task 4: UI chain extension

**Files:** `src/dashboard/public/css/tokens.css`, `src/dashboard/public/js/ui/filter-bar.js`

- [ ] **Step 1: Append CSS tokens**

Open `src/dashboard/public/css/tokens.css`. Find the section that defines `--chain-eth`, `--chain-bsc`, `--chain-btc`. Append:

```css
  --chain-polygon: #8b5cf6;
  --chain-tron: #ef4444;
```

(Inside `:root { ... }`. Place near the other chain colors.)

- [ ] **Step 2: Update filter-bar.js**

Open `src/dashboard/public/js/ui/filter-bar.js`. Find:

```js
const state = {
    chains: new Set(['eth', 'bsc', 'btc']),
```

Replace with:

```js
const state = {
    chains: new Set(['eth', 'bsc', 'btc', 'polygon', 'tron']),
```

Find the three `chainChip(...)` calls and add two more:

```js
  el.appendChild(chainChip('eth'));
  el.appendChild(chainChip('bsc'));
  el.appendChild(chainChip('btc'));
  el.appendChild(chainChip('polygon'));
  el.appendChild(chainChip('tron'));
```

Then in the chainChip helper (which builds `<button class="chip eth|bsc|btc ..."`), make sure the chip class includes polygon/tron. If the existing helper renders `chip ${chain}` then `<style>.chip.polygon .dot { background: var(--chain-polygon); }` would be needed in components.css. Find the `.chip.eth .dot` rule in `src/dashboard/public/css/components.css` and append:

```css
.chip.polygon .dot { background: var(--chain-polygon); }
.chip.tron .dot { background: var(--chain-tron); }
```

- [ ] **Step 3: Verify**

```bash
node --check src/dashboard/public/js/ui/filter-bar.js
npx tsc -p . --noEmit
npm test 2>&1 | tail -5
```

Expected: clean, **128 / 128**.

- [ ] **Step 4: Commit**

```bash
git add src/dashboard/public/css/tokens.css src/dashboard/public/css/components.css src/dashboard/public/js/ui/filter-bar.js
git commit -m "feat(dashboard): 5-chain filter chips + tokens

* tokens.css — --chain-polygon (#8b5cf6) + --chain-tron (#ef4444)
* components.css — .chip.polygon/.tron .dot color rules
* filter-bar.js — default state includes all 5 chains; polygon + tron chips rendered alongside existing ETH/BSC/BTC"
```

---

## Task 5: Smoke + PR

- [ ] **Step 1: Final gates**

```bash
cd ~/projects/chain-watcher
npx tsc -p . --noEmit
npm run lint
npm test
npm run build
```

Expected: clean, **128 / 128**.

- [ ] **Step 2: Smoke**

```bash
cp .env.example .env
redis-server --daemonize yes --port 6379 --dir /tmp 2>/dev/null || true
redis-cli ping
npm run dev > /tmp/m16-smoke.log 2>&1 &
sleep 6
# Enable Tron + Polygon via settings API
curl -s -X PATCH http://localhost:8787/api/settings/chain.tron.enabled -H 'Content-Type: application/json' -d '{"value": true}'
curl -s -X PATCH http://localhost:8787/api/settings/chain.polygon.enabled -H 'Content-Type: application/json' -d '{"value": true}'
sleep 25
sqlite3 ~/projects/chain-watcher/data/cw.db "SELECT chain, COUNT(*) FROM tx GROUP BY chain"
sqlite3 ~/projects/chain-watcher/data/cw.db "SELECT last_block FROM checkpoints WHERE chain IN ('polygon','tron')"
grep -c "tron poll loop starting\|chain: \"polygon\"" /tmp/m16-smoke.log
```

Expected: at least one new row in `tx` table for chain='tron' or 'polygon' if any USDT transfers occurred during the 25s window. Polygon usually has at least one Transfer per second; Tron mainnet too.

- [ ] **Step 3: Cleanup + push + PR**

```bash
pkill -f "tsx.*src/index" 2>/dev/null
redis-cli shutdown 2>/dev/null || true
rm -f .env

git push -u origin feat/v2-m16-tron-polygon
gh pr create --base main --head feat/v2-m16-tron-polygon \
  --title "feat(v2/M16): Polygon + Tron (TRC20) multi-chain" \
  --body "Polygon via EvmIngestor (reuse). Tron via new TronIngestor (5s HTTP poll on TronGrid /events). Decoder, engine, UI extend to 5 chains. Both default off (chain.{polygon,tron}.enabled=false). 128/128 tests (+8 new). 🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

---

## Done criteria

- 5 commits + PR
- 128 / 128 tests pass
- Polygon block ingestor + Tron poll ingestor both opt-in via settings
- Filter bar shows 5 chains; Alerts cards render with appropriate chain colors when alerts fire on polygon/tron
