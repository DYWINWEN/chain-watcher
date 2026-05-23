-- M14: custom rule DSL engine
CREATE TABLE IF NOT EXISTS rules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  severity TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  dsl TEXT NOT NULL,
  built_in INTEGER NOT NULL DEFAULT 0,
  fire_count INTEGER NOT NULL DEFAULT 0,
  last_fired_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rules_enabled ON rules(enabled);

ALTER TABLE alerts ADD COLUMN rule_id TEXT;
CREATE INDEX IF NOT EXISTS idx_alerts_rule_id ON alerts(rule_id);
