import type { NormalizedTx, RawEvent } from '../types.js';
import { decodeEvmTransfer } from './erc20.js';
import { decodeBtcVout } from './btc.js';
import { decodeTrc20Transfer } from './tron.js';
import { getLabels } from '../labels/lookup.js';

export async function decode(ev: RawEvent): Promise<NormalizedTx> {
  let base: NormalizedTx;
  if (ev.kind === 'evm-transfer') {
    base = decodeEvmTransfer(ev);
    base.source = 'block';
  } else if (ev.kind === 'evm-mempool-tx') {
    base = decodeEvmTransfer({ ...ev, kind: 'evm-transfer', source: undefined });
    base.source = 'mempool';
  } else if (ev.kind === 'tron-trc20-transfer') {
    base = await decodeTrc20Transfer(ev);
  } else {
    base = await decodeBtcVout(ev);
    base.source = 'block';
  }
  base.fromLabels = getLabels(base.chain, base.from).map((l) => l.label);
  base.toLabels = getLabels(base.chain, base.to).map((l) => l.label);
  return base;
}
