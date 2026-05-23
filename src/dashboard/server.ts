import express, { type Request, type Response } from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Server } from 'node:http';
import { getDb } from '../storage/db.js';
import { getAllSettings, setSetting, getSetting, SETTINGS } from '../config.js';
import { attachSseClient } from '../notifiers/sse-bus.js';
import { logger } from '../utils/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

let server: Server | null = null;

export async function startDashboard(): Promise<void> {
  if (server) return;
  const port = Number(getSetting<number>(SETTINGS.dashboard_port, 8787)) || 8787;
  const app = express();
  app.use(express.json({ limit: '256kb' }));

  // ----- pages -----
  app.use('/static', express.static(join(__dirname, 'public')));
  app.get('/', (_req, res) => res.redirect('/alerts'));
  app.get(['/alerts', '/watchlist', '/stats', '/settings'], (_req, res) => {
    res.sendFile(join(__dirname, 'public', 'index.html'));
  });

  // ----- data APIs -----
  app.get('/api/alerts', (req, res): void => {
    const limit = Math.min(Number(req.query.limit) || 100, 1000);
    const rows = getDb()
      .prepare(
        `SELECT id, chain, rule, pivot_address, counterparty, trigger_tx_hash,
                window_tx_hashes, amount_usdt, created_at
           FROM alerts ORDER BY created_at DESC LIMIT ?`,
      )
      .all(limit);
    res.json(rows.map((r: any) => ({ ...r, window_tx_hashes: JSON.parse(r.window_tx_hashes) })));
  });

  app.get('/api/windows', (req, res): void => {
    const address = String(req.query.address ?? '').toLowerCase();
    if (!address) {
      res.status(400).json({ error: 'address required' });
      return;
    }
    const rows = getDb()
      .prepare(
        `SELECT chain, direction, counterparties, last_tx_hashes, updated_at, backfilled
           FROM windows WHERE address = ?`,
      )
      .all(address);
    res.json(
      rows.map((r: any) => ({
        ...r,
        counterparties: JSON.parse(r.counterparties),
        last_tx_hashes: JSON.parse(r.last_tx_hashes),
        backfilled: !!r.backfilled,
      })),
    );
  });

  app.get('/api/stats', (_req, res) => {
    const buckets = getDb()
      .prepare(
        `SELECT (created_at / 3600) * 3600 AS bucket, chain, COUNT(*) AS n
           FROM alerts
          WHERE created_at > strftime('%s','now') - 7*24*3600
          GROUP BY bucket, chain
          ORDER BY bucket ASC`,
      )
      .all();
    const txTotals = getDb()
      .prepare('SELECT chain, COUNT(*) AS n FROM tx GROUP BY chain')
      .all();
    res.json({ alertBuckets: buckets, txTotals });
  });

  app.get('/api/settings', (_req, res) => {
    res.json(getAllSettings());
  });

  app.patch('/api/settings/:key', (req: Request, res: Response): void => {
    const key = String(req.params.key ?? '');
    if (!key) {
      res.status(400).json({ error: 'key required' });
      return;
    }
    const { value, updated_by } = req.body ?? {};
    try {
      setSetting(key, value, typeof updated_by === 'string' ? updated_by : 'dashboard');
      res.json({ ok: true });
    } catch (err) {
      logger.warn({ err: (err as Error).message, key }, 'set setting failed');
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/api/audit', (_req, res) => {
    const rows = getDb()
      .prepare(
        `SELECT id, key, old_value, new_value, updated_by, ts
           FROM settings_audit ORDER BY ts DESC LIMIT 50`,
      )
      .all();
    res.json(rows);
  });

  app.get('/api/lists/:listType', (req, res) => {
    const lt = req.params.listType;
    const rows = getDb()
      .prepare(`SELECT chain, address, label, created_at FROM address_lists WHERE list_type = ? ORDER BY chain, address`)
      .all(lt);
    res.json(rows);
  });

  app.post('/api/lists/:listType', (req, res): void => {
    const lt = req.params.listType;
    const { chain, address, label } = req.body ?? {};
    if (!chain || !address) {
      res.status(400).json({ error: 'chain & address required' });
      return;
    }
    const now = Math.floor(Date.now() / 1000);
    getDb()
      .prepare(
        `INSERT OR REPLACE INTO address_lists (list_type, chain, address, label, created_at) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(lt, chain, String(address).toLowerCase(), label ?? '', now);
    res.json({ ok: true });
  });

  app.delete('/api/lists/:listType/:chain/:address', (req, res) => {
    const { listType, chain, address } = req.params;
    getDb()
      .prepare(`DELETE FROM address_lists WHERE list_type = ? AND chain = ? AND address = ?`)
      .run(listType, chain, address.toLowerCase());
    res.json({ ok: true });
  });

  app.get('/sse', (_req, res) => attachSseClient(res));

  await new Promise<void>((resolve) => {
    server = app.listen(port, () => {
      logger.info({ port }, 'dashboard listening');
      resolve();
    });
  });
}

export async function stopDashboard(): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = null;
}
