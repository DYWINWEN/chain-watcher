# M17 — Counterparty Network Graph Design

**Date**: 2026-05-23
**Predecessor**: v2 design doc §7 M17; Pencil mockup `design/page-watchlist.png`
**Successor plan**: `docs/superpowers/plans/2026-05-23-m17-network-graph.md`
**Branch**: `feat/v2-m17-network-graph`

---

## 1. Context

Final v2 milestone. M11.2 added a static counterparty table on the Watchlist page. M17 replaces / augments it with an **interactive force-directed graph** powered by Cytoscape.js — pivot address at the center, top counterparties (from `tx` table) as nodes, optionally expanding to 2nd-degree via "click-to-expand". Labels color nodes; alert involvement makes edges bolder.

Brainstorm decisions inline:

| | |
|---|---|
| **Backend API** | New `GET /api/graph?chain=X&address=Y&depth=N&limit=K` — BFS over `tx` table. Depth default=1 (just direct counterparties), max=2. Limit per layer default=10. |
| **Edge weight** | Number of txs between the two addresses + total USDT amount. Used to size the edge stroke. |
| **CEX hub avoidance** | Nodes with category='cex' label are rendered but NOT expanded for depth > 1 (would explode). Marked as "leaf". |
| **Frontend lib** | Cytoscape.js + cytoscape-cose-bilkent layout. ~80KB gz from CDN. Lazy-load only on Watchlist page. |
| **Where in UI** | Watchlist page — replace the current "Top counterparties" card with the graph. Existing per-direction window tables stay below as supplementary tabular view. |
| **Click interaction** | Click any node → opens the existing M11.1 address drawer with that address (deep-link). Double-click expands depth+1 (capped at 2). |

---

## 2. Goals & Non-Goals

**Goals**
- `GET /api/graph` backend endpoint: BFS over `tx` table, returns `{ nodes: [], edges: [] }`
- Watchlist page renders a Cytoscape graph at depth=1 by default
- Nodes colored by category label (ofac/mixer red; cex green; project gray; pivot purple)
- Edge thickness scales with tx count + total USDT
- Click node → open drawer
- Double-click non-leaf node → expand to depth 2
- CEX-categorized nodes don't expand (leaf)
- Loading state + empty state ("no counterparties yet")

**Non-Goals**
- Cross-chain graph correlation — same address on ETH vs BSC = different nodes (v3)
- AML risk scoring on edges (v3)
- Time-range filtering of the graph (defer)
- Export to image / GraphML (defer)
- Real-time updates (graph is on-demand only; no SSE)

---

## 3. Schema

No new tables. The graph is derived from existing `tx` + `labels` tables.

(M16's `idx_tx_chain_ts` already helps the chain+time-bounded queries.)

---

## 4. API design

`GET /api/graph?chain=X&address=Y&depth=N&limit=K`:

- `chain` required: 'eth' | 'bsc' | 'btc' | 'polygon' | 'tron'
- `address` required: pivot address (lowercased for EVM; case-preserved for BTC/Tron)
- `depth` optional, default 1, max 2
- `limit` optional, default 10, max 50 (per-layer cap)

Response shape:

```json
{
  "pivot": { "chain": "eth", "address": "0xa..." },
  "nodes": [
    {
      "id": "eth|0xa...",
      "chain": "eth",
      "address": "0xa...",
      "labels": ["OFAC SDN", "Tornado.Cash"],
      "category": "ofac",            // highest-priority category among the address's labels
      "riskScore": 95,
      "isPivot": true,
      "isLeaf": false,                // true if category='cex' — UI doesn't expand
      "txCount": 42                    // total tx count involving this address within the layer
    },
    { "id": "eth|0xb...", ... },
    ...
  ],
  "edges": [
    {
      "source": "eth|0xa...",
      "target": "eth|0xb...",
      "txCount": 5,
      "totalUsdt": 4218.50,
      "alertCount": 3                   // # alerts where (pivot, counterparty) pair matches
    },
    ...
  ]
}
```

Implementation logic:
1. Validate inputs (chain in whitelist; address non-empty)
2. Seed BFS frontier with pivot
3. For each layer up to depth:
   - For each address in the current frontier:
     - SELECT counterparties from `tx` table:
       - `SELECT to_addr AS cp, COUNT(*) AS n, SUM(amount_usdt) AS total FROM tx WHERE chain=? AND from_addr=? GROUP BY to_addr ORDER BY total DESC LIMIT ?`
       - Same for `from_addr=cp WHERE to_addr=?` (inbound)
       - Merge by cp address; sum counts/totals
     - Limit to top `limit` by `total`
     - Add new addresses to next frontier (if not already visited)
4. Annotate nodes with labels (call `getLabels(chain, addr)` for each) — sets category to highest-risk
5. Annotate edges with alert counts (subquery on `alerts WHERE pivot_address=? AND counterparty=?`)
6. CEX nodes are marked `isLeaf=true` and NOT added to next-layer frontier

Performance budget: depth=1 + limit=10 → 1 pivot × 20 counterparty rows × 1 label query × 1 alert subquery ≈ 50ms SQLite. Depth=2 multiplies by 10 → ~500ms. Acceptable for ad-hoc page loads.

---

## 5. Frontend: Cytoscape integration

`src/dashboard/public/index.html` — add Cytoscape script tag near the existing Chart.js tag:

```html
<script src="https://cdn.jsdelivr.net/npm/cytoscape@3.30.4/dist/cytoscape.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/layout-base@2.0.1/layout-base.js"></script>
<script src="https://cdn.jsdelivr.net/npm/cose-base@2.2.0/cose-base.js"></script>
<script src="https://cdn.jsdelivr.net/npm/cytoscape-cose-bilkent@4.1.0/cytoscape-cose-bilkent.js"></script>
```

The `cose-bilkent` layout is hierarchical-force; gives clean graphs for the small (<50 node) sets we deal with.

New module `src/dashboard/public/js/ui/graph.js`:

```js
// Cytoscape wrapper for the counterparty graph.
// Exports renderGraph(container, data, { onNodeClick, onNodeDblClick }).

export function renderGraph(container, data, opts) {
  /* global cytoscape */
  if (typeof cytoscape === 'undefined') {
    container.innerHTML = '<div class="muted">Graph library failed to load.</div>';
    return null;
  }
  const elements = [
    ...data.nodes.map((n) => ({
      data: {
        id: n.id, label: n.labels?.[0] ?? shortHash(n.address),
        category: n.category, riskScore: n.riskScore,
        isPivot: n.isPivot, isLeaf: n.isLeaf,
        ...n,
      },
    })),
    ...data.edges.map((e) => ({
      data: { id: `${e.source}->${e.target}`, source: e.source, target: e.target, ...e },
    })),
  ];
  const cy = cytoscape({
    container,
    elements,
    style: [
      { selector: 'node', style: {
        'background-color': 'data(color)',  // computed below
        'label': 'data(label)',
        'color': '#fafafa',
        'font-size': '10px',
        'text-valign': 'bottom', 'text-margin-y': 6,
        'width': 'data(size)', 'height': 'data(size)',
      }},
      { selector: 'node[isPivot]', style: { 'border-width': 3, 'border-color': '#5b6cff' }},
      { selector: 'edge', style: {
        'width': 'data(strokeWidth)',
        'line-color': 'data(strokeColor)',
        'curve-style': 'bezier',
        'target-arrow-shape': 'triangle',
        'target-arrow-color': 'data(strokeColor)',
      }},
    ],
    layout: { name: 'cose-bilkent', randomize: false, padding: 30 },
  });
  // Pre-compute node sizes + colors from category
  for (const n of cy.nodes()) {
    const cat = n.data('category');
    const size = n.data('isPivot') ? 56 : 36 + Math.min(20, Math.log2((n.data('txCount') ?? 1) + 1) * 6);
    n.data('size', size);
    n.data('color', categoryColor(cat));
  }
  for (const e of cy.edges()) {
    const alerts = e.data('alertCount') ?? 0;
    e.data('strokeWidth', Math.min(8, 1 + Math.log2((e.data('txCount') ?? 1) + 1) * 1.5));
    e.data('strokeColor', alerts > 0 ? '#f87171' : '#52525b');
  }
  if (opts?.onNodeClick) cy.on('tap', 'node', (evt) => opts.onNodeClick(evt.target.data()));
  if (opts?.onNodeDblClick) cy.on('dblclick', 'node', (evt) => opts.onNodeDblClick(evt.target.data()));
  return cy;
}

function categoryColor(cat) {
  switch (cat) {
    case 'ofac':
    case 'sanctions':
    case 'mixer': return '#f87171';   // red
    case 'cex': return '#22c55e';     // green
    case 'bridge': return '#facc15';  // yellow
    case 'project': return '#71717a'; // gray
    default: return '#a78bfa';        // purple (pivot/user/unknown)
  }
}

function shortHash(s) {
  return typeof s === 'string' && s.length > 14 ? `${s.slice(0, 8)}…${s.slice(-4)}` : (s ?? '');
}
```

---

## 6. Watchlist page changes

`src/dashboard/public/js/pages/watchlist.js` — replace the "Top counterparties" table section with the graph:

```js
import { renderGraph } from '../ui/graph.js';
// ... existing imports ...

async function loadGraph(host, chain, address) {
  host.innerHTML = '<div class="muted">Loading graph…</div>';
  let data;
  try {
    data = await apiGet(`/api/graph?chain=${chain}&address=${encodeURIComponent(address)}&depth=1&limit=10`);
  } catch { return; }
  if (data.nodes.length <= 1) {
    host.innerHTML = '<div class="muted">No counterparties yet — graph empty.</div>';
    return;
  }
  host.innerHTML = '<div id="graph-canvas" style="height:420px;"></div>';
  renderGraph(host.querySelector('#graph-canvas'), data, {
    onNodeClick: (n) => openAddressDrawer(n.chain, n.address),
    onNodeDblClick: async (n) => {
      if (n.isLeaf) return; // CEX hubs don't expand
      const expanded = await apiGet(`/api/graph?chain=${chain}&address=${encodeURIComponent(n.address)}&depth=1&limit=10`);
      // Merge into the same canvas — re-render to keep things simple
      data.nodes = [...new Map([...data.nodes, ...expanded.nodes].map(x => [x.id, x])).values()];
      data.edges = [...new Map([...data.edges, ...expanded.edges].map(x => [x.source+'->'+x.target, x])).values()];
      renderGraph(host.querySelector('#graph-canvas'), data, /* same opts */);
    },
  });
}
```

Where the existing watchlist code rendered the top-5 counterparty TABLE, call `loadGraph(host, chain, address)` instead. Keep the existing per-direction window tables below for users who want the raw data.

---

## 7. Code layout

```
src/api/graph.ts                          ★ new — Express router for /api/graph
src/dashboard/server.ts                   ✎ mount graphRouter
src/dashboard/public/js/ui/graph.js       ★ new — Cytoscape wrapper
src/dashboard/public/js/pages/watchlist.js ✎ load + render graph
src/dashboard/public/index.html           ✎ cytoscape CDN scripts

test/
└── graph-api.test.ts                     ★ 4 cases (basic depth=1; CEX leaf; depth=2; missing inputs)
```

Target: **+4 tests** (128 → 132).

---

## 8. Testing

`test/graph-api.test.ts`:
- depth=1 returns correct nodes (pivot + top-N counterparties) + edges
- CEX-labeled node marked `isLeaf=true`
- depth=2 expands one level; isLeaf nodes don't contribute to next-layer frontier
- 400 on missing `chain` or `address`

No frontend tests for Cytoscape — verified via smoke in T5.

---

## 9. Risks + mitigations

- **Hub explosion**: Even with limit=10 per layer, a popular address (Binance) at depth=2 could fan into 100+ nodes. Mitigated by CEX leaf marking + hard limit=50.
- **Cytoscape CDN unreachable**: Production deployments may need to vendor the JS. M17 ships with CDN refs; vendor copies can be added in a follow-up if anyone deploys air-gapped.
- **Slow SQLite query at depth=2**: ~500ms is acceptable for an on-demand page action. If profiling shows issues, can add `idx_tx_to_chain_amount` for the sort.

---

## 10. Done criteria

- 132 / 132 tests pass
- `/api/graph?chain=eth&address=<known>` returns valid response shape
- Watchlist page loads the graph at depth=1 by default
- Clicking a node opens the address drawer
- Double-clicking a non-leaf node expands depth+1
- CEX nodes show but don't expand
