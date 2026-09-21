-- 资料修改冷却：主页地址一年一次，昵称与简介 30 天一次。
-- NULL 表示从没改过（注册时自动生成/派生不算「改」），随时可改。
ALTER TABLE users ADD COLUMN handle_changed_at INTEGER;
ALTER TABLE users ADD COLUMN display_name_changed_at INTEGER;
ALTER TABLE users ADD COLUMN bio_changed_at INTEGER;
