import { describe, it, expect } from 'vitest';
import { formatPlain, formatMarkdown, formatSlackBlocks } from '../src/notifiers/format.js';

const sampleAlert = {
  id: 42,
  chain: 'eth' as const,
  rule: 'sender_repeats_to' as const,
  pivotAddress: '0x9a4e3c2b8d7c9f1e2a3b4c5d6e7f8a9b0c1d2e3f',
  counterparty: '0xf72b0a8d1e2c3b4a5b6c7d8e9f0a1b2c3d4e5f60',
  triggerTxHash: '0xab12f9d4',
  windowTxHashes: [],
  amountUsdt: 4219.5,
  createdAt: 1700000000,
  severity: 'P1' as const,
  pivotLabels: [{ label: 'OFAC SDN', category: 'ofac', riskScore: 95 }],
  counterpartyLabels: [],
};

describe('format', () => {
  it('formatPlain includes severity, chain, rule, amount, addresses', () => {
    const out = formatPlain(sampleAlert);
    expect(out).toContain('[P1]');
    expect(out).toContain('eth');
    expect(out).toContain('sender_repeats_to');
    expect(out).toContain('4219.50');
    expect(out).toContain('0x9a4e3c2b'); // shortened pivot
  });

  it('formatMarkdown wraps addresses in backticks', () => {
    const out = formatMarkdown(sampleAlert);
    expect(out).toMatch(/`0x9a4e3c2b/);
    expect(out).toContain('*'); // markdown bold
  });

  it('formatSlackBlocks returns valid Block Kit JSON structure', () => {
    const out = formatSlackBlocks(sampleAlert);
    expect(Array.isArray(out.blocks)).toBe(true);
    expect(out.blocks.length).toBeGreaterThan(0);
    // First block should be a header or section
    expect(['header', 'section']).toContain(out.blocks[0].type);
  });

  it('formatPlain handles missing labels gracefully', () => {
    const noLabels = { ...sampleAlert, pivotLabels: [], counterpartyLabels: [] };
    const out = formatPlain(noLabels);
    expect(out).toContain('[P1]');
    expect(out).not.toContain('undefined');
  });
});
