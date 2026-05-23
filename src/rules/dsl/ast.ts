import type { Condition, RuleDsl } from './schema.js';
import type { Chain, NormalizedTx } from '../../types.js';

export type EvalDeps = {
  freq: {
    add: (chain: Chain, group: string, ts: number, txHash: string) => Promise<void>;
    count: (chain: Chain, group: string, windowSeconds: number) => Promise<number>;
    prune: (chain: Chain, group: string, olderThanSeconds: number) => Promise<void>;
  };
  getLabels: (chain: Chain, address: string) => Array<{ label: string; category: string; riskScore: number }>;
  pushAndCheckWindow: (
    chain: Chain,
    address: string,
    direction: 'out' | 'in',
    counterparty: string,
    txHash: string,
    windowSize: number,
  ) => { hit: boolean; counterparties: string[]; windowTxHashes: string[] };
};

const RX_TIMEOUT_MS = 50;

function readField(tx: NormalizedTx, field: string): unknown {
  switch (field) {
    case 'amount_usdt': return tx.amountUsdt;
    case 'amount_raw': return tx.amountRaw;
    case 'chain': return tx.chain;
    case 'from_addr': return tx.from;
    case 'to_addr': return tx.to;
    case 'token': return tx.token;
    case 'block_number': return tx.blockNumber;
    case 'timestamp': return tx.timestamp;
    case 'from_labels': return tx.fromLabels ?? [];
    case 'to_labels': return tx.toLabels ?? [];
    case 'source': return (tx as NormalizedTx & { source?: string }).source ?? 'block';
    case 'direction': return (tx as NormalizedTx & { _direction?: string })._direction ?? 'out';
    default: return undefined;
  }
}

function timeoutRegexTest(pattern: string, input: string): boolean {
  // Synchronous regex with a wall-clock guard. We compile then test; if the test
  // hasn't returned in RX_TIMEOUT_MS we report false. Since RegExp is sync in JS
  // we cannot truly interrupt it — this guard relies on the zod ReDoS heuristic
  // having already blocked the worst shapes. We measure elapsed and warn if slow.
  try {
    const re = new RegExp(pattern);
    const start = Date.now();
    const res = re.test(input);
    if (Date.now() - start > RX_TIMEOUT_MS) {
      return false;
    }
    return res;
  } catch {
    return false;
  }
}

function scalarOp(op: string, lhs: unknown, rhs: unknown): boolean {
  switch (op) {
    case '>': return Number(lhs) > Number(rhs);
    case '<': return Number(lhs) < Number(rhs);
    case '>=': return Number(lhs) >= Number(rhs);
    case '<=': return Number(lhs) <= Number(rhs);
    case '==': return lhs == rhs;  
    case '!=': return lhs != rhs;  
    case 'in':
      if (!Array.isArray(rhs)) return false;
      return rhs.includes(lhs as never);
    case 'not_in':
      if (!Array.isArray(rhs)) return true;
      return !rhs.includes(lhs as never);
    case 'contains':
      if (Array.isArray(lhs)) return lhs.includes(rhs as never);
      if (typeof lhs === 'string') return lhs.includes(String(rhs));
      return false;
    case 'matches':
      if (typeof lhs !== 'string' || typeof rhs !== 'string') return false;
      return timeoutRegexTest(rhs, lhs);
    default:
      return false;
  }
}

export async function evaluateCondition(
  c: Condition,
  tx: NormalizedTx,
  deps: EvalDeps,
  _rule: RuleDsl,
): Promise<boolean> {
  if ('field' in c) {
    return scalarOp(c.op, readField(tx, c.field), c.value);
  }
  if (c.type === 'frequency') {
    const groupValue = c.group_by === 'from_addr' ? tx.from : tx.to;
    const n = await deps.freq.count(tx.chain, `${c.group_by}:${groupValue}`, c.window_minutes * 60);
    return n >= c.min_count;
  }
  if (c.type === 'counterparty_label') {
    const addr = c.side === 'from' ? tx.from : tx.to;
    const labels = deps.getLabels(tx.chain, addr);
    const want = new Set(c.labels_any);
    return labels.some((l) => want.has(l.label));
  }
  if (c.type === 'repeat_to_same') {
    const res = deps.pushAndCheckWindow(tx.chain, tx.from, 'out', tx.to, tx.txHash, c.window_size);
    return res.hit;
  }
  if (c.type === 'repeat_from_same') {
    const res = deps.pushAndCheckWindow(tx.chain, tx.to, 'in', tx.from, tx.txHash, c.window_size);
    return res.hit;
  }
  return false;
}

export async function evaluateRule(
  rule: RuleDsl,
  tx: NormalizedTx,
  deps: EvalDeps,
): Promise<boolean> {
  // AND-chain: all conditions must be true.
  for (const c of rule.when) {
    const ok = await evaluateCondition(c, tx, deps, rule);
    if (!ok) return false;
  }
  return true;
}
