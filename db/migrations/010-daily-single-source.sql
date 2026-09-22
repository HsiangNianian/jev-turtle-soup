-- 让 puzzles 成为「可玩字段」的唯一来源，dailies 只留每日独有的东西。
--
-- 顺序很重要：先把数据补齐（官汤的标签、以及两条路合流的对局计数），
-- 再删列。删掉的每一列都能从 puzzles 重新推出来，所以这一步是无损的。

-- 1) 把 turn_logs 里的对局补成 attempts 行。
--    attempts 是 plays/solves 的去重来源；不补的话，老玩家下次提问会被
--    当成新玩家再算一次 plays。
INSERT INTO attempts (id, puzzle_id, player_key, solved, turns, created_at, updated_at)
SELECT lower(hex(randomblob(16))), t.puzzle_id, t.player_key,
       MAX(t.solved), COUNT(*), MIN(t.created_at), MAX(t.created_at)
  FROM turn_logs t
 WHERE t.player_key IS NOT NULL AND t.player_key <> ''
   AND NOT EXISTS (
     SELECT 1 FROM attempts a WHERE a.puzzle_id = t.puzzle_id AND a.player_key = t.player_key
   )
 GROUP BY t.puzzle_id, t.player_key;

-- 2) 用 attempts 重算计数（它就是去重的依据，算出来必然自洽）
UPDATE puzzles SET
  plays = (SELECT COUNT(*) FROM attempts a WHERE a.puzzle_id = puzzles.id),
  solves = (SELECT COUNT(*) FROM attempts a WHERE a.puzzle_id = puzzles.id AND a.solved = 1)
 WHERE EXISTS (SELECT 1 FROM attempts a WHERE a.puzzle_id = puzzles.id);

-- 3) 官汤的标签原本只存在 dailies 一侧，题库搜索读的是 puzzles.tags
UPDATE puzzles SET tags = (SELECT d.tags FROM dailies d WHERE d.puzzle_id = puzzles.id)
 WHERE visibility = 'daily'
   AND EXISTS (SELECT 1 FROM dailies d WHERE d.puzzle_id = puzzles.id);

-- 4) attempts 这个名字和「生成试了几轮」撞车，改成不会看错的
ALTER TABLE dailies RENAME COLUMN attempts TO generate_attempts;

-- 5) 删掉 6 个和 puzzles 完全重复的列，以及需要手动镜像的 genre_score
ALTER TABLE dailies DROP COLUMN title;
ALTER TABLE dailies DROP COLUMN surface;
ALTER TABLE dailies DROP COLUMN truth;
ALTER TABLE dailies DROP COLUMN hint;
ALTER TABLE dailies DROP COLUMN tags;
ALTER TABLE dailies DROP COLUMN difficulty;
ALTER TABLE dailies DROP COLUMN genre_score;
