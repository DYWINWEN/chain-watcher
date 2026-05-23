import Database from 'better-sqlite3';
import { readFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from '../utils/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;
  const dbPath = resolve(process.env.DB_PATH ?? './data/cw.db');
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');
  applySchema(db);
  applyMigrations(db);
  _db = db;
  logger.info({ dbPath }, 'sqlite ready');
  return db;
}

function applySchema(db: Database.Database): void {
  const schemaPath = join(__dirname, 'schema.sql');
  const sql = readFileSync(schemaPath, 'utf8');
  db.exec(sql);
}

function applyMigrations(db: Database.Database): void {
  const migrationsDir = join(__dirname, 'migrations');
  if (!existsSync(migrationsDir)) return;
  db.exec(`CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)`);
  const applied = new Set(
    db.prepare('SELECT name FROM _migrations').all().map((r: any) => r.name as string),
  );
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  const insert = db.prepare('INSERT INTO _migrations (name, applied_at) VALUES (?, ?)');
  for (const f of files) {
    if (applied.has(f)) continue;
    const sql = readFileSync(join(migrationsDir, f), 'utf8');
    db.exec('BEGIN');
    try {
      db.exec(sql);
      insert.run(f, Math.floor(Date.now() / 1000));
      db.exec('COMMIT');
      logger.info({ migration: f }, 'migration applied');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}
