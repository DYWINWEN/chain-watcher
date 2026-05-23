// pages/alerts.js — Linear-style live alerts list with filter bar + drawer drill-in.

import { apiGet } from '../api.js';
import { onSse } from '../sse.js';
import { openDrawer } from '../ui/drawer.js';
import { toast } from '../ui/toast.js';
import { createFilterBar, matchesFilter } from '../ui/filter-bar.js';
import { fmtRelative, shortHash, fmtUsd } from '../format.js';

const CHAIN_LABEL = { eth: 'Ethereum', bsc: 'BSC', btc: 'Bitcoin' };
const RULE_LABEL = {
  sender_repeats_to: 'Sender repeats to same address',
  receiver_repeats_from: 'Receiver gathers from same address',
};

export async function renderAlerts(root) {
  root.innerHTML = `
    <div id="alerts-filter"></div>
    <div id="alerts-meta" class="muted" style="font-size: var(--fs-sm);">Loading…</div>
    <div id="alerts-list" style="display:flex; flex-direction:column; gap: var(--sp-3);"></div>
  `;

  const filterMount = root.querySelector('#alerts-filter');
  const meta = root.querySelector('#alerts-meta');
  const list = root.querySelector('#alerts-list');

  const filter = createFilterBar({
    onChange: () => render(),
  });
  filterMount.appendChild(filter.el);

  let alerts = [];
  try {
    alerts = await apiGet('/api/alerts?limit=200');
  } catch {
    meta.textContent = 'Failed to load alerts.';
    return;
  }

  function render() {
    const filtered = alerts.filter((a) => matchesFilter(a, filter.state));
    meta.textContent = `${filtered.length} of ${alerts.length} alerts (filtered)`;
    list.innerHTML = '';
    for (const a of filtered) list.appendChild(alertCard(a));
  }

  render();

  // SSE live updates: new alert → prepend with highlight if filter matches.
  onSse('alert', (a) => {
    alerts.unshift(a);
    if (matchesFilter(a, filter.state)) {
      const card = alertCard(a);
      card.style.background = 'color-mix(in srgb, var(--accent) 18%, var(--surface-1))';
      list.prepend(card);
      setTimeout(() => (card.style.background = ''), 1500);
      const filtered = alerts.filter((x) => matchesFilter(x, filter.state));
      meta.textContent = `${filtered.length} of ${alerts.length} alerts (filtered)`;
    }
  });
}

function alertCard(a) {
  const chain = a.chain;
  const ruleLabel = RULE_LABEL[a.rule] ?? a.rule;
  const pivot = a.pivot_address ?? a.pivotAddress;
  const counterparty = a.counterparty;
  const amount = a.amount_usdt ?? a.amountUsdt;
  const ts = a.created_at ?? a.createdAt;

  const card = document.createElement('div');
  card.className = 'card';
  card.style.padding = 'var(--sp-5)';
  card.style.cursor = 'pointer';
  card.style.transition = 'background 120ms ease, border-color 120ms ease';

  card.innerHTML = `
    <div style="display:flex;align-items:center;gap:var(--sp-3);">
      <span style="width:8px;height:8px;border-radius:50%;background:var(--chain-${chain});"></span>
      <strong style="color:var(--chain-${chain}); font-size:var(--fs-sm); font-weight:600;">${CHAIN_LABEL[chain] ?? chain}</strong>
      <span class="subtle">·</span>
      <span style="font-weight:500;">${ruleLabel}</span>
      <span style="flex:1;"></span>
      <strong style="color:var(--success); font-size:var(--fs-lg);">${fmtUsd(amount)}</strong>
    </div>
    <div style="display:flex;align-items:center;gap:var(--sp-3); margin-top:var(--sp-3);">
      <code class="mono" data-addr="${pivot}">${shortHash(pivot)}</code>
      <span class="subtle">→</span>
      <code class="mono" data-addr="${counterparty}">${shortHash(counterparty)}</code>
      <span style="flex:1;"></span>
      <span class="muted" style="font-size:var(--fs-sm);">View detail →</span>
    </div>
    <div class="muted" style="font-size:var(--fs-xs); margin-top:var(--sp-3);">
      ${fmtRelative(ts)} · tx <code class="mono">${shortHash(a.trigger_tx_hash ?? a.triggerTxHash)}</code>
    </div>
  `;

  card.addEventListener('click', (e) => {
    const addrEl = e.target.closest('[data-addr]');
    const address = addrEl?.dataset.addr ?? pivot;
    openAddressDrawer(address, a);
  });
  card.addEventListener('mouseenter', () => (card.style.borderColor = 'var(--accent)'));
  card.addEventListener('mouseleave', () => (card.style.borderColor = ''));

  return card;
}

function openAddressDrawer(address, alert) {
  const body = document.createElement('div');
  body.innerHTML = `
    <div>
      <div class="muted" style="font-size:var(--fs-xs);">Address</div>
      <code class="mono" style="font-size:var(--fs-md); word-break: break-all;">${address}</code>
      <button class="btn ghost" id="copy-addr" style="margin-left:var(--sp-2);">Copy</button>
    </div>
    <div style="display:grid;grid-template-columns: repeat(2, 1fr); gap:var(--sp-3); margin-top:var(--sp-3);">
      <div class="card" style="padding:var(--sp-3);">
        <div class="muted" style="font-size:var(--fs-xs);">Chain</div>
        <div style="font-weight:600;">${CHAIN_LABEL[alert.chain] ?? alert.chain}</div>
      </div>
      <div class="card" style="padding:var(--sp-3);">
        <div class="muted" style="font-size:var(--fs-xs);">Amount</div>
        <div style="font-weight:600; color:var(--success);">${fmtUsd(alert.amount_usdt ?? alert.amountUsdt)}</div>
      </div>
    </div>
    <div style="margin-top:var(--sp-3);">
      <a class="btn" href="/watchlist?address=${encodeURIComponent(address)}">Open in Watchlist</a>
    </div>
  `;
  body.querySelector('#copy-addr').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(address);
      toast({ kind: 'success', message: 'Address copied' });
    } catch {
      toast({ kind: 'error', message: 'Clipboard unavailable' });
    }
  });
  openDrawer({ title: shortHash(address), body });
}
