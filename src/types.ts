export type Chain = 'eth' | 'bsc' | 'btc';
export type Token = 'USDT' | 'BTC';
export type Direction = 'in' | 'out';

export type NormalizedTx = {
  chain: Chain;
  txHash: string;          // primary identifier, may include '#voutIndex' or '#logIndex' suffix
  blockNumber: number;
  timestamp: number;       // unix seconds
  from: string;            // lowercase
  to: string;              // lowercase
  token: Token;
  amountRaw: string;       // bigint string (no scaling)
  amountUsdt: number;
  replay?: boolean;        // true for backfilled txs; suppresses alerts during replay
  fromLabels?: string[];   // label NAMES only; full Label objects via getLabels()
  toLabels?: string[];
};

export type RawEvent =
  | {
      kind: 'evm-transfer';
      chain: 'eth' | 'bsc';
      txHash: string;
      logIndex: number;
      blockNumber: number;
      timestamp: number;
      from: string;
      to: string;
      valueRaw: string;
    }
  | {
      kind: 'btc-vout';
      chain: 'btc';
      txHash: string;
      voutIndex: number;
      blockNumber: number;
      timestamp: number;
      from: string;
      to: string;
      sats: string;
    };

export type Alert = {
  id: number;
  triggeredBy: NormalizedTx;
  rule: 'sender_repeats_to' | 'receiver_repeats_from';
  pivotAddress: string;
  counterparty: string;
  windowTxHashes: string[];
  createdAt: number;
};
