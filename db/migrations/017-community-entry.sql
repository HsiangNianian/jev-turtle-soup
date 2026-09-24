ALTER TABLE puzzles ADD COLUMN featured_note TEXT;

CREATE TABLE IF NOT EXISTS engagement_events (
  id TEXT PRIMARY KEY,
  event TEXT NOT NULL,
  actor_hash TEXT NOT NULL,
  puzzle_id TEXT NOT NULL DEFAULT '',
  platform TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'unknown',
  day TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (event, actor_hash, puzzle_id, day)
);

CREATE INDEX IF NOT EXISTS idx_engagement_events_day ON engagement_events (day, event);
CREATE INDEX IF NOT EXISTS idx_engagement_events_actor ON engagement_events (actor_hash, created_at);
