-- Older builds kept incrementing attempts.turns after a player had solved a soup.
-- Restore the first-solve count only when every recorded question has a matching
-- turn log. Incomplete or expired logs cannot safely establish that count.
WITH ordered AS (
  SELECT puzzle_id, player_key, solved,
    ROW_NUMBER() OVER (
      PARTITION BY puzzle_id, player_key ORDER BY created_at, rowid
    ) AS turn_number,
    COUNT(*) OVER (PARTITION BY puzzle_id, player_key) AS logged_turns
  FROM turn_logs
  WHERE player_key IS NOT NULL AND player_key <> ''
), first_solves AS (
  SELECT puzzle_id, player_key,
    MIN(CASE WHEN solved = 1 THEN turn_number END) AS first_solve_turns,
    MAX(logged_turns) AS logged_turns
  FROM ordered
  GROUP BY puzzle_id, player_key
), repairable AS (
  SELECT a.id, f.first_solve_turns
  FROM attempts a
  JOIN puzzles p ON p.id = a.puzzle_id
  JOIN first_solves f ON f.puzzle_id = a.puzzle_id AND f.player_key = a.player_key
  WHERE a.solved = 1 AND a.player_key <> p.owner_id
    AND a.turns = f.logged_turns AND f.first_solve_turns < a.turns
)
UPDATE attempts
SET turns = (SELECT first_solve_turns FROM repairable WHERE repairable.id = attempts.id)
WHERE id IN (SELECT id FROM repairable);
