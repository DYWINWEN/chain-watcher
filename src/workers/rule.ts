import { Worker } from 'bullmq';
import { connection, NORMALIZED_TX_QUEUE } from '../queues/index.js';
import { onNormalizedTx } from '../rules/engine.js';
import { getSetting, SETTINGS } from '../config.js';
import { logger } from '../utils/logger.js';
import type { NormalizedTx } from '../types.js';

let worker: Worker<NormalizedTx> | null = null;

export async function startRuleWorker(): Promise<void> {
  if (worker) return;
  const concurrency = Number(getSetting<number>(SETTINGS.rule_concurrency, 4)) || 4;
  worker = new Worker<NormalizedTx>(
    NORMALIZED_TX_QUEUE,
    async (job) => {
      await onNormalizedTx(job.data);
    },
    { connection, concurrency },
  );
  worker.on('failed', (job, err) =>
    logger.warn({ jobId: job?.id, err: err.message }, 'rule job failed'),
  );
  logger.info({ concurrency }, 'rule worker up');
}

export async function stopRuleWorker(): Promise<void> {
  if (!worker) return;
  await worker.close();
  worker = null;
}
