// Filter bar: chain chips + amount min + time range + rule selector.
// Emits change events; consumer reads getState().

export function createFilterBar({ onChange } = {}) {
  const state = {
    chains: new Set(['eth', 'bsc', 'btc']),
    minUsd: 100,
    timeWindowHours: 24,
    rule: 'any',
  };

  const el = document.createElement('div');
  el.style.display = 'flex';
  el.style.flexWrap = 'wrap';
  el.style.gap = 'var(--sp-2)';
  el.style.alignItems = 'center';

  const chainChip = (chain) => {
    const c = document.createElement('button');
    c.className = `chip ${chain} ${state.chains.has(chain) ? 'active' : ''}`;
    c.innerHTML = `<span class="dot"></span>${chain.toUpperCase()}`;
    c.addEventListener('click', () => {
      if (state.chains.has(chain)) state.chains.delete(chain);
      else state.chains.add(chain);
      c.classList.toggle('active');
      onChange?.(state);
    });
    return c;
  };

  el.appendChild(chainChip('eth'));
  el.appendChild(chainChip('bsc'));
  el.appendChild(chainChip('btc'));

  const sep = document.createElement('div');
  sep.style.width = '1px';
  sep.style.height = '20px';
  sep.style.background = 'var(--border)';
  sep.style.margin = '0 var(--sp-2)';
  el.appendChild(sep);

  const amt = document.createElement('select');
  amt.className = 'chip';
  amt.style.cursor = 'pointer';
  for (const v of [100, 500, 1000, 5000, 10000]) {
    const o = document.createElement('option');
    o.value = String(v);
    o.textContent = `> $${v}`;
    amt.appendChild(o);
  }
  amt.value = String(state.minUsd);
  amt.addEventListener('change', () => {
    state.minUsd = Number(amt.value);
    onChange?.(state);
  });
  el.appendChild(amt);

  const time = document.createElement('select');
  time.className = 'chip';
  time.style.cursor = 'pointer';
  for (const [v, label] of [[1, 'Last 1h'], [6, 'Last 6h'], [24, 'Last 24h'], [168, 'Last 7d'], [0, 'All time']]) {
    const o = document.createElement('option');
    o.value = String(v);
    o.textContent = label;
    time.appendChild(o);
  }
  time.value = String(state.timeWindowHours);
  time.addEventListener('change', () => {
    state.timeWindowHours = Number(time.value);
    onChange?.(state);
  });
  el.appendChild(time);

  const rule = document.createElement('select');
  rule.className = 'chip';
  rule.style.cursor = 'pointer';
  for (const [v, label] of [['any', 'Any rule'], ['sender_repeats_to', 'Sender repeats'], ['receiver_repeats_from', 'Receiver gather']]) {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = label;
    rule.appendChild(o);
  }
  rule.value = state.rule;
  rule.addEventListener('change', () => {
    state.rule = rule.value;
    onChange?.(state);
  });
  el.appendChild(rule);

  return { el, state, getState: () => state };
}

export function matchesFilter(alert, state) {
  if (!state.chains.has(alert.chain)) return false;
  const amt = Number(alert.amount_usdt ?? alert.amountUsdt ?? 0);
  if (amt < state.minUsd) return false;
  if (state.timeWindowHours > 0) {
    const created = alert.created_at ?? alert.createdAt ?? 0;
    const cutoff = Math.floor(Date.now() / 1000) - state.timeWindowHours * 3600;
    if (created < cutoff) return false;
  }
  if (state.rule !== 'any' && alert.rule !== state.rule) return false;
  return true;
}
