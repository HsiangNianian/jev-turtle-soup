-- 点赞与留言板：target 只分两类，profile 用 uid，puzzle 用题号。
CREATE TABLE IF NOT EXISTS likes (
  id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL,   -- 'profile' | 'puzzle'
  target_id TEXT NOT NULL,
  player_key TEXT NOT NULL,    -- 登录用 uid，未登录用本机设备号
  created_at INTEGER NOT NULL
);

-- 同一个人对同一个对象只能赞一次
CREATE UNIQUE INDEX IF NOT EXISTS idx_likes_unique ON likes (target_type, target_id, player_key);
CREATE INDEX IF NOT EXISTS idx_likes_target ON likes (target_type, target_id);

CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL,   -- 'profile' | 'puzzle'
  target_id TEXT NOT NULL,
  author_id TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_comments_target ON comments (target_type, target_id, created_at DESC);

-- 举报也要能针对一条留言，不再只是「某一局」
ALTER TABLE reports ADD COLUMN target_type TEXT;
ALTER TABLE reports ADD COLUMN target_id TEXT;
