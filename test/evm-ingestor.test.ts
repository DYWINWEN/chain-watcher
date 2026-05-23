import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// We won't exercise the actual ws connection — we test the
// invariant that `connect()` does NOT advance the checkpoint
// for blocks whose logs haven't been processed.

beforeEach(async () => {
  vi.resetModules();
  process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'cw-evm-')), 'cw.db');
  await import('../src/storage/db.js');
});

describe('EVM ingestor checkpoint discipline', () => {
  it('the connect() code path does not call saveCheckpoint(latest) after replay', async () => {
    // Read the source as text and assert the regression pattern is absent.
    // This is a structural test — pinning intent in a way that survives
    // future refactors that might re-introduce the race.
    const { readFileSync } = await import('node:fs');
    const evmSrcPath = new URL('../src/ingestors/evm.ts', import.meta.url);
    const src = readFileSync(evmSrcPath, 'utf8');

    // Find the catch-up block. It should NOT contain a bare
    // `this.saveCheckpoint(latest)` line — only `handleLog` (called
    // from replayRange or the live filter) is allowed to advance it.
    const catchupStart = src.indexOf('// Catch-up gap since last checkpoint.');
    const catchupEnd = src.indexOf('const filter =', catchupStart);
    expect(catchupStart).toBeGreaterThan(-1);
    expect(catchupEnd).toBeGreaterThan(catchupStart);
    const catchupBlock = src.slice(catchupStart, catchupEnd);
    expect(catchupBlock).not.toMatch(/this\.saveCheckpoint\(latest\)/);
  });

  it('connect() reads its url via RpcPool.current() — no hard-coded settings read', async () => {
    // Source-level invariant: connect() must obtain its url from the pool,
    // not by re-reading SETTINGS directly. This pins the rotation contract.
    const { readFileSync } = await import('node:fs');
    const evmSrcPath = new URL('../src/ingestors/evm.ts', import.meta.url);
    const src = readFileSync(evmSrcPath, 'utf8');

    // The connect() method body should call this.pool.current() and rotate at end.
    const connectStart = src.indexOf('async connect()');
    expect(connectStart).toBeGreaterThan(-1);
    const connectBlock = src.slice(connectStart, connectStart + 4000);
    expect(connectBlock).toMatch(/this\.pool\.current\(\)/);
    expect(connectBlock).toMatch(/this\.pool\.next\(\)/);
  });
});
