import { Router } from 'express';
import { getDb } from '../storage/db.js';
import { bus, EVENTS } from '../utils/event-bus.js';
import { parseRuleDsl } from '../rules/dsl/schema.js';

export const rulesRouter = Router();

rulesRouter.get('/api/rules', (_req, res) => {
  const rows = getDb()
    .prepare(
      `SELECT id, name, severity, enabled, dsl, built_in AS builtIn, fire_count AS fireCount,
              last_fired_at AS lastFiredAt, created_at AS createdAt, updated_at AS updatedAt
         FROM rules ORDER BY built_in DESC, id`,
    )
    .all() as Array<{
      id: string; name: string; severity: string; enabled: number; dsl: string;
      builtIn: number; fireCount: number; lastFiredAt: number | null;
      createdAt: number; updatedAt: number;
    }>;
  res.json(rows.map((r) => ({ ...r, dsl: safeParseJson(r.dsl), enabled: !!r.enabled, builtIn: !!r.builtIn })));
});

rulesRouter.get('/api/rules/:id', (req, res): void => {
  const row = getDb()
    .prepare(
      `SELECT id, name, severity, enabled, dsl, built_in AS builtIn, fire_count AS fireCount,
              last_fired_at AS lastFiredAt, created_at AS createdAt, updated_at AS updatedAt
         FROM rules WHERE id = ?`,
    )
    .get(req.params.id) as any;
  if (!row) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  res.json({ ...row, dsl: safeParseJson(row.dsl), enabled: !!row.enabled, builtIn: !!row.builtIn });
});

rulesRouter.post('/api/rules', (req, res): void => {
  let parsed;
  try {
    parsed = parseRuleDsl(req.body);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
    return;
  }
  const now = Math.floor(Date.now() / 1000);
  getDb()
    .prepare(
      `INSERT INTO rules (id, name, severity, enabled, dsl, built_in, fire_count, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name, severity = excluded.severity, enabled = excluded.enabled,
           dsl = excluded.dsl, updated_at = excluded.updated_at`,
    )
    .run(parsed.id, parsed.name, parsed.severity, parsed.enabled ? 1 : 0, JSON.stringify(parsed), now, now);
  bus.emit(EVENTS.RuleChanged, { id: parsed.id });
  res.json({ ok: true });
});

rulesRouter.patch('/api/rules/:id', (req, res): void => {
  const existing = getDb()
    .prepare(`SELECT dsl FROM rules WHERE id = ?`)
    .get(req.params.id) as { dsl: string } | undefined;
  if (!existing) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  const merged = { ...safeParseJson(existing.dsl), ...req.body, id: req.params.id };
  let parsed;
  try {
    parsed = parseRuleDsl(merged);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
    return;
  }
  const now = Math.floor(Date.now() / 1000);
  getDb()
    .prepare(
      `UPDATE rules SET name = ?, severity = ?, enabled = ?, dsl = ?, updated_at = ?
        WHERE id = ?`,
    )
    .run(parsed.name, parsed.severity, parsed.enabled ? 1 : 0, JSON.stringify(parsed), now, parsed.id);
  bus.emit(EVENTS.RuleChanged, { id: parsed.id });
  res.json({ ok: true });
});

rulesRouter.delete('/api/rules/:id', (req, res): void => {
  const existing = getDb()
    .prepare(`SELECT built_in FROM rules WHERE id = ?`)
    .get(req.params.id) as { built_in: number } | undefined;
  if (!existing) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  if (existing.built_in === 1) {
    res.status(403).json({ error: 'built-in rules cannot be deleted' });
    return;
  }
  getDb().prepare(`DELETE FROM rules WHERE id = ?`).run(req.params.id);
  bus.emit(EVENTS.RuleChanged, { id: req.params.id });
  res.json({ ok: true });
});

function safeParseJson(s: string): any {
  try { return JSON.parse(s); } catch { return null; }
}
