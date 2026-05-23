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
