-- Adds the public profile fields. Applied once to the existing database;
-- db/schema.sql already contains the resulting shape for fresh installs.

ALTER TABLE users ADD COLUMN handle TEXT;
ALTER TABLE users ADD COLUMN bio TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN profile_public INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN updated_at INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_handle ON users (handle) WHERE handle IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_puzzles_visibility ON puzzles (visibility, created_at DESC);
