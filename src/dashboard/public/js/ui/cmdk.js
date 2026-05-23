// Ctrl/Cmd + K command palette. Searches labels (via /api/labels/list?search=)
// + alerts (via /api/alerts then in-memory filter) + a direct "open watchlist
// for <pasted address>" action when the query looks like an address.

import { apiGet } from '../api.js';

let mounted = false;
let debounceTimer = null;
let lastResults = [];
let activeIndex = 0;

function root() {
  return document.getElementById('cmdk-root');
}

function ensureMounted() {
  if (mounted) return;
  mounted = true;
  const r = root();
  r.innerHTML = `
    <div class="backdrop"></div>
    <div class="panel">
      <div class="cmdk-input-row">
        <input id="cmdk-input" type="text" placeholder="Search labels, alerts, paste an address…" autocomplete="off" />
      </div>
      <div id="cmdk-list" class="cmdk-list"></div>
      <div class="cmdk-hint">
        <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
        <span><kbd>Enter</kbd> open</span>
        <span><kbd>Esc</kbd> close</span>
      </div>
    </div>
  `;
  r.querySelector('.backdrop').addEventListener('click', close);
  r.querySelector('#cmdk-input').addEventListener('input', onInput);
  r.querySelector('#cmdk-input').addEventListener('keydown', onKeyDown);
}

function open() {
  ensureMounted();
  root().classList.add('open');
  const inp = root().querySelector('#cmdk-input');
  inp.value = '';
  inp.focus();
  lastResults = [];
  activeIndex = 0;
  renderResults([]);
}

function close() {
  root().classList.remove('open');
}

function isOpen() {
  return root()?.classList.contains('open');
}

function onInput(e) {
  const q = e.target.value.trim();
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => doSearch(q), 180);
}

async function doSearch(q) {
  if (!q) {
    lastResults = [];
    renderResults([]);
    return;
  }
  const results = [];

  // Direct address shortcut
  if (/^0x[a-fA-F0-9]{6,}$/.test(q) || /^bc1[a-zA-Z0-9]{6,}$/.test(q) || /^[13][a-km-zA-HJ-NP-Z1-9]{6,}$/.test(q)) {
    results.push({
      kind: 'address',
      label: `Watchlist → ${q}`,
      sub: 'Open in Watchlist (eth)',
      action: () => { location.href = `/watchlist?address=${encodeURIComponent(q)}`; },
    });
  }

  // Labels
  try {
    const data = await apiGet(`/api/labels/list?search=${encodeURIComponent(q)}&limit=6`);
    for (const row of data.rows ?? []) {
      results.push({
        kind: 'label',
        label: `${row.label}`,
        sub: `${row.chain.toUpperCase()} · ${row.address.slice(0, 12)}… · ${row.category}`,
        action: () => { location.href = `/watchlist?address=${encodeURIComponent(row.address)}`; },
      });
    }
  } catch { /* api.js toasted */ }

  // Recent alerts that mention q (server-side filter is overkill; reuse cached if any)
  try {
    const alerts = await apiGet('/api/alerts?limit=200');
    const ql = q.toLowerCase();
    for (const a of alerts) {
      const match =
        (a.pivot_address ?? a.pivotAddress ?? '').toLowerCase().includes(ql) ||
        (a.counterparty ?? '').toLowerCase().includes(ql) ||
        (a.rule ?? '').toLowerCase().includes(ql);
      if (match) {
        results.push({
          kind: 'alert',
          label: `Alert #${a.id}: ${a.rule} (${a.chain})`,
          sub: `pivot ${(a.pivot_address ?? a.pivotAddress).slice(0, 12)}… amount $${Number(a.amount_usdt ?? a.amountUsdt).toFixed(0)}`,
          action: () => { location.href = '/alerts'; },
        });
        if (results.length >= 12) break;
      }
    }
  } catch { /* toasted */ }

  lastResults = results.slice(0, 12);
  activeIndex = 0;
  renderResults(lastResults);
}

function renderResults(results) {
  const list = root().querySelector('#cmdk-list');
  if (results.length === 0) {
    list.innerHTML = '<div class="cmdk-section" style="text-align:center; padding:var(--sp-5);">Type to search labels, addresses, alerts…</div>';
    return;
  }
  const byKind = new Map();
  for (const r of results) {
    if (!byKind.has(r.kind)) byKind.set(r.kind, []);
    byKind.get(r.kind).push(r);
  }
  const out = [];
  let i = 0;
  for (const [kind, items] of byKind) {
    out.push(`<div class="cmdk-section">${kind === 'label' ? 'Labels' : kind === 'alert' ? 'Recent alerts' : 'Quick actions'}</div>`);
    for (const r of items) {
      const idx = i++;
      out.push(`
        <div class="cmdk-item ${idx === activeIndex ? 'active' : ''}" data-idx="${idx}">
          <span class="kind">${r.kind}</span>
          <div style="display:flex; flex-direction:column;">
            <strong>${escapeHtml(r.label)}</strong>
            <span class="muted" style="font-size:var(--fs-xs);">${escapeHtml(r.sub)}</span>
          </div>
        </div>`);
    }
  }
  list.innerHTML = out.join('');
  for (const el of list.querySelectorAll('.cmdk-item')) {
    el.addEventListener('click', () => {
      const idx = Number(el.dataset.idx);
      if (lastResults[idx]) {
        close();
        lastResults[idx].action();
      }
    });
  }
}

function onKeyDown(e) {
  if (e.key === 'Escape') {
    close();
    e.preventDefault();
    return;
  }
  if (e.key === 'ArrowDown') {
    activeIndex = Math.min(activeIndex + 1, lastResults.length - 1);
    renderResults(lastResults);
    e.preventDefault();
    return;
  }
  if (e.key === 'ArrowUp') {
    activeIndex = Math.max(activeIndex - 1, 0);
    renderResults(lastResults);
    e.preventDefault();
    return;
  }
  if (e.key === 'Enter') {
    if (lastResults[activeIndex]) {
      close();
      lastResults[activeIndex].action();
    }
    e.preventDefault();
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}

export function startCmdK() {
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (isOpen()) close();
      else open();
    }
  });
}
