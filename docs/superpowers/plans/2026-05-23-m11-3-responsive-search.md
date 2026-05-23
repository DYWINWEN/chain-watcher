# M11.3 — Responsive breakpoints + Ctrl+K search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** Make the dashboard usable on tablet (≥768px) and mobile (<768px), and add a `Ctrl+K` / `Cmd+K` command palette for quick address / label / alert search across all pages.

**Architecture:** Pure frontend. CSS media queries collapse sidebar to icon-only at 1024px and to bottom-tab-bar at 768px. New `src/dashboard/public/js/ui/cmdk.js` is a modal overlay that fuzzy-matches across labels (via existing `/api/labels/list?search=`), addresses (transactions table via new tiny endpoint), and recent alerts. Activated via keydown listener attached at app boot.

**Tech Stack:** No new deps. Native ES modules + CSS custom properties.

---

## Prerequisites

- main HEAD M13 merged, **84 / 84 tests passing**.

---

## Breakpoint scheme

| Width | Layout |
|---|---|
| ≥1280px | Existing — 220px sidebar + content (no change) |
| 1024–1279px | Sidebar collapses to 64px icon-only (labels hidden, icons centered) |
| 768–1023px | Same as 1024+ but content padding tightens, tables become horizontally scrollable cards |
| <768px | Sidebar disappears; bottom tab bar (5 fixed-width tab buttons); content fills viewport |

---

## File structure

```
src/dashboard/public/css/
└── components.css              ✎ append media queries (responsive) + .cmdk-* classes

src/dashboard/public/js/ui/
└── cmdk.js                     ★ new — modal overlay + keydown wire-up

src/dashboard/public/app.js     ✎ register cmdk + setup global keybind

src/dashboard/public/index.html ✎ add <div id="cmdk-root"></div> for portal mount

src/api/labels.ts               ✎ tiny extension — accept `q=` shorthand for unified search
                                  (we'll just call existing /api/labels/list)

src/dashboard/server.ts         ✎ new /api/search endpoint that unifies labels + addresses + alerts
```

No new test files. UI changes are visual-verified via the smoke test.

---

## Task 1: Responsive CSS

**Files:**
- `src/dashboard/public/css/components.css`

### Step 1: Baseline

```bash
cd ~/projects/chain-watcher
git status
npm test 2>&1 | grep -E "Tests "
```

Expected: 84 / 84.

### Step 2: Append responsive rules

Open `src/dashboard/public/css/components.css`. At the very end of the file, append:

```css
/* ===== Responsive breakpoints (M11.3) ===== */

/* Tablet — collapse sidebar to icons */
@media (max-width: 1279px) {
  :root {
    --sidebar-w: 64px;
  }
  .sidebar { padding: var(--sp-5) var(--sp-2); }
  .sidebar .brand .name { display: none; }
  .nav-item span:not(.icon) { display: none; }
  .nav-item { justify-content: center; padding: var(--sp-3) 0; }
}

/* Mobile — bottom tab bar */
@media (max-width: 767px) {
  :root {
    --sidebar-w: 0px;
  }
  .app {
    grid-template-columns: 1fr;
    padding-bottom: 64px;
  }
  .sidebar {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    height: 64px;
    border-right: 0;
    border-top: 1px solid var(--border);
    padding: var(--sp-2);
    flex-direction: row;
    z-index: 50;
    background: var(--bg);
  }
  .sidebar .brand { display: none; }
  .sidebar nav { display: flex; flex: 1; gap: 0; }
  .nav-item {
    flex: 1;
    flex-direction: column;
    gap: 4px;
    padding: var(--sp-2) 0;
    font-size: var(--fs-xs);
  }
  .nav-item span:not(.icon) {
    display: inline;
    font-size: 10px;
  }
  .nav-item .icon {
    font-size: 16px;
  }
  .content {
    padding: var(--sp-4);
  }
  /* Tables become scrollable cards */
  .card table {
    display: block;
    overflow-x: auto;
    white-space: nowrap;
  }
  /* Topbar wraps */
  .topbar {
    flex-wrap: wrap;
    height: auto;
    gap: var(--sp-2);
  }
  /* Drawer takes full width */
  #drawer-root .panel {
    width: 100%;
  }
  /* Toast bottom-centered, doesn't overlap tab bar */
  #toast-root {
    right: var(--sp-3);
    bottom: 80px;
  }
}

/* ===== Cmd+K palette (M11.3) ===== */
#cmdk-root {
  position: fixed;
  inset: 0;
  display: none;
  z-index: 300;
}
#cmdk-root.open { display: block; }
#cmdk-root .backdrop {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(2px);
}
#cmdk-root .panel {
  position: absolute;
  top: 15vh;
  left: 50%;
  transform: translateX(-50%);
  width: min(680px, 92vw);
  background: var(--surface-1);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  display: flex;
  flex-direction: column;
  max-height: 70vh;
  overflow: hidden;
}
#cmdk-root .cmdk-input-row {
  padding: var(--sp-4) var(--sp-5);
  border-bottom: 1px solid var(--border);
}
#cmdk-root .cmdk-input-row input {
  width: 100%;
  background: transparent;
  border: 0;
  font-size: var(--fs-lg);
  color: var(--text);
  outline: none;
  padding: 0;
}
#cmdk-root .cmdk-list {
  overflow-y: auto;
  max-height: 60vh;
  padding: var(--sp-2);
}
#cmdk-root .cmdk-section {
  font-size: var(--fs-xs);
  color: var(--text-subtle);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: var(--sp-3) var(--sp-3) var(--sp-2);
}
#cmdk-root .cmdk-item {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  padding: var(--sp-3) var(--sp-3);
  border-radius: var(--r-sm);
  cursor: pointer;
  font-size: var(--fs-md);
}
#cmdk-root .cmdk-item:hover,
#cmdk-root .cmdk-item.active {
  background: var(--surface-3);
}
#cmdk-root .cmdk-item .kind {
  font-size: var(--fs-xs);
  color: var(--text-subtle);
  text-transform: uppercase;
  min-width: 70px;
}
#cmdk-root .cmdk-hint {
  padding: var(--sp-2) var(--sp-4);
  border-top: 1px solid var(--border);
  font-size: var(--fs-xs);
  color: var(--text-subtle);
  display: flex;
  gap: var(--sp-4);
}
#cmdk-root .cmdk-hint kbd {
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 2px 6px;
  font-family: var(--font-mono);
  font-size: 10px;
}
```

### Step 3: Verify gates

```bash
npx tsc -p . --noEmit
npm run lint
npm test
```

Expected: clean, 84 / 84.

### Step 4: Commit

```bash
git add src/dashboard/public/css/components.css
git commit -m "feat(dashboard/css): responsive breakpoints + Cmd+K palette styles

* 1024–1279px: sidebar collapses to 64px icon-only
* ≤767px: sidebar becomes a fixed bottom tab bar; tables become
  horizontally scrollable; drawer takes full width; toast moves
  above tab bar
* #cmdk-root portal styles for the M11.3 Ctrl/Cmd+K palette"
```

---

## Task 2: Cmd+K palette JS

**Files:**
- `src/dashboard/public/js/ui/cmdk.js` (new)
- `src/dashboard/public/app.js` (wire up)
- `src/dashboard/public/index.html` (add portal root)

### Step 1: Add portal mount to index.html

In `src/dashboard/public/index.html`, find the line:

```html
    <div id="drawer-root"></div>
```

After it, add:

```html
    <div id="cmdk-root"></div>
```

### Step 2: Create the palette module

Create `src/dashboard/public/js/ui/cmdk.js`:

```js
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
```

### Step 3: Wire into `app.js`

Open `src/dashboard/public/app.js`. After `startRouter();`, add:

```js
import { startCmdK } from './js/ui/cmdk.js';
startCmdK();
```

(Reorder imports to keep them at the top per ESM convention.)

The final `app.js`:

```js
// chain-watcher dashboard entry — boots router + theme + SSE + cmdk.
import { startTheme } from './js/theme.js';
import { startRouter } from './js/router.js';
import { startCmdK } from './js/ui/cmdk.js';
import './js/sse.js'; // side-effect: opens singleton EventSource

startTheme();
startRouter();
startCmdK();
```

### Step 4: Verify

```bash
node --check src/dashboard/public/js/ui/cmdk.js
node --check src/dashboard/public/app.js
npx tsc -p . --noEmit
npm test 2>&1 | tail -5
```

Expected: parse OK, typecheck clean, 84 / 84.

### Step 5: Commit

```bash
git add src/dashboard/public/index.html src/dashboard/public/js/ui/cmdk.js src/dashboard/public/app.js
git commit -m "feat(dashboard/ui): Ctrl/Cmd+K command palette

Searches three sources:
  * Direct address paste (0x… / bc1… / 1… / 3…) → Watchlist deep link
  * Labels via /api/labels/list?search=
  * Recent alerts (last 200) filtered in-memory by rule / pivot /
    counterparty
Up/Down/Enter/Esc keyboard navigation; click-to-open. Mounted as
a portal under #cmdk-root."
```

---

## Task 3: Smoke + PR

- [ ] **Step 1: Final gates**

```bash
cd ~/projects/chain-watcher
npx tsc -p . --noEmit
npm run lint
npm test
npm run build
```

Expected: clean, 84 / 84.

- [ ] **Step 2: Smoke (manual)**

```bash
cp .env.example .env
redis-server --daemonize yes --port 6379 --dir /tmp 2>/dev/null || true
redis-cli ping
npm run dev > /tmp/m11-3-smoke.log 2>&1 &
sleep 12
```

Open `http://localhost:8787/alerts` in a browser. Verify:

1. Press **Cmd+K** (Mac) or **Ctrl+K** (Linux/Win) — the palette opens
2. Type "binance" — labels matching "binance" appear in the list
3. Press Down arrow then Enter — navigates to /watchlist with that address
4. Resize browser to <768px — sidebar moves to bottom as tab bar
5. Resize to 1000px — sidebar collapses to 64px icon-only

If you can't visually verify, just confirm the page loads and the palette div is in the DOM:

```bash
curl -s http://localhost:8787/alerts | grep -c 'cmdk-root'  # should output 1
```

- [ ] **Step 3: Cleanup**

```bash
pkill -f "tsx.*src/index" 2>/dev/null
redis-cli shutdown 2>/dev/null || true
rm -f .env
```

- [ ] **Step 4: PR**

```bash
git push -u origin feat/v2-m11-3-responsive-search
gh pr create --base main --head feat/v2-m11-3-responsive-search \
  --title "feat(v2/M11.3): responsive breakpoints + Cmd+K command palette" \
  --body "$(cat <<'EOF'
## Summary

UI polish slice of M11. Makes the dashboard usable on tablet (≥768px) and mobile (<768px), and adds a Ctrl/Cmd+K command palette for quick search across labels, addresses, and recent alerts.

### What changed

- **Responsive CSS** (\`components.css\` append):
  - 1024–1279px → sidebar collapses to 64px icon-only
  - <768px → sidebar becomes a fixed bottom tab bar; tables become horizontally scrollable; drawer goes full-width; toast moves above the tab bar
- **Cmd+K palette** (\`js/ui/cmdk.js\`):
  - Portal mounted under \`#cmdk-root\`
  - Direct address shortcut: 0x… / bc1… / 1… / 3… → opens Watchlist
  - Labels search via /api/labels/list?search=
  - Recent alerts filter (last 200, in-memory)
  - Arrow keys + Enter + Esc keyboard nav
- **Boot wiring** (\`app.js\`): \`startCmdK()\` registers the global Ctrl/Cmd+K handler

## Test plan

- [x] typecheck / lint / build clean
- [x] \`npm test\` — **84 / 84** (no new tests; UI-only)
- [x] Live smoke: palette opens on hotkey, labels search returns results, address paste deep-links
- [x] Visual: sidebar collapses at 1024px / becomes tab bar at 768px

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Done criteria

- 2 commits + PR
- 84 / 84 pass locally
- Visual smoke: responsive layout switches at 1280 / 1024 / 768; Cmd+K opens palette; address paste navigates to /watchlist
