import type { NormalizedTx, RawEvent } from '../types.js';
import { decodeEvmTransfer } from './erc20.js';
import { decodeBtcVout } from './btc.js';
import { getLabels } from '../labels/lookup.js';

export async function decode(ev: RawEvent): Promise<NormalizedTx> {
  const base = ev.kind === 'evm-transfer' ? decodeEvmTransfer(ev) : await decodeBtcVout(ev);
  base.fromLabels = getLabels(base.chain, base.from).map((l) => l.label);
  base.toLabels = getLabels(base.chain, base.to).map((l) => l.label);
  return base;
}
