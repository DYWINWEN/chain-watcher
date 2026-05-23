import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let TronIngestor: typeof import('../src/ingestors/tron.js').TronIngestor;
let getDb: typeof import('../src/storage/db.js').getDb;
let setSetting: typeof import('../src/config.js').setSetting;
let SETTINGS: typeof import('../src/config.js').SETTINGS;
let server: Server;
let port: number;
let serverHits: any[];

beforeEach(async () => {
  vi.resetModules();
  process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'cw-tron-')), 'cw.db');
  ({ getDb } = await import('../src/storage/db.js'));
  ({ setSetting, SETTINGS } = await import('../src/config.js'));
  ({ TronIngestor } = await import('../src/ingestors/tron.js'));
  getDb();
  serverHits = [];
  const app = express();
  app.get('/v1/contracts/:contract/events', (req, res) => {
    serverHits.push({ contract: req.params.contract, query: req.query });
    res.json({
      data: [
        {
          block_number: 1000,
          block_timestamp: 1700000000000,
          transaction_id: 'tx_abc_123',
          event_name: 'Transfer',
          result: {
            from: 'TFromXyz',
            to: 'TToXyz',
            value: '5000000',  // 5 USDT
          },
        },
        {
          block_number: 1001,
          block_timestamp: 1700000001000,
          transaction_id: 'tx_def_456',
          event_name: 'Transfer',
          result: {
            from: 'TFromXyz',
            to: 'TToXyz',
            value: '10000000',
          },
        },
      ],
    });
  });
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  const addr = server.address();
  port = typeof addr === 'object' && addr ? addr.port : 0;
  setSetting(SETTINGS.chain_tron_enabled, true, 'test');
  setSetting(SETTINGS.chain_tron_api_base, `http://127.0.0.1:${port}`, 'test');
  setSetting(SETTINGS.chain_tron_usdt, 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', 'test');
  setSetting(SETTINGS.chain_tron_poll_interval_ms, 100, 'test');
});

afterEach(() => new Promise<void>((r) => server.close(() => r())));

describe('TronIngestor.fetchOnce', () => {
  it('hits the TronGrid /events endpoint with correct contract', async () => {
    const ing = new TronIngestor();
    const enqueued: any[] = [];
    (ing as any).enqueue = async (ev: any) => { enqueued.push(ev); };
    await (ing as any).fetchOnce();
    expect(serverHits).toHaveLength(1);
    expect(serverHits[0].contract).toBe('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t');
    expect(enqueued.length).toBe(2);
    expect(enqueued[0].chain).toBe('tron');
    expect(enqueued[0].txHash).toBe('tx_abc_123');
  });

  it('dedupes events seen via tx_id LRU on second poll', async () => {
    const ing = new TronIngestor();
    const enqueued: any[] = [];
    (ing as any).enqueue = async (ev: any) => { enqueued.push(ev); };
    await (ing as any).fetchOnce();
    await (ing as any).fetchOnce();
    expect(enqueued.length).toBe(2); // second poll's 2 events are deduped
  });

  it('advances checkpoint to max block_number seen', async () => {
    const ing = new TronIngestor();
    (ing as any).enqueue = async () => {};
    await (ing as any).fetchOnce();
    const cp = getDb().prepare(`SELECT last_block FROM checkpoints WHERE chain='tron'`).get() as { last_block: number };
    expect(cp.last_block).toBe(1001);
  });
});
