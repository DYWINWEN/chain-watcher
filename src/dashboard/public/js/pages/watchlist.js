import { apiGet } from '../api.js';
import { fmtTime, shortHash } from '../format.js';
import { toast } from '../ui/toast.js';

export async function renderWatchlist(root) {
  root.innerHTML = `
    <div class="card" style="display:flex; gap:var(--sp-3); align-items:center;">
      <input id="wl-addr" placeholder="0x… or bc1…" style="flex:1;" />
      <button id="wl-go" class="btn">Lookup</button>
    </div>
    <div id="wl-result"></div>
  `;

  const input = root.querySelector('#wl-addr');
  const out = root.querySelector('#wl-result');
  const lookup = async () => {
    const addr = input.value.trim();
    if (!addr) return;
    out.innerHTML = `<div class="muted">Loading…</div>`;
    let rows;
    try {
      rows = await apiGet(`/api/windows?address=${encodeURIComponent(addr)}`);
    } catch { return; }
    if (!rows.length) {
      out.innerHTML = `<div class="muted">No windows for this address.</div>`;
      return;
    }
    out.innerHTML = '';
    for (const row of rows) {
      const card = document.createElement('div');
      card.className = 'card';
      card.style.marginTop = 'var(--sp-3)';
      card.innerHTML = `
        <div style="display:flex; align-items:center; gap:var(--sp-2);">
          <strong style="color:var(--chain-${row.chain});">${row.chain.toUpperCase()}</strong>
          <span class="muted">/ ${row.direction}</span>
          ${row.backfilled ? '<span class="tag cex">BACKFILLED</span>' : ''}
          <span style="flex:1;"></span>
          <span class="muted" style="font-size:var(--fs-xs);">updated ${fmtTime(row.updated_at)}</span>
        </div>
        <table style="margin-top:var(--sp-3); width:100%;">
          <thead><tr><th>#</th><th>Counterparty</th><th>Tx</th></tr></thead>
          <tbody>
            ${row.counterparties.map((cp, i) => `
              <tr>
                <td class="muted">${i + 1}</td>
                <td><code class="mono">${shortHash(cp)}</code></td>
                <td><code class="mono">${shortHash(row.last_tx_hashes[i] ?? '')}</code></td>
              </tr>`).join('')}
          </tbody>
        </table>
      `;
      out.appendChild(card);
    }
  };

  root.querySelector('#wl-go').addEventListener('click', lookup);
  input.addEventListener('keypress', (e) => e.key === 'Enter' && lookup());

  // Honor ?address=X query param (used by Alerts drawer's "Open in Watchlist" link).
  const params = new URLSearchParams(location.search);
  const seed = params.get('address');
  if (seed) {
    input.value = seed;
    void lookup();
  }
}
