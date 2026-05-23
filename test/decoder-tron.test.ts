import { describe, it, expect } from 'vitest';
import { decodeTrc20Transfer } from '../src/decoder/tron.js';

const base = {
  kind: 'tron-trc20-transfer' as const,
  chain: 'tron' as const,
  txHash: 'abc123def456',
  blockNumber: 12345,
  timestamp: 1700000000,
  from: 'TFromAddrCaseSensitive',
  to: 'TToAddrCaseSensitive',
  valueRaw: '1000000', // 1 USDT
};

describe('decodeTrc20Transfer', () => {
  it('converts valueRaw to USDT float (6 decimals)', async () => {
    const out = await decodeTrc20Transfer(base);
    expect(out.amountUsdt).toBe(1);
    expect(out.amountRaw).toBe('1000000');
    expect(out.token).toBe('USDT');
    expect(out.chain).toBe('tron');
  });

  it('handles large value (200M USDT)', async () => {
    const out = await decodeTrc20Transfer({ ...base, valueRaw: '200000000000000' });
    expect(out.amountUsdt).toBe(200_000_000);
  });

  it('preserves Base58 address case', async () => {
    const out = await decodeTrc20Transfer(base);
    expect(out.from).toBe('TFromAddrCaseSensitive');
    expect(out.to).toBe('TToAddrCaseSensitive');
  });

  it('defaults source to block', async () => {
    const out = await decodeTrc20Transfer(base);
    expect(out.source).toBe('block');
  });
});
