import { apiGet } from '../api.js';

const RANGES = [
  { hours: 1, label: 'Last 1h' },
  { hours: 6, label: 'Last 6h' },
  { hours: 24, label: 'Last 24h' },
  { hours: 168, label: 'Last 7d' },
];

export async function renderStats(root) {
  root.innerHTML = `
    <div class="card" style="display:flex; gap:var(--sp-2); align-items:center;">
      <strong style="margin-right:var(--sp-2);">Range</strong>
      ${RANGES.map((r) => `<button class="chip range-btn" data-hours="${r.hours}">${r.label}</button>`).join('')}
    </div>

    <div id="stats-charts" style="display:grid; grid-template-columns: 1fr; gap:var(--sp-3); margin-top:var(--sp-3);"></div>

    <div id="stats-totals" style="display:grid; grid-template-columns: 1fr 1fr; gap:var(--sp-3); margin-top:var(--sp-3);"></div>
  `;

  let activeHours = 168;
  let chartByChain = null;
  let chartByRule = null;
  const buttons = root.querySelectorAll('.range-btn');

  function setActive(h) {
    activeHours = h;
    for (const b of buttons) b.classList.toggle('active', Number(b.dataset.hours) === h);
  }
  for (const btn of buttons) {
    btn.addEventListener('click', () => {
      setActive(Number(btn.dataset.hours));
      void refresh();
    });
  }
  setActive(168);

  async function refresh() {
    let data;
    try {
      data = await apiGet(`/api/stats?hours=${activeHours}`);
    } catch { return; }
    renderCharts(data);
    renderTotals(data);
  }

  function renderCharts(data) {
    const host = root.querySelector('#stats-charts');
    host.innerHTML = `
      <div class="card">
        <strong>Alerts by chain</strong>
        <div class="muted" style="font-size:var(--fs-sm);">over the selected range</div>
        <canvas id="chart-chain" style="margin-top:var(--sp-3); width:100%; max-height:280px;"></canvas>
      </div>
      <div class="card">
        <strong>Alerts by rule</strong>
        <div class="muted" style="font-size:var(--fs-sm);">over the selected range</div>
        <canvas id="chart-rule" style="margin-top:var(--sp-3); width:100%; max-height:280px;"></canvas>
      </div>
    `;
    const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

    // Aggregate by chain
    const chainBuckets = new Map();
    const ruleBuckets = new Map();
    for (const b of data.alertBuckets) {
      if (!chainBuckets.has(b.bucket)) chainBuckets.set(b.bucket, { bucket: b.bucket });
      chainBuckets.get(b.bucket)[b.chain] = (chainBuckets.get(b.bucket)[b.chain] ?? 0) + b.n;
      if (!ruleBuckets.has(b.bucket)) ruleBuckets.set(b.bucket, { bucket: b.bucket });
      ruleBuckets.get(b.bucket)[b.rule] = (ruleBuckets.get(b.bucket)[b.rule] ?? 0) + b.n;
    }
    const labels = [...chainBuckets.keys()].sort((a, b) => a - b).map((ts) => new Date(ts * 1000).toLocaleString());

    const chainDatasets = ['eth', 'bsc', 'btc'].map((c) => ({
      label: c.toUpperCase(),
      data: [...chainBuckets.values()].map((b) => b[c] ?? 0),
      borderColor: css(`--chain-${c}`),
      tension: 0.25,
    }));
    const ruleDatasets = ['sender_repeats_to', 'receiver_repeats_from'].map((r, i) => ({
      label: r === 'sender_repeats_to' ? 'Sender repeats' : 'Receiver gather',
      data: [...ruleBuckets.values()].map((b) => b[r] ?? 0),
      borderColor: i === 0 ? css('--accent-soft') : css('--success'),
      tension: 0.25,
    }));

    if (chartByChain) chartByChain.destroy();
    if (chartByRule) chartByRule.destroy();
    /* global Chart */
    const opts = { plugins: { legend: { labels: { color: css('--text') } } }, scales: { x: { ticks: { color: css('--text-muted') } }, y: { ticks: { color: css('--text-muted') }, beginAtZero: true } } };
    chartByChain = new Chart(root.querySelector('#chart-chain'), { type: 'line', data: { labels, datasets: chainDatasets }, options: opts });
    chartByRule = new Chart(root.querySelector('#chart-rule'), { type: 'line', data: { labels, datasets: ruleDatasets }, options: opts });
  }

  function renderTotals(data) {
    const host = root.querySelector('#stats-totals');
    host.innerHTML = `
      <div class="card">
        <strong>Transactions by chain</strong>
        <table style="width:100%; margin-top:var(--sp-3); font-size:var(--fs-sm);">
          <thead><tr><th style="text-align:left; color:var(--text-muted); font-weight:500;">Chain</th><th style="text-align:left; color:var(--text-muted); font-weight:500;">Count</th></tr></thead>
          <tbody>${data.txTotals.map((r) => `<tr style="border-top:1px solid var(--border);"><td style="padding:var(--sp-2);"><strong style="color:var(--chain-${r.chain});">${r.chain.toUpperCase()}</strong></td><td style="padding:var(--sp-2);">${r.n.toLocaleString()}</td></tr>`).join('')}</tbody>
        </table>
      </div>
      <div class="card">
        <strong>Alerts by rule</strong>
        <table style="width:100%; margin-top:var(--sp-3); font-size:var(--fs-sm);">
          <thead><tr><th style="text-align:left; color:var(--text-muted); font-weight:500;">Rule</th><th style="text-align:left; color:var(--text-muted); font-weight:500;">Count</th></tr></thead>
          <tbody>${data.ruleTotals.map((r) => `<tr style="border-top:1px solid var(--border);"><td style="padding:var(--sp-2);">${r.rule}</td><td style="padding:var(--sp-2);">${r.n.toLocaleString()}</td></tr>`).join('')}</tbody>
        </table>
      </div>
    `;
  }

  await refresh();
}
