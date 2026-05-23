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
