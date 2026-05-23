import { getSetting, SETTINGS } from '../config.js';
import type { Chain } from '../types.js';

/** Round-robin URL pool. Stateless beyond an index pointer.
 *  Health tracking lives in the ingestor — the pool just rotates. */
export class RpcPool {
  private idx = 0;
  private readonly urls: readonly string[];

  constructor(urls: readonly string[]) {
    if (urls.length === 0) throw new Error('RpcPool: empty url list');
    this.urls = urls;
  }

  current(): string {
    return this.urls[this.idx]!;
  }

  next(): string {
    this.idx = (this.idx + 1) % this.urls.length;
    return this.current();
  }

  size(): number {
    return this.urls.length;
  }
}

/** Resolve the active ws URL list for a chain. Prefers ws_urls if non-empty;
 *  otherwise wraps the single ws_url into a 1-element array; returns [] when
 *  neither is configured. */
export function resolveWsUrls(chain: Chain): string[] {
  const URLS_KEY: Record<Chain, string> = {
    eth: SETTINGS.chain_eth_ws_urls,
    bsc: SETTINGS.chain_bsc_ws_urls,
    btc: SETTINGS.chain_btc_ws_urls,
    polygon: SETTINGS.chain_polygon_ws_urls,
    tron: '',
  };
  const URL_KEY: Record<Chain, string> = {
    eth: SETTINGS.chain_eth_ws_url,
    bsc: SETTINGS.chain_bsc_ws_url,
    btc: SETTINGS.chain_btc_ws_url,
    polygon: SETTINGS.chain_polygon_ws_url,
    tron: '',
  };
  const multi = getSetting<string[]>(URLS_KEY[chain], []);
  if (Array.isArray(multi) && multi.length > 0) return multi.filter((u) => typeof u === 'string' && u.length > 0);
  const single = getSetting<string>(URL_KEY[chain], '');
  return single ? [single] : [];
}
