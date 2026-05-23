import { describe, it, expect } from 'vitest';
import { createInMemoryFrequencyCounter } from '../src/rules/frequency-counter.js';

describe('InMemoryFrequencyCounter', () => {
  it('add + count returns the right window member count', async () => {
    const c = createInMemoryFrequencyCounter();
    const now = Math.floor(Date.now() / 1000);
    await c.add('eth', 'from_addr:0xa', now, 't1');
    await c.add('eth', 'from_addr:0xa', now, 't2');
    await c.add('eth', 'from_addr:0xa', now - 100, 't3'); // 100s ago
    const n = await c.count('eth', 'from_addr:0xa', 60); // 60s window
    expect(n).toBe(2); // only t1+t2 (the recent ones)
  });

  it('group isolation — different groups do not bleed', async () => {
    const c = createInMemoryFrequencyCounter();
    const now = Math.floor(Date.now() / 1000);
    await c.add('eth', 'from_addr:0xa', now, 't1');
    await c.add('eth', 'from_addr:0xb', now, 't2');
    expect(await c.count('eth', 'from_addr:0xa', 60)).toBe(1);
    expect(await c.count('eth', 'from_addr:0xb', 60)).toBe(1);
    expect(await c.count('eth', 'from_addr:0xc', 60)).toBe(0);
  });

  it('prune drops older-than entries', async () => {
    const c = createInMemoryFrequencyCounter();
    const now = Math.floor(Date.now() / 1000);
    await c.add('eth', 'from_addr:0xa', now - 1000, 'old');
    await c.add('eth', 'from_addr:0xa', now, 'new');
    await c.prune('eth', 'from_addr:0xa', 500);
    expect(await c.count('eth', 'from_addr:0xa', 3600)).toBe(1);
  });
});
