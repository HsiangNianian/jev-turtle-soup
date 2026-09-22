-- 客户端错误上报。
-- 按「错误消息 + build」哈希聚合：一个 bug 影响 500 个人应该是 1 行 count=500，
-- 而不是 500 行 —— 否则一次白屏就能把这张表灌满，也就没人看得过来了。
CREATE TABLE IF NOT EXISTS client_errors (
  hash TEXT PRIMARY KEY,          -- message + build_id 的哈希
  message TEXT NOT NULL,
  stack TEXT NOT NULL DEFAULT '',
  path TEXT NOT NULL DEFAULT '',
  build_id TEXT NOT NULL DEFAULT '',
  locale TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',  -- error / unhandledrejection / react / recovery
  count INTEGER NOT NULL DEFAULT 1,
  first_at INTEGER NOT NULL,
  last_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_client_errors_count ON client_errors (count DESC);
