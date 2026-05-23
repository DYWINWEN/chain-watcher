-- M12: alert severity column + subscription routing table
ALTER TABLE alerts ADD COLUMN severity TEXT NOT NULL DEFAULT 'P2';

CREATE TABLE IF NOT EXISTS subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel TEXT NOT NULL,                -- 'dashboard' | 'tg' | 'webhook' | 'discord' | 'slack' (M13)
  min_severity TEXT NOT NULL,           -- 'P1' | 'P2' | 'P3'
  chain_filter TEXT,                    -- NULL = all chains; else JSON array
  rule_filter TEXT,                     -- NULL = all rules; else JSON array
  silence_until INTEGER,                -- unix ts; NULL = not silenced
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_subs_channel ON subscriptions(channel, enabled);
