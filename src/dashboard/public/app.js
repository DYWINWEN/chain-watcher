// chain-watcher dashboard — vanilla JS router, fetch + SSE.

const root = document.getElementById('root');
const sseStatus = document.getElementById('sse-status');

const sse = new EventSource('/sse');
sse.onopen = () => (sseStatus.textContent = 'SSE: live');
sse.onerror = () => (sseStatus.textContent = 'SSE: disconnected');

const routes = {
  '/alerts': renderAlerts,
  '/watchlist': renderWatchlist,
  '/stats': renderStats,
  '/settings': renderSettings,
};

const path = location.pathname;
(routes[path] ?? routes['/alerts'])();

function fmtTime(ts) {
  return new Date(ts * 1000).toLocaleString();
}
function shortHash(h) {
  return h.length > 18 ? h.slice(0, 10) + '…' + h.slice(-6) : h;
}

// -------- Alerts --------
async function renderAlerts() {
  root.innerHTML = `
    <h2>Recent Alerts</h2>
    <table id="alerts">
      <thead><tr>
        <th>id</th><th>time</th><th>chain</th><th>rule</th>
        <th>pivot</th><th>counterparty</th><th>trigger tx</th><th>amount</th>
      </tr></thead>
      <tbody></tbody>
    </table>`;
  const tbody = root.querySelector('tbody');
  const data = await fetch('/api/alerts').then((r) => r.json());
  for (const a of data) tbody.append(alertRow(a));
  sse.addEventListener('alert', (e) => {
    const a = JSON.parse(e.data);
    const tr = alertRow(a);
    tr.classList.add('row-new');
    tbody.prepend(tr);
    setTimeout(() => tr.classList.remove('row-new'), 1500);
  });
}
function alertRow(a) {
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td>${a.id}</td>
    <td class="muted">${fmtTime(a.created_at ?? a.createdAt)}</td>
    <td class="chain-${a.chain}">${a.chain}</td>
    <td>${a.rule}</td>
    <td><code>${shortHash(a.pivot_address ?? a.pivotAddress)}</code></td>
    <td><code>${shortHash(a.counterparty)}</code></td>
    <td><code>${shortHash(a.trigger_tx_hash ?? a.triggerTxHash)}</code></td>
    <td>$${Number(a.amount_usdt ?? a.amountUsdt).toFixed(2)}</td>`;
  return tr;
}

// -------- Watchlist --------
async function renderWatchlist() {
  root.innerHTML = `
    <h2>Address Windows</h2>
    <p><input id="addr" placeholder="0x… or bc1…" style="width:420px" />
       <button id="go">Lookup</button></p>
    <div id="wins"></div>`;
  const input = root.querySelector('#addr');
  const out = root.querySelector('#wins');
  root.querySelector('#go').onclick = lookup;
  input.addEventListener('keypress', (e) => e.key === 'Enter' && lookup());
  async function lookup() {
    const addr = input.value.trim();
    if (!addr) return;
    out.textContent = 'loading…';
    const rows = await fetch(`/api/windows?address=${encodeURIComponent(addr)}`).then((r) => r.json());
    if (!rows.length) {
      out.innerHTML = '<p class="muted">no windows for this address</p>';
      return;
    }
    out.innerHTML = '';
    for (const w of rows) {
      const div = document.createElement('section');
      div.innerHTML = `
        <h3 class="chain-${w.chain}">${w.chain} / ${w.direction}  ${w.backfilled ? '<span class="muted">(backfilled)</span>' : ''}</h3>
        <p class="muted">updated ${fmtTime(w.updated_at)}</p>
        <table><thead><tr><th>#</th><th>counterparty</th><th>tx</th></tr></thead><tbody></tbody></table>`;
      const tb = div.querySelector('tbody');
      w.counterparties.forEach((cp, i) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${i + 1}</td><td><code>${shortHash(cp)}</code></td><td><code>${shortHash(w.last_tx_hashes[i] ?? '')}</code></td>`;
        tb.append(tr);
      });
      out.append(div);
    }
  }
}

// -------- Stats --------
async function renderStats() {
  root.innerHTML = `
    <h2>Stats (7d)</h2>
    <div style="max-width:800px"><canvas id="chart"></canvas></div>
    <h3>Total tx by chain</h3>
    <table id="totals"><thead><tr><th>chain</th><th>tx count</th></tr></thead><tbody></tbody></table>`;
  const data = await fetch('/api/stats').then((r) => r.json());
  const tb = root.querySelector('#totals tbody');
  for (const t of data.txTotals) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td class="chain-${t.chain}">${t.chain}</td><td>${t.n}</td>`;
    tb.append(tr);
  }
  // alertBuckets: [{bucket, chain, n}]
  const byChain = {};
  for (const row of data.alertBuckets) {
    (byChain[row.chain] ??= []).push({ x: row.bucket * 1000, y: row.n });
  }
  const colors = { eth: '#58a6ff', bsc: '#f0b72f', btc: '#ff7b72' };
  const datasets = Object.entries(byChain).map(([chain, pts]) => ({
    label: chain,
    data: pts,
    borderColor: colors[chain] ?? '#aaa',
    backgroundColor: colors[chain] ?? '#aaa',
    tension: 0.3,
  }));
  new Chart(root.querySelector('#chart'), {
    type: 'line',
    data: { datasets },
    options: {
      parsing: false,
      scales: {
        x: { type: 'linear', ticks: { callback: (v) => new Date(v).toLocaleDateString() } },
        y: { beginAtZero: true, ticks: { precision: 0 } },
      },
    },
  });
}

// -------- Settings --------
async function renderSettings() {
  const [settings, audit] = await Promise.all([
    fetch('/api/settings').then((r) => r.json()),
    fetch('/api/audit').then((r) => r.json()),
  ]);
  root.innerHTML = `
    <h2>Settings (changes apply immediately)</h2>
    <div class="settings-grid">
      <section>
        <h2>Thresholds & Rules</h2>
        <div id="g-rules"></div>
      </section>
      <section>
        <h2>Chains</h2>
        <div id="g-chains"></div>
      </section>
      <section>
        <h2>Notifiers</h2>
        <div id="g-tg"></div>
      </section>
      <section>
        <h2>Backfill & Workers</h2>
        <div id="g-misc"></div>
      </section>
    </div>
    <h3 style="margin-top:1.5rem">Address Lists</h3>
    <div class="lists" id="lists"></div>
    <h3 style="margin-top:1.5rem">Recent changes</h3>
    <div class="audit" id="audit"></div>`;

  const groups = {
    'g-rules': ['threshold_usdt', 'blacklist_cex',
      'rule.sender_repeats_to.enabled', 'rule.sender_repeats_to.window_size',
      'rule.receiver_repeats_from.enabled', 'rule.receiver_repeats_from.window_size'],
    'g-chains': ['chain.eth.enabled', 'chain.eth.ws_url', 'chain.eth.usdt_contract',
      'chain.bsc.enabled', 'chain.bsc.ws_url', 'chain.bsc.usdt_contract',
      'chain.btc.enabled', 'chain.btc.ws_url', 'chain.btc.api_base'],
    'g-tg': ['telegram.enabled', 'telegram.bot_token', 'telegram.chat_id', 'telegram.min_level'],
    'g-misc': ['backfill.enabled', 'backfill.concurrency', 'backfill.history_window',
      'workers.decoder_concurrency', 'workers.rule_concurrency', 'price_oracle.ttl_seconds', 'dashboard.port'],
  };
  for (const [gid, keys] of Object.entries(groups)) {
    const host = root.querySelector('#' + gid);
    for (const k of keys) {
      if (!(k in settings)) continue;
      host.append(settingRow(k, settings[k]));
    }
  }

  const auditHost = root.querySelector('#audit');
  for (const a of audit) {
    const d = document.createElement('div');
    d.className = 'audit-entry';
    d.innerHTML = `<span class="muted">${fmtTime(a.ts)}</span> [${a.updated_by}] <code>${a.key}</code>: ${escape(a.old_value)} → ${escape(a.new_value)}`;
    auditHost.append(d);
  }
  sse.addEventListener('config', (e) => {
    const p = JSON.parse(e.data);
    const d = document.createElement('div');
    d.className = 'audit-entry';
    d.innerHTML = `<span class="muted">just now</span> [live] <code>${p.key}</code> = ${escape(JSON.stringify(p.value))}`;
    auditHost.prepend(d);
  });

  // address lists CRUD
  renderListsPanel();
}

function settingRow(key, value) {
  const row = document.createElement('div');
  row.className = 'setting-row';
  const labelHtml = `<label>${key}</label>`;
  let inputHtml;
  let cast;
  if (typeof value === 'boolean') {
    inputHtml = `<select><option value="true" ${value ? 'selected' : ''}>true</option><option value="false" ${!value ? 'selected' : ''}>false</option></select>`;
    cast = (v) => v === 'true';
  } else if (typeof value === 'number') {
    inputHtml = `<input type="number" value="${value}" />`;
    cast = (v) => Number(v);
  } else {
    inputHtml = `<input type="text" value="${escapeAttr(String(value ?? ''))}" />`;
    cast = (v) => v;
  }
  row.innerHTML = `${labelHtml}${inputHtml}<span class="status"></span>`;
  const ctrl = row.querySelector('input, select');
  const status = row.querySelector('.status');
  ctrl.addEventListener('change', async () => {
    const next = cast(ctrl.value);
    const danger = /ws_url|usdt_contract|api_base/.test(key);
    if (danger && !confirm(`Update ${key}? Connections will be reset.`)) {
      return;
    }
    status.textContent = 'saving…';
    try {
      const res = await fetch('/api/settings/' + encodeURIComponent(key), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ value: next, updated_by: 'dashboard' }),
      });
      if (!res.ok) throw new Error(await res.text());
      status.textContent = 'saved';
      status.className = 'status saved';
    } catch (err) {
      status.textContent = 'error';
      status.className = 'status error';
      console.error(err);
    }
  });
  return row;
}

async function renderListsPanel() {
  const host = document.getElementById('lists');
  if (!host) return;
  for (const lt of ['cex_blacklist', 'user_whitelist', 'user_blacklist']) {
    const rows = await fetch(`/api/lists/${lt}`).then((r) => r.json());
    const section = document.createElement('section');
    section.innerHTML = `
      <h4>${lt} (${rows.length})</h4>
      <table><thead><tr><th>chain</th><th>address</th><th>label</th><th></th></tr></thead><tbody></tbody></table>
      <p>
        <select class="lt-chain"><option>eth</option><option>bsc</option><option>btc</option><option value="*">*</option></select>
        <input class="lt-addr" placeholder="address" />
        <input class="lt-label" placeholder="label" />
        <button>Add</button>
      </p>`;
    const tb = section.querySelector('tbody');
    for (const r of rows) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${r.chain}</td><td><code>${r.address}</code></td><td>${escape(r.label || '')}</td>
        <td><button class="danger">×</button></td>`;
      tr.querySelector('button').onclick = async () => {
        if (!confirm(`Remove ${r.address}?`)) return;
        await fetch(`/api/lists/${lt}/${r.chain}/${encodeURIComponent(r.address)}`, { method: 'DELETE' });
        tr.remove();
      };
      tb.append(tr);
    }
    section.querySelector('button').onclick = async () => {
      const chain = section.querySelector('.lt-chain').value;
      const address = section.querySelector('.lt-addr').value.trim();
      const label = section.querySelector('.lt-label').value.trim();
      if (!address) return;
      await fetch(`/api/lists/${lt}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chain, address, label }),
      });
      renderSettings(); // refresh page
    };
    host.append(section);
  }
}

function escape(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}
function escapeAttr(s) {
  return escape(s).replace(/"/g, '&quot;');
}
