-- M9: First migration — index on tx.amount_usdt for amount-range queries.
-- Future v2 features (custom rules with amount filters, stats by amount bucket)
-- benefit from this. Idempotent via IF NOT EXISTS so re-applying the migration
-- file outside the framework is safe too.
CREATE INDEX IF NOT EXISTS idx_tx_amount ON tx(amount_usdt DESC);
