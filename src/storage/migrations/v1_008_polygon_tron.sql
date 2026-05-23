-- M16: Polygon + Tron support. The schema is already chain-agnostic
-- (chain column is TEXT); this migration just adds indexes that benefit
-- multi-chain GROUP BY queries we already do (e.g., Stats page).
CREATE INDEX IF NOT EXISTS idx_tx_chain_ts ON tx(chain, ts DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_chain_created ON alerts(chain, created_at DESC);
