# M17 — Counterparty Network Graph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** Replace the Watchlist's static counterparty table with an interactive Cytoscape.js graph — pivot at center, top-N counterparties as nodes, click to drill into the address drawer, double-click to expand depth.

**Architecture:** New `GET /api/graph` backend computes BFS over the `tx` table. Frontend lazy-loads Cytoscape from CDN, renders force-directed layout, applies category-color + edge-weight styling, wires click + dblclick interactions. No new tables, no new dependencies. Final v2 milestone.

**Tech Stack:** Existing — Express + better-sqlite3 + native fetch. Cytoscape.js loaded from CDN at runtime (HTML script tag).

---

## Prerequisites

- main HEAD M16 merged (128 / 128 passing)

---

## File structure (target end-state)

```
src/api/graph.ts                          ★ new
src/dashboard/server.ts                   ✎ mount graphRouter
src/dashboard/public/js/ui/graph.js       ★ new — Cytoscape wrapper
src/dashboard/public/js/pages/watchlist.js ✎ replace top-counterparty table with graph
src/dashboard/public/index.html           ✎ add cytoscape + cose-bilkent CDN script tags

test/
└── graph-api.test.ts                     ★ 4 cases
```

Target: **128 → 132 tests** (+4).

---

## Task 1: Graph API + 4 tests

**Files:** `src/api/graph.ts` (new), `src/dashboard/server.ts` (mount), `test/graph-api.test.ts` (new)

### Step 1: Baseline

```bash
cd ~/projects/chain-watcher
git status
git log --oneline -3
npm test 2>&1 | grep -E "Tests "
```

Expected: on `feat/v2-m17-network-graph`, 128/128.

### Step 2: Write tests

Create `test/graph-api.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let graphRouter: import('express').Router;
let getDb: typeof import('../src/storage/db.js').getDb;
let server: Server;
let port: number;

beforeEach(async () => {
  vi.resetModules();
  process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'cw-graph-')), 'cw.db');
  ({ getDb } = await import('../src/storage/db.js'));
  ({ graphRouter } = await import('../src/api/graph.js'));
  getDb();
  const app = express();
  app.use(express.json());
  app.use(graphRouter);
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  const addr = server.address();
  port = typeof addr === 'object' && addr ? addr.port : 0;
});

afterEach(() => new Promise<void>((r) => server.close(() => r())));

function url(p: string) { return `http://127.0.0.1:${port}${p}`; }

function insertTx(from: string, to: string, amount: number, blockNumber: number, txHash: string): void {
  const now = Math.floor(Date.now() / 1000);
  getDb().prepare(
    `INSERT INTO tx (chain, tx_hash, block_number, ts, from_addr, to_addr, token, amount_raw, amount_usdt)
       VALUES ('eth', ?, ?, ?, ?, ?, 'USDT', ?, ?)`,
  ).run(txHash, blockNumber, now, from, to, String(BigInt(Math.floor(amount * 1e6))), amount);
}

function insertLabel(addr: string, label: string, category: string): void {
  const now = Math.floor(Date.now() / 1000);
  getDb().prepare(
    `INSERT INTO labels (chain, address, label, category, source, risk_score, created_at, updated_at)
       VALUES ('eth', ?, ?, ?, 'user', 50, ?, ?)`,
  ).run(addr, label, category, now, now);
}

describe('GET /api/graph', () => {
  it('depth=1 returns pivot + top counterparties + edges', async () => {
    insertTx('0xpivot', '0xa', 100, 100, 'tx1');
    insertTx('0xpivot', '0xa', 200, 101, 'tx2');
    insertTx('0xpivot', '0xb', 50, 102, 'tx3');
    insertTx('0xc', '0xpivot', 75, 103, 'tx4');
    const r = await fetch(url('/api/graph?chain=eth&address=0xpivot&depth=1&limit=10'));
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.nodes.some((n: any) => n.address === '0xpivot' && n.isPivot)).toBe(true);
    const addrs = body.nodes.map((n: any) => n.address).sort();
    expect(addrs).toContain('0xa');
    expect(addrs).toContain('0xb');
    expect(addrs).toContain('0xc');
    expect(body.edges.length).toBeGreaterThanOrEqual(3);
    const aEdge = body.edges.find((e: any) => e.target.includes('0xa') || e.source.includes('0xa'));
    expect(aEdge.txCount).toBe(2);
    expect(aEdge.totalUsdt).toBe(300);
  });

  it('marks CEX-categorized counterparties as isLeaf', async () => {
    insertTx('0xpivot', '0xcex', 100, 100, 'tx1');
    insertLabel('0xcex', 'Binance Hot 14', 'cex');
    const body = await (await fetch(url('/api/graph?chain=eth&address=0xpivot&depth=1'))).json();
    const cexNode = body.nodes.find((n: any) => n.address === '0xcex');
    expect(cexNode).toBeDefined();
    expect(cexNode.isLeaf).toBe(true);
    expect(cexNode.category).toBe('cex');
  });

  it('depth=2 expands a level; CEX nodes do NOT contribute to frontier', async () => {
    // 0xpivot → 0xa → 0xa1
    // 0xpivot → 0xcex (leaf) → 0xshouldNotAppear
    insertTx('0xpivot', '0xa', 100, 100, 'tx1');
    insertTx('0xa', '0xa1', 50, 101, 'tx2');
    insertTx('0xpivot', '0xcex', 200, 102, 'tx3');
    insertTx('0xcex', '0xshouldNotAppear', 75, 103, 'tx4');
    insertLabel('0xcex', 'Binance Hot 14', 'cex');
    const body = await (await fetch(url('/api/graph?chain=eth&address=0xpivot&depth=2&limit=10'))).json();
    const addrs = body.nodes.map((n: any) => n.address);
    expect(addrs).toContain('0xa1');                  // expanded via non-leaf 0xa
    expect(addrs).not.toContain('0xshouldnotappear'); // 0xcex is leaf — no expansion
  });

  it('returns 400 on missing chain or address', async () => {
    const r1 = await fetch(url('/api/graph?address=0xa'));
    const r2 = await fetch(url('/api/graph?chain=eth'));
    expect(r1.status).toBe(400);
    expect(r2.status).toBe(400);
  });
});
```

### Step 3: Run, expect FAIL

```bash
npx vitest run test/graph-api.test.ts 2>&1 | tail -10
```

### Step 4: Implement

Create `src/api/graph.ts`:

```ts
import { Router } from 'express';
import { getDb } from '../storage/db.js';
import { getLabels } from '../labels/lookup.js';
import { CATEGORY_RISK } from '../notifiers/severity.js';
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
```

### Step 5: Mount

Open `src/dashboard/server.ts`. Add import:

```ts
import { graphRouter } from '../api/graph.js';
```

In `startDashboard()`, after `app.use(rulesRouter)`, add:

```ts
  app.use(graphRouter);
```

### Step 6: Verify

```bash
npx vitest run test/graph-api.test.ts 2>&1 | tail -15
npx tsc -p . --noEmit
npm test 2>&1 | tail -5
```

Expected: 4 / 4 in file; **132 / 132** overall.

### Step 7: Commit

```bash
git add src/api/graph.ts src/dashboard/server.ts test/graph-api.test.ts
git commit -m "feat(api): GET /api/graph — counterparty BFS over tx table

Pivot + per-layer BFS (depth 1-2, limit 1-50). Counterparties
merged across inbound + outbound directions, sorted by totalUsdt.
Edges aggregate tx count + total amount + alert count. Nodes
annotated with labels and the highest-risk category — category
'cex' marks the node as 'leaf' so it doesn't expand at depth+1
(prevents hub explosion).

4 unit tests cover depth=1 basics, CEX leaf marking, depth=2
expansion + leaf skipping, and 400 on missing inputs."
```

---

## Task 2: Cytoscape frontend wrapper

**Files:** `src/dashboard/public/index.html` (CDN scripts), `src/dashboard/public/js/ui/graph.js` (new)

### Step 1: Add Cytoscape CDN scripts

Open `src/dashboard/public/index.html`. Find the existing Chart.js script tag:

```html
    <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js"></script>
```

After it, add four more:

```html
    <script src="https://cdn.jsdelivr.net/npm/cytoscape@3.30.4/dist/cytoscape.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/layout-base@2.0.1/layout-base.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/cose-base@2.2.0/cose-base.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/cytoscape-cose-bilkent@4.1.0/cytoscape-cose-bilkent.js"></script>
```

### Step 2: Create graph.js wrapper

Create `src/dashboard/public/js/ui/graph.js`:

```js
// Cytoscape wrapper. Renders a force-directed counterparty graph in `container`.

export function renderGraph(container, data, opts = {}) {
  /* global cytoscape */
  container.innerHTML = '';
  if (typeof cytoscape === 'undefined') {
    container.textContent = 'Graph library not loaded.';
    return null;
  }

  const elements = [
    ...data.nodes.map((n) => ({ data: enrichNode(n) })),
    ...data.edges.map((e) => ({
      data: {
        id: `${e.source}->${e.target}`,
        source: e.source,
        target: e.target,
        txCount: e.txCount,
        totalUsdt: e.totalUsdt,
        alertCount: e.alertCount,
        strokeWidth: Math.min(8, 1 + Math.log2((e.txCount ?? 1) + 1) * 1.5),
        strokeColor: (e.alertCount ?? 0) > 0 ? '#f87171' : '#52525b',
      },
    })),
  ];

  const cy = cytoscape({
    container,
    elements,
    style: [
      {
        selector: 'node',
        style: {
          'background-color': 'data(color)',
          'label': 'data(displayLabel)',
          'color': '#fafafa',
          'font-size': '10px',
          'text-valign': 'bottom',
          'text-margin-y': 6,
          'width': 'data(size)',
          'height': 'data(size)',
          'border-width': 0,
        },
      },
      {
        selector: 'node[?isPivot]',
        style: { 'border-width': 3, 'border-color': '#5b6cff' },
      },
      {
        selector: 'edge',
        style: {
          'width': 'data(strokeWidth)',
          'line-color': 'data(strokeColor)',
          'curve-style': 'bezier',
          'target-arrow-shape': 'triangle',
          'target-arrow-color': 'data(strokeColor)',
          'opacity': 0.7,
        },
      },
    ],
    layout: { name: 'cose-bilkent', randomize: false, padding: 30 },
  });

  if (opts.onNodeClick) {
    cy.on('tap', 'node', (evt) => {
      opts.onNodeClick(evt.target.data());
    });
  }
  if (opts.onNodeDblClick) {
    cy.on('dblclick', 'node', (evt) => {
      opts.onNodeDblClick(evt.target.data());
    });
  }

  return cy;
}

function enrichNode(n) {
  const txc = n.txCount ?? 0;
  const size = n.isPivot ? 56 : 32 + Math.min(24, Math.log2(txc + 2) * 6);
  return {
    id: n.id,
    chain: n.chain,
    address: n.address,
    labels: n.labels ?? [],
    category: n.category,
    riskScore: n.riskScore ?? 0,
    isPivot: !!n.isPivot,
    isLeaf: !!n.isLeaf,
    txCount: txc,
    displayLabel: (n.labels && n.labels[0]) || shortHash(n.address),
    color: categoryColor(n.category),
    size,
  };
}

function categoryColor(cat) {
  if (cat === 'ofac' || cat === 'sanctions' || cat === 'mixer') return '#f87171';
  if (cat === 'cex') return '#22c55e';
  if (cat === 'bridge') return '#facc15';
  if (cat === 'project') return '#71717a';
  return '#a78bfa';
}

function shortHash(s) {
  if (typeof s !== 'string') return '';
  return s.length > 14 ? `${s.slice(0, 8)}…${s.slice(-4)}` : s;
}
```

### Step 3: Verify

```bash
node --check src/dashboard/public/js/ui/graph.js
npx tsc -p . --noEmit
npm test 2>&1 | tail -5
```

Expected: parse OK, clean, **132 / 132**.

### Step 4: Commit

```bash
git add src/dashboard/public/index.html src/dashboard/public/js/ui/graph.js
git commit -m "feat(dashboard/ui): Cytoscape graph wrapper + CDN scripts

* index.html — cytoscape@3.30 + cose-bilkent layout via CDN
* graph.js — renderGraph(container, data, opts) with category-color
  node fill, log-scaled node size + edge stroke, pivot border ring,
  alert-edge red highlight, tap + dblclick handlers"
```

---

## Task 3: Watchlist page integration

**Files:** `src/dashboard/public/js/pages/watchlist.js`

### Step 1: Update watchlist.js

Open `src/dashboard/public/js/pages/watchlist.js`. The current page (post-M11.2) renders a "Top counterparties" card with a table. Replace that card with the graph + add the dblclick-expand merge logic.

Find the section that renders top counterparties (look for a heading like "Top counterparties" or the variable `data.topCounterparties`). Replace it with:

```js
        <div class="card" style="margin-top:var(--sp-3);">
          <div style="display:flex; align-items:center; gap:var(--sp-3);">
            <strong>Counterparty graph</strong>
            <span class="muted" style="font-size:var(--fs-sm);">click a node to drill in · dbl-click to expand 1 level</span>
          </div>
          <div id="wl-graph" style="height: 420px; margin-top:var(--sp-3); background:var(--surface-2); border-radius:var(--r-md);"></div>
        </div>
```

At the top of the file, add:

```js
import { renderGraph } from '../ui/graph.js';
import { openDrawer, closeDrawer } from '../ui/drawer.js';
```

After the `renderDetail(...)` function, define an async helper that loads + renders the graph. Find where `renderDetail` is wired (likely inside the `lookup` async function in the watchlist page) and after the renderDetail call, append `await loadGraph(out, addr, chain)`:

```js
  async function loadGraph(container, address, chain) {
    const host = container.querySelector('#wl-graph');
    if (!host) return;
    host.innerHTML = '<div class="muted" style="padding:var(--sp-5); text-align:center;">Loading graph…</div>';
    let data;
    try {
      data = await apiGet(`/api/graph?chain=${chain}&address=${encodeURIComponent(address)}&depth=1&limit=10`);
    } catch { return; }
    if (data.nodes.length <= 1) {
      host.innerHTML = '<div class="muted" style="padding:var(--sp-5); text-align:center;">No counterparties yet.</div>';
      return;
    }
    let mergedData = data;
    const draw = () => renderGraph(host, mergedData, {
      onNodeClick: (n) => openNodeDrawer(n),
      onNodeDblClick: async (n) => {
        if (n.isLeaf || n.isPivot) return;
        try {
          const extra = await apiGet(`/api/graph?chain=${n.chain}&address=${encodeURIComponent(n.address)}&depth=1&limit=10`);
          mergedData = {
            pivot: mergedData.pivot,
            nodes: [...new Map([...mergedData.nodes, ...extra.nodes].map((x) => [x.id, x])).values()],
            edges: [...new Map([...mergedData.edges, ...extra.edges].map((x) => [`${x.source}->${x.target}`, x])).values()],
          };
          draw();
        } catch { /* toasted */ }
      },
    });
    draw();
  }

  function openNodeDrawer(n) {
    const body = document.createElement('div');
    body.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:var(--sp-3);">
        <div>
          <div class="muted" style="font-size:var(--fs-xs);">Address</div>
          <code class="mono" style="font-size:var(--fs-md); word-break: break-all;">${n.address}</code>
        </div>
        <div>
          <div class="muted" style="font-size:var(--fs-xs);">Chain · Risk</div>
          <div><strong style="color:var(--chain-${n.chain});">${n.chain.toUpperCase()}</strong> · risk ${n.riskScore}/100</div>
        </div>
        ${n.labels.length > 0 ? `
          <div>
            <div class="muted" style="font-size:var(--fs-xs);">Labels</div>
            <div style="display:flex; flex-wrap:wrap; gap:4px;">
              ${n.labels.map((l) => `<span class="tag ${n.category === 'ofac' || n.category === 'mixer' ? 'ofac' : 'cex'}">${escapeHtml(l)}</span>`).join('')}
            </div>
          </div>` : ''}
        <a class="btn" href="/watchlist?address=${encodeURIComponent(n.address)}">Open in Watchlist</a>
        <button class="btn ghost" id="close-drawer">Close</button>
      </div>
    `;
    body.querySelector('#close-drawer').addEventListener('click', closeDrawer);
    openDrawer({ title: 'Address', body });
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  }
```

After `renderDetail(...)` is called inside the lookup flow, append `loadGraph(out, addr, chain);`. The exact placement depends on the current shape of watchlist.js — just call it after the static detail card is appended.

### Step 2: Verify

```bash
node --check src/dashboard/public/js/pages/watchlist.js
npx tsc -p . --noEmit
npm test 2>&1 | tail -5
```

Expected: parse OK, clean, **132 / 132**.

### Step 3: Commit

```bash
git add src/dashboard/public/js/pages/watchlist.js
git commit -m "feat(dashboard/watchlist): replace top-counterparty table with Cytoscape graph

* Watchlist page now renders an interactive force-directed graph
  via /api/graph at depth=1 by default.
* Click node → opens drawer with address details + 'Open in
  Watchlist' deep-link.
* Double-click non-leaf node → fetches its 1-hop neighborhood and
  merges into the canvas (Map-based dedup on node id + edge key).
* CEX nodes are leaf-marked by the backend; dbl-click is a no-op."
```

---

## Task 4: Smoke + PR + merge

### Step 1: Final gates

```bash
cd ~/projects/chain-watcher
npx tsc -p . --noEmit
npm run lint
npm test
npm run build
```

Expected: clean, **132 / 132**.

### Step 2: Smoke

```bash
cp .env.example .env
redis-server --daemonize yes --port 6379 --dir /tmp 2>/dev/null || true
redis-cli ping
npm run dev > /tmp/m17-smoke.log 2>&1 &
sleep 18
# Hit the graph endpoint for a known address that has txs
curl -s "http://localhost:8787/api/graph?chain=eth&address=0xdac17f958d2ee523a2206206994597c13d831ec7&depth=1&limit=5" | head -c 800
```

Expected: returns `{ pivot, nodes, edges }`. If no txs exist for that address yet, response will have just the pivot node.

### Step 3: Cleanup + PR + merge

```bash
pkill -f "tsx.*src/index" 2>/dev/null
redis-cli shutdown 2>/dev/null || true
rm -f .env

git push -u origin feat/v2-m17-network-graph
gh pr create --base main --head feat/v2-m17-network-graph \
  --title "feat(v2/M17): counterparty network graph (Cytoscape.js)" \
  --body "Final v2 milestone. New GET /api/graph endpoint does BFS over the tx table (depth 1-2, limit 1-50, CEX nodes leaf-marked). Watchlist page replaces the static top-counterparty table with an interactive Cytoscape graph — click node = open drawer, dbl-click = expand 1 level. 132/132 tests (+4 new). 🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

---

## Done criteria

- 4 commits + PR
- 132 / 132 tests pass
- /api/graph returns valid response with known address
- Watchlist page renders graph with at least the pivot node
- Click + dblclick handlers work in browser smoke
- v2 complete — all 17 milestones merged

