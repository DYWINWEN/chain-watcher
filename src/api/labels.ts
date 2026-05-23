import { Router } from 'express';
import { getDb } from '../storage/db.js';
import { bus, EVENTS } from '../utils/event-bus.js';
import { upsertLabels } from '../labels/importer.js';
import { refreshOfacOnce } from '../labels/refresher.js';
import type { Chain } from '../types.js';
import type { Category, Source } from '../labels/types.js';
import { CATEGORY_RISK } from '../labels/score.js';

export const labelsRouter = Router();

labelsRouter.get('/api/labels', (req, res): void => {
  const chain = String(req.query.chain ?? '').toLowerCase() as Chain;
  const address = String(req.query.address ?? '').toLowerCase();
  if (!chain || !address) {
    res.status(400).json({ error: 'chain and address required' });
    return;
  }
  const rows = getDb()
    .prepare(
      `SELECT chain, address, label, category, source, risk_score AS riskScore,
              created_at AS createdAt, updated_at AS updatedAt
         FROM labels WHERE chain = ? AND address = ?`,
    )
    .all(chain, address);
  res.json(rows);
});

labelsRouter.post('/api/labels', (req, res): void => {
  const { chain, address, label, category } = req.body ?? {};
  if (!chain || !address || !label) {
    res.status(400).json({ error: 'chain, address, label required' });
    return;
  }
  const cat = (category as Category) ?? 'user';
  const risk = CATEGORY_RISK[cat] ?? 0;
  upsertLabels([
    {
      chain: String(chain).toLowerCase() as Chain,
      address: String(address).toLowerCase(),
      label: String(label),
      category: cat,
      source: 'user' as Source,
      riskScore: risk,
    },
  ]);
  res.json({ ok: true });
});

labelsRouter.delete('/api/labels/:chain/:address/:label', (req, res): void => {
  const { chain, address, label } = req.params;
  getDb()
    .prepare(`DELETE FROM labels WHERE chain = ? AND address = ? AND label = ?`)
    .run(String(chain).toLowerCase(), String(address).toLowerCase(), String(label));
  bus.emit(EVENTS.LabelsChanged, {
    chain: String(chain).toLowerCase() as Chain,
    address: String(address).toLowerCase(),
  });
  res.json({ ok: true });
});

labelsRouter.get('/api/labels/sources', (_req, res) => {
  const rows = getDb()
    .prepare(
      `SELECT source, last_fetched_at AS lastFetchedAt, row_count AS rowCount, status, last_error AS lastError
         FROM label_sources ORDER BY source`,
    )
    .all();
  res.json(rows);
});

labelsRouter.post('/api/labels/refresh', (req, res): void => {
  const source = String(req.body?.source ?? 'ofac_sdn');
  if (source !== 'ofac_sdn') {
    res.status(400).json({ error: 'only ofac_sdn supports manual refresh' });
    return;
  }
  // Fire-and-forget; status visible via /api/labels/sources.
  void refreshOfacOnce();
  res.json({ started: true });
});
