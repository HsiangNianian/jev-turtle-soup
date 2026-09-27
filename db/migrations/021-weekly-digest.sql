-- Durable reservations prevent a Cron retry or manual click from sending twice.
CREATE TABLE IF NOT EXISTS digest_runs (
  period_end INTEGER PRIMARY KEY,
  started_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  source TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS digest_deliveries (
  period_end INTEGER NOT NULL,
  uid TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('sending', 'sent', 'failed', 'uncertain', 'skipped')),
  counts TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL,
  sent_at INTEGER,
  message_id TEXT,
  error_code TEXT,
  PRIMARY KEY (period_end, uid)
);
