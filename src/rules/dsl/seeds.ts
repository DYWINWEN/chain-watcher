import type { RuleDsl } from './schema.js';

/** Built-in rules seeded on first launch. built_in=1 in the DB; UI hides delete. */
export const BUILT_IN_RULES: RuleDsl[] = [
  {
    id: 'sender_repeats_to',
    name: 'Sender repeats to same counterparty (×5)',
    severity: 'P2',
    enabled: true,
    version: 1,
    when: [
      { type: 'repeat_to_same', window_size: 5 },
    ],
    then: { emit_alert: true },
  },
  {
    id: 'receiver_repeats_from',
    name: 'Receiver gathers from same source (×5)',
    severity: 'P2',
    enabled: true,
    version: 1,
    when: [
      { type: 'repeat_from_same', window_size: 5 },
    ],
    then: { emit_alert: true },
  },
];
