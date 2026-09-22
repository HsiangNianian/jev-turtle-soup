-- 管理员名单：uid 在表里就能进 /admin。
--
-- 用登录态而不是共享口令：管理页面是给具体的人用的，谁做过什么应该能对上号，
-- 而不是所有人共用一个 token（口令一旦漏出去，收回就得全员换）。
CREATE TABLE IF NOT EXISTS admins (
  uid TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);

-- 初始管理员（站点作者）。迁移只这一次，之后在 /admin 页面里增删。
INSERT OR IGNORE INTO admins (uid, created_at)
VALUES ('f50c1a48-5936-4352-9df7-cb9e7c46ca8f', CAST(strftime('%s', 'now') AS INTEGER) * 1000);
