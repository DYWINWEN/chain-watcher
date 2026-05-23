import { describe, it, expect } from 'vitest';
import { decodeUsdtTransfer } from '../src/decoder/mempool-calldata.js';

describe('decodeUsdtTransfer', () => {
  // selector + 32B addr (12B zero-pad + 20B address) + 32B value
  // transfer to 0x1234...cdef of value 1000000 (1 USDT, 6 decimals)
  const valid = '0xa9059cbb' +
    '0000000000000000000000001234567890abcdef1234567890abcdef12345678' +
    '00000000000000000000000000000000000000000000000000000000000f4240'; // 1_000_000

  it('decodes a valid USDT transfer call', () => {
    const out = decodeUsdtTransfer(valid);
    expect(out).not.toBeNull();
    expect(out!.to).toBe('0x1234567890abcdef1234567890abcdef12345678');
    expect(out!.value).toBe('1000000');
  });

  it('returns null on wrong selector', () => {
    const bad = '0x12345678' + valid.slice(10);
    expect(decodeUsdtTransfer(bad)).toBeNull();
  });

  it('returns null on too-short input', () => {
    expect(decodeUsdtTransfer('0xa9059cbb')).toBeNull();
    expect(decodeUsdtTransfer('')).toBeNull();
    expect(decodeUsdtTransfer('0x')).toBeNull();
  });

  it('decodes zero-amount transfer (legal but unusual)', () => {
    const zero = '0xa9059cbb' +
      '0000000000000000000000001234567890abcdef1234567890abcdef12345678' +
      '0000000000000000000000000000000000000000000000000000000000000000';
    const out = decodeUsdtTransfer(zero);
    expect(out!.value).toBe('0');
  });
});
