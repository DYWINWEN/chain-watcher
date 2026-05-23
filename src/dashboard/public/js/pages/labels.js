// Labels management page — paginated list + search + filter + CRUD.

import { apiGet, apiPost, apiDelete } from '../api.js';
import { toast } from '../ui/toast.js';
import { fmtTime, shortHash } from '../format.js';

const PAGE_SIZE = 50;
const CATEGORIES = ['', 'ofac', 'sanctions', 'mixer', 'cex', 'bridge', 'project', 'user'];
const CHAINS = ['', 'eth', 'bsc', 'btc'];

export async function renderLabels(root) {
  root.innerHTML = `
    <div class="card" style="display:flex; flex-direction:column; gap:var(--sp-3);">
      <div style="display:flex; gap:var(--sp-2); flex-wrap:wrap; align-items:center;">
        <input id="lbl-search" placeholder="Search address or label…" style="flex:1; min-width:240px;" />
        <select id="lbl-chain">${CHAINS.map((c) => `<option value="${c}">${c ? c.toUpperCase() : 'All chains'}</option>`).join('')}</select>
        <select id="lbl-cat">${CATEGORIES.map((c) => `<option value="${c}">${c ? c : 'All categories'}</option>`).join('')}</select>
        <button id="lbl-add" class="btn">+ Add</button>
      </div>
      <div id="lbl-stats" class="muted" style="font-size:var(--fs-sm);">Loading…</div>
    </div>

    <div id="lbl-add-panel" class="card" style="display:none; margin-top:var(--sp-3); flex-direction:column; gap:var(--sp-2);">
      <strong style="font-size:var(--fs-md);">Add label</strong>
      <div style="display:flex; gap:var(--sp-2); flex-wrap:wrap;">
        <select id="add-chain">${CHAINS.filter(Boolean).map((c) => `<option value="${c}">${c.toUpperCase()}</option>`).join('')}</select>
        <input id="add-addr" placeholder="0x… / bc1…" style="flex:1; min-width:300px;" />
        <input id="add-label" placeholder="Label name" />
        <select id="add-cat">${CATEGORIES.filter(Boolean).map((c) => `<option value="${c}">${c}</option>`).join('')}</select>
        <button id="add-save" class="btn">Save</button>
        <button id="add-cancel" class="btn ghost">Cancel</button>
      </div>
    </div>

    <div id="lbl-table" class="card" style="margin-top:var(--sp-3); padding:0; overflow:hidden;"></div>
    <div id="lbl-pager" style="display:flex; gap:var(--sp-3); align-items:center; margin-top:var(--sp-3); justify-content:center;"></div>
  `;

  const state = { search: '', chain: '', category: '', offset: 0, total: 0 };

  const search = root.querySelector('#lbl-search');
  const chainSel = root.querySelector('#lbl-chain');
  const catSel = root.querySelector('#lbl-cat');
  const stats = root.querySelector('#lbl-stats');
  const table = root.querySelector('#lbl-table');
  const pager = root.querySelector('#lbl-pager');

  let debounce;
  search.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => { state.search = search.value.trim(); state.offset = 0; void refresh(); }, 200);
  });
  chainSel.addEventListener('change', () => { state.chain = chainSel.value; state.offset = 0; void refresh(); });
  catSel.addEventListener('change', () => { state.category = catSel.value; state.offset = 0; void refresh(); });

  // Add panel
  const addPanel = root.querySelector('#lbl-add-panel');
  root.querySelector('#lbl-add').addEventListener('click', () => {
    addPanel.style.display = addPanel.style.display === 'flex' ? 'none' : 'flex';
  });
  root.querySelector('#add-cancel').addEventListener('click', () => {
    addPanel.style.display = 'none';
  });
  root.querySelector('#add-save').addEventListener('click', async () => {
    const chain = root.querySelector('#add-chain').value;
    const address = root.querySelector('#add-addr').value.trim();
    const label = root.querySelector('#add-label').value.trim();
    const category = root.querySelector('#add-cat').value;
    if (!address || !label) {
      toast({ kind: 'error', message: 'Address and label are required' });
      return;
    }
    try {
      await apiPost('/api/labels', { chain, address, label, category });
      toast({ kind: 'success', message: 'Label added' });
      root.querySelector('#add-addr').value = '';
      root.querySelector('#add-label').value = '';
      addPanel.style.display = 'none';
      await refresh();
    } catch { /* api.js toasted */ }
  });

  async function refresh() {
    stats.textContent = 'Loading…';
    const qs = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: String(state.offset),
    });
    if (state.search) qs.set('search', state.search);
    if (state.chain) qs.set('chain', state.chain);
    if (state.category) qs.set('category', state.category);
    let data;
    try {
      data = await apiGet(`/api/labels/list?${qs.toString()}`);
    } catch { return; }
    state.total = data.total;
    stats.textContent = `${data.total.toLocaleString()} labels${state.search || state.chain || state.category ? ' matching filter' : ''} · showing ${data.rows.length} (${state.offset + 1}–${state.offset + data.rows.length})`;
    renderRows(data.rows);
    renderPager();
  }

  function renderRows(rows) {
    if (rows.length === 0) {
      table.innerHTML = '<div style="padding:var(--sp-5); text-align:center;" class="muted">No labels match.</div>';
      return;
    }
    table.innerHTML = `
      <table style="width:100%; border-collapse:collapse; font-size:var(--fs-sm);">
        <thead style="background:var(--surface-2);">
          <tr>
            <th style="text-align:left; padding:var(--sp-3) var(--sp-4); color:var(--text-muted); font-weight:500;">Chain</th>
            <th style="text-align:left; padding:var(--sp-3) var(--sp-4); color:var(--text-muted); font-weight:500;">Address</th>
            <th style="text-align:left; padding:var(--sp-3) var(--sp-4); color:var(--text-muted); font-weight:500;">Label</th>
            <th style="text-align:left; padding:var(--sp-3) var(--sp-4); color:var(--text-muted); font-weight:500;">Category</th>
            <th style="text-align:left; padding:var(--sp-3) var(--sp-4); color:var(--text-muted); font-weight:500;">Source</th>
            <th style="text-align:left; padding:var(--sp-3) var(--sp-4); color:var(--text-muted); font-weight:500;">Risk</th>
            <th style="padding:var(--sp-3) var(--sp-4);"></th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((r) => `
            <tr style="border-top:1px solid var(--border);">
              <td style="padding:var(--sp-3) var(--sp-4);"><strong style="color:var(--chain-${r.chain});">${r.chain.toUpperCase()}</strong></td>
              <td style="padding:var(--sp-3) var(--sp-4);"><code class="mono">${shortHash(r.address)}</code></td>
              <td style="padding:var(--sp-3) var(--sp-4);">${escapeHtml(r.label)}</td>
              <td style="padding:var(--sp-3) var(--sp-4);"><span class="tag ${categoryTagClass(r.category)}">${r.category}</span></td>
              <td style="padding:var(--sp-3) var(--sp-4);" class="muted">${r.source}</td>
              <td style="padding:var(--sp-3) var(--sp-4);" class="muted">${r.riskScore}</td>
              <td style="padding:var(--sp-3) var(--sp-4); text-align:right;">
                ${r.source === 'user' ? `<button class="btn ghost" data-del="${r.chain}|${r.address}|${escapeAttr(r.label)}">×</button>` : ''}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
    for (const btn of table.querySelectorAll('[data-del]')) {
      btn.addEventListener('click', async () => {
        const [chain, address, label] = btn.dataset.del.split('|');
        try {
          await apiDelete(`/api/labels/${chain}/${address}/${encodeURIComponent(label)}`);
          toast({ kind: 'success', message: 'Removed' });
          await refresh();
        } catch { /* toasted */ }
      });
    }
  }

  function renderPager() {
    const page = Math.floor(state.offset / PAGE_SIZE) + 1;
    const totalPages = Math.max(1, Math.ceil(state.total / PAGE_SIZE));
    pager.innerHTML = `
      <button class="btn ghost" id="lbl-prev" ${page === 1 ? 'disabled' : ''}>← Prev</button>
      <span class="muted">Page ${page} / ${totalPages}</span>
      <button class="btn ghost" id="lbl-next" ${page === totalPages ? 'disabled' : ''}>Next →</button>
    `;
    pager.querySelector('#lbl-prev')?.addEventListener('click', () => {
      state.offset = Math.max(0, state.offset - PAGE_SIZE);
      void refresh();
    });
    pager.querySelector('#lbl-next')?.addEventListener('click', () => {
      state.offset += PAGE_SIZE;
      void refresh();
    });
  }

  await refresh();
}

function categoryTagClass(c) {
  if (c === 'ofac' || c === 'sanctions' || c === 'mixer') return 'ofac';
  if (c === 'cex' || c === 'bridge' || c === 'project') return 'cex';
  return 'mixer'; // user
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}

function escapeAttr(s) {
  return String(s).replace(/"/g, '&quot;');
}
