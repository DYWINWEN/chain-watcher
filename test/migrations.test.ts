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
});
