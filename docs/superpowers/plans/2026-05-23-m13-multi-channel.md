# M13 — Multi-Channel Notifiers (Webhook + Discord + Slack) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** Wire three new notifier channels (`webhook`, `discord`, `slack`) into the M12 router. Each is a thin HTTP POST shaped per its target's contract. Channel-specific configuration (URL, optional template) is stored per-subscription via a new `subscriptions.config` JSON column. Failures are best-effort with bounded retries (in-process; no separate BullMQ queue — that's M14+).

**Architecture:** Each new file under `src/notifiers/` implements a single `send(alert, config)` function and registers via `setChannelHandler(...)` from M12's router. The router already gates by severity/filters; the new notifiers only worry about formatting + HTTP. Configuration lives as JSON on the `subscriptions` row (`config` column), parsed at dispatch time.

**Tech Stack:** Existing — TypeScript + Express + fetch (native in Node 20+). No new dependencies.

---

## Prerequisites

- main HEAD M12 merged, **76 / 76 tests passing**
- Subscriptions table seeded (dashboard P3 + tg P2)

---

## File structure

```
src/notifiers/
├── webhook.ts             ★ new
├── discord.ts             ★ new
├── slack.ts               ★ new
├── format.ts              ★ new — shared formatters (plain text + markdown + slack block kit)
└── (router.ts, severity.ts, telegram.ts unchanged)

src/storage/migrations/
└── v1_005_subscriptions_config.sql   ★ new — adds subscriptions.config TEXT column

src/index.ts                          ✎ register new channel handlers
src/api/subscriptions.ts              ✎ accept + return config field
src/dashboard/public/js/pages/settings.js  ✎ surface config editor for non-tg channels

test/
├── format.test.ts                    ★ new — 4 cases (plain / markdown / slack block / fallback)
├── webhook.test.ts                   ★ new — 3 cases (success / non-2xx / network error)
└── migrations.test.ts                ✎ +1 case for v1_005
```

Target: **+8 tests** (76 → 84). No Discord / Slack live tests (their webhooks need real URLs); we cover them indirectly via the webhook test (same HTTP-POST contract) and structural checks.

---

## Task 1: Migration + format module

**Files:**
- `src/storage/migrations/v1_005_subscriptions_config.sql` (new)
- `src/notifiers/format.ts` (new)
- `test/format.test.ts` (new)
- `test/migrations.test.ts` (+1 case)

### Step 1: Confirm baseline

```bash
cd ~/projects/chain-watcher
git status
git log --oneline -3
npm test 2>&1 | grep -E "Tests "
```

Expected: branch `feat/v2-m13-multi-channel`, baseline 76/76.

### Step 2: Create the migration

Create `src/storage/migrations/v1_005_subscriptions_config.sql`:

```sql
-- M13: per-subscription channel config (URL, template, etc.) as JSON blob.
ALTER TABLE subscriptions ADD COLUMN config TEXT NOT NULL DEFAULT '{}';
```

### Step 3: Extend migrations test

In `test/migrations.test.ts`, after the v1_004 test, add:

```ts
  it('discovers and applies v1_005_subscriptions_config.sql', () => {
    const db = getDb();
    const row = db
      .prepare(`SELECT name FROM _migrations WHERE name = 'v1_005_subscriptions_config.sql'`)
      .get();
    expect(row).toBeDefined();
    const cols = db.prepare(`PRAGMA table_info(subscriptions)`).all() as Array<{ name: string }>;
    expect(cols.map((c) => c.name)).toContain('config');
  });
```

### Step 4: Write format test

Create `test/format.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { formatPlain, formatMarkdown, formatSlackBlocks } from '../src/notifiers/format.js';

const sampleAlert = {
  id: 42,
  chain: 'eth' as const,
  rule: 'sender_repeats_to' as const,
  pivotAddress: '0x9a4e3c2b8d7c9f1e2a3b4c5d6e7f8a9b0c1d2e3f',
  counterparty: '0xf72b0a8d1e2c3b4a5b6c7d8e9f0a1b2c3d4e5f60',
  triggerTxHash: '0xab12f9d4',
  windowTxHashes: [],
  amountUsdt: 4219.5,
  createdAt: 1700000000,
  severity: 'P1' as const,
  pivotLabels: [{ label: 'OFAC SDN', category: 'ofac', riskScore: 95 }],
  counterpartyLabels: [],
};

describe('format', () => {
  it('formatPlain includes severity, chain, rule, amount, addresses', () => {
    const out = formatPlain(sampleAlert);
    expect(out).toContain('[P1]');
    expect(out).toContain('eth');
    expect(out).toContain('sender_repeats_to');
    expect(out).toContain('4219.50');
    expect(out).toContain('0x9a4e3c2b'); // shortened pivot
  });

  it('formatMarkdown wraps addresses in backticks', () => {
    const out = formatMarkdown(sampleAlert);
    expect(out).toMatch(/`0x9a4e3c2b/);
    expect(out).toContain('*'); // markdown bold
  });

  it('formatSlackBlocks returns valid Block Kit JSON structure', () => {
    const out = formatSlackBlocks(sampleAlert);
    expect(Array.isArray(out.blocks)).toBe(true);
    expect(out.blocks.length).toBeGreaterThan(0);
    // First block should be a header or section
    expect(['header', 'section']).toContain(out.blocks[0].type);
  });

  it('formatPlain handles missing labels gracefully', () => {
    const noLabels = { ...sampleAlert, pivotLabels: [], counterpartyLabels: [] };
    const out = formatPlain(noLabels);
    expect(out).toContain('[P1]');
    expect(out).not.toContain('undefined');
  });
});
```

### Step 5: Implement format module

Create `src/notifiers/format.ts`:

```ts
import type { AlertNewPayload } from '../utils/event-bus.js';

const shortAddr = (h: string): string =>
  typeof h === 'string' && h.length > 14 ? `${h.slice(0, 8)}…${h.slice(-4)}` : h;

const labelString = (labels: AlertNewPayload['pivotLabels']): string =>
  labels && labels.length > 0 ? ` (${labels.map((l) => l.label).join(', ')})` : '';

/** Plain text — Telegram fallback, Webhook generic. */
export function formatPlain(a: AlertNewPayload): string {
  return [
    `[${a.severity}] chain-watcher alert`,
    `chain: ${a.chain}`,
    `rule: ${a.rule}`,
    `pivot: ${shortAddr(a.pivotAddress)}${labelString(a.pivotLabels)}`,
    `counterparty: ${shortAddr(a.counterparty)}${labelString(a.counterpartyLabels)}`,
    `amount: ${a.amountUsdt.toFixed(2)} USDT`,
    `trigger: ${shortAddr(a.triggerTxHash)}`,
  ].join('\n');
}

/** Markdown — Telegram (parse_mode=Markdown), Discord (descriptions support some markdown). */
export function formatMarkdown(a: AlertNewPayload): string {
  return [
    `*[${a.severity}] chain-watcher alert*`,
    `chain: \`${a.chain}\``,
    `rule: \`${a.rule}\``,
    `pivot: \`${shortAddr(a.pivotAddress)}\`${labelString(a.pivotLabels)}`,
    `counterparty: \`${shortAddr(a.counterparty)}\`${labelString(a.counterpartyLabels)}`,
    `amount: *${a.amountUsdt.toFixed(2)} USDT*`,
    `trigger: \`${shortAddr(a.triggerTxHash)}\``,
  ].join('\n');
}

/** Slack Block Kit. */
export function formatSlackBlocks(a: AlertNewPayload): { blocks: any[] } {
  const labelsLine = (ls: AlertNewPayload['pivotLabels']) =>
    ls && ls.length > 0 ? ` _(${ls.map((l) => l.label).join(', ')})_` : '';
  return {
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: `[${a.severity}] chain-watcher alert` },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Chain:* ${a.chain}` },
          { type: 'mrkdwn', text: `*Rule:* ${a.rule}` },
          { type: 'mrkdwn', text: `*Amount:* ${a.amountUsdt.toFixed(2)} USDT` },
          { type: 'mrkdwn', text: `*Tx:* \`${shortAddr(a.triggerTxHash)}\`` },
        ],
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text:
            `*Pivot:* \`${shortAddr(a.pivotAddress)}\`${labelsLine(a.pivotLabels)}\n` +
            `*Counterparty:* \`${shortAddr(a.counterparty)}\`${labelsLine(a.counterpartyLabels)}`,
        },
      },
    ],
  };
}
```

### Step 6: Verify

```bash
npx vitest run test/format.test.ts test/migrations.test.ts 2>&1 | tail -15
npm test 2>&1 | tail -5
```

Expected: format 4/4 + migrations 5/5 (4 + new). Full suite: **81 / 81** (76 + 4 format + 1 migration).

### Step 7: Commit

```bash
git add src/storage/migrations/v1_005_subscriptions_config.sql src/notifiers/format.ts test/format.test.ts test/migrations.test.ts
git commit -m "feat(notifiers): shared formatters + v1_005 subscriptions.config column

* v1_005 — ALTER subscriptions ADD config TEXT DEFAULT '{}'.
* format.ts — formatPlain / formatMarkdown / formatSlackBlocks for
  reuse across webhook / discord / slack / telegram.
* 5 new tests (4 format + 1 migration)."
```

---

## Task 2: Webhook notifier

**Files:**
- `src/notifiers/webhook.ts` (new)
- `test/webhook.test.ts` (new)
- `src/index.ts` (register handler)

### Step 1: Write test

Create `test/webhook.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { sendToWebhook } from '../src/notifiers/webhook.js';

const sampleAlert = {
  id: 1,
  chain: 'eth' as const,
  rule: 'sender_repeats_to' as const,
  pivotAddress: '0xa',
  counterparty: '0xb',
  triggerTxHash: '0xt',
  windowTxHashes: [],
  amountUsdt: 1000,
  createdAt: 0,
  severity: 'P2' as const,
  pivotLabels: [],
  counterpartyLabels: [],
};

let server: Server;
let port: number;
let receivedBodies: any[] = [];
let nextStatus = 200;

beforeEach(async () => {
  receivedBodies = [];
  nextStatus = 200;
  const app = express();
  app.use(express.json());
  app.post('/hook', (req, res) => {
    receivedBodies.push(req.body);
    res.status(nextStatus).send(nextStatus === 200 ? 'ok' : 'fail');
  });
  await new Promise<void>((r) => {
    server = app.listen(0, () => r());
  });
  const addr = server.address();
  port = typeof addr === 'object' && addr ? addr.port : 0;
});

afterEach(() => new Promise<void>((r) => server.close(() => r())));

describe('sendToWebhook', () => {
  it('POSTs the alert as JSON on success', async () => {
    await sendToWebhook(sampleAlert, { url: `http://127.0.0.1:${port}/hook` });
    expect(receivedBodies).toHaveLength(1);
    expect(receivedBodies[0]).toMatchObject({
      severity: 'P2',
      chain: 'eth',
      amountUsdt: 1000,
    });
  });

  it('throws on non-2xx (caller decides retry)', async () => {
    nextStatus = 500;
    await expect(sendToWebhook(sampleAlert, { url: `http://127.0.0.1:${port}/hook` })).rejects.toThrow();
  });

  it('no-op when url is missing', async () => {
    await sendToWebhook(sampleAlert, {});
    expect(receivedBodies).toHaveLength(0);
  });
});
```

### Step 2: Run test, expect FAIL (module missing)

```bash
npx vitest run test/webhook.test.ts 2>&1 | tail -10
```

### Step 3: Implement webhook

Create `src/notifiers/webhook.ts`:

```ts
import type { AlertNewPayload } from '../utils/event-bus.js';

export type WebhookConfig = {
  url?: string;
  timeoutMs?: number;
};

/** POSTs the AlertNewPayload as JSON to config.url. Throws on network error
 *  or non-2xx response so the router can log it. */
export async function sendToWebhook(alert: AlertNewPayload, config: WebhookConfig): Promise<void> {
  if (!config.url) return;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), config.timeoutMs ?? 5000);
  try {
    const res = await fetch(config.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(alert),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      throw new Error(`webhook ${config.url} → ${res.status} ${res.statusText}`);
    }
  } finally {
    clearTimeout(timer);
  }
}
```

### Step 4: Run tests

```bash
npx vitest run test/webhook.test.ts 2>&1 | tail -10
```

Expected: 3 / 3 pass.

### Step 5: Register the handler in `src/index.ts`

In `src/index.ts`, after `seedSubscriptionsIfEmpty()`, register the webhook channel handler. Add a new dynamic import block:

```ts
  const { setChannelHandler } = await import('./notifiers/router.js');
  const { sendToWebhook } = await import('./notifiers/webhook.js');
  setChannelHandler('webhook', async (alert) => {
    // Read each subscription's config; one handler per channel, but multiple
    // subscriptions can target the same channel — so we need the row's config.
    // The router currently passes only the alert; channel-config lookup goes
    // through a side query here.
    const db = (await import('./storage/db.js')).getDb();
    const rows = db
      .prepare(`SELECT config FROM subscriptions WHERE channel = 'webhook' AND enabled = 1`)
      .all() as Array<{ config: string }>;
    for (const r of rows) {
      let cfg = {};
      try { cfg = JSON.parse(r.config); } catch { /* malformed JSON → skip */ }
      try {
        await sendToWebhook(alert, cfg);
      } catch (err) {
        const { logger } = await import('./utils/logger.js');
        logger.warn({ err: (err as Error).message }, 'webhook send failed');
      }
    }
  });
```

### Step 6: Full suite

```bash
npm test 2>&1 | tail -5
```

Expected: **84 / 84** (81 + 3).

### Step 7: Commit

```bash
git add src/notifiers/webhook.ts test/webhook.test.ts src/index.ts
git commit -m "feat(notifiers): webhook channel — POST JSON, 5s timeout, no retry

* sendToWebhook(alert, { url, timeoutMs }) — POSTs the
  AlertNewPayload as JSON. Throws on non-2xx so the router logs it.
* Registered in src/index.ts as channel 'webhook'. The handler
  reads per-subscription config from the subscriptions row so
  multiple webhook subscriptions can route to different URLs.
* 3 unit tests using a fake Express server."
```

---

## Task 3: Discord + Slack notifiers

**Files:**
- `src/notifiers/discord.ts` (new)
- `src/notifiers/slack.ts` (new)
- `src/index.ts` (register handlers)

(Both follow the same pattern as webhook — POST JSON to a configured URL. Discord wants `{ content }` or `{ embeds }`; Slack wants `{ blocks }`. No new unit tests beyond what webhook covers; the format module already has Slack-block test coverage.)

### Step 1: Create `src/notifiers/discord.ts`

```ts
import type { AlertNewPayload } from '../utils/event-bus.js';
import { formatMarkdown } from './format.js';

export type DiscordConfig = {
  webhookUrl?: string;
  timeoutMs?: number;
};

const SEV_COLOR: Record<string, number> = {
  P1: 0xf87171, // red
  P2: 0xfacc15, // yellow
  P3: 0xa78bfa, // purple
};

export async function sendToDiscord(alert: AlertNewPayload, config: DiscordConfig): Promise<void> {
  if (!config.webhookUrl) return;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), config.timeoutMs ?? 5000);
  try {
    const body = {
      embeds: [
        {
          title: `chain-watcher alert [${alert.severity}]`,
          description: formatMarkdown(alert),
          color: SEV_COLOR[alert.severity] ?? 0x71717a,
          timestamp: new Date(alert.createdAt * 1000).toISOString(),
        },
      ],
    };
    const res = await fetch(config.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      throw new Error(`discord webhook → ${res.status} ${res.statusText}`);
    }
  } finally {
    clearTimeout(timer);
  }
}
```

### Step 2: Create `src/notifiers/slack.ts`

```ts
import type { AlertNewPayload } from '../utils/event-bus.js';
import { formatSlackBlocks } from './format.js';

export type SlackConfig = {
  webhookUrl?: string;
  timeoutMs?: number;
};

export async function sendToSlack(alert: AlertNewPayload, config: SlackConfig): Promise<void> {
  if (!config.webhookUrl) return;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), config.timeoutMs ?? 5000);
  try {
    const body = formatSlackBlocks(alert);
    const res = await fetch(config.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      throw new Error(`slack webhook → ${res.status} ${res.statusText}`);
    }
  } finally {
    clearTimeout(timer);
  }
}
```

### Step 3: Register in `src/index.ts`

After the webhook registration block, add discord + slack:

```ts
  const { sendToDiscord } = await import('./notifiers/discord.js');
  setChannelHandler('discord', async (alert) => {
    const db = (await import('./storage/db.js')).getDb();
    const rows = db
      .prepare(`SELECT config FROM subscriptions WHERE channel = 'discord' AND enabled = 1`)
      .all() as Array<{ config: string }>;
    for (const r of rows) {
      let cfg = {};
      try { cfg = JSON.parse(r.config); } catch { /* skip */ }
      try {
        await sendToDiscord(alert, cfg);
      } catch (err) {
        const { logger } = await import('./utils/logger.js');
        logger.warn({ err: (err as Error).message }, 'discord send failed');
      }
    }
  });

  const { sendToSlack } = await import('./notifiers/slack.js');
  setChannelHandler('slack', async (alert) => {
    const db = (await import('./storage/db.js')).getDb();
    const rows = db
      .prepare(`SELECT config FROM subscriptions WHERE channel = 'slack' AND enabled = 1`)
      .all() as Array<{ config: string }>;
    for (const r of rows) {
      let cfg = {};
      try { cfg = JSON.parse(r.config); } catch { /* skip */ }
      try {
        await sendToSlack(alert, cfg);
      } catch (err) {
        const { logger } = await import('./utils/logger.js');
        logger.warn({ err: (err as Error).message }, 'slack send failed');
      }
    }
  });
```

### Step 4: Verify

```bash
npx tsc -p . --noEmit
npm test 2>&1 | tail -5
```

Expected: clean, 84 / 84 (no new tests).

### Step 5: Commit

```bash
git add src/notifiers/discord.ts src/notifiers/slack.ts src/index.ts
git commit -m "feat(notifiers): Discord + Slack channels

* discord.ts — POSTs an embed (title + markdown description + color
  per severity) to config.webhookUrl. P1=red, P2=yellow, P3=purple.
* slack.ts — POSTs Slack Block Kit (header + fields + section) via
  formatSlackBlocks helper.
* Registered as channels 'discord' and 'slack' in src/index.ts."
```

---

## Task 4: Subscriptions API + Settings UI — surface `config`

**Files:**
- `src/api/subscriptions.ts` (extend)
- `src/dashboard/public/js/pages/settings.js` (config editor in subscription rows)

### Step 1: Extend the API

Open `src/api/subscriptions.ts`. The existing GET handler doesn't return `config`. Update:

In the SELECT query, add `config`:

```ts
      `SELECT id, channel, min_severity AS minSeverity, chain_filter AS chainFilter,
              rule_filter AS ruleFilter, silence_until AS silenceUntil, enabled, config,
              created_at AS createdAt, updated_at AS updatedAt
         FROM subscriptions ORDER BY id`,
```

In the POST handler, accept `config`:

In the destructure: `const { channel, minSeverity, chainFilter, ruleFilter, silenceUntil, enabled, config } = req.body ?? {};`

In the INSERT, add `config` to the columns list and bound params:

```ts
      `INSERT INTO subscriptions (channel, min_severity, chain_filter, rule_filter,
                                  silence_until, enabled, config, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
```

Pass `typeof config === 'string' ? config : JSON.stringify(config ?? {})` after `enabled === false ? 0 : 1`.

In the PATCH handler camelMap, add `config: 'config'`. The allowed list already permits it via the loop (it checks if `col` is in `allowed`, and we should ensure `config` is in the `allowed` array). Update:

```ts
  const allowed = ['channel', 'min_severity', 'chain_filter', 'rule_filter', 'silence_until', 'enabled', 'config'];
```

For the `config` value coming through PATCH: if it's an object, stringify; if it's a string, use as-is. Inside the for-loop right before `params.push(...)`:

```ts
    let value = v;
    if (col === 'config' && typeof value === 'object' && value !== null) value = JSON.stringify(value);
```

### Step 2: Update Settings UI

Open `src/dashboard/public/js/pages/settings.js`. In `renderSubs`, currently each row shows: channel | minSeverity select | enabled checkbox | delete. Add a "config" editor section:

Find the row template in `renderSubs`. Replace it with a 2-row card per subscription — first row with the existing controls, second row with a JSON config editor (only when the channel is webhook/discord/slack — Telegram channel uses the global SETTINGS, not per-subscription config; dashboard ignores config):

```js
  body.innerHTML = rows.map((s) => {
    const isHttp = ['webhook', 'discord', 'slack'].includes(s.channel);
    return `
    <div style="display:flex; flex-direction:column; gap:var(--sp-2); padding:var(--sp-3); border:1px solid var(--border); border-radius:var(--r-sm);">
      <div style="display:flex; gap:var(--sp-3); align-items:center;">
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
      ${isHttp ? `
        <div style="display:flex; gap:var(--sp-2); align-items:center;">
          <span class="muted" style="min-width:90px; font-size:var(--fs-sm);">Config (JSON):</span>
          <input type="text" data-id="${s.id}" data-key="config" value='${escapeAttr(s.config ?? '{}')}' style="flex:1;" placeholder='{"url":"https://..."} or {"webhookUrl":"https://..."}' />
        </div>
      ` : ''}
    </div>
  `; }).join('');
```

And wire the config input:

```js
  for (const inp of body.querySelectorAll('input[type="text"][data-key="config"]')) {
    inp.addEventListener('change', async () => {
      let parsed;
      try { parsed = JSON.parse(inp.value); } catch {
        toast({ kind: 'error', message: 'Invalid JSON' });
        return;
      }
      await apiPatch(`/api/subscriptions/${inp.dataset.id}`, { config: parsed });
      toast({ kind: 'success', message: 'Config saved' });
    });
  }
```

You'll need `escapeAttr` helper if not already defined at the file scope — add it near the bottom:

```js
function escapeAttr(s) {
  return String(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
```

### Step 3: Verify

```bash
node --check src/dashboard/public/js/pages/settings.js
npx tsc -p . --noEmit
npm test 2>&1 | tail -5
```

Expected: parse OK, typecheck clean, 84 / 84.

### Step 4: Commit

```bash
git add src/api/subscriptions.ts src/dashboard/public/js/pages/settings.js
git commit -m "feat(api): subscriptions.config in CRUD + Settings UI editor

* GET returns config; POST accepts it; PATCH supports updating it.
  String/object coercion handles both raw JSON strings and objects.
* Settings page shows a JSON config input below each webhook/
  discord/slack subscription row. On blur, validates JSON, PATCHes
  the row, toasts success/error. Telegram/dashboard rows don't
  show the config input (they use global settings)."
```

---

## Task 5: Live smoke + final gates + PR

- [ ] **Step 1: Full gates**

```bash
cd ~/projects/chain-watcher
npx tsc -p . --noEmit
npm run lint
npm test
npm run build
```

Expected: clean, **84 / 84**.

- [ ] **Step 2: Smoke**

```bash
cp .env.example .env
redis-server --daemonize yes --port 6379 --dir /tmp 2>/dev/null || true
redis-cli ping
npm run dev > /tmp/m13-smoke.log 2>&1 &
sleep 15
```

Add a webhook subscription pointing at a local echo server (we can use httpbin via curl OR just verify the channel is dispatchable without a real receiver — we'll skip the real receiver since the unit test covers the HTTP semantics).

Verify the subscription columns include config:

```bash
curl -s http://localhost:8787/api/subscriptions | python3 -c "import json,sys;d=json.load(sys.stdin); print('rows:', len(d)); print('config field present:', 'config' in d[0])"
```

Expected: 2 rows (seeded), config field present.

Add a webhook subscription:

```bash
curl -s -X POST http://localhost:8787/api/subscriptions \
  -H 'Content-Type: application/json' \
  -d '{"channel":"webhook","minSeverity":"P2","config":"{\"url\":\"https://httpbin.org/post\"}"}'
curl -s http://localhost:8787/api/subscriptions | python3 -m json.tool | tail -20
```

Expected: a new row with channel=webhook, config containing the URL.

Wait 30s and check `/tmp/m13-smoke.log` for `webhook send failed` lines (acceptable — httpbin is slow, but the dispatch itself ran) OR `setChannelHandler` registrations succeeding.

- [ ] **Step 3: Cleanup + push + PR**

```bash
pkill -f "tsx.*src/index" 2>/dev/null
redis-cli shutdown 2>/dev/null || true
rm -f .env

git push -u origin feat/v2-m13-multi-channel
gh pr create --base main --head feat/v2-m13-multi-channel \
  --title "feat(v2/M13): multi-channel notifiers (webhook + Discord + Slack)" \
  --body "$(cat <<'EOF'
## Summary

Three new notifier channels wired into the M12 router: \`webhook\` (generic JSON POST), \`discord\` (embed), \`slack\` (Block Kit). Each subscription row carries a JSON \`config\` blob (URL + timeout) so multiple subscriptions can target different endpoints on the same channel.

### What changed

- **v1_005 migration** — \`subscriptions.config\` TEXT column (default '{}')
- **\`src/notifiers/format.ts\`** — shared formatters: plain / markdown / slackBlocks
- **\`src/notifiers/webhook.ts\`** — POST JSON, 5s default timeout, throw on non-2xx
- **\`src/notifiers/discord.ts\`** — POST embed with severity color (P1 red / P2 yellow / P3 purple)
- **\`src/notifiers/slack.ts\`** — POST Block Kit
- **\`src/index.ts\`** — registers handlers for all 3 channels at startup; per-channel handler reads each subscription's config and dispatches per-row
- **\`src/api/subscriptions.ts\`** — \`config\` field in GET/POST/PATCH
- **Settings page** — JSON config input under webhook/discord/slack subscriptions

## Test plan

- [x] typecheck / lint / build clean
- [x] \`npm test\` — **84 / 84** (76 prior + 8 new: 4 format + 3 webhook + 1 migration)
- [x] Live smoke: subscriptions row carries config; adding a webhook subscription with a real URL doesn't crash

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Done criteria

- 4 commits + PR
- 84 / 84 pass locally
- All 3 channels register at boot and respect per-subscription config
