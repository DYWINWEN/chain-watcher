import { Redis } from 'ioredis';
import type { Chain } from '../types.js';
import { logger } from '../utils/logger.js';

export type FrequencyCounter = {
  add(chain: Chain, group: string, ts: number, txHash: string): Promise<void>;
  count(chain: Chain, group: string, windowSeconds: number): Promise<number>;
  prune(chain: Chain, group: string, olderThanSeconds: number): Promise<void>;
};

function key(chain: Chain, group: string): string {
  return `freq:${chain}:${group}`;
}

/** Redis-backed counter via sorted sets. Atomic, concurrent-safe, persistent. */
export function createRedisFrequencyCounter(redis: Redis): FrequencyCounter {
  return {
    async add(chain, group, ts, txHash) {
      await redis.zadd(key(chain, group), ts, txHash);
    },
    async count(chain, group, windowSeconds) {
      const now = Math.floor(Date.now() / 1000);
      const cutoff = now - windowSeconds;
      const n = await redis.zcount(key(chain, group), cutoff, '+inf');
      return typeof n === 'number' ? n : Number(n);
    },
    async prune(chain, group, olderThanSeconds) {
      const cutoff = Math.floor(Date.now() / 1000) - olderThanSeconds;
      await redis.zremrangebyscore(key(chain, group), '-inf', cutoff);
    },
  };
}

/** Fallback when Redis is unreachable. Single-process only. */
export function createInMemoryFrequencyCounter(): FrequencyCounter {
  const store = new Map<string, Map<string, number>>(); // key → Map<txHash, ts>
  function inner(chain: Chain, group: string): Map<string, number> {
    const k = key(chain, group);
    let m = store.get(k);
    if (!m) {
      m = new Map();
      store.set(k, m);
    }
    return m;
  }
  return {
    async add(chain, group, ts, txHash) {
      inner(chain, group).set(txHash, ts);
    },
    async count(chain, group, windowSeconds) {
      const now = Math.floor(Date.now() / 1000);
      const cutoff = now - windowSeconds;
      let n = 0;
      for (const ts of inner(chain, group).values()) if (ts >= cutoff) n += 1;
      return n;
    },
    async prune(chain, group, olderThanSeconds) {
      const cutoff = Math.floor(Date.now() / 1000) - olderThanSeconds;
      const m = inner(chain, group);
      for (const [tx, ts] of m) if (ts < cutoff) m.delete(tx);
    },
  };
}

/** Pick a counter. If `redis` is provided AND `ping` succeeds, use Redis; else in-memory. */
export async function pickFrequencyCounter(redis: Redis | null): Promise<FrequencyCounter> {
  if (!redis) {
    logger.warn('frequency-counter: no redis client, using in-memory');
    return createInMemoryFrequencyCounter();
  }
  try {
    await redis.ping();
    logger.info('frequency-counter: using Redis ZSET');
    return createRedisFrequencyCounter(redis);
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'frequency-counter: Redis ping failed, falling back to in-memory');
    return createInMemoryFrequencyCounter();
  }
}
