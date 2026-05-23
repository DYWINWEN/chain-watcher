export type Chain = 'eth' | 'bsc' | 'btc' | 'polygon' | 'tron';
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
  source?: 'block' | 'mempool';   // default 'block' when unset
};

export type RawEvent =
  | {
      kind: 'evm-transfer';
      chain: 'eth' | 'bsc' | 'polygon';
      txHash: string;
      logIndex: number;
      blockNumber: number;
      timestamp: number;
      from: string;
      to: string;
      valueRaw: string;
      source?: 'block';
    }
  | {
      kind: 'evm-mempool-tx';
      chain: 'eth' | 'bsc' | 'polygon';
      txHash: string;
      logIndex: number;
      blockNumber: number;
      timestamp: number;
      from: string;
      to: string;
      valueRaw: string;
      source: 'mempool';
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
    }
  | {
      kind: 'tron-trc20-transfer';
      chain: 'tron';
      txHash: string;        // 64-hex from TronGrid (no 0x prefix from upstream; we normalize)
      blockNumber: number;
      timestamp: number;
      from: string;          // Base58 address (case-sensitive — DO NOT lowercase)
      to: string;
      valueRaw: string;      // uint256 string in USDT 6-decimal units
      source?: 'block';
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
