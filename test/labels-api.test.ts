import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import express from 'express';

let labelsRouter: import('express').Router;
let getDb: typeof import('../src/storage/db.js').getDb;
let server: Server;
let port: number;

beforeEach(async () => {
  vi.resetModules();
  process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'cw-labels-api-')), 'cw.db');
  ({ getDb } = await import('../src/storage/db.js'));
  ({ labelsRouter } = await import('../src/api/labels.js'));
  const app = express();
  app.use(express.json());
  app.use(labelsRouter);
  await new Promise<void>((r) => {
    server = app.listen(0, () => r());
  });
  const addr = server.address();
  port = typeof addr === 'object' && addr ? addr.port : 0;
});

afterEach(() => new Promise<void>((r) => server.close(() => r())));

function url(path: string): string {
  return `http://127.0.0.1:${port}${path}`;
}

describe('labels API', () => {
  it('GET /api/labels?chain=eth&address=… returns [] for unknown', async () => {
    const r = await fetch(url('/api/labels?chain=eth&address=0xunknown'));
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body).toEqual([]);
  });

  it('POST /api/labels adds a user label, GET returns it', async () => {
    const r = await fetch(url('/api/labels'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chain: 'eth', address: '0xUSER', label: 'MyHotWallet' }),
    });
    expect(r.status).toBe(200);
    const get = await (await fetch(url('/api/labels?chain=eth&address=0xuser'))).json();
    expect(get).toHaveLength(1);
    expect(get[0].label).toBe('MyHotWallet');
    expect(get[0].category).toBe('user');
    expect(get[0].riskScore).toBe(0);
  });

  it('DELETE /api/labels/:chain/:address/:label removes it', async () => {
    await fetch(url('/api/labels'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chain: 'eth', address: '0xZ', label: 'X' }),
    });
    const del = await fetch(url('/api/labels/eth/0xz/X'), { method: 'DELETE' });
    expect(del.status).toBe(200);
    const after = await (await fetch(url('/api/labels?chain=eth&address=0xz'))).json();
    expect(after).toEqual([]);
  });

  it('GET /api/labels/sources returns status of all configured sources', async () => {
    // Seed a label_sources row so the response is non-empty
    getDb()
      .prepare(
        `INSERT INTO label_sources (source, last_fetched_at, row_count, status) VALUES (?, ?, ?, ?)`,
      )
      .run('ofac_sdn', Math.floor(Date.now() / 1000), 42, 'ok');
    const r = await fetch(url('/api/labels/sources'));
    const body = await r.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.find((s: any) => s.source === 'ofac_sdn')).toMatchObject({ rowCount: 42, status: 'ok' });
  });

  it('POST /api/labels rejects missing fields', async () => {
    const r = await fetch(url('/api/labels'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chain: 'eth' }),
    });
    expect(r.status).toBe(400);
  });
});
