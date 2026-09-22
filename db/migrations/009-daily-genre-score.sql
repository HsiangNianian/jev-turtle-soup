-- 每日汤的实际题材落点：0 = 本格·逻辑推理，100 = 变格·怪力乱神。
-- genre_target 是摇到的目标，这一列是生成之后**实测**落在哪，两者可以对照着看。
ALTER TABLE dailies ADD COLUMN genre_score REAL;
