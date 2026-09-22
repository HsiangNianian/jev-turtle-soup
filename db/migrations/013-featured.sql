-- 精选位：管理员在后台给一道题打标，它在题库的「精选」排序里就会排前面。
-- 默认 0，对现有数据与行为零影响。
ALTER TABLE puzzles ADD COLUMN featured INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_puzzles_featured ON puzzles (featured, created_at DESC);
