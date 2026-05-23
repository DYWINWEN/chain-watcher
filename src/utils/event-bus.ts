import { EventEmitter } from 'node:events';

export const EVENTS = {
  ConfigChanged: 'config:changed',
  AlertNew: 'alert:new',
  TxNormalized: 'tx:normalized',
  IngestorDown: 'ingestor:down',
} as const;

export type ConfigChangedPayload = { key: string; value: unknown };
export type AlertNewPayload = {
  id: number;
  chain: string;
  rule: string;
  pivotAddress: string;
  counterparty: string;
  triggerTxHash: string;
  windowTxHashes: string[];
  amountUsdt: number;
  createdAt: number;
};

class TypedBus extends EventEmitter {}

export const bus = new TypedBus();
bus.setMaxListeners(50);
