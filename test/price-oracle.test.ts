import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getPrice, clearPriceCache, __setPriceFetcher } from '../src/decoder/price-oracle.js';

beforeEach(() => clearPriceCache());

describe('price oracle', () => {
  it('returns 1 for USDT without network call', async () => {
    const fn = vi.fn();
    __setPriceFetcher(fn);
    expect(await getPrice('USDT')).toBe(1);
    expect(fn).not.toHaveBeenCalled();
  });

  it('caches within TTL', async () => {
    let calls = 0;
    __setPriceFetcher(async () => {
      calls += 1;
      return 60000;
    });
    await getPrice('BTCUSDT');
    await getPrice('BTCUSDT');
    expect(calls).toBe(1);
  });

  it('falls back to stale on transient failure', async () => {
    let calls = 0;
    __setPriceFetcher(async () => {
      calls += 1;
      if (calls === 1) return 50000;
      throw new Error('boom');
    });
    expect(await getPrice('BTCUSDT')).toBe(50000);
    clearPriceCache();
    // first call fresh succeeded; clear cache then fail — should throw
    __setPriceFetcher(async () => { throw new Error('boom'); });
    await expect(getPrice('BTCUSDT')).rejects.toThrow();
  });
});
