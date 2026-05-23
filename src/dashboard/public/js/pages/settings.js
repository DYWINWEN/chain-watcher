import { apiGet, apiPatch, apiPost, apiDelete } from '../api.js';
import { toast } from '../ui/toast.js';
import { onSse } from '../sse.js';
import { fmtTime } from '../format.js';

export async function renderSettings(root) {
  root.innerHTML = `
    <div id="settings-grid" style="display:grid; grid-template-columns: repeat(2, 1fr); gap:var(--sp-4);"></div>
    <div id="lists-section"></div>
    <div id="audit-section"></div>
  `;
  const grid = root.querySelector('#settings-grid');
  const listsSection = root.querySelector('#lists-section');
  const auditSection = root.querySelector('#audit-section');

  const settings = await apiGet('/api/settings');

  // Group keys for the UI — same groupings as v1.
  const groups = [
    { title: 'Thresholds & rules', keys: ['threshold_usdt', 'blacklist_cex', 'rule.sender_repeats_to.enabled', 'rule.sender_repeats_to.window_size', 'rule.receiver_repeats_from.enabled', 'rule.receiver_repeats_from.window_size'] },
    { title: 'Chains', keys: ['chain.eth.enabled', 'chain.eth.ws_url', 'chain.eth.ws_urls', 'chain.eth.usdt_contract', 'chain.bsc.enabled', 'chain.bsc.ws_url', 'chain.bsc.ws_urls', 'chain.bsc.usdt_contract', 'chain.btc.enabled', 'chain.btc.ws_url', 'chain.btc.ws_urls', 'chain.btc.api_base'] },
    { title: 'Notifiers', keys: ['telegram.enabled', 'telegram.bot_token', 'telegram.chat_id', 'telegram.min_level'] },
    { title: 'Backfill & workers', keys: ['backfill.enabled', 'backfill.concurrency', 'backfill.history_window', 'workers.decoder_concurrency', 'workers.rule_concurrency', 'price_oracle.ttl_seconds', 'dashboard.port'] },
  ];

  for (const g of groups) {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `<h2 style="font-size:var(--fs-md); margin:0 0 var(--sp-3); color:var(--accent-soft);">${g.title}</h2>`;
    for (const key of g.keys) {
      if (!(key in settings)) continue;
      card.appendChild(settingRow(key, settings[key]));
    }
    grid.appendChild(card);
  }

  // Address lists (cex_blacklist, user_whitelist, user_blacklist) — port the v1 UI faithfully.
  listsSection.className = 'card';
  listsSection.style.marginTop = 'var(--sp-4)';
  listsSection.innerHTML = `<h2 style="font-size:var(--fs-md); margin:0 0 var(--sp-3); color:var(--accent-soft);">Address lists</h2>
    <div id="lists-body" style="display:flex; flex-direction:column; gap:var(--sp-4);"></div>`;
  await renderLists(listsSection.querySelector('#lists-body'));

  // Recent changes audit
  auditSection.className = 'card';
  auditSection.style.marginTop = 'var(--sp-4)';
  auditSection.innerHTML = `<h2 style="font-size:var(--fs-md); margin:0 0 var(--sp-3); color:var(--accent-soft);">Recent changes</h2>
    <div id="audit-body" style="display:flex; flex-direction:column; gap:var(--sp-2); max-height:240px; overflow-y:auto;"></div>`;
  await renderAudit(auditSection.querySelector('#audit-body'));

  onSse('config', () => void renderAudit(auditSection.querySelector('#audit-body')));

  // M10: label sources card
  const sourcesCard = document.createElement('div');
  sourcesCard.className = 'card';
  sourcesCard.style.marginTop = 'var(--sp-4)';
  sourcesCard.innerHTML = `<h2 style="font-size:var(--fs-md); margin:0 0 var(--sp-3); color:var(--accent-soft);">Label sources</h2>
    <div id="sources-body" style="display:flex; flex-direction:column; gap:var(--sp-3);"></div>`;
  root.appendChild(sourcesCard);
  await renderLabelSources(sourcesCard.querySelector('#sources-body'));
}

function settingRow(key, currentValue) {
  const row = document.createElement('div');
  row.style.display = 'flex';
  row.style.alignItems = 'center';
  row.style.gap = 'var(--sp-3)';
  row.style.marginBottom = 'var(--sp-2)';

  const label = document.createElement('label');
  label.style.flex = '1';
  label.style.fontSize = 'var(--fs-sm)';
  label.style.color = 'var(--text-muted)';
  label.textContent = key;
  row.appendChild(label);

  const editor = makeEditor(key, currentValue);
  row.appendChild(editor);

  return row;
}

function makeEditor(key, current) {
  // Boolean — checkbox
  if (typeof current === 'boolean') {
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = current;
    cb.addEventListener('change', () => save(key, cb.checked));
    return cb;
  }
  // Array — textarea (json)
  if (Array.isArray(current)) {
    const ta = document.createElement('input');
    ta.type = 'text';
    ta.style.minWidth = '260px';
    ta.value = JSON.stringify(current);
    ta.addEventListener('blur', () => {
      try { save(key, JSON.parse(ta.value)); } catch { toast({ kind: 'error', message: 'invalid JSON' }); }
    });
    return ta;
  }
  // Number — text input parsed as number
  if (typeof current === 'number') {
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.value = String(current);
    inp.style.width = '160px';
    inp.addEventListener('blur', () => save(key, Number(inp.value)));
    return inp;
  }
  // Default — string
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.value = current ?? '';
  inp.style.minWidth = '260px';
  inp.addEventListener('blur', () => save(key, inp.value));
  return inp;
}

async function save(key, value) {
  try {
    await apiPatch(`/api/settings/${encodeURIComponent(key)}`, { value, updated_by: 'dashboard' });
    toast({ kind: 'success', message: `${key} updated` });
  } catch {
    /* api.js already toasted */
  }
}

async function renderLists(body) {
  body.innerHTML = '';
  for (const type of ['cex_blacklist', 'user_whitelist', 'user_blacklist']) {
    const rows = await apiGet(`/api/lists/${type}`);
    const block = document.createElement('div');
    block.innerHTML = `
      <div style="display:flex;align-items:center;gap:var(--sp-2);"><strong>${type}</strong><span class="muted">(${rows.length})</span></div>
      <table style="width:100%; margin-top:var(--sp-2);">
        <thead><tr><th>Chain</th><th>Address</th><th>Label</th><th></th></tr></thead>
        <tbody>
          ${rows.map((r) => `<tr><td>${r.chain}</td><td><code class="mono">${r.address}</code></td><td>${r.label ?? ''}</td><td><button class="btn ghost" data-del='${r.chain}|${r.address}'>×</button></td></tr>`).join('')}
        </tbody>
      </table>
      <div style="display:flex;gap:var(--sp-2);margin-top:var(--sp-2);">
        <select class="chain-sel"><option>eth</option><option>bsc</option><option>btc</option></select>
        <input class="addr" placeholder="0x… / bc1…" style="flex:1;" />
        <input class="label-inp" placeholder="label" />
        <button class="btn add">Add</button>
      </div>
    `;
    block.querySelector('.add').addEventListener('click', async () => {
      const chain = block.querySelector('.chain-sel').value;
      const address = block.querySelector('.addr').value.trim();
      const label = block.querySelector('.label-inp').value.trim();
      if (!address) return;
      try {
        await apiPost(`/api/lists/${type}`, { chain, address, label });
        toast({ kind: 'success', message: 'Added' });
        await renderLists(body);
      } catch { /* toasted */ }
    });
    for (const btn of block.querySelectorAll('[data-del]')) {
      btn.addEventListener('click', async () => {
        const [chain, address] = btn.dataset.del.split('|');
        await apiDelete(`/api/lists/${type}/${chain}/${address}`);
        toast({ kind: 'success', message: 'Removed' });
        await renderLists(body);
      });
    }
    body.appendChild(block);
  }
}

async function renderAudit(body) {
  const rows = await apiGet('/api/audit');
  body.innerHTML = rows.map((r) =>
    `<div style="display:flex;gap:var(--sp-3);font-size:var(--fs-sm);">
       <span class="muted" style="min-width:140px;">${fmtTime(r.ts)}</span>
       <span class="muted">[${r.updated_by}]</span>
       <span style="flex:1;">${r.key} = ${r.new_value}</span>
     </div>`
  ).join('');
}

async function renderLabelSources(body) {
  const sources = await apiGet('/api/labels/sources');
  if (!sources.length) {
    body.innerHTML = `<div class="muted">No labels imported yet.</div>`;
    return;
  }
  body.innerHTML = sources.map((s) => `
    <div style="display:flex; align-items:center; gap:var(--sp-3);">
      <strong style="min-width:140px;">${s.source}</strong>
      <span class="muted">${s.rowCount.toLocaleString()} rows</span>
      <span class="muted">·</span>
      <span class="muted">${s.lastFetchedAt ? fmtTime(s.lastFetchedAt) : 'never'}</span>
      <span style="flex:1;"></span>
      <span class="tag ${s.status === 'ok' ? 'cex' : 'ofac'}" data-status="${s.status}">${s.status.toUpperCase()}</span>
      ${s.source === 'ofac_sdn' ? `<button class="btn ghost" data-refresh="${s.source}">Refresh now</button>` : ''}
    </div>
  `).join('');

  for (const btn of body.querySelectorAll('[data-refresh]')) {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = 'Refreshing…';
      try {
        await apiPost('/api/labels/refresh', { source: btn.dataset.refresh });
        toast({ kind: 'success', message: 'OFAC refresh started — check status in a moment' });
      } catch { /* api.js already toasted */ }
      // Re-render after a short delay so the status reflects.
      setTimeout(() => void renderLabelSources(body), 1500);
    });
  }
}
