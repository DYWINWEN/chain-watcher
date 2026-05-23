import { Router } from 'express';
import { getDb } from '../storage/db.js';
import { getLabels } from '../labels/lookup.js';
import { CATEGORY_RISK } from '../labels/score.js';
import type { Chain } from '../types.js';

const CHAINS = new Set(['eth', 'bsc', 'btc', 'polygon', 'tron']);

export const graphRouter = Router();

type Edge = { source: string; target: string; txCount: number; totalUsdt: number; alertCount: number };
type Node = {
  id: string;
  chain: Chain;
  address: string;
  labels: string[];
  category: string | null;
  riskScore: number;
  isPivot: boolean;
  isLeaf: boolean;
  txCount: number;
};

function highestCategory(labels: Array<{ category: string }>): string | null {
  if (labels.length === 0) return null;
  // Sort by CATEGORY_RISK descending; return first.
  const sorted = [...labels].sort(
    (a, b) => (CATEGORY_RISK[b.category as never] ?? 0) - (CATEGORY_RISK[a.category as never] ?? 0),
  );
  return sorted[0].category;
}

function fetchCounterparties(
  chain: string,
  address: string,
  limit: number,
): Array<{ addr: string; txCount: number; totalUsdt: number }> {
  const db = getDb();
  // Outbound: addresses the pivot sent to
  const out = db
    .prepare(
      `SELECT to_addr AS addr, COUNT(*) AS n, COALESCE(SUM(amount_usdt), 0) AS total
         FROM tx WHERE chain = ? AND from_addr = ?
         GROUP BY to_addr`,
    )
    .all(chain, address) as Array<{ addr: string; n: number; total: number }>;
  // Inbound: addresses that sent to the pivot
  const incoming = db
    .prepare(
      `SELECT from_addr AS addr, COUNT(*) AS n, COALESCE(SUM(amount_usdt), 0) AS total
         FROM tx WHERE chain = ? AND to_addr = ?
         GROUP BY from_addr`,
    )
    .all(chain, address) as Array<{ addr: string; n: number; total: number }>;
  const merged = new Map<string, { addr: string; txCount: number; totalUsdt: number }>();
  for (const r of [...out, ...incoming]) {
    if (r.addr === address) continue;
    const cur = merged.get(r.addr);
    if (cur) {
      cur.txCount += r.n;
      cur.totalUsdt += r.total;
    } else {
      merged.set(r.addr, { addr: r.addr, txCount: r.n, totalUsdt: r.total });
    }
  }
  return [...merged.values()].sort((a, b) => b.totalUsdt - a.totalUsdt).slice(0, limit);
}

function fetchEdges(chain: string, addr1: string, addr2: string): Edge {
  const db = getDb();
  const ab = db
    .prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(amount_usdt), 0) AS total FROM tx
         WHERE chain = ? AND ((from_addr = ? AND to_addr = ?) OR (from_addr = ? AND to_addr = ?))`,
    )
    .get(chain, addr1, addr2, addr2, addr1) as { n: number; total: number };
  const ac = db
    .prepare(
      `SELECT COUNT(*) AS n FROM alerts
         WHERE chain = ? AND
               ((pivot_address = ? AND counterparty = ?) OR (pivot_address = ? AND counterparty = ?))`,
    )
    .get(chain, addr1, addr2, addr2, addr1) as { n: number };
  return {
    source: `${chain}|${addr1}`,
    target: `${chain}|${addr2}`,
    txCount: ab.n,
    totalUsdt: ab.total,
    alertCount: ac.n,
  };
}

function buildNode(chain: Chain, address: string, isPivot: boolean, txCount: number): Node {
  const labels = getLabels(chain, address);
  const cat = highestCategory(labels);
  return {
    id: `${chain}|${address}`,
    chain,
    address,
    labels: labels.map((l) => l.label),
    category: cat,
    riskScore: cat ? CATEGORY_RISK[cat as never] ?? 0 : 0,
    isPivot,
    isLeaf: cat === 'cex',
    txCount,
  };
}

graphRouter.get('/api/graph', (req, res): void => {
  const chain = String(req.query.chain ?? '').toLowerCase();
  const address = String(req.query.address ?? '');
  const depth = Math.min(Math.max(Number(req.query.depth) || 1, 1), 2);
  const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 50);
  if (!chain || !address) {
    res.status(400).json({ error: 'chain and address required' });
    return;
  }
  if (!CHAINS.has(chain)) {
    res.status(400).json({ error: 'unknown chain' });
    return;
  }

  // BFS
  const normAddr = chain === 'tron' || chain === 'btc' ? address : address.toLowerCase();
  const nodesById = new Map<string, Node>();
  const edges: Edge[] = [];
  const edgeKeys = new Set<string>();
  const pivot = buildNode(chain as Chain, normAddr, true, 0);
  nodesById.set(pivot.id, pivot);
  let frontier = [normAddr];
  for (let layer = 0; layer < depth; layer += 1) {
    const next: string[] = [];
    for (const seed of frontier) {
      const cps = fetchCounterparties(chain, seed, limit);
      for (const cp of cps) {
        const id = `${chain}|${cp.addr}`;
        if (!nodesById.has(id)) {
          const n = buildNode(chain as Chain, cp.addr, false, cp.txCount);
          nodesById.set(id, n);
          // CEX/leaf nodes don't get added to next frontier
          if (!n.isLeaf) next.push(cp.addr);
        }
        // Edge dedup — undirected pair key
        const key = [seed, cp.addr].sort().join('|');
        if (!edgeKeys.has(key)) {
          edgeKeys.add(key);
          edges.push(fetchEdges(chain, seed, cp.addr));
        }
      }
    }
    frontier = next;
  }

  res.json({
    pivot: { chain, address: normAddr },
    nodes: [...nodesById.values()],
    edges,
  });
});
