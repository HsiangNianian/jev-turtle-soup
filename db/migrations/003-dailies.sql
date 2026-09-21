-- 每日官方汤：每天 00:00 UTC 由 Cron 生成一则，当天不可揭晓。
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
