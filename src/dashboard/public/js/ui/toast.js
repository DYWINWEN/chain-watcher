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
