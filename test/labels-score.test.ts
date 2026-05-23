import { describe, it, expect } from 'vitest';
import { CATEGORY_RISK, maxRiskScore } from '../src/labels/score.js';

describe('CATEGORY_RISK', () => {
  it('maps OFAC and mixer high, CEX low', () => {
    expect(CATEGORY_RISK.ofac).toBe(95);
    expect(CATEGORY_RISK.sanctions).toBe(95);
    expect(CATEGORY_RISK.mixer).toBe(80);
    expect(CATEGORY_RISK.bridge).toBe(40);
    expect(CATEGORY_RISK.cex).toBe(10);
    expect(CATEGORY_RISK.project).toBe(5);
    expect(CATEGORY_RISK.user).toBe(0);
  });
});

describe('maxRiskScore', () => {
  it('returns 0 for empty input', () => {
    expect(maxRiskScore([])).toBe(0);
  });
  it('returns max across multiple labels', () => {
    expect(maxRiskScore([{ category: 'cex' }, { category: 'mixer' }, { category: 'project' }])).toBe(80);
  });
});
