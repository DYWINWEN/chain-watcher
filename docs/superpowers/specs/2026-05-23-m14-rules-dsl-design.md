# M14 — Custom Rule DSL Engine Design

**Date**: 2026-05-23
**Predecessor**: v2 design doc §6 (DSL high-level), this doc is the detailed spec
**Successor plan**: `docs/superpowers/plans/2026-05-23-m14-rules-dsl.md`
**Branch**: `feat/v2-m14-rules-dsl`

---

## 1. Context

M14 is the v2 milestone with the highest functional payoff. v1 ships two hardcoded rules in `src/rules/engine.ts` (`sender_repeats_to`, `receiver_repeats_from`). M14 replaces that with a generic DSL engine: rules are persisted in SQLite, hot-reloaded, evaluated against every `NormalizedTx`, with a visual editor in the Dashboard.

Brainstorm decisions (locked):

- **Built-in rules** become DSL **seeds** marked `built_in=1` (immutable in UI; toggleable/silenceable). Engine has one unified evaluation path.
- **Rule edit UI** is **chip-based** in the primary drawer + an **Advanced YAML** textarea for power users.
- **Frequency conditions** use **Redis ZSET** (`ZADD` / `ZCOUNT` / `ZREMRANGEBYSCORE`) — atomic, high-concurrency, persists across restarts. Existing BullMQ Redis is reused.
- **Errors**: zod **strict** at save (POST/PATCH returns 400); engine **lax** at runtime (log warn, never auto-disable on transient).
- **Hot reload**: `bus.emit('rule:changed')` → engine re-queries the `rules` table; cached AST per rule re-compiled on change.
- **Multi-fire**: a single tx may match N rules → N rows in `alerts` (existing schema supports this).
- **Source field**: `RawEvent` + `NormalizedTx` gain optional `source: 'block' | 'mempool'` (defaults to `'block'`). M15 fills the `'mempool'` path.

---

## 2. Goals & Non-Goals

**Goals**
- Replace v1 hardcoded rules with DSL evaluator; v1 rules become DSL seeds.
- Support a fixed set of fields, operators, and 4 compound condition types (frequency, counterparty_label, repeat_to_same, repeat_from_same).
- Persist rules in SQLite; CRUD via REST API; hot reload via bus event.
- Visual chip editor + Advanced YAML toggle.
- Redis ZSET-backed frequency counter with graceful fallback when Redis is down.
- 18+ new tests covering DSL eval, frequency counter, API, migration.

**Non-Goals**
- Turing-complete expressions or arbitrary user code (security boundary).
- DAG / cross-tx state beyond windows + frequency.
- ML / heuristic rules.
- Rule sharing / import-export — defer.
- Per-rule custom channel templates — use the M12 router channels as-is.

---

## 3. DSL specification

### 3.1 YAML shape (what humans write; persisted as JSON in SQLite)

```yaml
id: mixer_outflow_burst         # unique slug, [a-z0-9_-]+
name: "Mixer outflow burst"     # display name
severity: P1                    # 'P1' | 'P2' | 'P3'
enabled: true
when:                           # array of conditions; AND semantics
  - { field: amount_usdt, op: ">", value: 500 }
  - { type: frequency,
      window_minutes: 10,
      min_count: 3,
      group_by: from_addr }
  - { type: counterparty_label,
      side: to,
      labels_any: ["Mixer", "OFAC SDN"] }
then:
  emit_alert: true
version: 1                      # schema version; future migrations
```

### 3.2 Field whitelist (zod enum)

| Field | Source | Type |
|---|---|---|
| `amount_usdt` | NormalizedTx.amountUsdt | number |
| `amount_raw` | NormalizedTx.amountRaw | string (bigint) |
| `chain` | NormalizedTx.chain | 'eth' / 'bsc' / 'btc' |
| `direction` | derived: 'out' if pivot==from, 'in' if pivot==to (only for repeat rules) | enum |
| `from_addr` | NormalizedTx.from | string |
| `to_addr` | NormalizedTx.to | string |
| `token` | NormalizedTx.token | 'USDT' / 'BTC' |
| `block_number` | NormalizedTx.blockNumber | number |
| `timestamp` | NormalizedTx.timestamp | number |
| `from_labels` | derived array of label names | string[] |
| `to_labels` | derived array of label names | string[] |
| `source` | 'block' (default) / 'mempool' (M15) | enum |

### 3.3 Operator whitelist

| Op | Applies to | Semantics |
|---|---|---|
| `>` / `<` / `>=` / `<=` | numbers | strict comparison |
| `==` / `!=` | scalars | strict equality (after coercion) |
| `in` / `not_in` | scalar in array | membership |
| `contains` | array contains scalar; OR substring on string | overloaded |
| `matches` | string regex | bounded — see §6 ReDoS |

### 3.4 Compound condition types

**`type: frequency`** — count events in a sliding window
```yaml
- type: frequency
  window_minutes: 10
  min_count: 3
  group_by: from_addr     # or to_addr
```
Backed by Redis ZSET. Counts events grouped by the specified field within `window_minutes` from current tx's timestamp. True if `count >= min_count`.

**`type: counterparty_label`** — label-based check
```yaml
- type: counterparty_label
  side: to                # or 'from'
  labels_any: [Mixer, OFAC SDN]
```
True if the address on `side` has any label name from `labels_any`. Lookup via existing `getLabels()`.

**`type: repeat_to_same`** / **`type: repeat_from_same`** — covers v1
```yaml
- type: repeat_to_same
  window_size: 5
```
Equivalent to v1's `sender_repeats_to` / `receiver_repeats_from`. Reuses existing `window-store.ts` push-and-check.

### 3.5 AND semantics + then block

`when` is an AND-chain: ALL conditions must be true. There is **no OR / NOT** in v1 of the DSL. Users wanting OR can split into two rules.

`then`:
```yaml
then:
  emit_alert: true        # only field supported in M14
```

(Future expansion: `then.set_severity_override`, `then.notify_channels`, etc. Not in M14 scope.)

---

## 4. Schema

Migration `src/storage/migrations/v1_006_rules.sql`:

```sql
CREATE TABLE IF NOT EXISTS rules (
  id TEXT PRIMARY KEY,                       -- slug [a-z0-9_-]+
  name TEXT NOT NULL,
  severity TEXT NOT NULL,                    -- 'P1' | 'P2' | 'P3'
  enabled INTEGER NOT NULL DEFAULT 1,
  dsl TEXT NOT NULL,                         -- JSON-encoded full rule
  built_in INTEGER NOT NULL DEFAULT 0,
  fire_count INTEGER NOT NULL DEFAULT 0,
  last_fired_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rules_enabled ON rules(enabled);

ALTER TABLE alerts ADD COLUMN rule_id TEXT;  -- FK-by-convention to rules.id (NULL for v1 alerts)
CREATE INDEX IF NOT EXISTS idx_alerts_rule_id ON alerts(rule_id);
```

The existing `alerts.rule TEXT` column stays (still populated with the rule slug). `rule_id` is a more stable reference; UI can JOIN to get `rules.name` / fire_count.

---

## 5. Architecture

```
DSL YAML / JSON  
  ↓ POST /api/rules
zod validate (schema.ts) — STRICT, 400 on invalid
  ↓ insert into rules table
bus.emit('rule:changed')
  ↓
RuleLoader (in-memory cache)
  • on boot: SELECT * FROM rules WHERE enabled=1
  • on event: re-query + recompile AST
CompiledRule[] (precompiled evaluators, AST closures)

NormalizedTx arrives → engine.onNormalizedTx(tx):
  for each rule in CompiledRule[]:
    if rule.evaluate(tx, { freqCounter, labelLookup, windowStore }):
      candidates.push({ ruleId, severity, ... })
  ↑
  evaluator is PURE: pulls deps via closure; no IO inside AST traversal
  
For each candidate:
  recordAlert(tx, rule, candidate.severity)
  routeAlert(alert)  ← M12 router
  bus.emit('alert')
  // also: UPDATE rules SET fire_count = fire_count + 1, last_fired_at = NOW WHERE id = ?
```

### 5.1 Module layout

```
src/rules/
├── engine.ts                ✎ refactored — onNormalizedTx becomes loop over compiled rules
├── dsl/
│   ├── schema.ts            ★ zod schema for rule + when[] + then; type RuleDsl
│   ├── ast.ts               ★ pure evaluator (rule, tx, deps) → boolean
│   ├── compile.ts           ★ RuleDsl → CompiledRule { evaluate(tx, deps) }
│   └── seeds.ts             ★ two built-in seeds (repeat_to_same / repeat_from_same)
├── frequency-counter.ts     ★ Redis ZSET wrapper + in-memory fallback
├── rule-loader.ts           ★ in-memory cache; bus.on('rule:changed')
├── window-store.ts          (unchanged)
├── backfill.ts              (unchanged)
└── blacklist.ts             (unchanged)

src/api/rules.ts             ★ CRUD endpoints
src/storage/migrations/
└── v1_006_rules.sql         ★

src/dashboard/public/js/pages/
└── rules.js                 ✎ rewrite as the editing page (currently empty/stub)

src/dashboard/public/js/ui/
└── rule-drawer.js           ★ chip-based editor drawer

test/
├── rules-dsl.test.ts        ★ 10 fixture-driven evaluator cases
├── rules-api.test.ts        ★ 4 CRUD cases
├── frequency-counter.test.ts ★ 3 cases (uses a real Redis on 6379 in tests; if absent, skip)
└── migrations.test.ts       ✎ +1 case
```

### 5.2 RuleLoader contract

```ts
export type CompiledRule = {
  id: string;
  name: string;
  severity: 'P1' | 'P2' | 'P3';
  enabled: boolean;
  builtIn: boolean;
  evaluate: (tx: NormalizedTx, deps: EvalDeps) => Promise<boolean>;
};

export type EvalDeps = {
  freq: FrequencyCounter;
  getLabels: (chain: Chain, addr: string) => Label[];
  windowStore: { pushAndCheck: typeof pushAndCheck };
};

export function getRules(): CompiledRule[];                  // all enabled, sorted
export function reloadRules(): Promise<void>;                // called by bus listener
```

### 5.3 Frequency-counter contract

```ts
export type FrequencyCounter = {
  add(chain: Chain, group: string, ts: number, txHash: string): Promise<void>;
  count(chain: Chain, group: string, windowSeconds: number): Promise<number>;
  prune(chain: Chain, group: string, olderThanSeconds: number): Promise<void>;
};

export function createRedisFrequencyCounter(redis: IORedis): FrequencyCounter;
export function createInMemoryFrequencyCounter(): FrequencyCounter; // fallback
```

Both have identical behavior. Engine picks Redis at boot; falls back to in-memory if Redis ping fails — logs warn, sets a `settings_audit` row.

---

## 6. Security / safety

### 6.1 Regex `matches` ReDoS

Native `RegExp` is vulnerable to catastrophic backtracking. Mitigations:
- **Compile-time check**: zod refine — reject patterns with `.*.*` or `(.+)+` heuristics (low recall, but easy gate)
- **Run-time guard**: wrap `regex.test(input)` in `Promise.race([test(), timeout(50ms)])`; on timeout, return false + log warn + record in `settings_audit`. 50ms gives a generous budget for honest regexes against short addresses/labels (typical inputs < 100 chars).

### 6.2 DSL evaluation is pure

The AST evaluator has no `eval`, no `Function` constructor, no dynamic import. Only explicit operators on whitelisted fields. zod refuses unknown fields.

### 6.3 Built-in rule integrity

`built_in=1` rules CANNOT be deleted via API (returns 403). They CAN be toggled (`enabled=0`) and silenced. They MAY be edited in dsl text — but the seed-replay logic on next boot will rewrite them to the canonical form, so user edits to built-ins are forgotten unless `built_in` is cleared (we don't offer that flow).

---

## 7. API

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/rules` | — | `Rule[]` (full DSL) |
| GET | `/api/rules/:id` | — | `Rule` |
| POST | `/api/rules` | `{ id, name, severity, enabled, dsl, then? }` | `{ ok: true }` (zod strict; 400 on invalid) |
| PATCH | `/api/rules/:id` | partial fields | `{ ok: true }` (zod strict; 400) |
| DELETE | `/api/rules/:id` | — | `{ ok: true }` (403 if `built_in=1`) |

All mutations `bus.emit(EVENTS.RuleChanged, { id })` → rule-loader re-fetches.

---

## 8. UI (Rules page — currently a stub from M11.1)

### 8.1 List view

Per the Pencil mockup `design/page-rules.png`. Each rule = card with:
- Toggle (enabled/disabled) — sliding switch
- Name (left) + severity tag (P1/P2/P3, colored)
- DSL preview as plain English: "WHEN amount > 500 AND 3+ outbound tx within 10 min AND recipient label Mixer or OFAC. THEN raise P1 alert."
- Condition chips inline below: `[amount > $500]` `[3+ / 10min]` `[label: Mixer | OFAC]` `[+ add condition]` — last chip is a dashed-border "add" button
- Footer: notify channels (resolved from subscriptions matching the severity), `Fired 12× in 24h`, `Edit conditions →` link
- Built-in rules show a small "BUILT-IN" tag and hide the delete option

### 8.2 Edit drawer

Right-slide drawer (reuses M11.1 `drawer.js`) with:
- **Header**: rule name + severity + enabled toggle + Save/Cancel
- **Conditions** section: chips + `+ Add condition` button
- Clicking a chip opens an inline form:
  - Field dropdown (only fields valid for the current condition type)
  - Operator dropdown
  - Value input — type adapts to field (number / string / array tag input)
- For compound types (frequency, counterparty_label), specialized forms
- **Output** section: `emit_alert` checkbox
- **Advanced** (collapsible): raw YAML textarea. Editing here parses with zod on save and updates the chip view; chip edits update the YAML.

### 8.3 New rule

Clicking `+ New rule` (top right) opens an empty drawer pre-populated with `{ name: 'New rule', severity: 'P3', enabled: false, when: [], then: { emit_alert: true } }`. User fills in chips, saves.

---

## 9. Testing strategy

| File | Cases | Covers |
|---|---|---|
| `test/rules-dsl.test.ts` | 10 | scalar ops, in/not_in, contains, matches w/ timeout, AND-chain, counterparty_label, frequency mock, repeat_to_same with seeded window, malformed rule rejected by zod, version field carried through |
| `test/rules-api.test.ts` | 4 | GET / POST / PATCH / DELETE (incl 403 on built-in delete) |
| `test/frequency-counter.test.ts` | 3 | add+count returns 1; window expiry; group_by isolation |
| `test/migrations.test.ts` | +1 | v1_006 applied + rules table + alerts.rule_id |

Total **18 new** (vs 17 in spec §2 — close enough). Final: **84 → 102**.

frequency-counter tests use a real Redis instance on `127.0.0.1:6379`. If unavailable (CI / first-time setup), the test SKIPs via `it.skipIf(process.env.SKIP_REDIS === '1')` — documented in the test file. The in-memory fallback path has its own unit test (separate from these 3).

---

## 10. Risk + mitigation

- **DSL evolves and breaks old rules**: `version: 1` field in DSL JSON. Future v2 migrations transform stored rules. Built-in seeds are always re-written at boot.
- **Redis frequency unavailable**: fallback to in-memory counter; warn in `settings_audit`. Single-process state is fine for low-volume operators.
- **AST evaluator perf**: each rule eval is O(conditions). 10 rules × 5 conditions = 50 ops per tx — trivial.
- **Chip UI complexity**: chip editor is the longest UI work in M14 (~0.8d). YAML mode is always available as escape hatch; ship chip editor for top 3 condition types (scalar, frequency, counterparty_label) and let Advanced YAML cover the rest.

---

## 11. Sequencing (for the impl plan)

1. Migration (rules + alerts.rule_id) + seed-cleanup of v1 hardcoded rules (T1, 0.3d)
2. DSL schema + AST evaluator + 10 fixture tests (T2, 0.7d)
3. Frequency-counter (Redis + in-memory) + 3 tests (T3, 0.3d)
4. RuleLoader + engine refactor (T4, 0.5d)
5. REST API + 4 tests (T5, 0.2d)
6. Rules page UI + chip drawer (T6, 0.8d)
7. Smoke + PR (T7, 0.2d)

≈ 3 days. 7 commits.

---

## 12. Done criteria

- All 18 new tests pass; total ≥ 102
- v1's two rules continue to fire identically (now as DSL seeds)
- Adding a custom rule via UI / API takes effect within 100ms (bus event hot reload)
- Rules page chip editor handles the 4 compound types; Advanced YAML toggle works
- Frequency conditions use Redis ZSET; in-memory fallback verified by stopping Redis mid-test
- `alerts.rule_id` populated correctly for new alerts (NULL for old)
