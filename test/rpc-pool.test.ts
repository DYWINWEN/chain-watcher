import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let RpcPool: typeof import('../src/utils/rpc-pool.js').RpcPool;
let resolveWsUrls: typeof import('../src/utils/rpc-pool.js').resolveWsUrls;

beforeEach(async () => {
  vi.resetModules();
  process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'cw-rpcpool-')), 'cw.db');
  ({ RpcPool, resolveWsUrls } = await import('../src/utils/rpc-pool.js'));
});

describe('RpcPool', () => {
  it('throws on empty url list', () => {
    expect(() => new RpcPool([])).toThrow(/empty/i);
  });

  it('current() returns the first url on construction', () => {
    const pool = new RpcPool(['wss://a', 'wss://b']);
    expect(pool.current()).toBe('wss://a');
  });

  it('next() rotates round-robin through the list', () => {
    const pool = new RpcPool(['wss://a', 'wss://b', 'wss://c']);
    expect(pool.next()).toBe('wss://b');
    expect(pool.next()).toBe('wss://c');
    expect(pool.next()).toBe('wss://a');
  });

  it('size() reports the configured length', () => {
    expect(new RpcPool(['wss://a']).size()).toBe(1);
    expect(new RpcPool(['wss://a', 'wss://b']).size()).toBe(2);
  });

  it('with a single url, next() returns the same url', () => {
    const pool = new RpcPool(['wss://only']);
    expect(pool.current()).toBe('wss://only');
    expect(pool.next()).toBe('wss://only');
    expect(pool.next()).toBe('wss://only');
  });
});

describe('resolveWsUrls', () => {
  it('uses ws_urls when present and non-empty', async () => {
    const { setSetting, SETTINGS } = await import('../src/config.js');
    setSetting(SETTINGS.chain_eth_ws_urls, ['wss://a', 'wss://b'], 'test');
    setSetting(SETTINGS.chain_eth_ws_url, 'wss://legacy', 'test');
    expect(resolveWsUrls('eth')).toEqual(['wss://a', 'wss://b']);
  });

  it('falls back to single ws_url when ws_urls absent or empty', async () => {
    const { setSetting, SETTINGS } = await import('../src/config.js');
    setSetting(SETTINGS.chain_bsc_ws_urls, [], 'test');
    setSetting(SETTINGS.chain_bsc_ws_url, 'wss://legacy-bsc', 'test');
    expect(resolveWsUrls('bsc')).toEqual(['wss://legacy-bsc']);
  });

  it('returns [] when both settings are empty', async () => {
    const { setSetting, SETTINGS } = await import('../src/config.js');
    setSetting(SETTINGS.chain_btc_ws_urls, [], 'test');
    setSetting(SETTINGS.chain_btc_ws_url, '', 'test');
    expect(resolveWsUrls('btc')).toEqual([]);
  });
});
