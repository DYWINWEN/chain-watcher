-- M15: alert lifecycle + mempool tracking
ALTER TABLE alerts ADD COLUMN status TEXT NOT NULL DEFAULT 'confirmed';
ALTER TABLE alerts ADD COLUMN confirmed_block INTEGER;
ALTER TABLE alerts ADD COLUMN source TEXT NOT NULL DEFAULT 'block';
CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts(status);
CREATE INDEX IF NOT EXISTS idx_alerts_trigger_tx ON alerts(trigger_tx_hash);

CREATE TABLE IF NOT EXISTS mempool_pending (
  chain TEXT NOT NULL,
  tx_hash TEXT NOT NULL,
  first_seen INTEGER NOT NULL,
  first_seen_block INTEGER NOT NULL,
  confirmed_block INTEGER,
  dropped INTEGER NOT NULL DEFAULT 0,
  alert_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (chain, tx_hash)
);
CREATE INDEX IF NOT EXISTS idx_mempool_pending_first_seen ON mempool_pending(first_seen);
CREATE INDEX IF NOT EXISTS idx_mempool_pending_unconfirmed ON mempool_pending(confirmed_block, dropped);

CREATE TABLE IF NOT EXISTS alert_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  alert_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  actor TEXT NOT NULL,
  note TEXT,
  ts INTEGER NOT NULL,
  FOREIGN KEY (alert_id) REFERENCES alerts(id)
);
CREATE INDEX IF NOT EXISTS idx_alert_actions_alert_id ON alert_actions(alert_id);
