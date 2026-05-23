-- M10: snapshot the labels involved at alert-fire time so historical
-- alerts always show the labels they had then, not what's in the
-- labels table now (which can change).
ALTER TABLE alerts ADD COLUMN pivot_labels TEXT NOT NULL DEFAULT '[]';
ALTER TABLE alerts ADD COLUMN counterparty_labels TEXT NOT NULL DEFAULT '[]';
