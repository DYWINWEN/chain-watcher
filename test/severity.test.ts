import { describe, it, expect } from 'vitest';
import { assignSeverity, compareSeverity } from '../src/notifiers/severity.js';

const baseAlert = {
  id: 1,
  chain: 'eth' as const,
  rule: 'sender_repeats_to' as const,
  pivotAddress: '0xa',
  counterparty: '0xb',
  triggerTxHash: '0xtx',
  windowTxHashes: [],
  amountUsdt: 100,
  createdAt: 0,
  pivotLabels: [] as Array<{ label: string; category: string; riskScore: number }>,
  counterpartyLabels: [] as Array<{ label: string; category: string; riskScore: number }>,
};

describe('compareSeverity', () => {
  it('P1 satisfies any minimum', () => {
    expect(compareSeverity('P1', 'P1')).toBe(true);
    expect(compareSeverity('P1', 'P2')).toBe(true);
    expect(compareSeverity('P1', 'P3')).toBe(true);
  });
  it('P3 only satisfies P3', () => {
    expect(compareSeverity('P3', 'P1')).toBe(false);
    expect(compareSeverity('P3', 'P2')).toBe(false);
    expect(compareSeverity('P3', 'P3')).toBe(true);
  });
});

describe('assignSeverity', () => {
  it('returns P1 for OFAC labels regardless of amount', () => {
    const a = { ...baseAlert, amountUsdt: 100,
      counterpartyLabels: [{ label: 'OFAC SDN', category: 'ofac', riskScore: 95 }] };
    expect(assignSeverity(a)).toBe('P1');
  });

  it('returns P1 for amount >= 5000', () => {
    expect(assignSeverity({ ...baseAlert, amountUsdt: 5000 })).toBe('P1');
    expect(assignSeverity({ ...baseAlert, amountUsdt: 4999 })).not.toBe('P1');
  });

  it('returns P2 for CEX labels at low amount', () => {
    const a = { ...baseAlert, amountUsdt: 200,
      pivotLabels: [{ label: 'Binance Hot 14', category: 'cex', riskScore: 10 }] };
    expect(assignSeverity(a)).toBe('P2');
  });

  it('returns P3 for plain small alert with no labels', () => {
    expect(assignSeverity({ ...baseAlert, amountUsdt: 200 })).toBe('P3');
  });
});
