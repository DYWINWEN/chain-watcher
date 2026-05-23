import { apiGet } from '../api.js';

export async function renderStats(root) {
  root.innerHTML = `
    <div class="card">
      <div style="display:flex; align-items:center; gap:var(--sp-3);">
        <strong>Alerts / hour</strong>
        <span class="muted">last 7 days</span>
      </div>
      <canvas id="stats-chart" style="margin-top:var(--sp-4); width:100%; max-height:360px;"></canvas>
    </div>
    <div id="stats-totals"></div>
  `;

  let data;
  try { data = await apiGet('/api/stats'); } catch { return; }

  // Bucket by hour with chain breakdown
  const buckets = new Map();
  for (const r of data.alertBuckets) {
    const ts = new Date(r.bucket * 1000).toLocaleString();
    if (!buckets.has(ts)) buckets.set(ts, { ts });
    buckets.get(ts)[r.chain] = r.n;
  }
  const labels = [...buckets.keys()];
  const datasets = ['eth', 'bsc', 'btc'].map((c) => ({
    label: c.toUpperCase(),
    data: labels.map((l) => buckets.get(l)[c] ?? 0),
    borderColor: getComputedStyle(document.documentElement).getPropertyValue(`--chain-${c}`).trim(),
    tension: 0.25,
  }));

  // eslint-disable-next-line no-undef
  new Chart(root.querySelector('#stats-chart'), {
    type: 'line',
    data: { labels, datasets },
    options: { plugins: { legend: { labels: { color: getComputedStyle(document.documentElement).getPropertyValue('--text').trim() } } }, scales: { x: { ticks: { color: getComputedStyle(document.documentElement).getPropertyValue('--text-muted').trim() } }, y: { ticks: { color: getComputedStyle(document.documentElement).getPropertyValue('--text-muted').trim() } } } },
  });

  const totals = root.querySelector('#stats-totals');
  totals.className = 'card';
  totals.style.marginTop = 'var(--sp-4)';
  totals.innerHTML = `
    <strong>Total transactions by chain</strong>
    <table style="margin-top:var(--sp-3); width:100%;">
      <thead><tr><th>Chain</th><th>Count</th></tr></thead>
      <tbody>${data.txTotals.map((r) => `<tr><td style="color:var(--chain-${r.chain});">${r.chain.toUpperCase()}</td><td>${r.n}</td></tr>`).join('')}</tbody>
    </table>
  `;
}
