// Rules page — list, edit (chip drawer + Advanced YAML), create.

import { apiGet, apiPost, apiPatch, apiDelete } from '../api.js';
import { toast } from '../ui/toast.js';
import { openDrawer, closeDrawer } from '../ui/drawer.js';

const SEVERITIES = ['P1', 'P2', 'P3'];

export async function renderRules(root) {
  root.innerHTML = `
    <div class="card" style="display:flex; align-items:center; gap:var(--sp-3);">
      <strong style="font-size:var(--fs-md);">All rules</strong>
      <span class="muted" id="rule-count" style="font-size:var(--fs-sm);"></span>
      <span style="flex:1;"></span>
      <button class="btn" id="rule-new">+ New rule</button>
    </div>
    <div id="rule-list" style="display:flex; flex-direction:column; gap:var(--sp-4); margin-top:var(--sp-4);"></div>
  `;

  const list = root.querySelector('#rule-list');
  const counter = root.querySelector('#rule-count');

  async function refresh() {
    const rows = await apiGet('/api/rules');
    counter.textContent = `${rows.length} rule${rows.length === 1 ? '' : 's'}`;
    list.innerHTML = '';
    for (const r of rows) list.appendChild(renderCard(r, refresh));
  }
  root.querySelector('#rule-new').addEventListener('click', () => openEditor(blankRule(), refresh));
  await refresh();
}

function blankRule() {
  return {
    id: `rule_${Date.now()}`,
    name: 'New rule',
    severity: 'P3',
    enabled: false,
    version: 1,
    when: [],
    then: { emit_alert: true },
  };
}

function renderCard(rule, onChanged) {
  const card = document.createElement('div');
  card.className = 'rule-card';
  const dsl = typeof rule.dsl === 'string' ? safeParse(rule.dsl) : rule.dsl;
  card.innerHTML = `
    <div class="header">
      <span class="toggle ${rule.enabled ? 'on' : ''}" data-toggle="${rule.id}"></span>
      <span class="name">${escapeHtml(rule.name)}</span>
      <span class="sev-tag ${rule.severity}">${rule.severity}</span>
      ${rule.builtIn ? '<span class="builtin">built-in</span>' : ''}
      <span style="flex:1;"></span>
      <span class="muted" style="font-size:var(--fs-xs);">fired ${rule.fireCount}× total</span>
    </div>
    <pre class="dsl">${escapeHtml(formatDslPlainEnglish(dsl))}</pre>
    <div class="chips">
      ${(dsl?.when ?? []).map((c) => `<span class="chip-cond">${escapeHtml(condLabel(c))}</span>`).join('')}
      <span class="chip-cond add">+ add condition</span>
    </div>
    <div class="footer">
      <span>${rule.builtIn ? 'Built-in — non-deletable' : 'Custom'}</span>
      <span class="edit-link" data-edit="${rule.id}">Edit conditions →</span>
    </div>
  `;
  card.querySelector(`[data-toggle="${rule.id}"]`).addEventListener('click', async () => {
    try {
      await apiPatch(`/api/rules/${rule.id}`, { ...dsl, enabled: !rule.enabled });
      toast({ kind: 'success', message: rule.enabled ? 'Disabled' : 'Enabled' });
      await onChanged();
    } catch { /* toasted */ }
  });
  card.querySelector(`[data-edit="${rule.id}"]`).addEventListener('click', () => openEditor(dsl, onChanged, { builtIn: rule.builtIn }));
  card.querySelector('.chip-cond.add').addEventListener('click', () => openEditor(dsl, onChanged, { builtIn: rule.builtIn }));
  return card;
}

function openEditor(rule, onChanged, opts = {}) {
  const body = document.createElement('div');
  body.innerHTML = `
    <div style="display:flex; flex-direction:column; gap:var(--sp-3);">
      <label class="muted" style="font-size:var(--fs-xs);">Name</label>
      <input id="ed-name" type="text" value="${escapeAttr(rule.name)}" />
      <label class="muted" style="font-size:var(--fs-xs);">Severity</label>
      <select id="ed-sev">
        ${SEVERITIES.map((s) => `<option value="${s}" ${s === rule.severity ? 'selected' : ''}>${s}</option>`).join('')}
      </select>
      <label style="display:flex; align-items:center; gap:var(--sp-2);">
        <input type="checkbox" id="ed-enabled" ${rule.enabled ? 'checked' : ''}/> Enabled
      </label>

      <strong style="margin-top:var(--sp-2);">Conditions</strong>
      <div id="ed-conds" style="display:flex; flex-direction:column; gap:var(--sp-2);"></div>
      <button class="btn ghost" id="ed-add-cond">+ Add condition</button>

      <details style="margin-top:var(--sp-3);">
        <summary class="muted" style="cursor:pointer;">Advanced — raw YAML/JSON</summary>
        <textarea id="ed-yaml" style="width:100%; height:240px; margin-top:var(--sp-2); font-family:var(--font-mono); font-size:var(--fs-sm);">${escapeHtml(JSON.stringify(rule, null, 2))}</textarea>
      </details>

      <div style="display:flex; gap:var(--sp-2); margin-top:var(--sp-3);">
        <button class="btn" id="ed-save">Save</button>
        <button class="btn ghost" id="ed-cancel">Cancel</button>
        ${!opts.builtIn ? '<span style="flex:1;"></span><button class="btn ghost" id="ed-delete" style="color:var(--danger);">Delete</button>' : ''}
      </div>
    </div>
  `;

  // Local mutable state mirrored to fields
  const state = { ...rule };

  const conds = body.querySelector('#ed-conds');
  function renderConds() {
    conds.innerHTML = state.when.map((c, idx) => `
      <div style="display:flex; gap:var(--sp-2); align-items:center;">
        <span class="chip-cond">${escapeHtml(condLabel(c))}</span>
        <button class="btn ghost" data-rm="${idx}" style="padding:2px 8px;">×</button>
      </div>
    `).join('');
    for (const btn of conds.querySelectorAll('[data-rm]')) {
      btn.addEventListener('click', () => {
        state.when.splice(Number(btn.dataset.rm), 1);
        renderConds();
        body.querySelector('#ed-yaml').value = JSON.stringify(state, null, 2);
      });
    }
  }
  renderConds();

  body.querySelector('#ed-add-cond').addEventListener('click', () => {
    // simple: append a scalar template the user can refine via the YAML textarea
    state.when.push({ field: 'amount_usdt', op: '>', value: 100 });
    renderConds();
    body.querySelector('#ed-yaml').value = JSON.stringify(state, null, 2);
  });

  body.querySelector('#ed-save').addEventListener('click', async () => {
    // Prefer YAML textarea as source of truth (it may contain user edits beyond the chip UI)
    let payload;
    try {
      payload = JSON.parse(body.querySelector('#ed-yaml').value);
    } catch {
      toast({ kind: 'error', message: 'Invalid JSON in Advanced editor' });
      return;
    }
    payload.name = body.querySelector('#ed-name').value;
    payload.severity = body.querySelector('#ed-sev').value;
    payload.enabled = body.querySelector('#ed-enabled').checked;
    try {
      await apiPost('/api/rules', payload);
      toast({ kind: 'success', message: 'Saved' });
      closeDrawer();
      await onChanged();
    } catch { /* toasted */ }
  });

  body.querySelector('#ed-cancel').addEventListener('click', closeDrawer);

  const del = body.querySelector('#ed-delete');
  if (del) {
    del.addEventListener('click', async () => {
      if (!confirm(`Delete rule "${state.name}"?`)) return;
      try {
        await apiDelete(`/api/rules/${state.id}`);
        toast({ kind: 'success', message: 'Deleted' });
        closeDrawer();
        await onChanged();
      } catch { /* toasted */ }
    });
  }

  openDrawer({ title: opts.builtIn ? `Edit: ${rule.name} (built-in)` : `Edit: ${rule.name}`, body });
}

function condLabel(c) {
  if ('field' in c) return `${c.field} ${c.op} ${JSON.stringify(c.value)}`;
  if (c.type === 'frequency') return `${c.min_count}+ tx / ${c.window_minutes}min by ${c.group_by}`;
  if (c.type === 'counterparty_label') return `${c.side} label ∈ {${c.labels_any.join(', ')}}`;
  if (c.type === 'repeat_to_same') return `repeat_to_same × ${c.window_size}`;
  if (c.type === 'repeat_from_same') return `repeat_from_same × ${c.window_size}`;
  return JSON.stringify(c);
}

function formatDslPlainEnglish(dsl) {
  if (!dsl) return '';
  const conds = (dsl.when ?? []).map(condLabel);
  return `WHEN ${conds.join('\n AND ')}\nTHEN raise ${dsl.severity} alert${dsl.then?.emit_alert ? '' : ' (no emit — dry run)'}`;
}

function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }
function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c])); }
function escapeAttr(s) { return String(s ?? '').replace(/"/g, '&quot;'); }
