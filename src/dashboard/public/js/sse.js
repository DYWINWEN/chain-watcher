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
