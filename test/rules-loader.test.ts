import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let getDb: typeof import('../src/storage/db.js').getDb;
let getCompiledRules: typeof import('../src/rules/rule-loader.js').getCompiledRules;
let reloadRules: typeof import('../src/rules/rule-loader.js').reloadRules;
let seedBuiltInRules: typeof import('../src/rules/rule-loader.js').seedBuiltInRules;

beforeEach(async () => {
  vi.resetModules();
  process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'cw-rules-loader-')), 'cw.db');
  ({ getDb } = await import('../src/storage/db.js'));
  ({ getCompiledRules, reloadRules, seedBuiltInRules } = await import('../src/rules/rule-loader.js'));
  getDb();
});

describe('rule-loader', () => {
  it('seedBuiltInRules inserts two built-ins on empty DB', async () => {
    seedBuiltInRules();
    const rows = getDb().prepare(`SELECT id FROM rules WHERE built_in = 1`).all() as Array<{ id: string }>;
    expect(rows.map((r) => r.id).sort()).toEqual(['receiver_repeats_from', 'sender_repeats_to']);
  });

  it('seedBuiltInRules is idempotent (running twice keeps two rows)', async () => {
    seedBuiltInRules();
    seedBuiltInRules();
    const n = (getDb().prepare(`SELECT COUNT(*) AS n FROM rules WHERE built_in = 1`).get() as { n: number }).n;
    expect(n).toBe(2);
  });

  it('reloadRules refreshes the in-memory cache after a row insert', async () => {
    seedBuiltInRules();
    await reloadRules();
    expect(getCompiledRules().length).toBe(2);
    const now = Math.floor(Date.now() / 1000);
    getDb()
      .prepare(
        `INSERT INTO rules (id, name, severity, enabled, dsl, built_in, fire_count, created_at, updated_at)
           VALUES (?, ?, ?, 1, ?, 0, 0, ?, ?)`,
      )
      .run('custom_test', 'Custom', 'P3', JSON.stringify({
        id: 'custom_test', name: 'Custom', severity: 'P3', enabled: true, version: 1,
        when: [], then: { emit_alert: true },
      }), now, now);
    await reloadRules();
    expect(getCompiledRules().length).toBe(3);
  });
});
