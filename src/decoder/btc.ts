import type { NormalizedTx, RawEvent } from '../types.js';
import { getPrice } from './price-oracle.js';

export async function decodeBtcVout(ev: Extract<RawEvent, { kind: 'btc-vout' }>): Promise<NormalizedTx> {
  const price = await getPrice('BTCUSDT');
  const btc = Number(BigInt(ev.sats)) / 1e8;
  const amountUsdt = btc * price;
  const txHash = `${ev.txHash}#${ev.voutIndex}`;
  return {
    chain: 'btc',
    txHash,
    blockNumber: ev.blockNumber,
    timestamp: ev.timestamp,
    from: ev.from.toLowerCase(),
    to: ev.to.toLowerCase(),
    token: 'BTC',
    amountRaw: ev.sats,
    amountUsdt,
  };
}

/**
 * Mempool.space tx shape (subset). vouts whose address matches vin[0].prevout.address are
 * treated as change and dropped — a coarse but useful filter to keep self-transfers out of windows.
 */
export type BtcTx = {
  txid: string;
  status: { confirmed: boolean; block_height?: number; block_time?: number };
  vin: Array<{ prevout?: { scriptpubkey_address?: string } | null }>;
  vout: Array<{
    scriptpubkey_address?: string;
    scriptpubkey_type?: string;
    value: number;
  }>;
};

export function btcTxToRawEvents(tx: BtcTx): Array<Extract<RawEvent, { kind: 'btc-vout' }>> {
  const from = tx.vin[0]?.prevout?.scriptpubkey_address ?? '';
  if (!from) return [];
  const blockNumber = tx.status.block_height ?? 0;
  const timestamp = tx.status.block_time ?? Math.floor(Date.now() / 1000);
  const out: Array<Extract<RawEvent, { kind: 'btc-vout' }>> = [];
  tx.vout.forEach((v, idx) => {
    if (!v.scriptpubkey_address) return; // OP_RETURN etc.
    if (v.scriptpubkey_address === from) return; // change heuristic
    out.push({
      kind: 'btc-vout',
      chain: 'btc',
      txHash: tx.txid,
      voutIndex: idx,
      blockNumber,
      timestamp,
      from,
      to: v.scriptpubkey_address,
      sats: String(v.value),
    });
  });
  return out;
}
