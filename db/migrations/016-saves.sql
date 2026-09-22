-- 云端存档：登录后把本机进度镜像到账号，换设备不丢。
-- 一局一行，而不是每人一整块 blob —— 单局有上限，整块会顶到行大小限制。
CREATE TABLE IF NOT EXISTS saves (
  uid TEXT NOT NULL,
  game_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (uid, game_id)
);

CREATE INDEX IF NOT EXISTS idx_saves_uid ON saves (uid, updated_at DESC);
