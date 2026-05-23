import { describe, it, expect, beforeEach } from 'vitest';
import { btcTxToRawEvents, decodeBtcVout, type BtcTx } from '../src/decoder/btc.js';
import { __setPriceFetcher, clearPriceCache } from '../src/decoder/price-oracle.js';

beforeEach(() => {
  clearPriceCache();
  __setPriceFetcher(async () => 60000);
});

const sampleTx: BtcTx = {
  txid: '0xabc',
  status: { confirmed: true, block_height: 850000, block_time: 1700000000 },
  vin: [{ prevout: { scriptpubkey_address: 'bc1qsender' } }],
  vout: [
    { scriptpubkey_address: 'bc1qreceiver', scriptpubkey_type: 'v0_p2wpkh', value: 500000 }, // 0.005 BTC
    { scriptpubkey_address: 'bc1qsender', scriptpubkey_type: 'v0_p2wpkh', value: 1000 },     // change
    { scriptpubkey_type: 'op_return', value: 0 },                                            // OP_RETURN
  ],
};

describe('btc decoder', () => {
  it('drops change and OP_RETURN', () => {
    const events = btcTxToRawEvents(sampleTx);
    expect(events).toHaveLength(1);
    expect(events[0].to).toBe('bc1qreceiver');
    expect(events[0].sats).toBe('500000');
  });

  it('returns [] when vin has no address', () => {
    expect(btcTxToRawEvents({ ...sampleTx, vin: [{ prevout: null }] })).toEqual([]);
  });

  it('converts sats to USDT at oracle price', async () => {
    const ev = btcTxToRawEvents(sampleTx)[0];
    const norm = await decodeBtcVout(ev);
    // 0.005 BTC * 60000 USDT = 300 USDT
    expect(norm.amountUsdt).toBeCloseTo(300, 6);
    expect(norm.token).toBe('BTC');
    expect(norm.txHash).toBe('0xabc#0');
  });
});
