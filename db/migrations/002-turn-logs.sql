-- 每一次判读都留档，便于复盘「同一个问题给了不同答案」这类不一致。
CREATE TABLE IF NOT EXISTS turn_logs (
  id TEXT PRIMARY KEY,
  puzzle_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  seq INTEGER NOT NULL,
  player_key TEXT,
  locale TEXT,
  message TEXT NOT NULL,
  reply TEXT NOT NULL,
  intent TEXT,
  verdict TEXT,
  closeness REAL,
  solved INTEGER NOT NULL DEFAULT 0,
  confidence REAL,
  model TEXT,
  debug_json TEXT,
  history_json TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_turn_logs_puzzle ON turn_logs (puzzle_id, seq);
CREATE INDEX IF NOT EXISTS idx_turn_logs_created ON turn_logs (created_at DESC);

-- 玩家主动反馈：只存标记与说明，细节靠 turn_logs + puzzles 关联
CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  puzzle_id TEXT,
  kind TEXT,
  player_key TEXT,
  locale TEXT,
  note TEXT NOT NULL,
  snapshot_json TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_reports_created ON reports (created_at DESC);
