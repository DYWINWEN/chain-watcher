import { ethers } from 'ethers';
import { Ingestor } from './base.js';
import { getSetting, SETTINGS } from '../config.js';
import { bus, EVENTS, type ConfigChangedPayload } from '../utils/event-bus.js';
import { RpcPool, resolveWsUrls } from '../utils/rpc-pool.js';
import { decodeUsdtTransfer } from '../decoder/mempool-calldata.js';

function readContract(chain: 'eth' | 'bsc'): string {
  const cKey = chain === 'eth' ? SETTINGS.chain_eth_usdt : SETTINGS.chain_bsc_usdt;
  return (getSetting<string>(cKey, '') || '').toLowerCase();
}

function buildPool(chain: 'eth' | 'bsc'): RpcPool | null {
  const urls = resolveWsUrls(chain);
  return urls.length > 0 ? new RpcPool(urls) : null;
}

type SeenEntry = { ts: number };

export class EvmMempoolIngestor extends Ingestor {
  private provider: ethers.WebSocketProvider | null = null;
  private pool: RpcPool | null;
  private contract: string;
  private seen = new Map<string, SeenEntry>();
  private readonly SEEN_MAX = 10_000;
  private readonly SEEN_TTL_MS = 5 * 60 * 1000;
  private readonly configListener = (payload: ConfigChangedPayload) => {
    if (typeof payload.key !== 'string') return;
    if (!payload.key.startsWith(`chain.${this.chain}.`) && payload.key !== 'mempool.enabled') return;
    this.log.info({ key: payload.key }, 'config changed — reconnecting mempool ingestor');
    void this.kickReconnect();
  };

  constructor(chain: 'eth' | 'bsc') {
    super(`${chain}-mempool` as never);
    // The base class uses chain for logging. Override to keep it 'eth' but with a child log tag.
    Object.defineProperty(this, 'chain', { value: chain, writable: false });
    this.pool = buildPool(chain);
    this.contract = readContract(chain);
    bus.on(EVENTS.ConfigChanged, this.configListener);
  }

  override async stop(): Promise<void> {
    bus.off(EVENTS.ConfigChanged, this.configListener);
    await super.stop();
  }

  private async kickReconnect(): Promise<void> {
    this.pool = buildPool(this.chain as 'eth' | 'bsc');
    this.contract = readContract(this.chain as 'eth' | 'bsc');
    if (this.provider) {
      try { await this.provider.destroy(); } catch { /* ignore */ }
      this.provider = null;
    }
  }

  private remember(hash: string): boolean {
    const now = Date.now();
    const hit = this.seen.get(hash);
    if (hit && now - hit.ts < this.SEEN_TTL_MS) return false;
    this.seen.set(hash, { ts: now });
    // Bound size — LRU by insertion order.
    while (this.seen.size > this.SEEN_MAX) {
      const first = this.seen.keys().next().value;
      if (first === undefined) break;
      this.seen.delete(first);
    }
    return true;
  }

  async connect(): Promise<void> {
    if (this.stopped) return;
    const mempoolEnabled = getSetting<boolean>('mempool.enabled' as any, false);
    if (!mempoolEnabled) {
      this.log.info('mempool.enabled = false; skipping');
      throw new Error('mempool disabled');
    }
    if (!this.pool || !this.contract) {
      this.log.warn({ poolSize: this.pool?.size() ?? 0, contract: this.contract }, 'missing pool/contract');
      throw new Error('missing chain config');
    }
    const wsUrl = this.pool.current();
    this.log.info({ wsUrl, contract: this.contract }, 'mempool: connecting');
    this.provider = new ethers.WebSocketProvider(wsUrl);

    let wsErrored: Error | null = null;
    const wsClosed = new Promise<void>((resolve) => {
      const ws = (this.provider as any)?.websocket;
      if (!ws || typeof ws.on !== 'function') return;
      ws.on('error', (err: Error) => { wsErrored = err; this.log.warn({ err: err.message, wsUrl }, 'mempool ws error'); resolve(); });
      ws.on('close', () => { this.log.warn({ wsUrl }, 'mempool ws closed'); resolve(); });
    });

    try {
      // ethers WebSocketProvider exposes the 'pending' subscription via .on('pending', cb).
      this.provider.on('pending', async (txHash: string) => {
        try {
          await this.handlePending(txHash);
        } catch (err) {
          this.log.warn({ err: (err as Error).message, txHash }, 'mempool handler error');
        }
      });
      await wsClosed;
      if (wsErrored) throw wsErrored;
    } finally {
      this.pool.next();
    }
  }

  async disconnect(): Promise<void> {
    if (this.provider) {
      try { await this.provider.destroy(); } catch { /* ignore */ }
      this.provider = null;
    }
  }

  private async handlePending(txHash: string): Promise<void> {
    if (!this.remember(txHash)) return;
    if (!this.provider) return;
    let tx;
    try {
      tx = await this.provider.getTransaction(txHash);
    } catch {
      return; // expired / replaced before we could fetch
    }
    if (!tx || !tx.to) return;
    if (tx.to.toLowerCase() !== this.contract) return;
    const decoded = decodeUsdtTransfer(tx.data ?? (tx as any).input ?? '');
    if (!decoded) return;
    await this.enqueue({
      kind: 'evm-mempool-tx',
      chain: this.chain as 'eth' | 'bsc',
      txHash,
      logIndex: 0,
      blockNumber: 0,
      timestamp: Math.floor(Date.now() / 1000),
      from: tx.from.toLowerCase(),
      to: decoded.to,
      valueRaw: decoded.value,
      source: 'mempool',
    });
  }
}
