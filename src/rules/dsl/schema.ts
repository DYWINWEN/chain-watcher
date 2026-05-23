import { z } from 'zod';

const FIELD = z.enum([
  'amount_usdt',
  'amount_raw',
  'chain',
  'direction',
  'from_addr',
  'to_addr',
  'token',
  'block_number',
  'timestamp',
  'from_labels',
  'to_labels',
  'source',
]);

const OP = z.enum(['>', '<', '>=', '<=', '==', '!=', 'in', 'not_in', 'contains', 'matches']);

const RE_DOS_PAT = /\.\*\.\*|\(\.\+\)\+|\(\.\*\)\+|\(\.\+\)\*|\(\.\*\)\*/;

const ScalarCondition = z
  .object({
    field: FIELD,
    op: OP,
    value: z.union([z.string(), z.number(), z.boolean(), z.array(z.union([z.string(), z.number()]))]),
  })
  .refine(
    (c) => {
      if (c.op !== 'matches') return true;
      if (typeof c.value !== 'string') return false;
      return !RE_DOS_PAT.test(c.value);
    },
    { message: 'unsafe regex pattern (catastrophic-backtracking shape)' },
  );

const FrequencyCondition = z.object({
  type: z.literal('frequency'),
  window_minutes: z.number().int().min(1).max(7 * 24 * 60),
  min_count: z.number().int().min(1).max(10_000),
  group_by: z.enum(['from_addr', 'to_addr']),
});

const CounterpartyLabelCondition = z.object({
  type: z.literal('counterparty_label'),
  side: z.enum(['from', 'to']),
  labels_any: z.array(z.string().min(1)).min(1),
});

const RepeatToSameCondition = z.object({
  type: z.literal('repeat_to_same'),
  window_size: z.number().int().min(2).max(20),
});

const RepeatFromSameCondition = z.object({
  type: z.literal('repeat_from_same'),
  window_size: z.number().int().min(2).max(20),
});

export const ConditionSchema = z.union([
  ScalarCondition,
  FrequencyCondition,
  CounterpartyLabelCondition,
  RepeatToSameCondition,
  RepeatFromSameCondition,
]);

export const RuleDslSchema = z.object({
  id: z.string().regex(/^[a-z0-9_-]+$/, 'id must be [a-z0-9_-]+'),
  name: z.string().min(1).max(128),
  severity: z.enum(['P1', 'P2', 'P3']),
  enabled: z.boolean(),
  version: z.literal(1).default(1),
  when: z.array(ConditionSchema),
  then: z.object({ emit_alert: z.boolean() }),
});

export type RuleDsl = z.infer<typeof RuleDslSchema>;
export type Condition = z.infer<typeof ConditionSchema>;

export function parseRuleDsl(raw: unknown): RuleDsl {
  return RuleDslSchema.parse(raw);
}
