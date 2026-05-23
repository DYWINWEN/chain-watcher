import type { NormalizedTx, RawEvent } from '../types.js';
import { decodeEvmTransfer } from './erc20.js';
import { decodeBtcVout } from './btc.js';

export async function decode(ev: RawEvent): Promise<NormalizedTx> {
  if (ev.kind === 'evm-transfer') return decodeEvmTransfer(ev);
  return decodeBtcVout(ev);
}
