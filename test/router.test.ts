import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let getDb: typeof import('../src/storage/db.js').getDb;
let routeAlert: typeof import('../src/notifiers/router.js').routeAlert;
let setChannelHandler: typeof import('../src/notifiers/router.js').setChannelHandler;

const baseAlert = {
  id: 1,
  chain: 'eth' as const,
  rule: 'sender_repeats_to' as const,
  pivotAddress: '0xa',
  counterparty: '0xb',
  triggerTxHash: '0xtx',
  windowTxHashes: [],
  amountUsdt: 1000,
  createdAt: 0,
  pivotLabels: [],
  counterpartyLabels: [],
  severity: 'P2' as const,
};

beforeEach(async () => {
  vi.resetModules();
  process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'cw-router-')), 'cw.db');
  ({ getDb } = await import('../src/storage/db.js'));
  ({ routeAlert, setChannelHandler } = await import('../src/notifiers/router.js'));
  // ensure tables exist (migration runs on getDb init)
  getDb();
});

function addSub(channel: string, minSeverity = 'P2', extras: Record<string, unknown> = {}): void {
  const now = Math.floor(Date.now() / 1000);
  getDb().prepare(
    `INSERT INTO subscriptions (channel, min_severity, chain_filter, rule_filter, silence_until, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
  ).run(
    channel,
    minSeverity,
    extras.chain_filter ?? null,
    extras.rule_filter ?? null,
    extras.silence_until ?? null,
    now,
    now,
  );
}

describe('routeAlert', () => {
  it('dispatches to channels whose min_severity is met', async () => {
    addSub('tg', 'P2');
    addSub('webhook', 'P1');
    const called: string[] = [];
    setChannelHandler('tg', async () => { called.push('tg'); });
    setChannelHandler('webhook', async () => { called.push('webhook'); });
    await routeAlert(baseAlert);
    expect(called).toEqual(['tg']); // webhook requires P1; alert is P2
  });

  it('respects chain_filter when set', async () => {
    addSub('tg', 'P3', { chain_filter: JSON.stringify(['bsc']) });
    const called: string[] = [];
    setChannelHandler('tg', async () => { called.push('tg'); });
    await routeAlert(baseAlert); // chain is eth, filter is bsc → skip
    expect(called).toEqual([]);
  });

  it('respects rule_filter when set', async () => {
    addSub('tg', 'P3', { rule_filter: JSON.stringify(['receiver_repeats_from']) });
    const called: string[] = [];
    setChannelHandler('tg', async () => { called.push('tg'); });
    await routeAlert(baseAlert);
    expect(called).toEqual([]);
  });

  it('respects silence_until in the future', async () => {
    const future = Math.floor(Date.now() / 1000) + 3600;
    addSub('tg', 'P3', { silence_until: future });
    const called: string[] = [];
    setChannelHandler('tg', async () => { called.push('tg'); });
    await routeAlert(baseAlert);
    expect(called).toEqual([]);
  });
});
