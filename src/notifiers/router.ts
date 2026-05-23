import { getDb } from '../storage/db.js';
import { logger } from '../utils/logger.js';
import type { AlertNewPayload } from '../utils/event-bus.js';
import { compareSeverity, type Severity } from './severity.js';

export type ChannelHandler = (alert: AlertNewPayload) => Promise<void>;

const handlers = new Map<string, ChannelHandler>();

export function setChannelHandler(channel: string, fn: ChannelHandler): void {
  handlers.set(channel, fn);
}

type SubRow = {
  id: number;
  channel: string;
  min_severity: string;
  chain_filter: string | null;
  rule_filter: string | null;
  silence_until: number | null;
  enabled: number;
};

export async function routeAlert(alert: AlertNewPayload): Promise<void> {
  const sev = (alert as AlertNewPayload & { severity?: string }).severity as Severity | undefined;
  if (!sev) {
    logger.warn({ alertId: alert.id }, 'routeAlert: missing severity, skipping');
    return;
  }
  const now = Math.floor(Date.now() / 1000);
  const subs = getDb()
    .prepare(`SELECT * FROM subscriptions WHERE enabled = 1`)
    .all() as SubRow[];

  for (const sub of subs) {
    if (!compareSeverity(sev, sub.min_severity as Severity)) continue;
    if (sub.chain_filter) {
      try {
        const allowed = JSON.parse(sub.chain_filter) as string[];
        if (!allowed.includes(alert.chain)) continue;
      } catch { /* malformed filter → treat as no-match for safety */ continue; }
    }
    if (sub.rule_filter) {
      try {
        const allowed = JSON.parse(sub.rule_filter) as string[];
        if (!allowed.includes(alert.rule)) continue;
      } catch { continue; }
    }
    if (sub.silence_until && sub.silence_until > now) continue;

    const handler = handlers.get(sub.channel);
    if (!handler) {
      logger.debug({ channel: sub.channel }, 'routeAlert: no handler registered, skipping');
      continue;
    }
    try {
      await handler(alert);
    } catch (err) {
      logger.warn({ err: (err as Error).message, channel: sub.channel, alertId: alert.id }, 'channel handler failed');
    }
  }
}

/** Default seed when subscriptions table is empty. Tg gets P2+, dashboard is informational. */
export function seedSubscriptionsIfEmpty(): void {
  const db = getDb();
  const existing = db.prepare(`SELECT COUNT(*) AS n FROM subscriptions`).get() as { n: number };
  if (existing.n > 0) return;
  const now = Math.floor(Date.now() / 1000);
  const insert = db.prepare(
    `INSERT INTO subscriptions (channel, min_severity, chain_filter, rule_filter, silence_until, enabled, created_at, updated_at)
       VALUES (?, ?, NULL, NULL, NULL, 1, ?, ?)`,
  );
  insert.run('dashboard', 'P3', now, now);
  insert.run('tg', 'P2', now, now);
  logger.info('subscriptions seeded (dashboard P3, tg P2)');
}
