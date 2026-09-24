import type { D1Like } from './auth.ts'
import { ApiError } from './errors.ts'

export const ENGAGEMENT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

const EVENTS = new Set(['entry_view', 'puzzle_open', 'first_question', 'discussion_open'])
const PLATFORMS = new Set(['web', 'ios'])

export interface EngagementInput {
  event?: unknown
  actorKey?: unknown
  puzzleId?: unknown
  platform?: unknown
  source?: unknown
}

function sourceValue(value: unknown): string {
  if (typeof value !== 'string') return 'unknown'
  const source = value.toLowerCase().trim().slice(0, 40)
  return /^[a-z0-9._-]+$/.test(source) ? source : 'unknown'
}

export async function recordEngagement(
  db: D1Like,
  input: EngagementInput,
  internal = false,
  now = Date.now(),
): Promise<boolean> {
  const event = input.event
  const actorKey = input.actorKey
  const platform = input.platform
  const puzzleId = input.puzzleId ?? ''
  if (!EVENTS.has(event as string) || !PLATFORMS.has(platform as string)) {
    throw new ApiError(400, '未知的行为事件')
  }
  if (typeof actorKey !== 'string' || actorKey.length < 8 || actorKey.length > 80) {
    throw new ApiError(400, '设备标识无效')
  }
  if (typeof puzzleId !== 'string' || puzzleId.length > 80) {
    throw new ApiError(400, '作品标识无效')
  }
  if (event !== 'entry_view' && !puzzleId) throw new ApiError(400, '缺少作品标识')
  if (internal || actorKey === 'anonymous-device') return false

  const bytes = new TextEncoder().encode(actorKey)
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
    .map((part) => part.toString(16).padStart(2, '0'))
    .join('')
  await db
    .prepare(
      `INSERT OR IGNORE INTO engagement_events
        (id, event, actor_hash, puzzle_id, platform, source, day, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      event,
      hash,
      puzzleId,
      platform,
      sourceValue(input.source),
      new Date(now).toISOString().slice(0, 10),
      now,
    )
    .run()
  return true
}

export async function purgeEngagement(db: D1Like, now = Date.now()): Promise<void> {
  await db
    .prepare('DELETE FROM engagement_events WHERE created_at < ?')
    .bind(now - ENGAGEMENT_RETENTION_MS)
    .run()
}

export async function engagementMetrics(db: D1Like, days = 28, now = Date.now()) {
  const since = now - Math.min(Math.max(Math.trunc(days) || 28, 1), 30) * 86_400_000
  const { results: daily } = await db
    .prepare(
      `SELECT day, platform, event, COUNT(*) AS count
         FROM engagement_events WHERE created_at >= ?
        GROUP BY day, platform, event ORDER BY day DESC, platform, event`,
    )
    .bind(since)
    .all<{ day: string; platform: string; event: string; count: number }>()
  const { results: sources } = await db
    .prepare(
      `SELECT source, platform, COUNT(*) AS entries
         FROM engagement_events WHERE event = 'entry_view' AND created_at >= ?
        GROUP BY source, platform ORDER BY entries DESC`,
    )
    .bind(since)
    .all<{ source: string; platform: string; entries: number }>()
  const returnRow = await db
    .prepare(
      `SELECT COUNT(*) AS players FROM (
         SELECT actor_hash, COUNT(DISTINCT puzzle_id) AS puzzles
           FROM engagement_events
          WHERE event = 'first_question' AND created_at >= ?
          GROUP BY actor_hash HAVING puzzles >= 2
       )`,
    )
    .bind(since)
    .first<{ players: number }>()
  const feedback = await db
    .prepare(
      `SELECT COUNT(*) AS soups,
          SUM(CASE WHEN EXISTS (
            SELECT 1 FROM comments c
             WHERE c.target_type = 'puzzle' AND c.target_id = p.id
               AND c.author_id <> p.owner_id
               AND c.author_id NOT IN (SELECT uid FROM admins)
          ) THEN 1 ELSE 0 END) AS withFeedback
         FROM puzzles p WHERE p.visibility = 'public'
           AND p.owner_id NOT IN (SELECT uid FROM admins)`,
    )
    .first<{ soups: number; withFeedback: number | null }>()
  const creators = await db
    .prepare(
      `SELECT COUNT(*) AS authors FROM (
         SELECT owner_id FROM puzzles
          WHERE visibility = 'public' AND created_at >= ?
            AND owner_id NOT IN (SELECT uid FROM admins)
          GROUP BY owner_id
          HAVING COUNT(DISTINCT strftime('%Y-%W', created_at / 1000, 'unixepoch', '+8 hours')) >= 2
       )`,
    )
    .bind(since)
    .first<{ authors: number }>()
  return {
    days: Math.min(Math.max(Math.trunc(days) || 28, 1), 30),
    daily: daily ?? [],
    sources: sources ?? [],
    secondPuzzlePlayers: returnRow?.players ?? 0,
    outsideFeedback: { soups: feedback?.soups ?? 0, withFeedback: feedback?.withFeedback ?? 0 },
    crossWeekAuthors: creators?.authors ?? 0,
  }
}
