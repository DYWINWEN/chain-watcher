import { getSetting, SETTINGS } from '../config.js';
import { logger } from '../utils/logger.js';

type CacheEntry = { price: number; ts: number };

const cache = new Map<string, CacheEntry>();

const BINANCE_URL = 'https://api.binance.com/api/v3/ticker/price';

// Test seam — vitest can override this.
export let fetchPriceFromBinance = async (symbol: string): Promise<number> => {
  const res = await fetch(`${BINANCE_URL}?symbol=${symbol}`);
  if (!res.ok) throw new Error(`binance ${symbol} ${res.status}`);
  const body = (await res.json()) as { symbol: string; price: string };
  return Number(body.price);
};

export function __setPriceFetcher(fn: typeof fetchPriceFromBinance): void {
  fetchPriceFromBinance = fn;
}

function ttlSeconds(): number {
  const v = getSetting<number>(SETTINGS.price_ttl, 60);
  return Number.isFinite(v) && v > 0 ? v : 60;
}

export async function getPrice(symbol: string): Promise<number> {
  if (symbol === 'USDT' || symbol === 'USDTUSDT') return 1;
  const now = Date.now();
  const hit = cache.get(symbol);
  if (hit && now - hit.ts < ttlSeconds() * 1000) return hit.price;
  try {
    const price = await fetchPriceFromBinance(symbol);
    cache.set(symbol, { price, ts: now });
    return price;
  } catch (err) {
    if (hit) {
      logger.warn({ symbol, err: (err as Error).message }, 'price fetch failed, using stale');
      return hit.price;
    }
    throw err;
  }
}

export function clearPriceCache(): void {
  cache.clear();
}
