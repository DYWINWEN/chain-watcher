import { ethers } from 'ethers';
import { Ingestor } from './base.js';
import { getSetting, SETTINGS } from '../config.js';
import { bus, EVENTS, type ConfigChangedPayload } from '../utils/event-bus.js';
import { RpcPool, resolveWsUrls } from '../utils/rpc-pool.js';

const TRANSFER_TOPIC = ethers.id('Transfer(address,address,uint256)');

const iface = new ethers.Interface([
  'event Transfer(address indexed from, address indexed to, uint256 value)',
]);

function readContract(chain: 'eth' | 'bsc' | 'polygon'): string {
  const cKey =
    chain === 'eth' ? SETTINGS.chain_eth_usdt
    : chain === 'bsc' ? SETTINGS.chain_bsc_usdt
    : SETTINGS.chain_polygon_usdt;
  return (getSetting<string>(cKey, '') || '').toLowerCase();
}

function buildPool(chain: 'eth' | 'bsc' | 'polygon'): RpcPool | null {
  const urls = resolveWsUrls(chain);
  return urls.length > 0 ? new RpcPool(urls) : null;
}

export class EvmIngestor extends Ingestor {
  private provider: ethers.WebSocketProvider | null = null;
  private pool: RpcPool | null;
  private contract: string;
  private readonly configListener = (payload: ConfigChangedPayload) => {
    if (typeof payload.key !== 'string') return;
    if (!payload.key.startsWith(`chain.${this.chain}.`)) return;
    this.log.info({ key: payload.key }, 'config changed — reconnecting');
    void this.kickReconnect();
  };

  constructor(chain: 'eth' | 'bsc' | 'polygon') {
    super(chain);
    this.pool = buildPool(chain);
    this.contract = readContract(chain);
    bus.on(EVENTS.ConfigChanged, this.configListener);
  }

  override async stop(): Promise<void> {
    bus.off(EVENTS.ConfigChanged, this.configListener);
    await super.stop();
  }

  private async kickReconnect(): Promise<void> {
    this.pool = buildPool(this.chain as 'eth' | 'bsc' | 'polygon');
    this.contract = readContract(this.chain as 'eth' | 'bsc' | 'polygon');
    if (this.provider) {
      try {
        await this.provider.destroy();
      } catch {
        // ignore
      }
      this.provider = null;
    }
  }

  async connect(): Promise<void> {
    if (this.stopped) return;
    if (!this.pool || !this.contract) {
      this.log.warn({ poolSize: this.pool?.size() ?? 0, contract: this.contract }, 'missing ws urls or usdt_contract — skip');
      throw new Error('missing chain config');
    }
    const wsUrl = this.pool.current();
    this.log.info({ wsUrl, contract: this.contract, poolSize: this.pool.size() }, 'connecting');
    this.provider = new ethers.WebSocketProvider(wsUrl);

    // Attach error/close listeners synchronously so the underlying `ws` doesn't bubble
    // an unhandled 'error' event during the handshake (which crashes the process).
    let wsErrored: Error | null = null;
    const wsClosed = new Promise<void>((resolve) => {
      const ws = (this.provider as any)?.websocket;
      if (!ws || typeof ws.on !== 'function') return;
      ws.on('error', (err: Error) => {
        wsErrored = err;
        this.log.warn({ err: err.message, wsUrl }, 'ws error');
        resolve();
      });
      ws.on('close', () => {
        this.log.warn({ wsUrl }, 'ws closed');
        resolve();
      });
    });

    try {
      // Catch-up gap since last checkpoint.
      try {
        const fromCheckpoint = this.getCheckpoint();
        const latest = await this.provider.getBlockNumber();
        if (fromCheckpoint > 0 && latest > fromCheckpoint) {
          const start = Math.max(fromCheckpoint + 1, latest - 5_000); // cap replay window
          await this.replayRange(start, latest);
        }
        // Cold-start anchor: see fix(v2/M8) — anchor at latest-1 so future
        // reconnects always have a starting point even if no Transfer logs
        // arrive before the next disconnect.
        if (fromCheckpoint === 0) {
          this.saveCheckpoint(Math.max(0, latest - 1));
        }
      } catch (err) {
        throw wsErrored ?? err;
      }

      const filter = { address: this.contract, topics: [TRANSFER_TOPIC] };
      this.provider.on(filter, async (log) => {
        try {
          await this.handleLog(log as ethers.Log);
        } catch (err) {
          this.log.warn({ err: (err as Error).message }, 'log handler error');
        }
      });

      await wsClosed;
      if (wsErrored) throw wsErrored;
    } finally {
      // Always advance to the next URL after a cycle — sticky failures cost at
      // most one retry. With a single-URL pool this is a no-op rotation.
      this.pool.next();
    }
  }

  async disconnect(): Promise<void> {
    if (this.provider) {
      try {
        await this.provider.destroy();
      } catch {
        // ignore
      }
      this.provider = null;
    }
  }

  private async replayRange(fromBlock: number, toBlock: number): Promise<void> {
    if (!this.provider) return;
    const logs = await this.provider.getLogs({
      address: this.contract,
      topics: [TRANSFER_TOPIC],
      fromBlock,
      toBlock,
    });
    this.log.info({ fromBlock, toBlock, count: logs.length }, 'replaying gap');
    for (const log of logs) await this.handleLog(log);
  }

  private async handleLog(log: ethers.Log): Promise<void> {
    const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
    if (!parsed) return;
    const block = await this.provider!.getBlock(log.blockNumber);
    await this.enqueue({
      kind: 'evm-transfer',
      chain: this.chain as 'eth' | 'bsc' | 'polygon',
      txHash: log.transactionHash,
      logIndex: log.index,
      blockNumber: log.blockNumber,
      timestamp: block?.timestamp ?? Math.floor(Date.now() / 1000),
      from: (parsed.args.from as string).toLowerCase(),
      to: (parsed.args.to as string).toLowerCase(),
      valueRaw: (parsed.args.value as bigint).toString(),
      source: 'block',
    });
    this.saveCheckpoint(log.blockNumber);
  }
}
