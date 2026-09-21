-- D1 schema for the public puzzle library.
-- Remote:  npx wrangler d1 execute jev-turtle-soup --remote --file=./db/schema.sql
-- Local:   npm run db:local

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT,
  handle TEXT,
  bio TEXT NOT NULL DEFAULT '',
  profile_public INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS puzzles (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  title TEXT NOT NULL,
  surface TEXT NOT NULL,
  truth TEXT NOT NULL,
  hint TEXT NOT NULL DEFAULT '',
  difficulty TEXT NOT NULL DEFAULT '中等',
  tags TEXT NOT NULL DEFAULT '[]',
  visibility TEXT NOT NULL DEFAULT 'public',
  plays INTEGER NOT NULL DEFAULT 0,
  solves INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_puzzles_created ON puzzles (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_puzzles_visibility ON puzzles (visibility, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_handle ON users (handle) WHERE handle IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_puzzles_owner ON puzzles (owner_id);

CREATE TABLE IF NOT EXISTS attempts (
  id TEXT PRIMARY KEY,
  puzzle_id TEXT NOT NULL,
  player_key TEXT,
  solved INTEGER NOT NULL DEFAULT 0,
  turns INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_attempts_puzzle ON attempts (puzzle_id);
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

CREATE TABLE IF NOT EXISTS dailies (
  date TEXT PRIMARY KEY,          -- 'YYYY-MM-DD'（UTC）
  puzzle_id TEXT NOT NULL,        -- 可玩的那行 puzzles（visibility='daily'）
  title TEXT NOT NULL,
  surface TEXT NOT NULL,
  truth TEXT NOT NULL,
  story TEXT NOT NULL,            -- 完整故事线，揭晓后展示
  hint TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]',
  difficulty TEXT NOT NULL DEFAULT '中等',
  review_json TEXT,               -- Jev 审核的完整结果
  attempts INTEGER NOT NULL DEFAULT 0,
  relaxed INTEGER NOT NULL DEFAULT 0,  -- 是否放宽阈值后发布
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_dailies_created ON dailies (created_at DESC);

-- 判读巡检记录：只存「复核后改判」的条目
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

CREATE UNIQUE INDEX IF NOT EXISTS idx_judge_flags_turn ON judge_flags (turn_log_id);
CREATE INDEX IF NOT EXISTS idx_judge_flags_created ON judge_flags (created_at DESC);
