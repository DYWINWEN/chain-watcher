# M8 — Bugfix Sweep Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surgically fix 3 real bugs found in v1 + migrate eslint config from legacy `.eslintrc.cjs` to v9 flat config, and add regression tests so the bugs can't silently come back.

**Architecture:** Stay 100% inside v1 architecture — no new modules, no new dependencies. Each fix is local to one file with a paired regression test in `test/`.

**Tech Stack:** TypeScript + vitest + better-sqlite3 + ethers v6 + zod (all existing).

---

## Prerequisites

- PR #1 (`feat/chain-watcher-impl`) is already pushed to GitHub. Either:
  - **(Preferred)** merge PR #1 to `main` first, then branch this M8 off `main`
  - **(Alternative)** branch this M8 off `feat/chain-watcher-impl` and ship as additional commits on the same PR
- Local clone exists at `~/projects/chain-watcher` with `origin` pointing at `https://github.com/DYWINWEN/chain-watcher.git`
- `node >= 20`, `npm` available

---

## Scope: What's IN, what's OUT

**IN (this plan)**

| # | Bug | File | Fix sketch |
|---|---|---|---|
| A | EVM ingestor advances checkpoint past blocks that haven't been processed yet (race between catch-up `saveCheckpoint(latest)` and `provider.on(filter)` attachment) | `src/ingestors/evm.ts` | Remove the post-replay `saveCheckpoint(latest)`. Let `handleLog` advance it organically. |
| B | `backfillEvm` passes `address` to `ethers.zeroPadValue` without format validation; a malformed input throws inside an async limit-wrapped task and only surfaces as a logger.warn | `src/rules/backfill.ts` | Add early `ethers.isAddress(address)` guard, return `[]` with a warn log if invalid. |
| C | `window_size = 1` is accepted by zod (`min(1)`) but never produces a hit because engine requires `windowSize >= 2`. Existing test `'never hits with window_size=1'` codifies the dead behavior. | `src/config.ts` + `test/window-store.test.ts` | Tighten zod to `min(2)`. Replace the dead-behavior test with one that asserts zod rejects `1`. |
| D | `npm run lint` fails with "ESLint couldn't find an eslint.config.(js\|mjs\|cjs) file" — eslint v9 dropped legacy `.eslintrc.cjs` | `eslint.config.js` (new) + delete `.eslintrc.cjs` | Author a minimal flat config preserving the two existing rule overrides. |

**OUT (deferred / wontfix with rationale)**

- **"Bug #1" from v2 spec — engine.ts:98 blacklist side**: After re-reading PLAN.md "避免交易所提币被误报" (avoid false-positive flagging of CEX deposits/withdrawals), the current behavior is correct. For `receiver_repeats_from`, the counterparty is the sender; if the sender is a CEX hot wallet, the pattern is "user repeatedly withdrawing from CEX" — a benign pattern that should be suppressed. The Explore agent's interpretation was a plausible alternative but doesn't match the documented intent. We will add a regression test (Task 5) that pins this semantics so future refactors don't accidentally invert it.
- BTC satoshi-to-number precision (`decoder/btc.ts:6`): theoretical only, real values < 2^53/1e8 = 90M BTC; deferred to M16 multi-chain pass.

---

## Files

**Modify**
- `src/ingestors/evm.ts` — remove post-replay `saveCheckpoint` call
- `src/rules/backfill.ts` — add address validation guard
- `src/config.ts` — tighten zod window_size schema
- `package.json` — remove now-unused `.eslintrc.cjs` deps if any (none currently)

**Create**
- `eslint.config.js` — flat config replacing `.eslintrc.cjs`
- `test/backfill.test.ts` — new (no backfill test exists)
- `test/evm-ingestor.test.ts` — new (no ingestor test exists)
- `test/config.test.ts` — new (no config test exists)
- regression case in `test/engine.test.ts` (modify)
- regression case in `test/window-store.test.ts` (modify)

**Delete**
- `.eslintrc.cjs`

---

## Task 1: Setup branch & verify baseline

**Files:** (none modified yet, sanity check only)

- [ ] **Step 1: Confirm working tree state and remote**

```bash
cd ~/projects/chain-watcher
git fetch --all --prune
git status
git branch -a
```

Expected: working tree clean. Branches include `main`, `feat/chain-watcher-impl`, `docs/v2-design`, plus `remotes/origin/...` equivalents.

- [ ] **Step 2: Choose base branch**

If PR #1 has been merged to `main`:

```bash
git checkout main
git pull origin main
git checkout -b feat/v2-m8-bugfix-sweep
```

Otherwise, branch off the feat branch:

```bash
git checkout feat/chain-watcher-impl
git pull origin feat/chain-watcher-impl
git checkout -b feat/v2-m8-bugfix-sweep
```

Expected: `git status` reports `On branch feat/v2-m8-bugfix-sweep` with no changes.

- [ ] **Step 3: Install deps & baseline check**

```bash
npm ci --no-audit --no-fund
npx tsc -p . --noEmit
npm test
```

Expected: install succeeds, typecheck clean, **15 / 15 tests pass**. If anything else, STOP and report — the base branch is broken before M8 even starts.

- [ ] **Step 4: Verify the existing lint failure (Bug D baseline)**

```bash
npm run lint 2>&1 | head -5
```

Expected output contains: `ESLint couldn't find an eslint.config.(js|mjs|cjs) file.`

---

## Task 2: Bug A — EVM ingestor checkpoint race

**Files:**
- Test: `test/evm-ingestor.test.ts` (create)
- Modify: `src/ingestors/evm.ts:86-95`

**Context:** At connection time, `connect()` does a catch-up replay between `getCheckpoint()` and `latest`, then calls `this.saveCheckpoint(latest)`, THEN attaches the live filter. If a new block arrives in the window between the `saveCheckpoint(latest)` line and the `provider.on(filter, ...)` line, that block's Transfer logs are never processed, but checkpoint has already advanced past it. On next reconnect, those logs are gone. Fix is to drop the post-replay `saveCheckpoint(latest)` — `handleLog` already calls `this.saveCheckpoint(log.blockNumber)` per processed log, so the checkpoint advances organically. Edge case (no logs arrive for a long time) is bounded by the `Math.max(fromCheckpoint + 1, latest - 5_000)` cap in `replayRange`.

- [ ] **Step 1: Read the file to confirm line numbers**

Open `src/ingestors/evm.ts`. Confirm lines 86-95 read:

```ts
    // Catch-up gap since last checkpoint.
    try {
      const fromCheckpoint = this.getCheckpoint();
      const latest = await this.provider.getBlockNumber();
      if (fromCheckpoint > 0 && latest > fromCheckpoint) {
        const start = Math.max(fromCheckpoint + 1, latest - 5_000); // cap replay window
        await this.replayRange(start, latest);
      }
      this.saveCheckpoint(latest);
    } catch (err) {
      throw wsErrored ?? err;
    }
```

If different, locate the equivalent block and adjust step 3 accordingly.

- [ ] **Step 2: Write the failing test**

Create `test/evm-ingestor.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// We won't exercise the actual ws connection — we test the
// invariant that `connect()` does NOT advance the checkpoint
// for blocks whose logs haven't been processed.

let getDb: typeof import('../src/storage/db.js').getDb;

beforeEach(async () => {
  vi.resetModules();
  process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'cw-evm-')), 'cw.db');
  ({ getDb } = await import('../src/storage/db.js'));
});

describe('EVM ingestor checkpoint discipline', () => {
  it('the connect() code path does not call saveCheckpoint(latest) after replay', async () => {
    // Read the source as text and assert the regression pattern is absent.
    // This is a structural test — pinning intent in a way that survives
    // future refactors that might re-introduce the race.
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('src/ingestors/evm.ts', 'utf8');

    // Find the catch-up block. It should NOT contain a bare
    // `this.saveCheckpoint(latest)` line — only `handleLog` (called
    // from replayRange or the live filter) is allowed to advance it.
    const catchupStart = src.indexOf('// Catch-up gap since last checkpoint.');
    const catchupEnd = src.indexOf('const filter =', catchupStart);
    expect(catchupStart).toBeGreaterThan(-1);
    expect(catchupEnd).toBeGreaterThan(catchupStart);
    const catchupBlock = src.slice(catchupStart, catchupEnd);
    expect(catchupBlock).not.toMatch(/this\.saveCheckpoint\(latest\)/);
  });
});
```

- [ ] **Step 3: Run test, expect FAIL**

```bash
npx vitest run test/evm-ingestor.test.ts
```

Expected: 1 test fails with the matcher `expect(catchupBlock).not.toMatch(/this\.saveCheckpoint\(latest\)/)` because the source currently does contain that call.

- [ ] **Step 4: Apply the fix — remove the racy checkpoint write**

Edit `src/ingestors/evm.ts`, find:

```ts
      if (fromCheckpoint > 0 && latest > fromCheckpoint) {
        const start = Math.max(fromCheckpoint + 1, latest - 5_000); // cap replay window
        await this.replayRange(start, latest);
      }
      this.saveCheckpoint(latest);
```

Replace with:

```ts
      if (fromCheckpoint > 0 && latest > fromCheckpoint) {
        const start = Math.max(fromCheckpoint + 1, latest - 5_000); // cap replay window
        await this.replayRange(start, latest);
      }
      // NOTE: do NOT saveCheckpoint(latest) here — there is a window between
      // this line and the `provider.on(filter, ...)` attachment below in which
      // new blocks could arrive and be dropped. handleLog() advances the
      // checkpoint per processed log, which is the correct authoritative source.
```

- [ ] **Step 5: Run test, expect PASS**

```bash
npx vitest run test/evm-ingestor.test.ts
```

Expected: 1 / 1 pass.

- [ ] **Step 6: Run full test suite, expect no regression**

```bash
npm test
```

Expected: **16 / 16 pass** (15 existing + 1 new).

- [ ] **Step 7: Commit**

```bash
git add src/ingestors/evm.ts test/evm-ingestor.test.ts
git commit -m "fix(ingestors/evm): drop racy post-replay checkpoint write

handleLog advances the checkpoint per processed log; the explicit
saveCheckpoint(latest) before filter attachment opened a window where
freshly produced blocks could be silently skipped on the next reconnect."
```

---

## Task 3: Bug B — backfill address validation

**Files:**
- Test: `test/backfill.test.ts` (create)
- Modify: `src/rules/backfill.ts:80` (the `ethers.zeroPadValue` call)

**Context:** `backfillEvm` builds an `eth_getLogs` topic filter using `ethers.zeroPadValue(address, 32)`. If `address` is not a 0x-prefixed 20-byte hex (e.g., a stray BTC address that slipped past chain dispatch, or an upper-cased non-checksum string), `zeroPadValue` will throw. The exception is caught by the outer p-limit wrapper and only surfaces as `logger.warn({ k }, 'backfill failed')` — a silent partial failure for that address. The fix is an early guard.

- [ ] **Step 1: Read the file to confirm**

Open `src/rules/backfill.ts`. Confirm the `backfillEvm` function (around line 60-110) contains:

```ts
    const padded = ethers.zeroPadValue(address, 32);
```

- [ ] **Step 2: Write the failing test**

Create `test/backfill.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let scheduleBackfill: typeof import('../src/rules/backfill.js').scheduleBackfill;
let getDb: typeof import('../src/storage/db.js').getDb;
let setSetting: typeof import('../src/config.js').setSetting;
let SETTINGS: typeof import('../src/config.js').SETTINGS;

beforeEach(async () => {
  vi.resetModules();
  process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'cw-backfill-')), 'cw.db');
  ({ getDb } = await import('../src/storage/db.js'));
  ({ setSetting, SETTINGS } = await import('../src/config.js'));
  ({ scheduleBackfill } = await import('../src/rules/backfill.js'));
  setSetting(SETTINGS.chain_eth_ws_url, 'wss://example.invalid', 'test');
  setSetting(SETTINGS.chain_eth_usdt, '0xdAC17F958D2ee523a2206206994597C13D831ec7', 'test');
  setSetting(SETTINGS.backfill_concurrency, 1, 'test');
  setSetting(SETTINGS.backfill_history_window, 5, 'test');
});

describe('scheduleBackfill', () => {
  it('does not crash on a malformed (non-EVM) address — returns gracefully', async () => {
    // BTC-style address inadvertently dispatched to EVM backfill (regression
    // for a real-world misroute path)
    expect(() => scheduleBackfill('eth', 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh', 'out')).not.toThrow();
    // Give the limit-wrapped task a tick to fire.
    await new Promise((r) => setTimeout(r, 50));
    // Even though the address is invalid, we should NOT have touched the
    // windows table for this address (no backfilled=1 marker).
    const row = getDb()
      .prepare(`SELECT 1 FROM windows WHERE chain = ? AND address = ?`)
      .get('eth', 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh');
    expect(row).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run test, expect FAIL**

```bash
npx vitest run test/backfill.test.ts
```

Expected: the test errors (uncaught) because `ethers.zeroPadValue` throws on non-hex input inside the p-limit wrapper. Even though the outer `.catch` logs, the test environment may surface an unhandled rejection. Either way, the test fails.

- [ ] **Step 4: Apply the fix — guard in backfillEvm**

Edit `src/rules/backfill.ts`, find the `backfillEvm` function. Locate:

```ts
    const latest = await provider.getBlockNumber();
    const lookback = 60_000; // ~ a week on ETH; bounded so eth_getLogs doesn't blow up.
    const fromBlock = Math.max(0, latest - lookback);
    const padded = ethers.zeroPadValue(address, 32);
```

Replace with:

```ts
    if (!ethers.isAddress(address)) {
      logger.warn({ chain, address }, 'backfill: skipping non-EVM address');
      return [];
    }
    const latest = await provider.getBlockNumber();
    const lookback = 60_000; // ~ a week on ETH; bounded so eth_getLogs doesn't blow up.
    const fromBlock = Math.max(0, latest - lookback);
    const padded = ethers.zeroPadValue(address, 32);
```

(Note: `logger` is already imported at the top of `backfill.ts`. `chain` is a parameter of `backfillEvm`. `ethers` is already imported.)

- [ ] **Step 5: Run test, expect PASS**

```bash
npx vitest run test/backfill.test.ts
```

Expected: 1 / 1 pass.

- [ ] **Step 6: Run full test suite**

```bash
npm test
```

Expected: **17 / 17 pass**.

- [ ] **Step 7: Commit**

```bash
git add src/rules/backfill.ts test/backfill.test.ts
git commit -m "fix(rules/backfill): guard EVM backfill against malformed addresses

zeroPadValue throws on non-hex input; the exception was previously
swallowed by the p-limit catch wrapper, masking partial failures.
Now we ethers.isAddress() upfront and return empty cleanly."
```

---

## Task 4: Bug C — enforce window_size >= 2 in config

**Files:**
- Test: `test/config.test.ts` (create)
- Modify: `src/config.ts` (RootConfigSchema window_size min)
- Modify: `test/window-store.test.ts` (replace the now-misleading test)

**Context:** `RootConfigSchema` allows `window_size: z.number().int().min(1).max(20)`, but `window-store.ts:88` only hits with `windowSize >= 2`. A user setting `window_size: 1` via UI or YAML gets a silent dead config (rule never fires). The existing test `'never hits with window_size=1'` codifies this dead behavior. Fix: tighten zod min to `2`, replace the test to assert "config rejects window_size=1".

- [ ] **Step 1: Write the failing config test**

Create `test/config.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { RootConfigSchema } from '../src/config.js';

function baseValidConfig() {
  return {
    threshold_usdt: 100,
    rules: {
      sender_repeats_to: { enabled: true, window_size: 5 },
      receiver_repeats_from: { enabled: true, window_size: 5 },
    },
    blacklist_cex: true,
    chains: {
      eth: { enabled: true, ws_url: 'wss://x', usdt_contract: '0xx', decimals: 6 },
      bsc: { enabled: true, ws_url: 'wss://x', usdt_contract: '0xx', decimals: 18 },
      btc: { enabled: true, ws_url: 'wss://x', api_base: 'https://x' },
    },
    price_oracle: { ttl_seconds: 60, symbols: {} },
    notifiers: {
      dashboard: { enabled: true, port: 8787 },
      telegram: { enabled: false },
    },
    backfill: { enabled: true, concurrency: 2, history_window: 5 },
    workers: { decoder_concurrency: 2, rule_concurrency: 4 },
  };
}

describe('RootConfigSchema', () => {
  it('accepts a baseline valid config', () => {
    const result = RootConfigSchema.safeParse(baseValidConfig());
    expect(result.success).toBe(true);
  });

  it('rejects window_size = 1 — engine cannot hit with a window of 1', () => {
    const cfg = baseValidConfig();
    cfg.rules.sender_repeats_to.window_size = 1;
    const result = RootConfigSchema.safeParse(cfg);
    expect(result.success).toBe(false);
  });

  it('accepts window_size = 2 (minimum meaningful)', () => {
    const cfg = baseValidConfig();
    cfg.rules.sender_repeats_to.window_size = 2;
    cfg.rules.receiver_repeats_from.window_size = 2;
    const result = RootConfigSchema.safeParse(cfg);
    expect(result.success).toBe(true);
  });

  it('rejects window_size = 21 (above max)', () => {
    const cfg = baseValidConfig();
    cfg.rules.sender_repeats_to.window_size = 21;
    const result = RootConfigSchema.safeParse(cfg);
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test, expect "rejects window_size = 1" to FAIL**

```bash
npx vitest run test/config.test.ts
```

Expected: 3 of 4 pass; `'rejects window_size = 1'` fails because zod currently allows `1`.

- [ ] **Step 3: Apply the fix — tighten zod schema**

Edit `src/config.ts`. Find:

```ts
  rules: z.object({
    sender_repeats_to: z.object({ enabled: z.boolean(), window_size: z.number().int().min(1).max(20) }),
    receiver_repeats_from: z.object({ enabled: z.boolean(), window_size: z.number().int().min(1).max(20) }),
  }),
```

Replace with:

```ts
  rules: z.object({
    sender_repeats_to: z.object({ enabled: z.boolean(), window_size: z.number().int().min(2).max(20) }),
    receiver_repeats_from: z.object({ enabled: z.boolean(), window_size: z.number().int().min(2).max(20) }),
  }),
```

(min: 1 → 2 on both lines.)

- [ ] **Step 4: Run config test, expect ALL PASS**

```bash
npx vitest run test/config.test.ts
```

Expected: 4 / 4 pass.

- [ ] **Step 5: Update the misleading window-store test**

Edit `test/window-store.test.ts`. Find:

```ts
  it('never hits with window_size=1', () => {
    const r = pushAndCheck('eth', '0xc', 'out', '0xany', 't0', 1);
    expect(r.hit).toBe(false);
  });
```

Replace with:

```ts
  // Config validation rejects window_size=1 at the schema layer (see test/config.test.ts).
  // window-store itself remains defensive in case an internal caller bypasses config.
  it('window_size=1 is defensively rejected by window-store (no hit, no crash)', () => {
    const r = pushAndCheck('eth', '0xc', 'out', '0xany', 't0', 1);
    expect(r.hit).toBe(false);
  });
```

(No code change needed in `window-store.ts` — the existing `windowSize >= 2` guard already produces the right behavior. We're just clarifying the test comment.)

- [ ] **Step 6: Run full test suite**

```bash
npm test
```

Expected: **21 / 21 pass** (15 existing + 1 evm + 1 backfill + 4 config = 21). The renamed window-store test still counts.

- [ ] **Step 7: Commit**

```bash
git add src/config.ts test/config.test.ts test/window-store.test.ts
git commit -m "fix(config): require window_size >= 2 in zod schema

window_size = 1 was accepted by config but produced a dead rule
(window-store requires >= 2 entries to compare). Tighten the schema
to reject 1 at the boundary; rename the now-defensive window-store
test to reflect that the schema is the primary gate."
```

---

## Task 5: Pin engine blacklist semantics (regression test only — no code change)

**Files:**
- Modify: `test/engine.test.ts` (add 1 test)

**Context:** The v2 spec listed engine.ts:98 blacklist-side as a "high severity bug" (Explore agent finding). Re-reading PLAN.md "黑名单：内置 CEX 热钱包名单（避免交易所提币被误报）" reveals the current behavior matches the documented intent: when the counterparty (sender for receiver-rule, receiver for sender-rule) is a known CEX, the pattern is a normal CEX deposit/withdrawal and should be suppressed. This task adds a test that pins the receiver-side behavior so a future refactor can't quietly invert it.

- [ ] **Step 1: Add the regression test**

Edit `test/engine.test.ts`. Append inside the `describe('engine', ...)` block:

```ts
  it('receiver_repeats_from: suppresses when the repeated SENDER is CEX-blacklisted', async () => {
    // Scenario: a user address receives 5 inbound USDT txs all from a CEX
    // hot wallet — this is a normal CEX-withdrawal pattern, not an aggregation
    // attack. PLAN.md "避免交易所提币被误报" calls for suppression.
    const cex = '0xcexsender';
    getDb()
      .prepare(
        `INSERT INTO address_lists (list_type, chain, address, label, created_at) VALUES ('cex_blacklist', 'eth', ?, 'test', ?)`,
      )
      .run(cex, Math.floor(Date.now() / 1000));
    for (let i = 0; i < 5; i++) await onNormalizedTx(tx(i, cex, '0xuser', 200));
    const alerts = getDb()
      .prepare(`SELECT * FROM alerts WHERE rule = 'receiver_repeats_from'`)
      .all() as any[];
    expect(alerts.length).toBe(0); // pattern is CEX-withdrawal, should be suppressed
  });
```

- [ ] **Step 2: Run engine tests, expect ALL PASS (no code change needed)**

```bash
npx vitest run test/engine.test.ts
```

Expected: 6 / 6 pass (5 existing + 1 new). If the new test FAILS, the receiver-side blacklist behavior is broken — STOP and investigate. (Per source inspection it shouldn't fail.)

- [ ] **Step 3: Run full test suite**

```bash
npm test
```

Expected: **22 / 22 pass**.

- [ ] **Step 4: Commit**

```bash
git add test/engine.test.ts
git commit -m "test(rules/engine): pin receiver_repeats_from blacklist semantics

Pins the documented intent (PLAN.md '避免交易所提币被误报') that when
the repeated counterparty in receiver_repeats_from is a known CEX
hot wallet, the alert is suppressed. Prevents accidental inversion
in future refactors."
```

---

## Task 6: Bug D — eslint v9 flat config migration

**Files:**
- Create: `eslint.config.js`
- Delete: `.eslintrc.cjs`

**Context:** eslint v9.0 dropped support for `.eslintrc.*` legacy configs. The committed `.eslintrc.cjs` causes `npm run lint` to abort before reading any file. We migrate to flat config preserving the same two rule overrides (`no-unused-vars` ignores `_`-prefix, `no-explicit-any` off).

- [ ] **Step 1: Create the new flat config**

Create `eslint.config.js`:

```js
// eslint v9 flat config — replaces the legacy .eslintrc.cjs.
// Preserves the original two overrides: argsIgnorePattern '^_' and no-explicit-any off.

import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';

export default [
  {
    ignores: ['dist/**', 'node_modules/**', 'src/dashboard/public/**'],
  },
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tsparser,
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        setImmediate: 'readonly',
        clearImmediate: 'readonly',
        global: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
];
```

- [ ] **Step 2: Delete the legacy config**

```bash
rm .eslintrc.cjs
```

- [ ] **Step 3: Run lint**

```bash
npm run lint 2>&1 | tail -30
```

Expected: command succeeds with exit code 0. May print some warnings about unused vars in `src/` — that's eslint actually running. As long as it doesn't error-exit on the config itself, this fix is good.

- [ ] **Step 4: If lint surfaces NEW errors that weren't there before, decide per-error**

Most likely outcome: a small number of unused-var warnings in `src/`. Per the rule `'warn'` not `'error'`, the command should still exit 0. If somehow there are TypeScript-parsing errors, examine the file — it's likely a config issue in this step, not a code bug.

If lint exits non-zero with config errors, debug `eslint.config.js` before proceeding.

- [ ] **Step 5: Verify full test suite still passes (sanity)**

```bash
npm test
```

Expected: **22 / 22 pass** (no behavior change).

- [ ] **Step 6: Commit**

```bash
git add eslint.config.js
git rm .eslintrc.cjs
git commit -m "chore(lint): migrate to eslint v9 flat config

.eslintrc.cjs is unsupported by eslint v9; npm run lint aborted with
'ESLint couldn't find an eslint.config.(js|mjs|cjs) file.' Replace
with an equivalent flat config preserving the existing two rule
overrides."
```

---

## Task 7: Final verification & PR

**Files:** (none modified)

- [ ] **Step 1: Verify branch is clean and ahead of base**

```bash
git status
git log --oneline -10
```

Expected: clean working tree, 5 new commits on `feat/v2-m8-bugfix-sweep` (one per Task 2-6).

- [ ] **Step 2: Run all gates one last time**

```bash
npx tsc -p . --noEmit
npm run lint
npm test
npm run build
```

Expected:
- typecheck: clean
- lint: exit 0 (warnings allowed, errors not)
- test: **22 / 22 pass**
- build: `dist/` produced with no errors

- [ ] **Step 3: Push the branch**

```bash
git push -u origin feat/v2-m8-bugfix-sweep
```

Expected: branch pushed, GitHub returns a "Create PR" URL.

- [ ] **Step 4: Open the PR**

```bash
gh pr create --base main --head feat/v2-m8-bugfix-sweep --title "feat(v2/M8): bugfix sweep + eslint v9 flat config + 7 regression tests" --body "$(cat <<'EOF'
## Summary

M8 from the v2 design doc — surgical fixes for 3 real v1 bugs + eslint
v9 flat-config migration + regression tests that pin both fixed and
already-correct semantics.

### Fixes
- **fix(ingestors/evm)**: drop racy post-replay `saveCheckpoint(latest)` —
  blocks arriving between checkpoint write and filter attachment used to
  be silently dropped on reconnect.
- **fix(rules/backfill)**: guard `backfillEvm` against malformed addresses
  with `ethers.isAddress()` — non-EVM input no longer throws inside the
  p-limit wrapper.
- **fix(config)**: tighten `window_size` zod schema to `min(2)` —
  `window_size = 1` was accepted but produced a dead rule.

### Migration
- **chore(lint)**: migrate `.eslintrc.cjs` → `eslint.config.js` flat
  config for eslint v9 compatibility. `npm run lint` works again.

### Tests
- 7 new test cases (`test/evm-ingestor.test.ts`, `test/backfill.test.ts`,
  `test/config.test.ts`, plus regression cases in `test/engine.test.ts`
  and `test/window-store.test.ts`). Total: **15 → 22 passing**.

### Wontfix with rationale
- v2 spec listed `engine.ts:98` blacklist side as a high-severity bug
  (Explore agent finding). Re-read of PLAN.md "避免交易所提币被误报"
  shows current behavior is correct (CEX-counterparty pattern is a
  normal deposit/withdrawal flow and should be suppressed). Task 5
  adds a regression test that pins this semantics instead of "fixing"
  it.

## Test plan

- [x] `npx tsc -p . --noEmit` clean
- [x] `npm run lint` exit 0 (eslint v9 works)
- [x] `npm test` — 22 / 22 pass
- [x] `npm run build` produces dist/ with static assets

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: gh prints a PR URL. Capture it as the deliverable.

- [ ] **Step 5: Confirm PR is open and CI (if any) is green**

```bash
gh pr view --json url,state,statusCheckRollup
```

Expected: state OPEN, CI not yet configured = empty `statusCheckRollup`. Report URL to the user.

---

## Done criteria

- All 7 tasks above complete and committed
- 22 / 22 tests passing locally
- PR opened against `main` (or `feat/chain-watcher-impl` if that's still the live base)
- No new dependencies added
- No behavioral changes beyond the four named fixes
