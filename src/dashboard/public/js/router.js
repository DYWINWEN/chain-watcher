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
