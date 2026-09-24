-- 从本次迁移起记录主动揭晓；旧请求没有可靠的行为记录，不能回填。
CREATE TABLE IF NOT EXISTS manual_reveals (
  puzzle_id TEXT NOT NULL,
  actor_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (puzzle_id, actor_hash)
);
