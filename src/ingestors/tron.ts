import { Ingestor } from './base.js';
import { getSetting, SETTINGS } from '../config.js';
import { bus, EVENTS, type ConfigChangedPayload } from '../utils/event-bus.js';
import { sleep } from '../utils/reconnect.js';
import type { Chain } from '../types.js';

type EventRow = {
  block_number: number;
  block_timestamp: number;
  transaction_id: string;
  event_name: string;
  result: { from?: string; to?: string; value?: string; '0'?: string; '1'?: string; '2'?: string };
};

export class TronIngestor extends Ingestor {
  private apiBase = '';
  private contract = '';
  private intervalMs = 5000;
  private readonly seen = new Map<string, number>();
  private readonly SEEN_MAX = 5000;
  private readonly SEEN_TTL_MS = 60_000;
  private stopRequested = false;
  private readonly configListener = (payload: ConfigChangedPayload) => {
    if (typeof payload.key !== 'string') return;
    if (!payload.key.startsWith('chain.tron.')) return;
    this.log.info({ key: payload.key }, 'tron config changed');
    this.readCfg();
  };

  constructor() {
    super('tron' as Chain);
    this.readCfg();
    bus.on(EVENTS.ConfigChanged, this.configListener);
  }

  override async stop(): Promise<void> {
    this.stopRequested = true;
    bus.off(EVENTS.ConfigChanged, this.configListener);
    await super.stop();
  }

  private readCfg(): void {
    this.apiBase = (getSetting<string>(SETTINGS.chain_tron_api_base, 'https://api.trongrid.io') || '').replace(/\/$/, '');
    this.contract = getSetting<string>(SETTINGS.chain_tron_usdt, '');
    this.intervalMs = Number(getSetting<number>(SETTINGS.chain_tron_poll_interval_ms, 5000)) || 5000;
  }

  private remember(txId: string): boolean {
    const now = Date.now();
    const last = this.seen.get(txId);
    if (last !== undefined && now - last < this.SEEN_TTL_MS) return false;
    this.seen.set(txId, now);
    while (this.seen.size > this.SEEN_MAX) {
      const first = this.seen.keys().next().value;
      if (first === undefined) break;
      this.seen.delete(first);
    }
    return true;
  }

  /** Single poll cycle — exported for tests. */
  async fetchOnce(): Promise<void> {
    const enabled = getSetting<boolean>(SETTINGS.chain_tron_enabled, false);
    if (!enabled || !this.contract) return;
    const cursor = this.getCheckpoint();
    const url =
      `${this.apiBase}/v1/contracts/${encodeURIComponent(this.contract)}/events` +
      `?event_name=Transfer&limit=200&order_by=block_timestamp,desc` +
      (cursor > 0 ? `&min_block_timestamp=${cursor * 1000}` : '');
    let res: Response;
    try {
      res = await fetch(url, { headers: { Accept: 'application/json' } });
    } catch (err) {
      this.log.warn({ err: (err as Error).message }, 'tron fetch network error');
      return;
    }
    if (!res.ok) {
      this.log.warn({ status: res.status }, 'tron fetch non-2xx');
      return;
    }
    const body = (await res.json()) as { data?: EventRow[] };
    const events = body.data ?? [];
    let maxBlock = cursor;
    for (const e of events) {
      if (e.event_name !== 'Transfer') continue;
      if (!e.transaction_id || !e.block_number || !e.result) continue;
      if (e.block_number <= cursor) continue;
      const from = e.result.from ?? e.result['0'];
      const to = e.result.to ?? e.result['1'];
      const value = e.result.value ?? e.result['2'];
      if (!from || !to || !value) continue;
      if (!this.remember(e.transaction_id)) continue;
      await this.enqueue({
        kind: 'tron-trc20-transfer',
        chain: 'tron',
        txHash: e.transaction_id,
        blockNumber: e.block_number,
        timestamp: Math.floor(e.block_timestamp / 1000),
        from,
        to,
        valueRaw: value,
        source: 'block',
      });
      if (e.block_number > maxBlock) maxBlock = e.block_number;
    }
    if (maxBlock > cursor) this.saveCheckpoint(maxBlock);
  }

  async connect(): Promise<void> {
    const enabled = getSetting<boolean>(SETTINGS.chain_tron_enabled, false);
    if (!enabled) {
      this.log.info('tron disabled, skipping');
      throw new Error('tron disabled');
    }
    if (!this.contract) {
      throw new Error('missing tron config');
    }
    this.log.info(
      { apiBase: this.apiBase, contract: this.contract, intervalMs: this.intervalMs },
      'tron poll loop starting',
    );
    while (!this.stopRequested && !this.stopped) {
      try {
        await this.fetchOnce();
      } catch (err) {
        this.log.warn({ err: (err as Error).message }, 'tron fetchOnce error');
      }
      await sleep(this.intervalMs);
    }
  }

  async disconnect(): Promise<void> {
    this.stopRequested = true;
  }
}
