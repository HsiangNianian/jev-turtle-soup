-- D1 schema for the public puzzle library.
-- Remote:  npx wrangler d1 execute jev-turtle-soup --remote --file=./db/schema.sql
-- Local:   npm run db:local

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS puzzles (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  title TEXT NOT NULL,
  surface TEXT NOT NULL,
  truth TEXT NOT NULL,
  hint TEXT NOT NULL DEFAULT '',
  difficulty TEXT NOT NULL DEFAULT '中等',
  tags TEXT NOT NULL DEFAULT '[]',
  visibility TEXT NOT NULL DEFAULT 'public',
  plays INTEGER NOT NULL DEFAULT 0,
  solves INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_puzzles_created ON puzzles (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_puzzles_owner ON puzzles (owner_id);

CREATE TABLE IF NOT EXISTS attempts (
  id TEXT PRIMARY KEY,
  puzzle_id TEXT NOT NULL,
  player_key TEXT,
  solved INTEGER NOT NULL DEFAULT 0,
  turns INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_attempts_puzzle ON attempts (puzzle_id);
