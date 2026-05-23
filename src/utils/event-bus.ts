import { EventEmitter } from 'node:events';
import type { Chain } from '../types.js';

export const EVENTS = {
  ConfigChanged: 'config:changed',
  AlertNew: 'alert:new',
  TxNormalized: 'tx:normalized',
  IngestorDown: 'ingestor:down',
  LabelsChanged: 'labels:changed',
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
export type LabelsChangedPayload = { chain: Chain; address: string };

class TypedBus extends EventEmitter {}

export const bus = new TypedBus();
bus.setMaxListeners(50);
