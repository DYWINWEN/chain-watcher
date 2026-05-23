import express, { type Request, type Response } from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Server } from 'node:http';
import { getDb } from '../storage/db.js';
import { getAllSettings, setSetting, getSetting, SETTINGS } from '../config.js';
import { attachSseClient } from '../notifiers/sse-bus.js';
import { logger } from '../utils/logger.js';
import { labelsRouter } from '../api/labels.js';
import { subscriptionsRouter } from '../api/subscriptions.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

let server: Server | null = null;

export async function startDashboard(): Promise<void> {
  if (server) return;
  const port = Number(getSetting<number>(SETTINGS.dashboard_port, 8787)) || 8787;
  const app = express();
  app.use(express.json({ limit: '256kb' }));
  app.use(labelsRouter);
  app.use(subscriptionsRouter);

  // ----- pages -----
  app.use('/static', express.static(join(__dirname, 'public')));
  app.get('/', (_req, res) => res.redirect('/alerts'));
  app.get(['/alerts', '/watchlist', '/stats', '/settings', '/labels'], (_req, res) => {
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

  app.get('/api/address/:chain/:address', (req, res): void => {
    const chain = String(req.params.chain).toLowerCase();
    const address = String(req.params.address).toLowerCase();
    const db = getDb();

    const out = db
      .prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(amount_usdt), 0) AS total FROM tx WHERE chain = ? AND from_addr = ?`)
      .get(chain, address) as { n: number; total: number };
    const into = db
      .prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(amount_usdt), 0) AS total FROM tx WHERE chain = ? AND to_addr = ?`)
      .get(chain, address) as { n: number; total: number };
    const alerts = db
      .prepare(`SELECT COUNT(*) AS n FROM alerts WHERE chain = ? AND (pivot_address = ? OR counterparty = ?)`)
      .get(chain, address, address) as { n: number };
    const labels = db
      .prepare(
        `SELECT label, category, risk_score AS riskScore, source FROM labels WHERE chain = ? AND address = ?`,
      )
      .all(chain, address) as Array<{ label: string; category: string; riskScore: number; source: string }>;
    const maxRisk = labels.reduce((m, l) => Math.max(m, l.riskScore), 0);

    // Top counterparties — from windows table (in + out merged).
    const tops = db
      .prepare(
        `SELECT counterparties FROM windows WHERE chain = ? AND address = ?`,
      )
      .all(chain, address) as Array<{ counterparties: string }>;
    const counterCount = new Map<string, number>();
    for (const row of tops) {
      try {
        const cps = JSON.parse(row.counterparties) as string[];
        for (const cp of cps) counterCount.set(cp, (counterCount.get(cp) ?? 0) + 1);
      } catch {
        // ignore malformed JSON
      }
    }
    const topCounterparties = [...counterCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([address, count]) => ({ address, count }));

    res.json({
      chain,
      address,
      stats: {
        outboundCount: out.n,
        outboundTotal: out.total,
        inboundCount: into.n,
        inboundTotal: into.total,
        alertCount: alerts.n,
        maxRiskScore: maxRisk,
      },
      labels,
      topCounterparties,
    });
  });

  app.get('/api/stats', (req, res) => {
    const hours = Math.max(1, Math.min(24 * 30, Number(req.query.hours) || 24 * 7));
    const bucketSec = hours <= 6 ? 300 : hours <= 24 ? 1800 : hours <= 168 ? 3600 : 21600;
    const db = getDb();
    const cutoff = Math.floor(Date.now() / 1000) - hours * 3600;
    const buckets = db
      .prepare(
        `SELECT (created_at / ?) * ? AS bucket, chain, rule, COUNT(*) AS n
           FROM alerts WHERE created_at > ?
           GROUP BY bucket, chain, rule
           ORDER BY bucket ASC`,
      )
      .all(bucketSec, bucketSec, cutoff);
    const txTotals = db
      .prepare('SELECT chain, COUNT(*) AS n FROM tx WHERE ts > ? GROUP BY chain')
      .all(cutoff);
    const ruleTotals = db
      .prepare('SELECT rule, COUNT(*) AS n FROM alerts WHERE created_at > ? GROUP BY rule')
      .all(cutoff);
    res.json({ hours, bucketSec, alertBuckets: buckets, txTotals, ruleTotals });
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
