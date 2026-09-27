CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  puzzle_id TEXT NOT NULL,
  title TEXT NOT NULL,
  invite_hash TEXT NOT NULL UNIQUE,
  phase TEXT NOT NULL,
  turns INTEGER NOT NULL DEFAULT 0,
  author_participated INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  finished_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_rooms_puzzle ON rooms(puzzle_id, phase);
CREATE TABLE IF NOT EXISTS room_members (
  room_id TEXT NOT NULL,
  uid TEXT NOT NULL,
  seat TEXT NOT NULL,
  cutoff_turns INTEGER NOT NULL DEFAULT 0,
  hidden INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (room_id, uid)
);
CREATE INDEX IF NOT EXISTS idx_room_members_user ON room_members(uid, hidden, updated_at DESC);
ALTER TABLE turn_logs ADD COLUMN room_id TEXT;
ALTER TABLE turn_logs ADD COLUMN question_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_turn_logs_room_question ON turn_logs(room_id, question_id)
  WHERE room_id IS NOT NULL;
