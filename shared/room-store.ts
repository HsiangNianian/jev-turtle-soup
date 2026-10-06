import type { D1Like } from './auth.ts'
import { ApiError } from './errors.ts'
import type { RoomSecretPuzzle, RoomState } from './room-engine.ts'
import type { RoomActor, RoomSummary } from './room-protocol.ts'
import { roomHash } from './room-security.ts'

export async function roomActor(db: D1Like, uid: string): Promise<RoomActor> {
  const row = await db
    .prepare('SELECT display_name, handle FROM users WHERE id = ?')
    .bind(uid)
    .first<{ display_name: string | null; handle: string | null }>()
  if (!row) throw new ApiError(401, '请重新登录')
  return { uid, name: row.display_name?.trim().slice(0, 60) || '汤友', handle: row.handle ?? '' }
}

export async function roomPuzzle(db: D1Like, id: string): Promise<RoomSecretPuzzle> {
  const row = await db
    .prepare(
      `SELECT p.id, p.owner_id, p.title, p.surface, p.truth, p.hint, p.difficulty,
    p.visibility, d.date, d.story FROM puzzles p LEFT JOIN dailies d ON d.puzzle_id = p.id WHERE p.id = ?`,
    )
    .bind(id)
    .first<{
      id: string
      owner_id: string
      title: string
      surface: string
      truth: string
      hint: string
      difficulty: string
      visibility: string
      date: string | null
      story: string | null
    }>()
  if (
    !row ||
    !(
      row.visibility === 'public' ||
      (row.visibility === 'daily' && row.date && row.date <= new Date().toISOString().slice(0, 10))
    )
  ) {
    throw new ApiError(404, '只有公开的汤和每日官汤可以开桌')
  }
  if (row.truth.includes('[[')) throw new ApiError(400, '填空汤暂不支持同桌，请单人开始填空')
  return {
    id: row.id,
    ownerId: row.owner_id,
    title: row.title,
    surface: row.surface,
    difficulty: row.difficulty,
    truth: row.truth,
    hint: row.hint,
    ...(row.date ? { dailyDate: row.date } : {}),
    ...(row.story ? { story: row.story } : {}),
  }
}

/** The DO is authoritative. This is a retryable, revision-guarded search projection. */
export async function projectRoom(db: D1Like, s: RoomState): Promise<void> {
  const hash = await roomHash(s.inviteCode)
  await db
    .prepare(
      `INSERT INTO rooms(id, puzzle_id, title, invite_hash, phase, turns, author_participated, revision, created_at, updated_at, finished_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET phase=excluded.phase, turns=excluded.turns,
      author_participated=excluded.author_participated, revision=excluded.revision,
      updated_at=excluded.updated_at, finished_at=excluded.finished_at WHERE excluded.revision >= rooms.revision`,
    )
    .bind(
      s.id,
      s.puzzle.id,
      s.puzzle.title,
      hash,
      s.phase,
      s.turns,
      s.authorParticipated ? 1 : 0,
      s.revision,
      s.createdAt,
      s.updatedAt,
      s.finishedAt,
    )
    .run()
  for (const m of s.members) {
    await db
      .prepare(
        `INSERT INTO room_members(room_id, uid, seat, revision, updated_at, cutoff_turns) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(room_id, uid) DO UPDATE SET seat=excluded.seat, revision=excluded.revision, updated_at=excluded.updated_at, cutoff_turns=excluded.cutoff_turns
      WHERE excluded.revision >= room_members.revision`,
      )
      .bind(
        s.id,
        m.uid,
        m.seat,
        s.revision,
        m.seat === 'removed' ? m.disconnectedAt : s.updatedAt,
        m.cutoffTurns ?? 0,
      )
      .run()
  }
  if (s.phase === 'revealed' && s.puzzle.ownerId) {
    for (const uid of s.revealVoters.filter((id) => id !== s.puzzle.ownerId)) {
      await db
        .prepare(
          'INSERT OR IGNORE INTO manual_reveals(puzzle_id, actor_hash, created_at) VALUES (?, ?, ?)',
        )
        .bind(s.puzzle.id, await roomHash(`user:${uid}`), s.finishedAt)
        .run()
    }
  }
}

export async function listMyRooms(db: D1Like, uid: string): Promise<RoomSummary[]> {
  const result = await db
    .prepare(
      `SELECT r.id AS roomId, r.title, CASE WHEN m.seat='removed' THEN 'abandoned' ELSE r.phase END AS phase,
      CASE WHEN m.seat='removed' THEN m.cutoff_turns ELSE r.turns END AS turns, m.updated_at AS updatedAt
    FROM room_members m JOIN rooms r ON r.id=m.room_id WHERE m.uid=? AND m.hidden=0
    ORDER BY m.updated_at DESC LIMIT 100`,
    )
    .bind(uid)
    .all<RoomSummary>()
  return result.results ?? []
}

export async function teamRecords(
  db: D1Like,
  puzzleId: string,
): Promise<{ shortestTeamSolveTurns: number | null; longestTeamSolveTurns: number | null }> {
  const row = await db
    .prepare(
      `SELECT MIN(turns) AS shortest, MAX(turns) AS longest FROM rooms
    WHERE puzzle_id=? AND phase='solved' AND turns>0 AND author_participated=0`,
    )
    .bind(puzzleId)
    .first<{ shortest: number | null; longest: number | null }>()
  return {
    shortestTeamSolveTurns: row?.shortest ?? null,
    longestTeamSolveTurns: row?.longest ?? null,
  }
}
