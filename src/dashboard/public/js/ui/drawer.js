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
