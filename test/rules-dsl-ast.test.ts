import { describe, it, expect, vi } from 'vitest';
import { compileRule } from '../src/rules/dsl/compile.js';
import type { RuleDsl } from '../src/rules/dsl/schema.js';
import type { EvalDeps } from '../src/rules/dsl/ast.js';

const baseTx = {
  chain: 'eth' as const,
  txHash: '0xt',
  blockNumber: 100,
  timestamp: 1700000000,
  from: '0xa',
  to: '0xb',
  token: 'USDT' as const,
  amountRaw: '1000000',
  amountUsdt: 1000,
  fromLabels: [] as string[],
  toLabels: [] as string[],
};

const deps: EvalDeps = {
  freq: {
    add: async () => {},
    count: async () => 0,
    prune: async () => {},
  },
  getLabels: () => [],
  pushAndCheckWindow: () => ({ hit: false, counterparties: [], windowTxHashes: [] }),
};

function rule(when: RuleDsl['when']): RuleDsl {
  return {
    id: 'r',
    name: 'r',
    severity: 'P3',
    enabled: true,
    version: 1,
    when,
    then: { emit_alert: true },
  };
}

describe('compileRule.evaluate', () => {
  it('scalar > true', async () => {
    const r = compileRule(rule([{ field: 'amount_usdt', op: '>', value: 500 }]));
    expect(await r.evaluate(baseTx, deps)).toBe(true);
  });
  it('scalar > false', async () => {
    const r = compileRule(rule([{ field: 'amount_usdt', op: '>', value: 5000 }]));
    expect(await r.evaluate(baseTx, deps)).toBe(false);
  });
  it('== string', async () => {
    const r = compileRule(rule([{ field: 'chain', op: '==', value: 'eth' }]));
    expect(await r.evaluate(baseTx, deps)).toBe(true);
  });
  it('in array', async () => {
    const r = compileRule(rule([{ field: 'chain', op: 'in', value: ['eth', 'bsc'] }]));
    expect(await r.evaluate(baseTx, deps)).toBe(true);
  });
  it('contains on label array', async () => {
    const tx = { ...baseTx, fromLabels: ['Binance Hot 14'] };
    const r = compileRule(rule([{ field: 'from_labels', op: 'contains', value: 'Binance Hot 14' }]));
    expect(await r.evaluate(tx, deps)).toBe(true);
  });
  it('AND chain — all must hold', async () => {
    const r = compileRule(
      rule([
        { field: 'amount_usdt', op: '>', value: 500 },
        { field: 'chain', op: '==', value: 'eth' },
      ]),
    );
    expect(await r.evaluate(baseTx, deps)).toBe(true);
  });
  it('AND chain — one false → false', async () => {
    const r = compileRule(
      rule([
        { field: 'amount_usdt', op: '>', value: 500 },
        { field: 'chain', op: '==', value: 'btc' },
      ]),
    );
    expect(await r.evaluate(baseTx, deps)).toBe(false);
  });
  it('frequency condition consults freq.count', async () => {
    const count = vi.fn().mockResolvedValue(5);
    const r = compileRule(
      rule([{ type: 'frequency', window_minutes: 10, min_count: 3, group_by: 'from_addr' }]),
    );
    expect(await r.evaluate(baseTx, { ...deps, freq: { ...deps.freq, count } })).toBe(true);
    expect(count).toHaveBeenCalled();
  });
  it('counterparty_label hits when address has the label', async () => {
    const getLabels = vi.fn().mockReturnValue([
      { label: 'OFAC SDN', category: 'ofac', riskScore: 95 },
    ]);
    const r = compileRule(
      rule([{ type: 'counterparty_label', side: 'to', labels_any: ['OFAC SDN'] }]),
    );
    expect(await r.evaluate(baseTx, { ...deps, getLabels })).toBe(true);
  });
  it('repeat_to_same delegates to pushAndCheckWindow', async () => {
    const pushAndCheckWindow = vi.fn().mockReturnValue({ hit: true, counterparties: [], windowTxHashes: [] });
    const r = compileRule(rule([{ type: 'repeat_to_same', window_size: 5 }]));
    expect(await r.evaluate(baseTx, { ...deps, pushAndCheckWindow })).toBe(true);
    expect(pushAndCheckWindow).toHaveBeenCalled();
  });
});
