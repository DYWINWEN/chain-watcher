-- M13: per-subscription channel config (URL, template, etc.) as JSON blob.
ALTER TABLE subscriptions ADD COLUMN config TEXT NOT NULL DEFAULT '{}';
