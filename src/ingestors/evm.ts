import { ethers } from 'ethers';
import { Ingestor } from './base.js';
import { getSetting, SETTINGS } from '../config.js';
import { bus, EVENTS, type ConfigChangedPayload } from '../utils/event-bus.js';

const TRANSFER_TOPIC = ethers.id('Transfer(address,address,uint256)');

const iface = new ethers.Interface([
  'event Transfer(address indexed from, address indexed to, uint256 value)',
]);

type Cfg = { wsUrl: string; contract: string };

function readCfg(chain: 'eth' | 'bsc'): Cfg {
  const wsKey = chain === 'eth' ? SETTINGS.chain_eth_ws_url : SETTINGS.chain_bsc_ws_url;
  const cKey = chain === 'eth' ? SETTINGS.chain_eth_usdt : SETTINGS.chain_bsc_usdt;
  return {
    wsUrl: getSetting<string>(wsKey, ''),
    contract: (getSetting<string>(cKey, '') || '').toLowerCase(),
  };
}

export class EvmIngestor extends Ingestor {
  private provider: ethers.WebSocketProvider | null = null;
  private cfg: Cfg;
  private readonly configListener = (payload: ConfigChangedPayload) => {
    if (typeof payload.key !== 'string') return;
    if (!payload.key.startsWith(`chain.${this.chain}.`)) return;
    this.log.info({ key: payload.key }, 'config changed — reconnecting');
    void this.kickReconnect();
  };

  constructor(chain: 'eth' | 'bsc') {
    super(chain);
    this.cfg = readCfg(chain);
    bus.on(EVENTS.ConfigChanged, this.configListener);
  }

  override async stop(): Promise<void> {
    bus.off(EVENTS.ConfigChanged, this.configListener);
    await super.stop();
  }

  private async kickReconnect(): Promise<void> {
    this.cfg = readCfg(this.chain as 'eth' | 'bsc');
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
    if (!this.cfg.wsUrl || !this.cfg.contract) {
      this.log.warn({ cfg: this.cfg }, 'missing ws_url or usdt_contract — skip');
      throw new Error('missing chain config');
    }
    this.log.info({ wsUrl: this.cfg.wsUrl, contract: this.cfg.contract }, 'connecting');
    this.provider = new ethers.WebSocketProvider(this.cfg.wsUrl);

    // Attach error/close listeners synchronously so the underlying `ws` doesn't bubble
    // an unhandled 'error' event during the handshake (which crashes the process).
    let wsErrored: Error | null = null;
    const wsClosed = new Promise<void>((resolve) => {
      const ws = (this.provider as any)?.websocket;
      if (!ws || typeof ws.on !== 'function') return;
      ws.on('error', (err: Error) => {
        wsErrored = err;
        this.log.warn({ err: err.message }, 'ws error');
        resolve();
      });
      ws.on('close', () => {
        this.log.warn('ws closed');
        resolve();
      });
    });

    // Catch-up gap since last checkpoint.
    try {
      const fromCheckpoint = this.getCheckpoint();
      const latest = await this.provider.getBlockNumber();
      if (fromCheckpoint > 0 && latest > fromCheckpoint) {
        const start = Math.max(fromCheckpoint + 1, latest - 5_000); // cap replay window
        await this.replayRange(start, latest);
      }
      this.saveCheckpoint(latest);
    } catch (err) {
      throw wsErrored ?? err;
    }

    const filter = { address: this.cfg.contract, topics: [TRANSFER_TOPIC] };
    this.provider.on(filter, async (log) => {
      try {
        await this.handleLog(log as ethers.Log);
      } catch (err) {
        this.log.warn({ err: (err as Error).message }, 'log handler error');
      }
    });

    await wsClosed;
    if (wsErrored) throw wsErrored;
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
      address: this.cfg.contract,
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
      chain: this.chain as 'eth' | 'bsc',
      txHash: log.transactionHash,
      logIndex: log.index,
      blockNumber: log.blockNumber,
      timestamp: block?.timestamp ?? Math.floor(Date.now() / 1000),
      from: (parsed.args.from as string).toLowerCase(),
      to: (parsed.args.to as string).toLowerCase(),
      valueRaw: (parsed.args.value as bigint).toString(),
    });
    this.saveCheckpoint(log.blockNumber);
  }
}
