import type { Category } from './types.js';

export const CATEGORY_RISK: Record<Category, number> = {
  ofac: 95,
  sanctions: 95,
  mixer: 80,
  bridge: 40,
  cex: 10,
  project: 5,
  user: 0,
};

export function maxRiskScore(labels: Array<{ category: string }>): number {
  let max = 0;
  for (const l of labels) {
    const s = CATEGORY_RISK[l.category as Category] ?? 0;
    if (s > max) max = s;
  }
  return max;
}
