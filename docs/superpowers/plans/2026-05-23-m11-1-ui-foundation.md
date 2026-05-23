# M11.1 — UI Foundation + Alerts Page Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** Replace the v1 GitHub-Dark frontend with Linear/Vercel-style design tokens, a sidebar+topbar shell, and a redesigned Alerts page that includes a filter bar, address-detail drawer, toast notifications, and a working light/dark theme toggle. Watchlist / Stats / Settings pages are **ported** (functionally preserved with minimal styling) — full redesigns of those pages live in M11.2.

**Architecture:** Single-page app served from `src/dashboard/public/`. Server-side path-based routing (existing `app.get(['/alerts', '/watchlist', '/stats', '/settings'], ...)`) is preserved; client-side routing is handled by a tiny module that switches the active page module based on `location.pathname` on load + when nav links are clicked. No build step, native ES modules, no framework. CSS uses custom properties for theming.

**Tech Stack:** Vanilla HTML / ES modules / CSS custom properties. No bundler. Chart.js (already used) is retained on the Stats page port.

**Visual reference:** `design/demo2-linear-vercel.png` and `design/page-watchlist.png` in this repo show the target visual.

---

## Prerequisites

- M9 merged into `main` (HEAD `3dee3ea` or later, **38 / 38 tests passing**).
- Node 20+, `npm ci` already run.

---

## Scope

**IN this plan (M11.1)**
- Linear-style sidebar + topbar shell
- Design tokens (CSS vars) for dark + light themes, brand purple, chain colors, spacing scale, radii
- Theme toggle (sun/moon button, persisted via localStorage, system preference detection)
- Toast notification system (replaces inline "saved" / "error" text)
- Right-slide address-detail drawer (replaces the watchlist's manual lookup as the "drill in" UX, also reachable from Alerts cards)
- **Alerts page** fully redesigned: card-style list, filter bar (chain / amount / time / rule), SSE-live updates with flash highlight, clickable addresses opening the drawer
- Watchlist / Stats / Settings: ported with minimal style updates so the existing functionality keeps working

**OUT (deferred to M11.2 / M11.3)**
- Watchlist with full counterparty graph viz (M11.2)
- Stats page with proper time-range picker + multi-chart (M11.2)
- Settings page polish + advanced subscriptions UI (M11.2 / paired with M12)
- Labels page (M11.2 / paired with M10)
- Mobile responsive breakpoints (M11.3)
- `Ctrl+K` search overlay (M11.3)

---

## File structure (target end-state for M11.1)

```
src/dashboard/public/
├── index.html                    ★ rewritten — shell
├── styles.css                    (deleted — replaced by css/ modules)
├── app.js                        ★ rewritten — module entry
├── css/
│   ├── tokens.css                ★ new — CSS vars + themes
│   └── components.css            ★ new — reset + reusable components
├── js/
│   ├── api.js                    ★ new — fetch helpers
│   ├── sse.js                    ★ new — singleton EventSource
│   ├── router.js                 ★ new — path-based page mounting
│   ├── theme.js                  ★ new — light/dark toggle
│   ├── format.js                 ★ new — fmtTime/shortHash/fmtUsd helpers
│   ├── ui/
│   │   ├── toast.js              ★ new — toast queue
│   │   ├── drawer.js             ★ new — right-slide drawer
│   │   └── filter-bar.js         ★ new — chain/amount/time/rule chips
│   └── pages/
│       ├── alerts.js             ★ new — Linear-style page (full redesign)
│       ├── watchlist.js          ★ new — ported from v1 app.js
│       ├── stats.js              ★ new — ported from v1 app.js
│       └── settings.js           ★ new — ported from v1 app.js
```

**No tests added** for UI in M11.1. UI is verified via the manual smoke test in Task 8 (start server, open in browser, walk through key interactions). Adding rendering tests for vanilla DOM would be heavy and low-value relative to a 5-minute browser check.

---

## Design tokens (use exactly — referenced from the chosen Pencil demo)

Spec sheet for `css/tokens.css`. The implementer must use these values verbatim — no improvisation.

**Colors (dark — default)**

| Token | Value | Use |
|---|---|---|
| `--bg` | `#0a0a0b` | page background |
| `--surface-1` | `#101015` | cards / drawers |
| `--surface-2` | `#16161b` | filter chips inactive, sidebar hover |
| `--surface-3` | `#1b1b3a` | active nav item |
| `--border` | `#22232a` | card borders, dividers |
| `--text` | `#fafafa` | primary text |
| `--text-muted` | `#a1a1aa` | secondary text |
| `--text-subtle` | `#71717a` | tertiary text |
| `--accent` | `#5b6cff` | brand primary (buttons, links) |
| `--accent-soft` | `#a78bfa` | brand secondary |
| `--accent-bg` | `#16161b` | (placeholder; tokens-active uses #1b1b3a for active nav) |
| `--chain-eth` | `#a78bfa` | ETH dot/badge |
| `--chain-bsc` | `#facc15` | BSC dot/badge |
| `--chain-btc` | `#fb923c` | BTC dot/badge |
| `--success` | `#22c55e` | live indicator, positive amount |
| `--warning` | `#facc15` | warning |
| `--danger` | `#f87171` | error, P1 alerts |

**Colors (light — applied via `[data-theme="light"]` selector on `<html>`)**

| Token | Value |
|---|---|
| `--bg` | `#ffffff` |
| `--surface-1` | `#f4f4f5` |
| `--surface-2` | `#fafafa` |
| `--surface-3` | `#eef0ff` |
| `--border` | `#e4e4e7` |
| `--text` | `#18181b` |
| `--text-muted` | `#52525b` |
| `--text-subtle` | `#71717a` |
| (accent, chain, status colors unchanged) | (same as dark) |

**Typography**

| Token | Value |
|---|---|
| `--font-sans` | `Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif` |
| `--font-mono` | `'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace` |
| `--fs-xs` | `11px` |
| `--fs-sm` | `12px` |
| `--fs-md` | `13px` |
| `--fs-lg` | `15px` |
| `--fs-xl` | `22px` (page titles) |

**Spacing scale**

| Token | Value |
|---|---|
| `--sp-1` | `4px` |
| `--sp-2` | `8px` |
| `--sp-3` | `10px` |
| `--sp-4` | `14px` |
| `--sp-5` | `18px` |
| `--sp-6` | `24px` |
| `--sp-7` | `28px` |

**Radius**

| Token | Value |
|---|---|
| `--r-sm` | `6px` |
| `--r-md` | `10px` |
| `--r-lg` | `14px` |
| `--r-pill` | `999px` |

**Sidebar width: 220px. Topbar height: 56px. Drawer width: 360px.**

---

## Task 1: Branch + baseline + directory scaffold

- [ ] **Step 1: Create branch**

```bash
cd ~/projects/chain-watcher
git fetch --all --prune
git checkout main
git pull --ff-only
git checkout -b feat/v2-m11-1-ui-foundation
```

- [ ] **Step 2: Baseline gates**

```bash
npx tsc -p . --noEmit
npm run lint
npm test
```

Expected: 38 / 38 tests pass, typecheck/lint clean.

- [ ] **Step 3: Create directory scaffold**

```bash
mkdir -p src/dashboard/public/css src/dashboard/public/js/ui src/dashboard/public/js/pages
```

---

## Task 2: CSS — design tokens + base components

**Files:**
- Create: `src/dashboard/public/css/tokens.css`
- Create: `src/dashboard/public/css/components.css`

### Step 1: Create `css/tokens.css`

Use the values from the "Design tokens" table above exactly. Structure:

```css
/* chain-watcher design tokens — M11.1 */

:root {
  /* spacing */
  --sp-1: 4px;
  --sp-2: 8px;
  --sp-3: 10px;
  --sp-4: 14px;
  --sp-5: 18px;
  --sp-6: 24px;
  --sp-7: 28px;

  /* radius */
  --r-sm: 6px;
  --r-md: 10px;
  --r-lg: 14px;
  --r-pill: 999px;

  /* fonts */
  --font-sans: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace;
  --fs-xs: 11px;
  --fs-sm: 12px;
  --fs-md: 13px;
  --fs-lg: 15px;
  --fs-xl: 22px;

  /* layout constants */
  --sidebar-w: 220px;
  --topbar-h: 56px;
  --drawer-w: 360px;

  /* dark — default */
  --bg: #0a0a0b;
  --surface-1: #101015;
  --surface-2: #16161b;
  --surface-3: #1b1b3a;
  --border: #22232a;
  --text: #fafafa;
  --text-muted: #a1a1aa;
  --text-subtle: #71717a;

  /* brand + chain + status (same in both themes) */
  --accent: #5b6cff;
  --accent-soft: #a78bfa;
  --chain-eth: #a78bfa;
  --chain-bsc: #facc15;
  --chain-btc: #fb923c;
  --success: #22c55e;
  --warning: #facc15;
  --danger: #f87171;
}

[data-theme="light"] {
  --bg: #ffffff;
  --surface-1: #f4f4f5;
  --surface-2: #fafafa;
  --surface-3: #eef0ff;
  --border: #e4e4e7;
  --text: #18181b;
  --text-muted: #52525b;
  --text-subtle: #71717a;
}
```

### Step 2: Create `css/components.css`

```css
/* chain-watcher base components — M11.1 */

*, *::before, *::after { box-sizing: border-box; }

html, body {
  margin: 0;
  padding: 0;
  background: var(--bg);
  color: var(--text);
  font: var(--fs-md)/1.5 var(--font-sans);
  transition: background 200ms ease, color 200ms ease;
}

a { color: inherit; text-decoration: none; }
button { font: inherit; }

code, .mono { font-family: var(--font-mono); font-size: var(--fs-sm); }

/* layout shell */
.app {
  display: grid;
  grid-template-columns: var(--sidebar-w) 1fr;
  min-height: 100vh;
}

.sidebar {
  background: var(--bg);
  border-right: 1px solid var(--border);
  padding: var(--sp-5) var(--sp-6);
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
}

.sidebar .brand {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  margin-bottom: var(--sp-6);
  padding: 0 var(--sp-2);
}
.sidebar .brand .logo {
  width: 24px;
  height: 24px;
  border-radius: 7px;
  background: var(--accent);
}
.sidebar .brand .name { font-weight: 600; font-size: var(--fs-md); }

.nav-item {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  padding: var(--sp-3) var(--sp-2);
  border-radius: var(--r-sm);
  color: var(--text-muted);
  cursor: pointer;
  font-size: var(--fs-md);
  transition: background 120ms ease, color 120ms ease;
}
.nav-item:hover { background: var(--surface-2); color: var(--text); }
.nav-item.active { background: var(--surface-3); color: var(--text); }
.nav-item .icon { width: 16px; height: 16px; display: inline-block; }

.content {
  padding: var(--sp-7);
  display: flex;
  flex-direction: column;
  gap: var(--sp-6);
}

.topbar {
  display: flex;
  align-items: center;
  gap: var(--sp-4);
  height: 32px;
}
.topbar h1 { font-size: var(--fs-xl); font-weight: 600; margin: 0; }
.topbar .subtitle { color: var(--text-subtle); font-size: var(--fs-md); }
.topbar .spacer { flex: 1; }

/* live indicator pill */
.live-pill {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
  padding: 5px 10px;
  background: color-mix(in srgb, var(--success) 12%, var(--surface-1));
  color: var(--success);
  font-size: var(--fs-xs);
  font-weight: 500;
  border-radius: var(--r-pill);
}
.live-pill::before {
  content: '';
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--success);
}
.live-pill.offline { background: color-mix(in srgb, var(--text-subtle) 12%, var(--surface-1)); color: var(--text-subtle); }
.live-pill.offline::before { background: var(--text-subtle); }

/* generic card */
.card {
  background: var(--surface-1);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  padding: var(--sp-5) var(--sp-5);
}

/* generic chip / pill button */
.chip {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
  height: 28px;
  padding: 0 12px;
  background: var(--surface-2);
  border: 1px solid transparent;
  border-radius: var(--r-pill);
  color: var(--text);
  font-size: var(--fs-sm);
  cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease;
}
.chip:hover { background: var(--surface-1); }
.chip.active { background: var(--surface-3); border-color: var(--accent); }
.chip .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--accent-soft); }
.chip.eth .dot { background: var(--chain-eth); }
.chip.bsc .dot { background: var(--chain-bsc); }
.chip.btc .dot { background: var(--chain-btc); }

/* primary button */
.btn {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
  padding: 8px 14px;
  background: var(--accent);
  color: #fff;
  border: 0;
  border-radius: var(--r-sm);
  font-size: var(--fs-md);
  font-weight: 500;
  cursor: pointer;
}
.btn.ghost { background: transparent; color: var(--text-muted); border: 1px solid var(--border); }
.btn.ghost:hover { color: var(--text); border-color: var(--text-subtle); }

/* text input */
input, select, textarea {
  background: var(--surface-2);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  padding: 8px 12px;
  font: inherit;
  outline: none;
  transition: border-color 120ms ease;
}
input:focus, select:focus, textarea:focus { border-color: var(--accent); }

/* tag chips inside data rows — small */
.tag {
  display: inline-flex;
  align-items: center;
  height: 18px;
  padding: 0 6px;
  border-radius: 4px;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.02em;
  text-transform: uppercase;
}
.tag.ofac { background: color-mix(in srgb, var(--danger) 18%, var(--surface-1)); color: var(--danger); }
.tag.cex { background: color-mix(in srgb, var(--success) 18%, var(--surface-1)); color: var(--success); }
.tag.mixer { background: color-mix(in srgb, var(--warning) 18%, var(--surface-1)); color: var(--warning); }

/* utility */
.muted { color: var(--text-muted); }
.subtle { color: var(--text-subtle); }
```

### Step 3: Commit

```bash
git add src/dashboard/public/css/tokens.css src/dashboard/public/css/components.css
git commit -m "feat(dashboard/css): Linear-style design tokens + base components

Two new CSS modules:
  * tokens.css — colors / fonts / spacing / radius custom properties,
    with [data-theme=light] override.
  * components.css — reset, layout shell (.app .sidebar .content
    .topbar), .card / .chip / .btn / .tag / .live-pill primitives.

No HTML wired yet; old styles.css still in place."
```

---

## Task 3: New index.html shell

**Files:**
- Modify: `src/dashboard/public/index.html`

Replace the existing minimal markup with a Linear-style shell. The shell renders:
- Left sidebar: brand + 4 nav items (Alerts / Watchlist / Stats / Settings) — Labels item added later in M11.2
- Top bar inside content: page title slot + live indicator + theme toggle button
- Main content area: a `<div id="page-root">` that the page modules will populate
- Bottom-right: `<div id="toast-root">` for stacked toasts
- Right side: `<div id="drawer-root">` for the slide-in drawer

```html
<!DOCTYPE html>
<html lang="en" data-theme="dark">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>chain-watcher</title>
    <link rel="stylesheet" href="/static/css/tokens.css" />
    <link rel="stylesheet" href="/static/css/components.css" />
  </head>
  <body>
    <div class="app">
      <aside class="sidebar">
        <div class="brand">
          <span class="logo"></span>
          <span class="name">chain-watcher</span>
        </div>
        <nav id="nav">
          <a class="nav-item" data-route="/alerts" href="/alerts">
            <span class="icon">●</span><span>Alerts</span>
          </a>
          <a class="nav-item" data-route="/watchlist" href="/watchlist">
            <span class="icon">◇</span><span>Watchlist</span>
          </a>
          <a class="nav-item" data-route="/stats" href="/stats">
            <span class="icon">▤</span><span>Stats</span>
          </a>
          <a class="nav-item" data-route="/settings" href="/settings">
            <span class="icon">⚙</span><span>Settings</span>
          </a>
        </nav>
      </aside>

      <main class="content">
        <header class="topbar">
          <h1 id="page-title">…</h1>
          <span class="subtitle" id="page-subtitle"></span>
          <div class="spacer"></div>
          <span id="live-indicator" class="live-pill offline">SSE</span>
          <button id="theme-toggle" class="btn ghost" title="Toggle theme">◐</button>
        </header>
        <div id="page-root"></div>
      </main>
    </div>

    <div id="toast-root" aria-live="polite" aria-atomic="true"></div>
    <div id="drawer-root"></div>

    <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js"></script>
    <script type="module" src="/static/app.js"></script>
  </body>
</html>
```

Also add layout rules for toast and drawer to `css/components.css` (you can append to the file from Task 2):

```css
/* drawer */
#drawer-root {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 100;
}
#drawer-root.open { pointer-events: auto; }
#drawer-root .backdrop {
  position: absolute; inset: 0;
  background: rgba(0,0,0,0.4);
  opacity: 0;
  transition: opacity 200ms ease;
}
#drawer-root.open .backdrop { opacity: 1; }
#drawer-root .panel {
  position: absolute;
  top: 0; right: 0; bottom: 0;
  width: var(--drawer-w);
  background: var(--surface-1);
  border-left: 1px solid var(--border);
  padding: var(--sp-6);
  overflow-y: auto;
  transform: translateX(100%);
  transition: transform 240ms ease;
  display: flex;
  flex-direction: column;
  gap: var(--sp-4);
}
#drawer-root.open .panel { transform: translateX(0); }

/* toast */
#toast-root {
  position: fixed;
  right: var(--sp-6);
  bottom: var(--sp-6);
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  z-index: 200;
  pointer-events: none;
}
#toast-root .toast {
  background: var(--surface-1);
  border: 1px solid var(--border);
  border-left: 3px solid var(--accent);
  border-radius: var(--r-md);
  padding: var(--sp-3) var(--sp-4);
  font-size: var(--fs-sm);
  color: var(--text);
  pointer-events: auto;
  min-width: 240px;
  opacity: 0;
  transform: translateX(20px);
  transition: opacity 180ms ease, transform 180ms ease;
}
#toast-root .toast.in { opacity: 1; transform: translateX(0); }
#toast-root .toast.success { border-left-color: var(--success); }
#toast-root .toast.error { border-left-color: var(--danger); }
```

After saving, do NOT commit yet — we'll commit the HTML + new JS together in Task 7 to keep the working version coherent.

(Actually, commit the components.css update + index.html now so the diff is bisectable. Keep old styles.css still referenced by NOTHING but unchanged. We'll delete it in Task 7.)

Commit:

```bash
git add src/dashboard/public/css/components.css src/dashboard/public/index.html
git commit -m "feat(dashboard/html): new Linear-style shell (sidebar + topbar + page root)

index.html now uses /static/css/tokens.css + /static/css/components.css
and renders an app shell (.app > .sidebar + .content). The actual page
content is loaded by JS (next commits). Old styles.css still on disk
but no longer linked from this HTML — deleted in the final cleanup."
```

---

## Task 4: JS infrastructure — api / sse / router / theme / format

**Files:**
- Create: `src/dashboard/public/js/api.js`
- Create: `src/dashboard/public/js/sse.js`
- Create: `src/dashboard/public/js/router.js`
- Create: `src/dashboard/public/js/theme.js`
- Create: `src/dashboard/public/js/format.js`

### `js/api.js`

```js
// Thin wrapper around fetch — adds JSON parsing + error toast on non-2xx.
import { toast } from './ui/toast.js';

export async function apiGet(path) {
  const r = await fetch(path);
  if (!r.ok) {
    toast({ kind: 'error', message: `GET ${path} → ${r.status}` });
    throw new Error(`${r.status}`);
  }
  return r.json();
}

export async function apiPatch(path, body) {
  const r = await fetch(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    toast({ kind: 'error', message: `PATCH ${path} → ${r.status}` });
    throw new Error(`${r.status}`);
  }
  return r.json();
}

export async function apiPost(path, body) {
  const r = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    toast({ kind: 'error', message: `POST ${path} → ${r.status}` });
    throw new Error(`${r.status}`);
  }
  return r.json();
}

export async function apiDelete(path) {
  const r = await fetch(path, { method: 'DELETE' });
  if (!r.ok) {
    toast({ kind: 'error', message: `DELETE ${path} → ${r.status}` });
    throw new Error(`${r.status}`);
  }
  return r.json();
}
```

### `js/sse.js`

```js
// Singleton EventSource shared across pages. Pages subscribe via on('alert', cb).

const indicator = () => document.getElementById('live-indicator');

let es = null;
const listeners = new Map(); // event -> Set<fn>

function ensureOpen() {
  if (es) return es;
  es = new EventSource('/sse');
  es.onopen = () => {
    const el = indicator();
    if (el) { el.classList.remove('offline'); el.textContent = 'Live'; }
  };
  es.onerror = () => {
    const el = indicator();
    if (el) { el.classList.add('offline'); el.textContent = 'Offline'; }
  };
  for (const [ev, fns] of listeners) {
    es.addEventListener(ev, makeDispatcher(ev));
  }
  return es;
}

function makeDispatcher(ev) {
  return (e) => {
    const fns = listeners.get(ev);
    if (!fns) return;
    let data;
    try { data = JSON.parse(e.data); } catch { data = e.data; }
    for (const fn of fns) {
      try { fn(data); } catch {}
    }
  };
}

export function onSse(event, fn) {
  ensureOpen();
  if (!listeners.has(event)) {
    listeners.set(event, new Set());
    es.addEventListener(event, makeDispatcher(event));
  }
  listeners.get(event).add(fn);
  return () => listeners.get(event)?.delete(fn);
}

// Eager-open so the live indicator turns green ASAP.
ensureOpen();
```

### `js/router.js`

```js
// Server-side routing serves index.html for /alerts /watchlist /stats /settings.
// Client side: dispatch based on location.pathname; nav clicks pushState + dispatch.

import { renderAlerts } from './pages/alerts.js';
import { renderWatchlist } from './pages/watchlist.js';
import { renderStats } from './pages/stats.js';
import { renderSettings } from './pages/settings.js';

const ROUTES = {
  '/alerts': { render: renderAlerts, title: 'Alerts', subtitle: 'Real-time signals from BSC, BTC, ETH' },
  '/watchlist': { render: renderWatchlist, title: 'Watchlist', subtitle: 'Inspect any address — windows, related alerts' },
  '/stats': { render: renderStats, title: 'Stats', subtitle: 'Hits per chain over time' },
  '/settings': { render: renderSettings, title: 'Settings', subtitle: 'All analysis parameters, live' },
};

function setActive(path) {
  for (const link of document.querySelectorAll('#nav .nav-item')) {
    link.classList.toggle('active', link.dataset.route === path);
  }
  const route = ROUTES[path] ?? ROUTES['/alerts'];
  document.getElementById('page-title').textContent = route.title;
  document.getElementById('page-subtitle').textContent = route.subtitle;
}

async function mount(path) {
  const route = ROUTES[path] ?? ROUTES['/alerts'];
  const root = document.getElementById('page-root');
  root.innerHTML = '';
  setActive(path);
  await route.render(root);
}

export function startRouter() {
  // Intercept nav clicks
  document.getElementById('nav').addEventListener('click', (e) => {
    const link = e.target.closest('a.nav-item');
    if (!link) return;
    e.preventDefault();
    const path = link.dataset.route;
    if (location.pathname !== path) {
      history.pushState({}, '', path);
    }
    void mount(path);
  });
  window.addEventListener('popstate', () => void mount(location.pathname));
  // Initial render
  const initial = location.pathname in ROUTES ? location.pathname : '/alerts';
  if (location.pathname !== initial) history.replaceState({}, '', initial);
  void mount(initial);
}
```

### `js/theme.js`

```js
// Light/dark toggle. Persisted in localStorage; respects prefers-color-scheme on first visit.

const STORAGE_KEY = 'cw-theme';
const html = document.documentElement;

function preferred() {
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function apply(theme) {
  html.dataset.theme = theme;
  const btn = document.getElementById('theme-toggle');
  if (btn) btn.textContent = theme === 'light' ? '☾' : '☀';
}

export function startTheme() {
  const saved = localStorage.getItem(STORAGE_KEY);
  apply(saved ?? preferred());
  const btn = document.getElementById('theme-toggle');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const next = html.dataset.theme === 'light' ? 'dark' : 'light';
    apply(next);
    localStorage.setItem(STORAGE_KEY, next);
  });
}
```

### `js/format.js`

```js
export const fmtTime = (ts) => new Date(ts * 1000).toLocaleString();

export function fmtRelative(ts) {
  const diff = Math.max(0, Math.floor(Date.now() / 1000) - ts);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export const shortHash = (h) => (typeof h === 'string' && h.length > 14 ? `${h.slice(0, 8)}…${h.slice(-4)}` : h ?? '');

export const fmtUsd = (n) =>
  Number(n).toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  });
```

### Commit

```bash
git add src/dashboard/public/js/api.js src/dashboard/public/js/sse.js src/dashboard/public/js/router.js src/dashboard/public/js/theme.js src/dashboard/public/js/format.js
git commit -m "feat(dashboard/js): SPA-lite infrastructure — api/sse/router/theme/format

Tiny vanilla-JS infrastructure modules used by all page modules:
  * api.js — fetch wrappers with toast-on-error
  * sse.js — singleton EventSource + on(event, fn) subscription
  * router.js — path-based page mounting (preserves server routes)
  * theme.js — light/dark with localStorage persistence
  * format.js — fmtTime / shortHash / fmtUsd helpers"
```

---

## Task 5: UI primitives — toast / drawer / filter-bar

**Files:**
- Create: `src/dashboard/public/js/ui/toast.js`
- Create: `src/dashboard/public/js/ui/drawer.js`
- Create: `src/dashboard/public/js/ui/filter-bar.js`

### `js/ui/toast.js`

```js
// Tiny toast queue. Call toast({ kind: 'success'|'error'|'info', message, ttl }).

const TTL_DEFAULT = 3500;

export function toast({ kind = 'info', message, ttl = TTL_DEFAULT } = {}) {
  const root = document.getElementById('toast-root');
  if (!root) return;
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = message ?? '';
  root.appendChild(el);
  requestAnimationFrame(() => el.classList.add('in'));
  setTimeout(() => {
    el.classList.remove('in');
    setTimeout(() => el.remove(), 200);
  }, ttl);
}
```

### `js/ui/drawer.js`

```js
// Right-slide drawer. openDrawer({ title, body }) — body is an HTMLElement or string.

const root = () => document.getElementById('drawer-root');

function ensureMount() {
  const r = root();
  if (r.querySelector('.panel')) return r;
  r.innerHTML = `
    <div class="backdrop"></div>
    <div class="panel" role="dialog" aria-modal="true">
      <div style="display:flex;align-items:center;gap:var(--sp-3);">
        <strong class="drawer-title" style="font-size:var(--fs-lg);"></strong>
        <span style="flex:1"></span>
        <button class="btn ghost drawer-close">×</button>
      </div>
      <div class="drawer-body" style="display:flex;flex-direction:column;gap:var(--sp-3);"></div>
    </div>`;
  r.querySelector('.backdrop').addEventListener('click', closeDrawer);
  r.querySelector('.drawer-close').addEventListener('click', closeDrawer);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });
  return r;
}

export function openDrawer({ title = '', body = '' } = {}) {
  const r = ensureMount();
  r.querySelector('.drawer-title').textContent = title;
  const bodyEl = r.querySelector('.drawer-body');
  bodyEl.innerHTML = '';
  if (typeof body === 'string') bodyEl.innerHTML = body;
  else if (body instanceof Node) bodyEl.appendChild(body);
  r.classList.add('open');
}

export function closeDrawer() {
  const r = root();
  if (r) r.classList.remove('open');
}
```

### `js/ui/filter-bar.js`

```js
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
```

### Commit

```bash
git add src/dashboard/public/js/ui/toast.js src/dashboard/public/js/ui/drawer.js src/dashboard/public/js/ui/filter-bar.js
git commit -m "feat(dashboard/ui): toast / drawer / filter-bar primitives

  * toast.js — queueable notifications (success/error/info)
  * drawer.js — right-slide drawer with Esc/backdrop close
  * filter-bar.js — chain chips + amount/time/rule selectors,
    plus matchesFilter() helper for in-memory list filtering"
```

---

## Task 6: Alerts page — full redesign

**Files:**
- Create: `src/dashboard/public/js/pages/alerts.js`

This is the centerpiece of M11.1. Render a card-style list matching `design/demo2-linear-vercel.png`. Each alert is a card with:
- Row 1: chain dot + chain name + rule label + amount (right-aligned, success-color)
- Row 2: from address → arrow → to address + "View detail →" link (opens drawer)
- Row 3: relative time + tag chips (when applicable; for now no tags since labels system is M10)

Filter bar at top. Live SSE updates prepend new alerts with a brief highlight, applying current filter before adding to DOM.

```js
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
```

### Commit

```bash
git add src/dashboard/public/js/pages/alerts.js
git commit -m "feat(dashboard/pages): Linear-style Alerts page with filter + drawer

Card-style list (replaces v1 8-column table). Filter bar at top
(chain chips + amount + time + rule). SSE live updates prepend new
alerts with a brief highlight when they pass the current filter.
Clicking any address (or the card body) opens the right-slide drawer
with a copy button + Watchlist deep-link."
```

---

## Task 7: Port the other 3 pages + wire up app.js entry

**Files:**
- Create: `src/dashboard/public/js/pages/watchlist.js`
- Create: `src/dashboard/public/js/pages/stats.js`
- Create: `src/dashboard/public/js/pages/settings.js`
- Rewrite: `src/dashboard/public/app.js`
- Delete: `src/dashboard/public/styles.css`

The 3 ported pages: copy the rendering logic from the v1 `app.js` (the existing file, which still exists on this branch — open it and read), but adapt to the new shell. Replace the v1 `<h2>` headings (since the topbar now owns the title) and rewrap any tables/inputs in `.card` to fit the visual.

Key rules for the port:
- Pages export a `render(root)` function that populates `root` (the page-root div).
- DO keep all existing API calls and DOM event listeners — functional behavior unchanged.
- DO replace v1 CSS classes like `.settings-grid`, `.audit`, `.row-new` references with the new design. Inline styles are acceptable for one-off layout.
- DO NOT add new features (filter bars, drawers, charts) — those land in M11.2.

### `js/pages/watchlist.js`

Take the v1 `renderWatchlist` function in the existing `app.js` (the function that builds an input + lookup button and renders window rows). Port it into a module with:

```js
import { apiGet } from '../api.js';
import { fmtTime, shortHash } from '../format.js';
import { toast } from '../ui/toast.js';

export async function renderWatchlist(root) {
  root.innerHTML = `
    <div class="card" style="display:flex; gap:var(--sp-3); align-items:center;">
      <input id="wl-addr" placeholder="0x… or bc1…" style="flex:1;" />
      <button id="wl-go" class="btn">Lookup</button>
    </div>
    <div id="wl-result"></div>
  `;

  const input = root.querySelector('#wl-addr');
  const out = root.querySelector('#wl-result');
  const lookup = async () => {
    const addr = input.value.trim();
    if (!addr) return;
    out.innerHTML = `<div class="muted">Loading…</div>`;
    let rows;
    try {
      rows = await apiGet(`/api/windows?address=${encodeURIComponent(addr)}`);
    } catch { return; }
    if (!rows.length) {
      out.innerHTML = `<div class="muted">No windows for this address.</div>`;
      return;
    }
    out.innerHTML = '';
    for (const row of rows) {
      const card = document.createElement('div');
      card.className = 'card';
      card.style.marginTop = 'var(--sp-3)';
      card.innerHTML = `
        <div style="display:flex; align-items:center; gap:var(--sp-2);">
          <strong style="color:var(--chain-${row.chain});">${row.chain.toUpperCase()}</strong>
          <span class="muted">/ ${row.direction}</span>
          ${row.backfilled ? '<span class="tag cex">BACKFILLED</span>' : ''}
          <span style="flex:1;"></span>
          <span class="muted" style="font-size:var(--fs-xs);">updated ${fmtTime(row.updated_at)}</span>
        </div>
        <table style="margin-top:var(--sp-3); width:100%;">
          <thead><tr><th>#</th><th>Counterparty</th><th>Tx</th></tr></thead>
          <tbody>
            ${row.counterparties.map((cp, i) => `
              <tr>
                <td class="muted">${i + 1}</td>
                <td><code class="mono">${shortHash(cp)}</code></td>
                <td><code class="mono">${shortHash(row.last_tx_hashes[i] ?? '')}</code></td>
              </tr>`).join('')}
          </tbody>
        </table>
      `;
      out.appendChild(card);
    }
  };

  root.querySelector('#wl-go').addEventListener('click', lookup);
  input.addEventListener('keypress', (e) => e.key === 'Enter' && lookup());

  // Honor ?address=X query param (used by Alerts drawer's "Open in Watchlist" link).
  const params = new URLSearchParams(location.search);
  const seed = params.get('address');
  if (seed) {
    input.value = seed;
    void lookup();
  }
}
```

(Add `?address=X` query param handling to the existing server's `app.get('/watchlist', ...)` route is NOT needed since query strings don't affect the route match — index.html is still served and the JS reads `location.search`.)

### `js/pages/stats.js`

Port v1 `renderStats`:

```js
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
```

### `js/pages/settings.js`

Port v1 `renderSettings`. The v1 file is moderately long; preserve all its functionality (each setting row is an inline-editable input that PATCHes /api/settings/:key on blur or change; lists CRUD; audit log). Just wrap in `.card` blocks and use the new tokens.

```js
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
```

### Rewrite `src/dashboard/public/app.js`

```js
// chain-watcher dashboard entry — boots router + theme + SSE.
import { startTheme } from './js/theme.js';
import { startRouter } from './js/router.js';
import './js/sse.js'; // side-effect: opens singleton EventSource

startTheme();
startRouter();
```

### Delete the old `styles.css`

```bash
rm src/dashboard/public/styles.css
```

### Commit

```bash
git add src/dashboard/public/js/pages/watchlist.js src/dashboard/public/js/pages/stats.js src/dashboard/public/js/pages/settings.js src/dashboard/public/app.js
git rm src/dashboard/public/styles.css
git commit -m "feat(dashboard): port Watchlist/Stats/Settings + rewrite app.js entry

Three pages ported from v1 inline renderers to module exports.
Functionality is unchanged; visual is upgraded via the new design
tokens — Watchlist input gets the card treatment, Settings sections
become cards with the accent-soft headings, Stats inherits chart
colors from the CSS vars. app.js is now a 3-line entry that boots
theme + router + SSE singleton. Legacy styles.css is removed (all
its rules have moved to css/tokens.css + css/components.css)."
```

---

## Task 8: Smoke test via Chrome MCP + final gates

**Files:** none

The dev workflow exists: `npm run dev` starts the server. M11.1 is a frontend-only change; backend gates from earlier milestones already pass.

### Step 1: TypeScript + lint + tests still pass

```bash
cd ~/projects/chain-watcher
npx tsc -p . --noEmit
npm run lint
npm test
npm run build
```

Expected:
- typecheck clean
- lint exit 0
- test 38 / 38 pass (no new tests, no removed tests)
- build: `dist/dashboard/public/` should mirror the new structure including `css/` and `js/` subdirs

### Step 2: Confirm static assets copied to dist

```bash
ls dist/dashboard/public/
ls dist/dashboard/public/css/
ls dist/dashboard/public/js/
ls dist/dashboard/public/js/ui/
ls dist/dashboard/public/js/pages/
```

Expected: mirror of source layout. If anything is missing, check `scripts/copy-assets.js` — it uses `cpSync(..., { recursive: true })` so subdirs should copy automatically.

### Step 3: Visual smoke test

The implementer should start the server and open the dashboard in a browser to verify:

```bash
# Terminal A
docker run -d --name cw-redis -p 6379:6379 redis:7-alpine 2>/dev/null || docker start cw-redis
npm run dev
```

Then in a browser (or via Chrome MCP):
1. Open `http://localhost:8787/` — should redirect to `/alerts` and show the new shell (sidebar with 4 nav items, topbar with theme button, page-root with the Alerts page).
2. **Theme toggle**: click the ☀ / ☾ button. The whole UI should swap between dark and light. Reload the page — theme persists.
3. **Navigation**: click each nav item. Active state highlights. URL changes via pushState. Each page renders.
4. **Alerts page**: filter chips work (toggle ETH off → ETH alerts disappear from list); amount/time/rule dropdowns filter the list; clicking a card opens the right-side drawer with the address and "Open in Watchlist" link. Drawer closes on Esc / backdrop click / × button.
5. **Toast**: trigger an error by patching an invalid setting from devtools (or just verify the success toast fires when editing a setting in the Settings page).
6. **SSE live indicator**: top-right pill says "Live" (green dot) when SSE connects, "Offline" (gray) when disconnected.

If any of the above is broken: STOP, report which check failed, and fix before continuing.

### Step 4: Final commit (if any tweaks were needed)

If Step 3 surfaced bugs that required code changes, commit those as `fix(dashboard): smoke-test fixes — <one-liner>`. Otherwise proceed.

### Step 5: Push + open PR

```bash
git push -u origin feat/v2-m11-1-ui-foundation
gh pr create --base main --head feat/v2-m11-1-ui-foundation --title "feat(v2/M11.1): UI foundation — Linear shell + redesigned Alerts page" --body "$(cat <<'EOF'
## Summary

First of three M11 PRs. Replaces the v1 GitHub-Dark frontend with a
Linear/Vercel-style design system and a redesigned Alerts page.
Other pages (Watchlist / Stats / Settings) are ported with minimal
styling — their full redesigns + Labels page + responsive
breakpoints come in M11.2 / M11.3.

### What changed

- **css/tokens.css** — colors (dark + light themes), fonts, spacing scale, radii
- **css/components.css** — reset, shell layout (.app .sidebar .content .topbar), .card .chip .btn .tag .live-pill primitives, drawer + toast styles
- **index.html** — new Linear shell (sidebar + topbar + page-root + drawer-root + toast-root)
- **js/api.js / sse.js / router.js / theme.js / format.js** — vanilla SPA-lite infrastructure
- **js/ui/{toast,drawer,filter-bar}.js** — reusable primitives
- **js/pages/alerts.js** — full redesign: card list, filter bar, SSE live highlights, address drawer
- **js/pages/{watchlist,stats,settings}.js** — ported (functionality unchanged, styling upgraded via tokens)
- **app.js** — 3-line entry (theme + router + SSE)
- Deleted **styles.css** (all rules migrated)

### What's NOT in this PR
- Watchlist counterparty graph (M11.2)
- Stats time-range picker + multi-chart (M11.2)
- Settings deep polish + subscriptions UI (M11.2 / M12)
- Labels page (M11.2 / M10)
- Mobile responsive (M11.3)
- Ctrl+K search (M11.3)

## Test plan

- [x] \`npx tsc -p . --noEmit\` clean
- [x] \`npm run lint\` exit 0
- [x] \`npm test\` 38/38 pass (no tests added; vanilla frontend)
- [x] \`npm run build\` produces dist/dashboard/public/ mirror including css/ + js/
- [x] Manual smoke test: server up, theme toggle works + persists, 4 pages mount, Alerts filter + drawer + SSE highlight all work

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Done criteria

- Branch pushed; PR open
- All gates pass (typecheck / lint / build / 38 tests)
- Manual smoke test passes (Step 3 above)
- File structure matches §"File structure (target end-state)"
- Old `styles.css` deleted; no JS or HTML still references it
