import { Queue, QueueEvents } from 'bullmq';
import { Redis } from 'ioredis';
import { logger } from '../utils/logger.js';
import type { RawEvent, NormalizedTx } from '../types.js';

const url = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';

export const connection = new Redis(url, { maxRetriesPerRequest: null });

connection.on('error', (err: Error) => logger.warn({ err: err.message }, 'redis connection error'));

export const RAW_TX_QUEUE = 'raw-tx';
export const NORMALIZED_TX_QUEUE = 'normalized-tx';

const defaultJobOptions = {
  removeOnComplete: 1000,
  removeOnFail: 5000,
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 1000 },
};

export const rawTxQueue = new Queue<RawEvent>(RAW_TX_QUEUE, { connection, defaultJobOptions });
export const normalizedTxQueue = new Queue<NormalizedTx>(NORMALIZED_TX_QUEUE, { connection, defaultJobOptions });

export const rawTxQueueEvents = new QueueEvents(RAW_TX_QUEUE, { connection: connection.duplicate() });
export const normalizedTxQueueEvents = new QueueEvents(NORMALIZED_TX_QUEUE, { connection: connection.duplicate() });

export async function closeQueues(): Promise<void> {
  await Promise.allSettled([
    rawTxQueue.close(),
    normalizedTxQueue.close(),
    rawTxQueueEvents.close(),
    normalizedTxQueueEvents.close(),
  ]);
  connection.disconnect();
}
