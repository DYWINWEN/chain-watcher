import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import express from 'express';

let rulesRouter: import('express').Router;
let getDb: typeof import('../src/storage/db.js').getDb;
let seedBuiltInRules: typeof import('../src/rules/rule-loader.js').seedBuiltInRules;
let server: Server;
let port: number;

beforeEach(async () => {
  vi.resetModules();
  process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'cw-rules-api-')), 'cw.db');
  ({ getDb } = await import('../src/storage/db.js'));
  ({ seedBuiltInRules } = await import('../src/rules/rule-loader.js'));
  ({ rulesRouter } = await import('../src/api/rules.js'));
  getDb();
  seedBuiltInRules();
  const app = express();
  app.use(express.json());
  app.use(rulesRouter);
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  const addr = server.address();
  port = typeof addr === 'object' && addr ? addr.port : 0;
});

afterEach(() => new Promise<void>((r) => server.close(() => r())));

function url(p: string) { return `http://127.0.0.1:${port}${p}`; }

describe('rules API', () => {
  it('GET /api/rules returns built-ins', async () => {
    const r = await (await fetch(url('/api/rules'))).json();
    expect(r.length).toBe(2);
    expect(r.map((x: any) => x.id).sort()).toEqual(['receiver_repeats_from', 'sender_repeats_to']);
  });

  it('POST /api/rules adds a custom rule', async () => {
    const r = await fetch(url('/api/rules'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'custom1', name: 'Custom one', severity: 'P3', enabled: true, version: 1,
        when: [{ field: 'amount_usdt', op: '>', value: 100 }],
        then: { emit_alert: true },
      }),
    });
    expect(r.status).toBe(200);
    const list = await (await fetch(url('/api/rules'))).json();
    expect(list.find((x: any) => x.id === 'custom1')).toBeTruthy();
  });

  it('POST rejects malformed DSL with 400', async () => {
    const r = await fetch(url('/api/rules'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'bad', name: 'bad' }),
    });
    expect(r.status).toBe(400);
  });

  it('DELETE on built-in returns 403', async () => {
    const r = await fetch(url('/api/rules/sender_repeats_to'), { method: 'DELETE' });
    expect(r.status).toBe(403);
  });
});
