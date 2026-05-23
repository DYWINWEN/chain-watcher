import type { NormalizedTx, RawEvent } from '../types.js';

export async function decodeTrc20Transfer(
  ev: Extract<RawEvent, { kind: 'tron-trc20-transfer' }>,
): Promise<NormalizedTx> {
  // TRC20 USDT has 6 decimals; valueRaw is uint256 string in 6-decimal units.
  const amountUsdt = Number(ev.valueRaw) / 1e6;
  return {
    chain: 'tron',
    txHash: ev.txHash,
    blockNumber: ev.blockNumber,
    timestamp: ev.timestamp,
    from: ev.from,         // Base58 — preserve case
    to: ev.to,
    token: 'USDT',
    amountRaw: ev.valueRaw,
    amountUsdt,
    source: ev.source ?? 'block',
  };
}
