import { apiGet } from '../api.js';
import { fmtTime, shortHash, fmtUsd } from '../format.js';
import { renderGraph } from '../ui/graph.js';
import { openDrawer, closeDrawer } from '../ui/drawer.js';

export async function renderWatchlist(root) {
  root.innerHTML = `
    <div class="card" style="display:flex; gap:var(--sp-3); align-items:center;">
      <input id="wl-addr" placeholder="0x… or bc1…" style="flex:1;" />
      <select id="wl-chain">
        <option value="eth">ETH</option>
        <option value="bsc">BSC</option>
        <option value="btc">BTC</option>
      </select>
      <button id="wl-go" class="btn">Lookup</button>
    </div>
    <div id="wl-result"></div>
  `;

  const input = root.querySelector('#wl-addr');
  const chainSel = root.querySelector('#wl-chain');
  const out = root.querySelector('#wl-result');

  const lookup = async () => {
    const addr = input.value.trim().toLowerCase();
    if (!addr) return;
    const chain = chainSel.value;
    out.innerHTML = `<div class="muted">Loading…</div>`;
    let data;
    try {
      data = await apiGet(`/api/address/${chain}/${encodeURIComponent(addr)}`);
    } catch { return; }
    renderDetail(data, addr, chain);
    loadGraph(out, addr, chain);
  };

  root.querySelector('#wl-go').addEventListener('click', lookup);
  input.addEventListener('keypress', (e) => e.key === 'Enter' && lookup());

  // Honor ?address=X (deep-link from Alerts drawer).
  const params = new URLSearchParams(location.search);
  const seed = params.get('address');
  if (seed) {
    input.value = seed;
    void lookup();
  }

  function renderDetail(data, addr, chain) {
    const labelChips = data.labels.length
      ? data.labels.map((l) => `<span class="tag ${tagClass(l.category)}">${l.label}</span>`).join(' ')
      : '<span class="muted" style="font-size:var(--fs-sm);">No labels</span>';

    out.innerHTML = `
      <div class="card" style="margin-top:var(--sp-3); display:flex; flex-direction:column; gap:var(--sp-3);">
        <div style="display:flex; align-items:center; gap:var(--sp-3);">
          <strong style="color:var(--chain-${chain});">${chain.toUpperCase()}</strong>
          <code class="mono" style="font-size:var(--fs-md);">${addr}</code>
          <span style="flex:1;"></span>
          ${labelChips}
        </div>
        <div style="display:grid; grid-template-columns: repeat(4, 1fr); gap:var(--sp-3);">
          ${tile('Outbound', data.stats.outboundCount.toLocaleString(), fmtUsd(data.stats.outboundTotal))}
          ${tile('Inbound', data.stats.inboundCount.toLocaleString(), fmtUsd(data.stats.inboundTotal))}
          ${tile('Alerts', data.stats.alertCount.toLocaleString(), data.stats.alertCount > 0 ? 'in history' : 'no alerts', data.stats.alertCount > 0 ? 'var(--danger)' : null)}
          ${tile('Risk score', String(data.stats.maxRiskScore) + '/100', data.stats.maxRiskScore >= 80 ? 'high' : data.stats.maxRiskScore >= 40 ? 'medium' : 'low', data.stats.maxRiskScore >= 80 ? 'var(--danger)' : data.stats.maxRiskScore >= 40 ? 'var(--warning)' : null)}
        </div>
      </div>

      <div class="card" style="margin-top:var(--sp-3);">
          <div style="display:flex; align-items:center; gap:var(--sp-3);">
            <strong>Counterparty graph</strong>
            <span class="muted" style="font-size:var(--fs-sm);">click a node to drill in · dbl-click to expand 1 level</span>
          </div>
          <div id="wl-graph" style="height: 420px; margin-top:var(--sp-3); background:var(--surface-2); border-radius:var(--r-md);"></div>
        </div>

      <div id="wl-windows" style="margin-top:var(--sp-3);"></div>
    `;

    void renderWindows(out.querySelector('#wl-windows'), addr);
  }

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
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  async function renderWindows(host, addr) {
    let rows;
    try {
      rows = await apiGet(`/api/windows?address=${encodeURIComponent(addr)}`);
    } catch { return; }
    if (!rows.length) {
      host.innerHTML = '';
      return;
    }
    host.innerHTML = rows.map((row) => `
      <div class="card" style="margin-top:var(--sp-3);">
        <div style="display:flex; align-items:center; gap:var(--sp-2);">
          <strong style="color:var(--chain-${row.chain});">${row.chain.toUpperCase()}</strong>
          <span class="muted">/ ${row.direction}</span>
          ${row.backfilled ? '<span class="tag cex">BACKFILLED</span>' : ''}
          <span style="flex:1;"></span>
          <span class="muted" style="font-size:var(--fs-xs);">updated ${fmtTime(row.updated_at)}</span>
        </div>
        <table style="margin-top:var(--sp-3); width:100%; font-size:var(--fs-sm);">
          <thead><tr><th style="text-align:left; color:var(--text-muted); font-weight:500;">#</th><th style="text-align:left; color:var(--text-muted); font-weight:500;">Counterparty</th><th style="text-align:left; color:var(--text-muted); font-weight:500;">Tx</th></tr></thead>
          <tbody>
            ${row.counterparties.map((cp, i) => `
              <tr style="border-top:1px solid var(--border);">
                <td class="muted" style="padding:var(--sp-2);">${i + 1}</td>
                <td style="padding:var(--sp-2);"><code class="mono">${cp.length > 14 ? shortHash(cp) : cp}</code></td>
                <td style="padding:var(--sp-2);"><code class="mono">${shortHash(row.last_tx_hashes[i] ?? '')}</code></td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    `).join('');
  }
}

function tile(label, big, sub, color) {
  return `
    <div class="card" style="padding:var(--sp-4);">
      <div class="muted" style="font-size:var(--fs-xs);">${label}</div>
      <div style="font-weight:600; font-size:var(--fs-xl); margin-top:var(--sp-1); ${color ? `color: ${color};` : ''}">${big}</div>
      <div class="muted" style="font-size:var(--fs-xs);">${sub}</div>
    </div>
  `;
}

function tagClass(c) {
  if (c === 'ofac' || c === 'sanctions' || c === 'mixer') return 'ofac';
  if (c === 'cex' || c === 'bridge' || c === 'project') return 'cex';
  return 'mixer';
}
