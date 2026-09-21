-- 每日官方汤现在每天随机用一种语言原生写（中文 / 英文 / 日文），
-- 非该语言的读者要能在卡片和每日页上看出今天这碗是什么语言。
ALTER TABLE dailies ADD COLUMN locale TEXT NOT NULL DEFAULT 'zh-CN';
-- 摇到的题材坐标（0 本格 · 100 变格），留档用于回看与巡检
ALTER TABLE dailies ADD COLUMN genre_target INTEGER;
