# M12 — Alert Severity + Subscription Router Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** Introduce severity (P1/P2/P3) on every alert, and a subscription router that gates which notifier channels each alert reaches. Existing channels: `dashboard` (SSE — universal, ungated) and `tg` (Telegram). Default routing ships sensible: Dashboard gets everything, Telegram gets P1 + P2 only.

**Architecture:** New `src/notifiers/severity.ts` computes severity from labels + amount. New `subscriptions` table + `src/notifiers/router.ts`. Engine assigns severity at alert-fire time and calls `routeAlert(alert)` alongside the existing `bus.emit(AlertNew, ...)`. Telegram notifier becomes a router-callable function instead of a bus subscriber. Settings page gains a subscription matrix UI.

**Tech Stack:** Existing — TypeScript + better-sqlite3 + Express + vanilla JS. No new dependencies.

---

## Prerequisites

- main HEAD `c39a86f` (M11.2 merged, **65/65 tests passing**)

---

## Severity assignment policy (locked)

```
P1 (high):    any label of category 'ofac' | 'sanctions' | 'mixer'
              OR amount_usdt >= 5000
P2 (medium):  any label of category 'cex' | 'bridge'
              OR amount_usdt >= 500
P3 (low):     everything else
```

P1 > P2 > P3. `compareSeverity(actual, min)` returns true when actual meets or exceeds min.

## Default subscriptions (seed at first launch when table is empty)

```
channel='dashboard', min_severity='P3', enabled=1   # universal — but dashboard always receives via SSE anyway, this row is a placeholder for UI
channel='tg',        min_severity='P2', enabled=1   # Telegram for P1 + P2 only
```

The router is the source of truth for which channels fire; SSE remains a separate broadcast (Dashboard is always "subscribed" to the SSE bus regardless of subscription rows).

---

## File structure

```
src/notifiers/
├── severity.ts    ★ new — Severity type + assignSeverity + compareSeverity
├── router.ts      ★ new — routeAlert(alert) reads subscriptions, dispatches
├── telegram.ts    ✎ refactor — expose sendAlertToTelegram() instead of bus subscription
└── sse-bus.ts     unchanged

src/storage/migrations/
└── v1_004_severity_subscriptions.sql   ★ new — alerts.severity column + subscriptions table

src/rules/engine.ts                     ✎ assign severity + call router
src/utils/event-bus.ts                  ✎ AlertNewPayload gains severity
src/api/subscriptions.ts                ★ new — CRUD API for subscriptions
src/dashboard/server.ts                 ✎ mount subscriptions router
src/dashboard/public/js/pages/settings.js  ✎ append Subscriptions card UI
src/index.ts                            ✎ seedSubscriptionsIfEmpty + remove old direct telegram subscribe

test/severity.test.ts                   ★ new — 4 cases
test/router.test.ts                     ★ new — 4 cases
test/migrations.test.ts                 ✎ +1 case
```

Target: **9 new tests** (4 severity + 4 router + 1 migration). 65 → 74.

---

## Task 1: Migration + Severity module

**Files:**
- `src/storage/migrations/v1_004_severity_subscriptions.sql` (new)
- `src/notifiers/severity.ts` (new)
- `test/severity.test.ts` (new)
- `test/migrations.test.ts` (+1 case)

### Step 1: Branch + baseline

```bash
cd ~/projects/chain-watcher
git status
git log --oneline -3
npm test 2>&1 | grep -E "Tests "
```

Expected: on `feat/v2-m12-severity-subscriptions`, M11.2 merged, **65 / 65 pass**.

### Step 2: Create migration

Create `src/storage/migrations/v1_004_severity_subscriptions.sql`:

```sql
-- M12: alert severity column + subscription routing table
ALTER TABLE alerts ADD COLUMN severity TEXT NOT NULL DEFAULT 'P2';

CREATE TABLE IF NOT EXISTS subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel TEXT NOT NULL,                -- 'dashboard' | 'tg' | 'webhook' | 'discord' | 'slack' (M13)
  min_severity TEXT NOT NULL,           -- 'P1' | 'P2' | 'P3'
  chain_filter TEXT,                    -- NULL = all chains; else JSON array
  rule_filter TEXT,                     -- NULL = all rules; else JSON array
  silence_until INTEGER,                -- unix ts; NULL = not silenced
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_subs_channel ON subscriptions(channel, enabled);
```

### Step 3: Extend migrations.test.ts

In `test/migrations.test.ts`, after the `v1_002 / v1_003` test, add:

```ts
  it('discovers and applies v1_004_severity_subscriptions.sql', () => {
    const db = getDb();
    const row = db
      .prepare(`SELECT name FROM _migrations WHERE name = 'v1_004_severity_subscriptions.sql'`)
      .get();
    expect(row).toBeDefined();
    const alertCols = db.prepare(`PRAGMA table_info(alerts)`).all() as Array<{ name: string }>;
    expect(alertCols.map((c) => c.name)).toContain('severity');
    const subTbl = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'subscriptions'`)
      .get();
    expect(subTbl).toBeDefined();
  });
```

### Step 4: Write severity test

Create `test/severity.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { assignSeverity, compareSeverity } from '../src/notifiers/severity.js';

const baseAlert = {
  id: 1,
  chain: 'eth' as const,
  rule: 'sender_repeats_to' as const,
  pivotAddress: '0xa',
  counterparty: '0xb',
  triggerTxHash: '0xtx',
  windowTxHashes: [],
  amountUsdt: 100,
  createdAt: 0,
  pivotLabels: [] as Array<{ label: string; category: string; riskScore: number }>,
  counterpartyLabels: [] as Array<{ label: string; category: string; riskScore: number }>,
};

describe('compareSeverity', () => {
  it('P1 satisfies any minimum', () => {
    expect(compareSeverity('P1', 'P1')).toBe(true);
    expect(compareSeverity('P1', 'P2')).toBe(true);
    expect(compareSeverity('P1', 'P3')).toBe(true);
  });
  it('P3 only satisfies P3', () => {
    expect(compareSeverity('P3', 'P1')).toBe(false);
    expect(compareSeverity('P3', 'P2')).toBe(false);
    expect(compareSeverity('P3', 'P3')).toBe(true);
  });
});

describe('assignSeverity', () => {
  it('returns P1 for OFAC labels regardless of amount', () => {
    const a = { ...baseAlert, amountUsdt: 100,
      counterpartyLabels: [{ label: 'OFAC SDN', category: 'ofac', riskScore: 95 }] };
    expect(assignSeverity(a)).toBe('P1');
  });

  it('returns P1 for amount >= 5000', () => {
    expect(assignSeverity({ ...baseAlert, amountUsdt: 5000 })).toBe('P1');
    expect(assignSeverity({ ...baseAlert, amountUsdt: 4999 })).not.toBe('P1');
  });

  it('returns P2 for CEX labels at low amount', () => {
    const a = { ...baseAlert, amountUsdt: 200,
      pivotLabels: [{ label: 'Binance Hot 14', category: 'cex', riskScore: 10 }] };
    expect(assignSeverity(a)).toBe('P2');
  });

  it('returns P3 for plain small alert with no labels', () => {
    expect(assignSeverity({ ...baseAlert, amountUsdt: 200 })).toBe('P3');
  });
});
```

### Step 5: Implement severity module

Create `src/notifiers/severity.ts`:

```ts
import type { AlertNewPayload } from '../utils/event-bus.js';

export type Severity = 'P1' | 'P2' | 'P3';

const SEV_ORDER: Record<Severity, number> = { P1: 3, P2: 2, P3: 1 };

const HIGH_RISK_CATS = new Set(['ofac', 'sanctions', 'mixer']);
const MED_RISK_CATS = new Set(['cex', 'bridge']);

/** True iff `actual` is at or above the `min` threshold (P1 > P2 > P3). */
export function compareSeverity(actual: Severity, min: Severity): boolean {
  return SEV_ORDER[actual] >= SEV_ORDER[min];
}

/** Policy: OFAC/sanctions/mixer OR amount >= 5000 → P1.
 *  CEX/bridge OR amount >= 500 → P2. Else P3. */
export function assignSeverity(
  payload: Pick<AlertNewPayload, 'amountUsdt' | 'pivotLabels' | 'counterpartyLabels'>,
): Severity {
  const cats = new Set<string>();
  for (const l of payload.pivotLabels ?? []) cats.add(l.category);
  for (const l of payload.counterpartyLabels ?? []) cats.add(l.category);

  for (const c of cats) if (HIGH_RISK_CATS.has(c)) return 'P1';
  if (payload.amountUsdt >= 5000) return 'P1';
  for (const c of cats) if (MED_RISK_CATS.has(c)) return 'P2';
  if (payload.amountUsdt >= 500) return 'P2';
  return 'P3';
}
```

### Step 6: Run severity tests, expect 6/6 pass

```bash
mkdir -p src/notifiers
npx vitest run test/severity.test.ts test/migrations.test.ts 2>&1 | tail -15
```

Expected: 6 severity + 4 migrations = 10 pass in those files.

### Step 7: Full suite

```bash
npm test 2>&1 | tail -5
```

Expected: **72 / 72** (65 + 6 severity + 1 migration). _Note: the severity test file has 6 it() blocks across 2 describes — count accordingly._

### Step 8: Commit

```bash
git add src/storage/migrations/v1_004_severity_subscriptions.sql src/notifiers/severity.ts test/severity.test.ts test/migrations.test.ts
git commit -m "feat(notifiers): severity policy + alerts.severity migration + subscriptions table

* v1_004 — ALTER alerts ADD severity TEXT DEFAULT 'P2' + CREATE
  TABLE subscriptions (channel, min_severity, filters, silence).
* severity.ts — assignSeverity(alert) and compareSeverity(actual, min).
  P1: ofac/sanctions/mixer labels OR amount >= 5000
  P2: cex/bridge labels OR amount >= 500
  P3: else
* 7 new tests (6 severity + 1 migration)."
```

---

## Task 2: Router module + subscription seed

**Files:**
- `src/notifiers/router.ts` (new)
- `test/router.test.ts` (new)
- `src/index.ts` (add seedSubscriptionsIfEmpty)

### Step 1: Write router test

Create `test/router.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let getDb: typeof import('../src/storage/db.js').getDb;
let routeAlert: typeof import('../src/notifiers/router.js').routeAlert;
let setChannelHandler: typeof import('../src/notifiers/router.js').setChannelHandler;

const baseAlert = {
  id: 1,
  chain: 'eth' as const,
  rule: 'sender_repeats_to' as const,
  pivotAddress: '0xa',
  counterparty: '0xb',
  triggerTxHash: '0xtx',
  windowTxHashes: [],
  amountUsdt: 1000,
  createdAt: 0,
  pivotLabels: [],
  counterpartyLabels: [],
  severity: 'P2' as const,
};

beforeEach(async () => {
  vi.resetModules();
  process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'cw-router-')), 'cw.db');
  ({ getDb } = await import('../src/storage/db.js'));
  ({ routeAlert, setChannelHandler } = await import('../src/notifiers/router.js'));
  // ensure tables exist (migration runs on getDb init)
  getDb();
});

function addSub(channel: string, minSeverity = 'P2', extras: Record<string, unknown> = {}): void {
  const now = Math.floor(Date.now() / 1000);
  getDb().prepare(
    `INSERT INTO subscriptions (channel, min_severity, chain_filter, rule_filter, silence_until, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
  ).run(
    channel,
    minSeverity,
    extras.chain_filter ?? null,
    extras.rule_filter ?? null,
    extras.silence_until ?? null,
    now,
    now,
  );
}

describe('routeAlert', () => {
  it('dispatches to channels whose min_severity is met', async () => {
    addSub('tg', 'P2');
    addSub('webhook', 'P1');
    const called: string[] = [];
    setChannelHandler('tg', async () => { called.push('tg'); });
    setChannelHandler('webhook', async () => { called.push('webhook'); });
    await routeAlert(baseAlert);
    expect(called).toEqual(['tg']); // webhook requires P1; alert is P2
  });

  it('respects chain_filter when set', async () => {
    addSub('tg', 'P3', { chain_filter: JSON.stringify(['bsc']) });
    const called: string[] = [];
    setChannelHandler('tg', async () => { called.push('tg'); });
    await routeAlert(baseAlert); // chain is eth, filter is bsc → skip
    expect(called).toEqual([]);
  });

  it('respects rule_filter when set', async () => {
    addSub('tg', 'P3', { rule_filter: JSON.stringify(['receiver_repeats_from']) });
    const called: string[] = [];
    setChannelHandler('tg', async () => { called.push('tg'); });
    await routeAlert(baseAlert);
    expect(called).toEqual([]);
  });

  it('respects silence_until in the future', async () => {
    const future = Math.floor(Date.now() / 1000) + 3600;
    addSub('tg', 'P3', { silence_until: future });
    const called: string[] = [];
    setChannelHandler('tg', async () => { called.push('tg'); });
    await routeAlert(baseAlert);
    expect(called).toEqual([]);
  });
});
```

### Step 2: Run test, expect FAIL (module missing)

```bash
npx vitest run test/router.test.ts 2>&1 | tail -10
```

Expected: `Cannot find module '../src/notifiers/router.js'`.

### Step 3: Implement router

Create `src/notifiers/router.ts`:

```ts
import { getDb } from '../storage/db.js';
import { logger } from '../utils/logger.js';
import type { AlertNewPayload } from '../utils/event-bus.js';
import { compareSeverity, type Severity } from './severity.js';

export type ChannelHandler = (alert: AlertNewPayload) => Promise<void>;

const handlers = new Map<string, ChannelHandler>();

export function setChannelHandler(channel: string, fn: ChannelHandler): void {
  handlers.set(channel, fn);
}

type SubRow = {
  id: number;
  channel: string;
  min_severity: string;
  chain_filter: string | null;
  rule_filter: string | null;
  silence_until: number | null;
  enabled: number;
};

export async function routeAlert(alert: AlertNewPayload): Promise<void> {
  const sev = alert.severity as Severity;
  if (!sev) {
    logger.warn({ alertId: alert.id }, 'routeAlert: missing severity, skipping');
    return;
  }
  const now = Math.floor(Date.now() / 1000);
  const subs = getDb()
    .prepare(`SELECT * FROM subscriptions WHERE enabled = 1`)
    .all() as SubRow[];

  for (const sub of subs) {
    if (!compareSeverity(sev, sub.min_severity as Severity)) continue;
    if (sub.chain_filter) {
      try {
        const allowed = JSON.parse(sub.chain_filter) as string[];
        if (!allowed.includes(alert.chain)) continue;
      } catch { /* malformed filter → treat as no-match for safety */ continue; }
    }
    if (sub.rule_filter) {
      try {
        const allowed = JSON.parse(sub.rule_filter) as string[];
        if (!allowed.includes(alert.rule)) continue;
      } catch { continue; }
    }
    if (sub.silence_until && sub.silence_until > now) continue;

    const handler = handlers.get(sub.channel);
    if (!handler) {
      logger.debug({ channel: sub.channel }, 'routeAlert: no handler registered, skipping');
      continue;
    }
    try {
      await handler(alert);
    } catch (err) {
      logger.warn({ err: (err as Error).message, channel: sub.channel, alertId: alert.id }, 'channel handler failed');
    }
  }
}

/** Default seed when subscriptions table is empty. Tg gets P2+, dashboard is informational. */
export function seedSubscriptionsIfEmpty(): void {
  const db = getDb();
  const existing = db.prepare(`SELECT COUNT(*) AS n FROM subscriptions`).get() as { n: number };
  if (existing.n > 0) return;
  const now = Math.floor(Date.now() / 1000);
  const insert = db.prepare(
    `INSERT INTO subscriptions (channel, min_severity, chain_filter, rule_filter, silence_until, enabled, created_at, updated_at)
       VALUES (?, ?, NULL, NULL, NULL, 1, ?, ?)`,
  );
  insert.run('dashboard', 'P3', now, now);
  insert.run('tg', 'P2', now, now);
  logger.info('subscriptions seeded (dashboard P3, tg P2)');
}
```

### Step 4: Wire `seedSubscriptionsIfEmpty` into `src/index.ts`

In `src/index.ts`, find the existing M10 seed block. After `seedEtherscanLabels` lines, add:

```ts
  const { seedSubscriptionsIfEmpty } = await import('./notifiers/router.js');
  seedSubscriptionsIfEmpty();
```

Use a dynamic `import` to avoid a static-cycle worry (router will import from event-bus which is already imported).

(If the existing file uses static top-level imports already for similar modules, prefer static — but dynamic is safe.)

### Step 5: Run router tests

```bash
npx vitest run test/router.test.ts 2>&1 | tail -10
```

Expected: 4 / 4 pass.

### Step 6: Full suite

```bash
npm test 2>&1 | tail -5
```

Expected: **76 / 76** (72 + 4).

### Step 7: Commit

```bash
git add src/notifiers/router.ts test/router.test.ts src/index.ts
git commit -m "feat(notifiers): subscription router + default seed

* router.ts — routeAlert(alert) reads enabled subscriptions, applies
  severity threshold + chain_filter + rule_filter + silence_until,
  dispatches to handlers registered via setChannelHandler(channel, fn).
* seedSubscriptionsIfEmpty seeds two defaults on first boot:
  (dashboard, P3) and (tg, P2).
* Wired into src/index.ts post-label-seed."
```

---

## Task 3: Engine — assign severity + call router

**Files:**
- `src/utils/event-bus.ts` (add `severity` to AlertNewPayload)
- `src/rules/engine.ts` (compute + persist severity, call routeAlert)

### Step 1: Extend `AlertNewPayload`

Open `src/utils/event-bus.ts`. Find `AlertNewPayload`. Add a `severity` field:

```ts
export type AlertNewPayload = {
  // ... existing fields ...
  severity: 'P1' | 'P2' | 'P3';
};
```

(Place it after `createdAt` to be near the metadata.)

### Step 2: Engine — assign + persist

Open `src/rules/engine.ts`. Find the `recordAlert` function. The INSERT currently writes `pivot_labels` + `counterparty_labels`. Now also persist `severity`. After `cpFull` is computed, compute severity:

Add import at top:

```ts
import { assignSeverity } from '../notifiers/severity.js';
import { routeAlert } from '../notifiers/router.js';
```

Update `recordAlert` to compute severity right after the label snapshots:

```ts
  const sev = assignSeverity({ amountUsdt: tx.amountUsdt, pivotLabels: pivotFull, counterpartyLabels: cpFull });
```

Add `severity` to the INSERT (the columns list and bound params):

```ts
  const res = db
    .prepare(
      `INSERT INTO alerts (chain, rule, pivot_address, counterparty, trigger_tx_hash,
                           window_tx_hashes, amount_usdt, created_at,
                           pivot_labels, counterparty_labels, severity)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      tx.chain, rule, pivot, counterparty, tx.txHash,
      JSON.stringify(windowTxHashes), tx.amountUsdt, now,
      JSON.stringify(pivotFull), JSON.stringify(cpFull), sev,
    );
```

Then include `severity: sev` on the `payload` object passed to `bus.emit(EVENTS.AlertNew, payload)`. After the existing emit, call the router:

```ts
  bus.emit(EVENTS.AlertNew, payload);
  void routeAlert(payload);  // fire-and-forget; router logs its own failures
```

(Don't `await` — the engine shouldn't block on notifier latency.)

### Step 3: Verify

```bash
npx tsc -p . --noEmit 2>&1 | tail -5
npm test 2>&1 | tail -5
```

Expected: typecheck clean. Tests: **76 / 76** (existing engine tests will see `severity` now populated as 'P3' for amount=200; they don't assert severity, so they keep passing).

### Step 4: Commit

```bash
git add src/utils/event-bus.ts src/rules/engine.ts
git commit -m "feat(rules/engine): assign severity + invoke router on alert fire

* AlertNewPayload now carries severity ('P1' | 'P2' | 'P3').
* recordAlert computes severity from amount + label snapshots,
  persists it in the alerts row, includes it in the SSE payload,
  and fire-and-forget calls routeAlert(payload)."
```

---

## Task 4: Telegram refactor — bus-subscriber → router-callable

**Files:**
- `src/notifiers/telegram.ts` (refactor)

The current Telegram notifier subscribes to `bus.on(EVENTS.AlertNew, ...)` and fires every alert. We want the router to gate it.

### Step 1: Refactor telegram.ts

Open `src/notifiers/telegram.ts`. Find the `startTelegramNotifier` function and the bus subscription. Replace the bus subscription with a router registration:

Replace any `bus.on(EVENTS.AlertNew, ...)` calls inside `startTelegramNotifier` with:

```ts
  const { setChannelHandler } = await import('./router.js');
  setChannelHandler('tg', async (alert) => {
    const b = await ensureBot();
    if (!b) return;
    const chatId = getSetting<string>(SETTINGS.tg_chat_id, '');
    if (!chatId) return;
    try {
      await b.sendMessage(chatId, formatAlert(alert), { parse_mode: 'Markdown' });
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'tg send failed');
    }
  });
```

If there's an `AlertNew` `bus.off` cleanup in `stopTelegramNotifier`, you can remove it (or leave it as a no-op — handlers map persists across stop/start; that's acceptable).

Also: `formatAlert` may currently exclude severity. Add it to the message:

```ts
function formatAlert(a: AlertNewPayload): string {
  const lines = [
    `*chain-watcher alert* [${a.severity}]`,
    `chain: ${a.chain}`,
    `rule: ${a.rule}`,
    `pivot: \`${a.pivotAddress}\``,
    `counterparty: \`${a.counterparty}\``,
    `trigger: \`${a.triggerTxHash}\``,
    `amount: ${a.amountUsdt.toFixed(2)} USDT`,
  ];
  return lines.join('\n');
}
```

(Keep the existing lines structure; just add `[${a.severity}]` to the header.)

### Step 2: Verify

```bash
npx tsc -p . --noEmit 2>&1 | tail -3
npm test 2>&1 | tail -5
```

Expected: clean, **76 / 76**.

### Step 3: Commit

```bash
git add src/notifiers/telegram.ts
git commit -m "refactor(notifiers/telegram): subscribe via router instead of bus

Telegram is now a router channel ('tg') — startTelegramNotifier
registers a handler via setChannelHandler. This lets the M12
subscription rules (min_severity / chain_filter / rule_filter /
silence_until) gate Telegram sends.
formatAlert prefixes the message with [P1] / [P2] / [P3]."
```

---

## Task 5: Subscriptions REST API + Settings UI

**Files:**
- `src/api/subscriptions.ts` (new)
- `src/dashboard/server.ts` (mount)
- `src/dashboard/public/js/pages/settings.js` (append Subscriptions card)

### Step 1: Create the API

Create `src/api/subscriptions.ts`:

```ts
import { Router } from 'express';
import { getDb } from '../storage/db.js';

export const subscriptionsRouter = Router();

subscriptionsRouter.get('/api/subscriptions', (_req, res) => {
  const rows = getDb()
    .prepare(
      `SELECT id, channel, min_severity AS minSeverity, chain_filter AS chainFilter,
              rule_filter AS ruleFilter, silence_until AS silenceUntil, enabled,
              created_at AS createdAt, updated_at AS updatedAt
         FROM subscriptions ORDER BY id`,
    )
    .all();
  res.json(rows);
});

subscriptionsRouter.post('/api/subscriptions', (req, res): void => {
  const { channel, minSeverity, chainFilter, ruleFilter, silenceUntil, enabled } = req.body ?? {};
  if (!channel || !minSeverity) {
    res.status(400).json({ error: 'channel + minSeverity required' });
    return;
  }
  const now = Math.floor(Date.now() / 1000);
  const result = getDb()
    .prepare(
      `INSERT INTO subscriptions (channel, min_severity, chain_filter, rule_filter,
                                  silence_until, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      String(channel),
      String(minSeverity),
      chainFilter ?? null,
      ruleFilter ?? null,
      silenceUntil ?? null,
      enabled === false ? 0 : 1,
      now,
      now,
    );
  res.json({ id: Number(result.lastInsertRowid), ok: true });
});

subscriptionsRouter.patch('/api/subscriptions/:id', (req, res): void => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: 'invalid id' });
    return;
  }
  const allowed = ['channel', 'min_severity', 'chain_filter', 'rule_filter', 'silence_until', 'enabled'];
  const camelMap: Record<string, string> = {
    minSeverity: 'min_severity',
    chainFilter: 'chain_filter',
    ruleFilter: 'rule_filter',
    silenceUntil: 'silence_until',
  };
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [k, v] of Object.entries(req.body ?? {})) {
    const col = camelMap[k] ?? k;
    if (!allowed.includes(col)) continue;
    sets.push(`${col} = ?`);
    params.push(col === 'enabled' ? (v ? 1 : 0) : v);
  }
  if (sets.length === 0) {
    res.json({ ok: true });
    return;
  }
  sets.push('updated_at = ?');
  params.push(Math.floor(Date.now() / 1000));
  params.push(id);
  getDb().prepare(`UPDATE subscriptions SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  res.json({ ok: true });
});

subscriptionsRouter.delete('/api/subscriptions/:id', (req, res) => {
  const id = Number(req.params.id);
  getDb().prepare(`DELETE FROM subscriptions WHERE id = ?`).run(id);
  res.json({ ok: true });
});
```

### Step 2: Mount in `src/dashboard/server.ts`

Open `src/dashboard/server.ts`. Add import alongside `labelsRouter`:

```ts
import { subscriptionsRouter } from '../api/subscriptions.js';
```

In `startDashboard()`, after `app.use(labelsRouter)`, add:

```ts
  app.use(subscriptionsRouter);
```

### Step 3: Append Subscriptions card to Settings

Open `src/dashboard/public/js/pages/settings.js`. After the existing `renderLabelSources` call near the end, append a new section. Find the line that calls `renderLabelSources(sourcesCard.querySelector('#sources-body'));` and right after it, add:

```js
  // M12: subscriptions card
  const subsCard = document.createElement('div');
  subsCard.className = 'card';
  subsCard.style.marginTop = 'var(--sp-4)';
  subsCard.innerHTML = `<h2 style="font-size:var(--fs-md); margin:0 0 var(--sp-3); color:var(--accent-soft);">Subscriptions</h2>
    <div class="muted" style="font-size:var(--fs-sm); margin-bottom:var(--sp-3);">
      Decide which notifier channels each alert reaches. Dashboard is universal (always receives via SSE).
    </div>
    <div id="subs-body" style="display:flex; flex-direction:column; gap:var(--sp-2);"></div>
    <div style="display:flex; gap:var(--sp-2); margin-top:var(--sp-3); align-items:center;">
      <select id="sub-add-channel">
        <option value="tg">tg</option>
        <option value="webhook">webhook</option>
        <option value="discord">discord</option>
        <option value="slack">slack</option>
      </select>
      <select id="sub-add-sev">
        <option value="P1">P1 only</option>
        <option value="P2" selected>P2+</option>
        <option value="P3">All (P3+)</option>
      </select>
      <button id="sub-add" class="btn">Add subscription</button>
    </div>`;
  root.appendChild(subsCard);
  await renderSubs(subsCard.querySelector('#subs-body'));
  subsCard.querySelector('#sub-add').addEventListener('click', async () => {
    const channel = subsCard.querySelector('#sub-add-channel').value;
    const minSeverity = subsCard.querySelector('#sub-add-sev').value;
    try {
      await apiPost('/api/subscriptions', { channel, minSeverity });
      toast({ kind: 'success', message: 'Subscription added' });
      await renderSubs(subsCard.querySelector('#subs-body'));
    } catch { /* toasted */ }
  });
```

At the bottom of the file, add `renderSubs` helper:

```js
async function renderSubs(body) {
  const rows = await apiGet('/api/subscriptions');
  if (rows.length === 0) {
    body.innerHTML = '<div class="muted">No subscriptions configured.</div>';
    return;
  }
  body.innerHTML = rows.map((s) => `
    <div style="display:flex; gap:var(--sp-3); align-items:center; padding:var(--sp-2); border:1px solid var(--border); border-radius:var(--r-sm);">
      <strong style="min-width:90px;">${s.channel}</strong>
      <select data-id="${s.id}" data-key="minSeverity">
        <option ${s.minSeverity === 'P1' ? 'selected' : ''}>P1</option>
        <option ${s.minSeverity === 'P2' ? 'selected' : ''}>P2</option>
        <option ${s.minSeverity === 'P3' ? 'selected' : ''}>P3</option>
      </select>
      <label style="display:flex; align-items:center; gap:var(--sp-1);">
        <input type="checkbox" data-id="${s.id}" data-key="enabled" ${s.enabled ? 'checked' : ''} />
        enabled
      </label>
      <span style="flex:1;"></span>
      <button class="btn ghost" data-del="${s.id}">×</button>
    </div>
  `).join('');
  for (const sel of body.querySelectorAll('select[data-key="minSeverity"]')) {
    sel.addEventListener('change', async () => {
      await apiPatch(`/api/subscriptions/${sel.dataset.id}`, { minSeverity: sel.value });
      toast({ kind: 'success', message: 'Subscription updated' });
    });
  }
  for (const cb of body.querySelectorAll('input[type="checkbox"][data-key="enabled"]')) {
    cb.addEventListener('change', async () => {
      await apiPatch(`/api/subscriptions/${cb.dataset.id}`, { enabled: cb.checked });
    });
  }
  for (const btn of body.querySelectorAll('[data-del]')) {
    btn.addEventListener('click', async () => {
      await apiDelete(`/api/subscriptions/${btn.dataset.del}`);
      toast({ kind: 'success', message: 'Removed' });
      await renderSubs(body);
    });
  }
}
```

### Step 4: Verify

```bash
node --check src/dashboard/public/js/pages/settings.js
npx tsc -p . --noEmit
npm test 2>&1 | tail -5
```

Expected: parse OK, typecheck clean, **76 / 76**.

### Step 5: Commit

```bash
git add src/api/subscriptions.ts src/dashboard/server.ts src/dashboard/public/js/pages/settings.js
git commit -m "feat(dashboard): subscriptions REST API + Settings card

* GET/POST/PATCH/DELETE /api/subscriptions
* Settings page gains a 'Subscriptions' card listing all enabled
  channels with severity selector + enabled toggle + delete.
  + Add subscription drop-down to create new channel routes."
```

---

## Task 6: Live smoke + final gates + PR

- [ ] **Step 1: Full gates**

```bash
cd ~/projects/chain-watcher
npx tsc -p . --noEmit
npm run lint
npm test
npm run build
```

Expected: clean, **76 / 76**.

- [ ] **Step 2: Live smoke**

```bash
cp .env.example .env
redis-server --daemonize yes --port 6379 --dir /tmp 2>/dev/null || true
redis-cli ping
npm run dev > /tmp/m12-smoke.log 2>&1 &
sleep 18
```

Verify:

```bash
# Subscriptions seeded?
curl -s http://localhost:8787/api/subscriptions | head -c 400
# Expected: 2 rows — (dashboard P3) + (tg P2)

# Alerts now have severity?
sqlite3 ~/projects/chain-watcher/data/cw.db "SELECT severity, COUNT(*) FROM alerts GROUP BY severity"
# Expected: distribution like P3 → most, P2 → some, P1 → few or 0
```

Open browser: `http://localhost:8787/settings`. Verify the Subscriptions card appears under Label sources.

- [ ] **Step 3: Cleanup**

```bash
pkill -f "tsx.*src/index" 2>/dev/null
redis-cli shutdown 2>/dev/null || true
rm -f .env
```

- [ ] **Step 4: Push + PR**

```bash
git push -u origin feat/v2-m12-severity-subscriptions
gh pr create --base main --head feat/v2-m12-severity-subscriptions \
  --title "feat(v2/M12): alert severity + subscription router" \
  --body "$(cat <<'EOF'
## Summary

Adds P1/P2/P3 severity to every alert, a subscriptions table that gates which notifier channels each alert reaches, and a Settings UI to manage subscriptions. Ships sensible defaults (dashboard P3, tg P2).

### What changed

- **v1_004 migration** — \`alerts.severity\` column + \`subscriptions\` table
- **\`src/notifiers/severity.ts\`** — policy: OFAC/Mixer or amount>=5000 → P1; CEX/Bridge or amount>=500 → P2; else P3
- **\`src/notifiers/router.ts\`** — routeAlert reads enabled subscriptions, applies severity threshold + filters + silence, dispatches to per-channel handlers registered via setChannelHandler
- **\`src/rules/engine.ts\`** — assigns severity at alert-fire time, persists it, invokes router (fire-and-forget) alongside the existing SSE emit
- **\`src/notifiers/telegram.ts\`** — refactored from bus subscriber to router channel handler; message now prefixed with [P1]/[P2]/[P3]
- **\`src/api/subscriptions.ts\`** — full CRUD REST API
- **Settings page** — new Subscriptions card with channel/severity/enabled controls + Add subscription dropdown
- **Default seed** — on first boot, two rows: (dashboard, P3) + (tg, P2). Dashboard SSE remains universal regardless.

## Test plan

- [x] typecheck / lint / build clean
- [x] \`npm test\` — **76 / 76** (65 prior + 11 new: 6 severity + 4 router + 1 migration)
- [x] Live smoke: \`/api/subscriptions\` seeded, alerts table populated with severity, Settings UI renders

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Done criteria

- 6 commits on `feat/v2-m12-severity-subscriptions` + PR
- 76 / 76 tests pass locally
- Smoke: subscriptions seeded, alerts now carry severity, Settings shows the card
