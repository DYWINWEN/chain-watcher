import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let getDb: typeof import('../src/storage/db.js').getDb;
let closeDb: typeof import('../src/storage/db.js').closeDb;

beforeEach(async () => {
  vi.resetModules();
  process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'cw-migrations-')), 'cw.db');
  ({ getDb, closeDb } = await import('../src/storage/db.js'));
});

describe('migrations framework', () => {
  it('discovers and applies v1_001_idx_tx_amount.sql on first getDb()', () => {
    const db = getDb();
    const row = db
      .prepare(`SELECT name FROM _migrations WHERE name = 'v1_001_idx_tx_amount.sql'`)
      .get();
    expect(row).toBeDefined();
  });

  it('creates the idx_tx_amount index', () => {
    const db = getDb();
    const indexes = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'tx'`)
      .all() as Array<{ name: string }>;
    expect(indexes.map((i) => i.name)).toContain('idx_tx_amount');
  });

  it('does not re-apply on second open', () => {
    getDb();
    closeDb();
    // open a second time — count should remain 1
    const db = getDb();
    const row = db
      .prepare(`SELECT COUNT(*) AS n FROM _migrations WHERE name = 'v1_001_idx_tx_amount.sql'`)
      .get() as { n: number };
    expect(row.n).toBe(1);
  });

  it('discovers and applies v1_002_labels.sql and v1_003_alert_labels.sql', () => {
    const db = getDb();
    const v2 = db
      .prepare(`SELECT name FROM _migrations WHERE name = 'v1_002_labels.sql'`)
      .get();
    const v3 = db
      .prepare(`SELECT name FROM _migrations WHERE name = 'v1_003_alert_labels.sql'`)
      .get();
    expect(v2).toBeDefined();
    expect(v3).toBeDefined();

    // labels table + indexes
    const labelTbl = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'labels'`)
      .get();
    expect(labelTbl).toBeDefined();
    const indexes = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'labels'`)
      .all() as Array<{ name: string }>;
    expect(indexes.map((i) => i.name)).toContain('idx_labels_addr');
    expect(indexes.map((i) => i.name)).toContain('idx_labels_cat');

    // alerts label columns
    const cols = db.prepare(`PRAGMA table_info(alerts)`).all() as Array<{ name: string }>;
    expect(cols.map((c) => c.name)).toContain('pivot_labels');
    expect(cols.map((c) => c.name)).toContain('counterparty_labels');
  });

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

  it('discovers and applies v1_005_subscriptions_config.sql', () => {
    const db = getDb();
    const row = db
      .prepare(`SELECT name FROM _migrations WHERE name = 'v1_005_subscriptions_config.sql'`)
      .get();
    expect(row).toBeDefined();
    const cols = db.prepare(`PRAGMA table_info(subscriptions)`).all() as Array<{ name: string }>;
    expect(cols.map((c) => c.name)).toContain('config');
  });

  it('discovers and applies v1_006_rules.sql', () => {
    const db = getDb();
    const row = db
      .prepare(`SELECT name FROM _migrations WHERE name = 'v1_006_rules.sql'`)
      .get();
    expect(row).toBeDefined();
    const rulesTbl = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'rules'`)
      .get();
    expect(rulesTbl).toBeDefined();
    const alertCols = db.prepare(`PRAGMA table_info(alerts)`).all() as Array<{ name: string }>;
    expect(alertCols.map((c) => c.name)).toContain('rule_id');
  });
});
