import type { AlertNewPayload } from '../utils/event-bus.js';

export type Severity = 'P1' | 'P2' | 'P3';

const SEV_ORDER: Record<Severity, number> = { P1: 3, P2: 2, P3: 1 };

const HIGH_RISK_CATS = new Set(['ofac', 'sanctions', 'mixer']);
const MED_RISK_CATS = new Set(['cex', 'bridge']);

/** True iff `actual` is at or above the `min` threshold (P1 > P2 > P3). */
export function compareSeverity(actual: Severity, min: Severity): boolean {
  return SEV_ORDER[actual] >= SEV_ORDER[min];
}

/** Policy: OFAC/sanctions/mixer OR amount >= 5000 → P1.
 *  CEX/bridge OR amount >= 500 → P2. Else P3. */
export function assignSeverity(
  payload: Pick<AlertNewPayload, 'amountUsdt' | 'pivotLabels' | 'counterpartyLabels'>,
): Severity {
  const cats = new Set<string>();
  for (const l of payload.pivotLabels ?? []) cats.add(l.category);
  for (const l of payload.counterpartyLabels ?? []) cats.add(l.category);

  for (const c of cats) if (HIGH_RISK_CATS.has(c)) return 'P1';
  if (payload.amountUsdt >= 5000) return 'P1';
  for (const c of cats) if (MED_RISK_CATS.has(c)) return 'P2';
  if (payload.amountUsdt >= 500) return 'P2';
  return 'P3';
}
