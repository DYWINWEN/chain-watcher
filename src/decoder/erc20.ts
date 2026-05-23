import { getSetting, SETTINGS } from '../config.js';
import type { NormalizedTx, RawEvent } from '../types.js';

function decimalsFor(chain: 'eth' | 'bsc'): number {
  // Mainnet USDT: ETH = 6, BSC = 18.
  if (chain === 'eth') return 6;
  if (chain === 'bsc') return 18;
  return 18;
}

function scaledToUsdt(amountRaw: string, decimals: number): number {
  // USDT ~ $1 stable; divide by 10**decimals as float — precision OK for alert thresholds.
  const big = BigInt(amountRaw);
  const divisor = 10n ** BigInt(decimals);
  const whole = Number(big / divisor);
  const remainder = Number(big % divisor) / Number(divisor);
  return whole + remainder;
}

export function decodeEvmTransfer(ev: Extract<RawEvent, { kind: 'evm-transfer' }>): NormalizedTx {
  const decimals = decimalsFor(ev.chain);
  const amountUsdt = scaledToUsdt(ev.valueRaw, decimals);
  // Composite hash so multiple Transfer logs in same tx don't collide on (chain, tx_hash).
  const txHash = `${ev.txHash}#${ev.logIndex}`;
  return {
    chain: ev.chain,
    txHash,
    blockNumber: ev.blockNumber,
    timestamp: ev.timestamp,
    from: ev.from.toLowerCase(),
    to: ev.to.toLowerCase(),
    token: 'USDT',
    amountRaw: ev.valueRaw,
    amountUsdt,
  };
}

export function usdtContractFor(chain: 'eth' | 'bsc'): string {
  const key = chain === 'eth' ? SETTINGS.chain_eth_usdt : SETTINGS.chain_bsc_usdt;
  return (getSetting<string>(key, '') || '').toLowerCase();
}
