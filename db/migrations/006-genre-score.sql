-- 题材坐标：0 = 本格·逻辑推理，100 = 变格·怪力乱神。
-- 发布时由 Jev 打一次分（失败则退回标签启发式），之后滑动条只做排序，不再问模型。
ALTER TABLE puzzles ADD COLUMN genre_score REAL;
