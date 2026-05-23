import WebSocket from 'ws';
import { Ingestor } from './base.js';
import { getSetting, SETTINGS } from '../config.js';
import { bus, EVENTS, type ConfigChangedPayload } from '../utils/event-bus.js';
import { RpcPool, resolveWsUrls } from '../utils/rpc-pool.js';
import { btcTxToRawEvents, type BtcTx } from '../decoder/btc.js';

export class BtcIngestor extends Ingestor {
  private ws: WebSocket | null = null;
  private apiBase = '';
  private pool: RpcPool | null = null;
  private readonly configListener = (payload: ConfigChangedPayload) => {
    if (typeof payload.key !== 'string') return;
    if (!payload.key.startsWith('chain.btc.')) return;
    this.log.info({ key: payload.key }, 'config changed — reconnecting');
    void this.disconnect();
  };

  constructor() {
    super('btc');
    bus.on(EVENTS.ConfigChanged, this.configListener);
  }

  override async stop(): Promise<void> {
    bus.off(EVENTS.ConfigChanged, this.configListener);
    await super.stop();
  }

  async connect(): Promise<void> {
    if (this.stopped) return;
    this.apiBase = getSetting<string>(SETTINGS.chain_btc_api_base, 'https://mempool.space/api');
    const urls = resolveWsUrls('btc');
    if (urls.length === 0) urls.push('wss://mempool.space/api/v1/ws');
    if (!this.pool || this.pool.size() !== urls.length) {
      this.pool = new RpcPool(urls);
    }
    const wsUrl = this.pool.current();
    this.log.info({ wsUrl, poolSize: this.pool.size() }, 'connecting');

    try {
      const ws = new WebSocket(wsUrl);
      this.ws = ws;

      const opened = new Promise<void>((resolve, reject) => {
        ws.once('open', () => resolve());
        ws.once('error', (err) => reject(err));
      });
      await opened;

      ws.send(JSON.stringify({ action: 'want', data: ['blocks'] }));

      ws.on('message', (raw) => {
        void this.handleMessage(raw.toString()).catch((err) =>
          this.log.warn({ err: (err as Error).message }, 'btc msg handler error'),
        );
      });

      await new Promise<void>((resolve) => {
        ws.once('close', () => {
          this.log.warn('btc ws closed');
          resolve();
        });
        ws.once('error', (err) => {
          this.log.warn({ err: err.message }, 'btc ws error');
          resolve();
        });
      });
    } finally {
      this.pool.next();
    }
  }

  async disconnect(): Promise<void> {
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
  }

  private async handleMessage(text: string): Promise<void> {
    let msg: any;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    const block = msg.block ?? msg.blocks?.[0];
    if (!block?.id) return;
    const blockHash = block.id as string;
    const blockHeight = block.height as number;
    this.saveCheckpoint(blockHeight);
    this.log.debug({ blockHash, blockHeight }, 'new btc block');

    let page = 0;
    // mempool.space paginates 25 txs per page; we cap to 4 pages = 100 txs to avoid runaway.
    while (page < 4) {
      const offset = page === 0 ? '' : `/${page * 25}`;
      const res = await fetch(`${this.apiBase}/block/${blockHash}/txs${offset}`);
      if (!res.ok) {
        this.log.warn({ status: res.status, page }, 'block txs fetch failed');
        break;
      }
      const txs = (await res.json()) as BtcTx[];
      if (txs.length === 0) break;
      for (const tx of txs) {
        const events = btcTxToRawEvents(tx);
        for (const ev of events) await this.enqueue(ev);
      }
      if (txs.length < 25) break;
      page += 1;
    }
  }
}
