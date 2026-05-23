import { Worker } from 'bullmq';
import { connection, RAW_TX_QUEUE, normalizedTxQueue } from '../queues/index.js';
import { decode } from '../decoder/index.js';
import { getSetting, SETTINGS } from '../config.js';
import { logger } from '../utils/logger.js';
import type { RawEvent } from '../types.js';

let worker: Worker<RawEvent> | null = null;

export async function startDecoderWorker(): Promise<void> {
  if (worker) return;
  const concurrency = Number(getSetting<number>(SETTINGS.decoder_concurrency, 8)) || 8;
  worker = new Worker<RawEvent>(
    RAW_TX_QUEUE,
    async (job) => {
      const tx = await decode(job.data);
      await normalizedTxQueue.add('norm', tx, { jobId: `${tx.chain}:${tx.txHash}` });
    },
    { connection, concurrency },
  );
  worker.on('failed', (job, err) =>
    logger.warn({ jobId: job?.id, err: err.message }, 'decoder job failed'),
  );
  logger.info({ concurrency }, 'decoder worker up');
}

export async function stopDecoderWorker(): Promise<void> {
  if (!worker) return;
  await worker.close();
  worker = null;
}
