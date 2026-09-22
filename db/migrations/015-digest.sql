-- 作者周报：退订标记、退订令牌、界面语言（决定邮件用哪种语言写）。
ALTER TABLE users ADD COLUMN digest_opt_out INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN digest_token TEXT;
ALTER TABLE users ADD COLUMN locale TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_digest_token
  ON users (digest_token) WHERE digest_token IS NOT NULL;
