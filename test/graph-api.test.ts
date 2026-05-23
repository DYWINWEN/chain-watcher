import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let graphRouter: import('express').Router;
let getDb: typeof import('../src/storage/db.js').getDb;
let server: Server;
let port: number;

beforeEach(async () => {
  vi.resetModules();
  process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'cw-graph-')), 'cw.db');
  ({ getDb } = await import('../src/storage/db.js'));
  ({ graphRouter } = await import('../src/api/graph.js'));
  getDb();
  const app = express();
  app.use(express.json());
  app.use(graphRouter);
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  const addr = server.address();
  port = typeof addr === 'object' && addr ? addr.port : 0;
});

afterEach(() => new Promise<void>((r) => server.close(() => r())));

function url(p: string) { return `http://127.0.0.1:${port}${p}`; }

function insertTx(from: string, to: string, amount: number, blockNumber: number, txHash: string): void {
  const now = Math.floor(Date.now() / 1000);
  getDb().prepare(
    `INSERT INTO tx (chain, tx_hash, block_number, ts, from_addr, to_addr, token, amount_raw, amount_usdt)
       VALUES ('eth', ?, ?, ?, ?, ?, 'USDT', ?, ?)`,
  ).run(txHash, blockNumber, now, from, to, String(BigInt(Math.floor(amount * 1e6))), amount);
}

function insertLabel(addr: string, label: string, category: string): void {
  const now = Math.floor(Date.now() / 1000);
  getDb().prepare(
    `INSERT INTO labels (chain, address, label, category, source, risk_score, created_at, updated_at)
       VALUES ('eth', ?, ?, ?, 'user', 50, ?, ?)`,
  ).run(addr, label, category, now, now);
}

describe('GET /api/graph', () => {
  it('depth=1 returns pivot + top counterparties + edges', async () => {
    insertTx('0xpivot', '0xa', 100, 100, 'tx1');
    insertTx('0xpivot', '0xa', 200, 101, 'tx2');
    insertTx('0xpivot', '0xb', 50, 102, 'tx3');
    insertTx('0xc', '0xpivot', 75, 103, 'tx4');
    const r = await fetch(url('/api/graph?chain=eth&address=0xpivot&depth=1&limit=10'));
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.nodes.some((n: any) => n.address === '0xpivot' && n.isPivot)).toBe(true);
    const addrs = body.nodes.map((n: any) => n.address).sort();
    expect(addrs).toContain('0xa');
    expect(addrs).toContain('0xb');
    expect(addrs).toContain('0xc');
    expect(body.edges.length).toBeGreaterThanOrEqual(3);
    const aEdge = body.edges.find((e: any) => e.target.includes('0xa') || e.source.includes('0xa'));
    expect(aEdge.txCount).toBe(2);
    expect(aEdge.totalUsdt).toBe(300);
  });

  it('marks CEX-categorized counterparties as isLeaf', async () => {
    insertTx('0xpivot', '0xcex', 100, 100, 'tx1');
    insertLabel('0xcex', 'Binance Hot 14', 'cex');
    const body = await (await fetch(url('/api/graph?chain=eth&address=0xpivot&depth=1'))).json();
    const cexNode = body.nodes.find((n: any) => n.address === '0xcex');
    expect(cexNode).toBeDefined();
    expect(cexNode.isLeaf).toBe(true);
    expect(cexNode.category).toBe('cex');
  });

  it('depth=2 expands a level; CEX nodes do NOT contribute to frontier', async () => {
    // 0xpivot → 0xa → 0xa1
    // 0xpivot → 0xcex (leaf) → 0xshouldNotAppear
    insertTx('0xpivot', '0xa', 100, 100, 'tx1');
    insertTx('0xa', '0xa1', 50, 101, 'tx2');
    insertTx('0xpivot', '0xcex', 200, 102, 'tx3');
    insertTx('0xcex', '0xshouldNotAppear', 75, 103, 'tx4');
    insertLabel('0xcex', 'Binance Hot 14', 'cex');
    const body = await (await fetch(url('/api/graph?chain=eth&address=0xpivot&depth=2&limit=10'))).json();
    const addrs = body.nodes.map((n: any) => n.address);
    expect(addrs).toContain('0xa1');                  // expanded via non-leaf 0xa
    expect(addrs).not.toContain('0xshouldnotappear'); // 0xcex is leaf — no expansion
  });

  it('returns 400 on missing chain or address', async () => {
    const r1 = await fetch(url('/api/graph?address=0xa'));
    const r2 = await fetch(url('/api/graph?chain=eth'));
    expect(r1.status).toBe(400);
    expect(r2.status).toBe(400);
  });
});
