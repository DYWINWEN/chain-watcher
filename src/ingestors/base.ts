import { getDb } from '../storage/db.js';
import { logger, type Logger } from '../utils/logger.js';
import { bus, EVENTS } from '../utils/event-bus.js';
import { exponentialBackoff, sleep } from '../utils/reconnect.js';
import { rawTxQueue } from '../queues/index.js';
import { safeJobId } from '../queues/job-id.js';
import type { Chain, RawEvent } from '../types.js';

export abstract class Ingestor {
  protected readonly log: Logger;
  protected stopped = false;
  private connectAttempts = 0;
  private readonly maxConnectAttempts = 12;

  constructor(public readonly chain: Chain) {
    this.log = logger.child({ ingestor: chain });
  }

  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;

  async start(): Promise<void> {
    this.stopped = false;
    const nextDelay = exponentialBackoff({ initialMs: 1000, maxMs: 30_000 });
    while (!this.stopped) {
      try {
        await this.connect();
        this.connectAttempts = 0;
        // connect() blocks until the connection drops; we loop and reconnect.
      } catch (err) {
        this.connectAttempts += 1;
        this.log.warn({ err: (err as Error).message, attempt: this.connectAttempts }, 'connect failed');
        if (this.connectAttempts >= this.maxConnectAttempts) {
          bus.emit(EVENTS.IngestorDown, { chain: this.chain });
          this.log.error({ attempts: this.connectAttempts }, 'ingestor down — giving up');
          break;
        }
      }
      if (this.stopped) break;
      await sleep(nextDelay());
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    try {
      await this.disconnect();
    } catch (err) {
      this.log.warn({ err: (err as Error).message }, 'disconnect error');
    }
  }

  protected async enqueue(ev: RawEvent): Promise<void> {
    try {
      // Include the sub-event index (logIndex for EVM, voutIndex for BTC) so
      // multiple events from the same tx aren't deduplicated by jobId.
      const subIndex = ev.kind === 'evm-transfer' || ev.kind === 'evm-mempool-tx' ? ev.logIndex : ev.voutIndex;
      await rawTxQueue.add('raw', ev, { jobId: safeJobId(ev.chain, ev.txHash, subIndex) });
    } catch (err) {
      this.log.warn({ err: (err as Error).message }, 'enqueue failed');
    }
  }

  protected saveCheckpoint(block: number): void {
    const db = getDb();
    const now = Math.floor(Date.now() / 1000);
    db.prepare(
      `INSERT INTO checkpoints (chain, last_block, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(chain) DO UPDATE SET last_block = excluded.last_block, updated_at = excluded.updated_at
         WHERE excluded.last_block > checkpoints.last_block`,
    ).run(this.chain, block, now);
  }

  protected getCheckpoint(): number {
    const db = getDb();
    const row = db.prepare('SELECT last_block FROM checkpoints WHERE chain = ?').get(this.chain) as
      | { last_block: number }
      | undefined;
    return row?.last_block ?? 0;
  }
}
