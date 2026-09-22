-- 「动态看到哪了」：算未读徽章用。
-- NULL = 从没看过，按「没有未读」处理 —— 否则上线那一刻人人都会顶一个大红点。
ALTER TABLE users ADD COLUMN activity_seen_at INTEGER;
