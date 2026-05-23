-- chain-watcher schema (M0 baseline; later milestones add migrations under src/storage/migrations/).

CREATE TABLE IF NOT EXISTS tx (
  chain TEXT NOT NULL,
  tx_hash TEXT NOT NULL,
  block_number INTEGER NOT NULL,
  ts INTEGER NOT NULL,
  from_addr TEXT NOT NULL,
  to_addr TEXT NOT NULL,
  token TEXT NOT NULL,
  amount_raw TEXT NOT NULL,
  amount_usdt REAL NOT NULL,
  PRIMARY KEY (chain, tx_hash)
);
CREATE INDEX IF NOT EXISTS idx_tx_from ON tx(chain, from_addr, ts DESC);
CREATE INDEX IF NOT EXISTS idx_tx_to   ON tx(chain, to_addr,   ts DESC);
CREATE INDEX IF NOT EXISTS idx_tx_ts   ON tx(ts DESC);

CREATE TABLE IF NOT EXISTS windows (
  chain TEXT NOT NULL,
  address TEXT NOT NULL,
  direction TEXT NOT NULL,           -- 'out' or 'in'
  counterparties TEXT NOT NULL,      -- JSON array (most recent last)
  last_tx_hashes TEXT NOT NULL,      -- JSON array, same length as counterparties
  updated_at INTEGER NOT NULL,
  backfilled INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (chain, address, direction)
);

CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chain TEXT NOT NULL,
  rule TEXT NOT NULL,
  pivot_address TEXT NOT NULL,
  counterparty TEXT NOT NULL,
  trigger_tx_hash TEXT NOT NULL,
  window_tx_hashes TEXT NOT NULL,
  amount_usdt REAL NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_alerts_created ON alerts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_chain   ON alerts(chain, created_at DESC);

CREATE TABLE IF NOT EXISTS checkpoints (
  chain TEXT PRIMARY KEY,
  last_block INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL DEFAULT 'seed'
);

CREATE TABLE IF NOT EXISTS address_lists (
  list_type TEXT NOT NULL,   -- 'cex_blacklist' | 'user_whitelist' | 'user_blacklist'
  chain TEXT NOT NULL,       -- 'eth' | 'bsc' | 'btc' | '*'
  address TEXT NOT NULL,
  label TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (list_type, chain, address)
);

CREATE TABLE IF NOT EXISTS settings_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_settings_audit_ts ON settings_audit(ts DESC);
