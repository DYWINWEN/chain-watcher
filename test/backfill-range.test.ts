import { describe, it, expect } from 'vitest';

describe('backfill EVM lookback range — must stay under public RPC caps', () => {
  it('lookback constant in backfillEvm is <= 9_900 blocks (PublicNode caps at 50_000)', async () => {
    // Structural test: regression pin for the v1 bug where lookback was 60_000,
    // causing 100% of EVM backfill calls to fail with "exceed maximum block range: 50000"
    // against PublicNode and similar free RPC endpoints.
    const { readFileSync } = await import('node:fs');
    const path = new URL('../src/rules/backfill.ts', import.meta.url);
    const src = readFileSync(path, 'utf8');

    // Find the lookback assignment inside backfillEvm.
    const m = src.match(/const lookback = (\d[\d_]*);/);
    expect(m).not.toBeNull();
    const value = Number(m![1].replace(/_/g, ''));
    expect(value).toBeLessThanOrEqual(9_900);
    expect(value).toBeGreaterThan(0);
  });
});
