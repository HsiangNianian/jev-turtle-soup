-- 判读巡检记录：只存「复核后改判」的条目。
CREATE TABLE IF NOT EXISTS judge_flags (
  id TEXT PRIMARY KEY,
  turn_log_id TEXT NOT NULL,
  puzzle_id TEXT NOT NULL,
  question TEXT NOT NULL,
  first_verdict TEXT NOT NULL,
  second_verdict TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0,
  reason TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

-- 同一条判读只巡检一次
CREATE UNIQUE INDEX IF NOT EXISTS idx_judge_flags_turn ON judge_flags (turn_log_id);
CREATE INDEX IF NOT EXISTS idx_judge_flags_created ON judge_flags (created_at DESC);
