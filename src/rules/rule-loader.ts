import { getDb } from '../storage/db.js';
import { logger } from '../utils/logger.js';
import { bus, EVENTS } from '../utils/event-bus.js';
import { BUILT_IN_RULES } from './dsl/seeds.js';
import { parseRuleDsl } from './dsl/schema.js';
import { compileRule, type CompiledRule } from './dsl/compile.js';

let cache: CompiledRule[] = [];

export function getCompiledRules(): CompiledRule[] {
  return cache;
}

type Row = {
  id: string;
  name: string;
  severity: string;
  enabled: number;
  dsl: string;
  built_in: number;
};

export async function reloadRules(): Promise<void> {
  const rows = getDb()
    .prepare(`SELECT id, name, severity, enabled, dsl, built_in FROM rules WHERE enabled = 1 ORDER BY id`)
    .all() as Row[];
  const next: CompiledRule[] = [];
  for (const r of rows) {
    try {
      const parsed = parseRuleDsl(JSON.parse(r.dsl));
      next.push(compileRule(parsed, { builtIn: r.built_in === 1 }));
    } catch (err) {
      logger.warn({ err: (err as Error).message, id: r.id }, 'rule-loader: skipping rule with invalid dsl');
    }
  }
  cache = next;
  logger.debug({ count: next.length }, 'rules reloaded');
}

/** Seed built-in rules if not present. Idempotent (INSERT OR IGNORE). */
export function seedBuiltInRules(): void {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const insert = db.prepare(
    `INSERT OR IGNORE INTO rules (id, name, severity, enabled, dsl, built_in, fire_count, created_at, updated_at)
       VALUES (?, ?, ?, 1, ?, 1, 0, ?, ?)`,
  );
  const tx = db.transaction((rules: typeof BUILT_IN_RULES) => {
    for (const r of rules) insert.run(r.id, r.name, r.severity, JSON.stringify(r), now, now);
  });
  tx(BUILT_IN_RULES);
}

bus.on(EVENTS.RuleChanged, () => {
  void reloadRules().catch((err) => logger.warn({ err: (err as Error).message }, 'reloadRules failed'));
});
