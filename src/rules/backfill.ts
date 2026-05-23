import pLimit from 'p-limit';
import { ethers } from 'ethers';
import { getSetting, SETTINGS } from '../config.js';
import { logger } from '../utils/logger.js';
import type { Chain, Direction, NormalizedTx } from '../types.js';
import { isBackfilled, markBackfilled } from './window-store.js';
import { decodeEvmTransfer } from '../decoder/erc20.js';
import { btcTxToRawEvents, type BtcTx } from '../decoder/btc.js';
import { decodeBtcVout } from '../decoder/btc.js';

const inFlight = new Set<string>();
const limit = pLimit(getSetting<number>(SETTINGS.backfill_concurrency, 2) || 2);

const TRANSFER_TOPIC = ethers.id('Transfer(address,address,uint256)');

function key(chain: Chain, address: string, direction: Direction): string {
  return `${chain}:${address}:${direction}`;
}

/** Fire-and-forget. Idempotent via the in-flight set + windows.backfilled flag. */
export function scheduleBackfill(chain: Chain, address: string, direction: Direction): void {
  const k = key(chain, address, direction);
  if (inFlight.has(k)) return;
  if (isBackfilled(chain, address, direction)) return;
  inFlight.add(k);
  limit(() => runBackfill(chain, address, direction))
    .catch((err) => logger.warn({ err: (err as Error).message, k }, 'backfill failed'))
    .finally(() => inFlight.delete(k));
}

async function runBackfill(chain: Chain, address: string, direction: Direction): Promise<void> {
  if ((chain === 'eth' || chain === 'bsc') && !ethers.isAddress(address)) {
    logger.warn({ chain, address }, 'backfill: skipping non-EVM address');
    return;
  }
  const N = getSetting<number>(SETTINGS.backfill_history_window, 5);
  let replayed: NormalizedTx[] = [];
  if (chain === 'eth' || chain === 'bsc') {
    replayed = await backfillEvm(chain, address, direction, N);
  } else if (chain === 'btc') {
    replayed = await backfillBtc(address, direction, N);
  }
  // Mark before replay so the engine's own scheduleBackfill calls during replay short-circuit.
  markBackfilled(chain, address, direction);
  // Lazily import to avoid a circular dep at module-load time (engine imports backfill).
  const { onNormalizedTx } = await import('./engine.js');
  for (const tx of replayed) {
    tx.replay = true;
    try {
      await onNormalizedTx(tx);
    } catch (err) {
      logger.warn({ err: (err as Error).message, txHash: tx.txHash }, 'replay tx failed');
    }
  }
  logger.debug({ chain, address, direction, count: replayed.length }, 'backfill complete');
}

async function backfillEvm(
  chain: 'eth' | 'bsc',
  address: string,
  direction: Direction,
  limitCount: number,
): Promise<NormalizedTx[]> {
  const wsKey = chain === 'eth' ? SETTINGS.chain_eth_ws_url : SETTINGS.chain_bsc_ws_url;
  const usdtKey = chain === 'eth' ? SETTINGS.chain_eth_usdt : SETTINGS.chain_bsc_usdt;
  const wsUrl = getSetting<string>(wsKey, '');
  const usdt = getSetting<string>(usdtKey, '');
  if (!wsUrl || !usdt) return [];
  const provider = wsUrl.startsWith('ws')
    ? new ethers.WebSocketProvider(wsUrl)
    : new ethers.JsonRpcProvider(wsUrl);
  // Defensive: ethers' embedded `ws` can emit 'error' synchronously during handshake;
  // attach a no-op listener so the process doesn't crash on transient backfill failure.
  const ws = (provider as any)?.websocket;
  if (ws && typeof ws.on === 'function') {
    ws.on('error', () => {
      // swallow — outer try/catch on provider call will surface as a rejected promise
    });
  }
  try {
    // Defense-in-depth: the outer runBackfill guard should have caught this first;
    // this stays here in case backfillEvm is ever called directly in a future refactor.
    if (!ethers.isAddress(address)) {
      logger.warn({ chain, address }, 'backfill: skipping non-EVM address');
      return [];
    }
    const latest = await provider.getBlockNumber();
    // Keep under common public-RPC caps: PublicNode allows up to 50k blocks
    // per eth_getLogs call; Ankr / drpc.org sit around the same range. 9,900 gives
    // a comfortable safety margin (~1.5 days on ETH at 12s blocks; ~8h on BSC at 3s).
    // For an active address this is enough to find 5 historical transfers; if the
    // address is dormant the window stays unfilled, which is acceptable — operators
    // with paid RPC can lift this in M10/M14 once the setting is exposed.
    const lookback = 9_900;
    const fromBlock = Math.max(0, latest - lookback);
    const padded = ethers.zeroPadValue(address, 32);
    const topics: Array<string | null> =
      direction === 'out'
        ? [TRANSFER_TOPIC, padded, null]
        : [TRANSFER_TOPIC, null, padded];
    const logs = await provider.getLogs({
      address: usdt,
      fromBlock,
      toBlock: latest,
      topics,
    });
    const iface = new ethers.Interface([
      'event Transfer(address indexed from, address indexed to, uint256 value)',
    ]);
    // Most recent N
    const sliced = logs.slice(-limitCount);
    const out: NormalizedTx[] = [];
    for (const log of sliced) {
      const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
      if (!parsed) continue;
      const block = await provider.getBlock(log.blockNumber);
      const tx = decodeEvmTransfer({
        kind: 'evm-transfer',
        chain,
        txHash: log.transactionHash,
        logIndex: log.index,
        blockNumber: log.blockNumber,
        timestamp: block?.timestamp ?? Math.floor(Date.now() / 1000),
        from: parsed.args.from as string,
        to: parsed.args.to as string,
        valueRaw: (parsed.args.value as bigint).toString(),
      });
      out.push(tx);
    }
    return out;
  } finally {
    if ('destroy' in provider && typeof provider.destroy === 'function') {
      try {
        await provider.destroy();
      } catch {
        // ignore
      }
    }
  }
}

async function backfillBtc(
  address: string,
  direction: Direction,
  limitCount: number,
): Promise<NormalizedTx[]> {
  const apiBase = getSetting<string>(SETTINGS.chain_btc_api_base, 'https://mempool.space/api');
  const res = await fetch(`${apiBase}/address/${address}/txs`);
  if (!res.ok) throw new Error(`mempool ${address} ${res.status}`);
  const txs = (await res.json()) as BtcTx[];
  const out: NormalizedTx[] = [];
  for (const tx of txs.slice(0, 25)) {
    const events = btcTxToRawEvents(tx);
    for (const ev of events) {
      if (direction === 'out' && ev.from !== address) continue;
      if (direction === 'in' && ev.to !== address) continue;
      const norm = await decodeBtcVout(ev);
      out.push(norm);
    }
    if (out.length >= limitCount) break;
  }
  return out.slice(-limitCount);
}
