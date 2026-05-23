-- M10: address label system
CREATE TABLE IF NOT EXISTS labels (
  chain TEXT NOT NULL,
  address TEXT NOT NULL,
  label TEXT NOT NULL,
  category TEXT NOT NULL,
  source TEXT NOT NULL,
  risk_score INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (chain, address, label)
);
CREATE INDEX IF NOT EXISTS idx_labels_addr ON labels(chain, address);
CREATE INDEX IF NOT EXISTS idx_labels_cat  ON labels(category);

CREATE TABLE IF NOT EXISTS label_sources (
  source TEXT PRIMARY KEY,
  last_fetched_at INTEGER,
  row_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  last_error TEXT
);
