import { describe, it, expect } from 'vitest';
import { RuleDslSchema, parseRuleDsl } from '../src/rules/dsl/schema.js';

const validBase = {
  id: 'my_rule',
  name: 'My rule',
  severity: 'P2' as const,
  enabled: true,
  version: 1,
  when: [],
  then: { emit_alert: true },
};

describe('RuleDslSchema', () => {
  it('accepts a minimal valid rule', () => {
    const r = RuleDslSchema.safeParse(validBase);
    expect(r.success).toBe(true);
  });

  it('accepts a scalar condition', () => {
    const r = RuleDslSchema.safeParse({
      ...validBase,
      when: [{ field: 'amount_usdt', op: '>', value: 500 }],
    });
    expect(r.success).toBe(true);
  });

  it('rejects an unknown field', () => {
    const r = RuleDslSchema.safeParse({
      ...validBase,
      when: [{ field: 'not_a_field', op: '>', value: 500 }],
    });
    expect(r.success).toBe(false);
  });

  it('rejects an unknown operator', () => {
    const r = RuleDslSchema.safeParse({
      ...validBase,
      when: [{ field: 'amount_usdt', op: 'WIZARD', value: 500 }],
    });
    expect(r.success).toBe(false);
  });

  it('accepts a frequency compound condition', () => {
    const r = RuleDslSchema.safeParse({
      ...validBase,
      when: [{ type: 'frequency', window_minutes: 10, min_count: 3, group_by: 'from_addr' }],
    });
    expect(r.success).toBe(true);
  });

  it('rejects regex with catastrophic backtracking heuristic .*.*', () => {
    const r = RuleDslSchema.safeParse({
      ...validBase,
      when: [{ field: 'token', op: 'matches', value: '.*.*' }],
    });
    expect(r.success).toBe(false);
  });

  it('parseRuleDsl throws on invalid input with a descriptive message', () => {
    expect(() => parseRuleDsl({ id: 'x' })).toThrow();
  });
});
