import { Router } from 'express';
import { getDb } from '../storage/db.js';

export const subscriptionsRouter = Router();

subscriptionsRouter.get('/api/subscriptions', (_req, res) => {
  const rows = getDb()
    .prepare(
      `SELECT id, channel, min_severity AS minSeverity, chain_filter AS chainFilter,
              rule_filter AS ruleFilter, silence_until AS silenceUntil, enabled,
              created_at AS createdAt, updated_at AS updatedAt
         FROM subscriptions ORDER BY id`,
    )
    .all();
  res.json(rows);
});

subscriptionsRouter.post('/api/subscriptions', (req, res): void => {
  const { channel, minSeverity, chainFilter, ruleFilter, silenceUntil, enabled } = req.body ?? {};
  if (!channel || !minSeverity) {
    res.status(400).json({ error: 'channel + minSeverity required' });
    return;
  }
  const now = Math.floor(Date.now() / 1000);
  const result = getDb()
    .prepare(
      `INSERT INTO subscriptions (channel, min_severity, chain_filter, rule_filter,
                                  silence_until, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      String(channel),
      String(minSeverity),
      chainFilter ?? null,
      ruleFilter ?? null,
      silenceUntil ?? null,
      enabled === false ? 0 : 1,
      now,
      now,
    );
  res.json({ id: Number(result.lastInsertRowid), ok: true });
});

subscriptionsRouter.patch('/api/subscriptions/:id', (req, res): void => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: 'invalid id' });
    return;
  }
  const allowed = ['channel', 'min_severity', 'chain_filter', 'rule_filter', 'silence_until', 'enabled'];
  const camelMap: Record<string, string> = {
    minSeverity: 'min_severity',
    chainFilter: 'chain_filter',
    ruleFilter: 'rule_filter',
    silenceUntil: 'silence_until',
  };
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [k, v] of Object.entries(req.body ?? {})) {
    const col = camelMap[k] ?? k;
    if (!allowed.includes(col)) continue;
    sets.push(`${col} = ?`);
    params.push(col === 'enabled' ? (v ? 1 : 0) : v);
  }
  if (sets.length === 0) {
    res.json({ ok: true });
    return;
  }
  sets.push('updated_at = ?');
  params.push(Math.floor(Date.now() / 1000));
  params.push(id);
  getDb().prepare(`UPDATE subscriptions SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  res.json({ ok: true });
});

subscriptionsRouter.delete('/api/subscriptions/:id', (req, res) => {
  const id = Number(req.params.id);
  getDb().prepare(`DELETE FROM subscriptions WHERE id = ?`).run(id);
  res.json({ ok: true });
});
