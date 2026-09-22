import type { D1Like } from './auth.ts'
import type { Visibility } from './library.ts'

/**
 * 作者看板与动态流。
 *
 * 上传之后最缺的是「回音」：写完就石沉大海，第二次上传全靠自觉。
 * 这里把已经存在的数据（attempts / comments / likes）汇成两样东西：
 * - 概览：累计与本周的问过 / 解开，让作者看到自己的题在被玩；
 * - 动态：一条按时间倒排的流水，把「有人开始挑战 / 有人解开 / 有人留言 / 有人点赞」
 *   摊开。
 *
 * **不新增表**：一切都从现有表派生，所以口径永远和实际数据一致，也不会漂移。
 * 玩家身份一律不暴露（问过 / 解开是匿名的），留言本来就公开、才带署名。
 */

const WEEK_MS = 7 * 24 * 60 * 60 * 1000
const MAX_PUZZLES = 200
const MAX_EVENTS = 100

function clampLimit(limit: number): number {
  if (!Number.isFinite(limit)) return 30
  return Math.max(1, Math.min(Math.trunc(limit), MAX_EVENTS))
}

function safeTags(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed)
      ? parsed.filter((tag): tag is string => typeof tag === 'string')
      : []
  } catch {
    return []
  }
}

export interface AuthorPuzzle {
  id: string
  title: string
  surface: string
  truth: string
  hint: string
  difficulty: string
  tags: string[]
  visibility: Visibility
  createdAt: number
  plays: number
  solves: number
  playsThisWeek: number
  solvesThisWeek: number
  /** 最近一次有人问过的时间；从没人玩过就是 null */
  lastActivityAt: number | null
}

export interface AuthorSummary {
  total: number
  public: number
  plays: number
  solves: number
  playsThisWeek: number
  solvesThisWeek: number
}

export type AuthorEventKind = 'play' | 'solve' | 'comment' | 'like'

export interface AuthorEvent {
  kind: AuthorEventKind
  target: 'puzzle' | 'profile'
  at: number
  puzzleId: string | null
  puzzleTitle: string
  /** 留言正文（仅 comment） */
  body: string
  /** 留言者公开昵称（仅 comment） */
  actor: string
}

interface StatRow {
  id: string
  title: string
  surface: string
  truth: string
  hint: string
  difficulty: string
  tags: string
  visibility: string
  created_at: number
  plays: number
  solves: number
  plays_week: number
  solves_week: number
  last_at: number | null
}

/**
 * 自己名下的题 + 每人一道的统计。
 *
 * 计数**从 attempts 现算**，不读 puzzles.plays/solves 那两个缓存列：
 * 那两个是写入时累加的，一旦漏加就对不上；看板是要给作者看的数字，必须准。
 */
export async function listOwnPuzzles(
  db: D1Like,
  uid: string,
  now = Date.now(),
): Promise<AuthorPuzzle[]> {
  const week = now - WEEK_MS
  const { results } = await db
    .prepare(
      `SELECT p.id, p.title, p.surface, p.truth, p.hint, p.difficulty, p.tags, p.visibility, p.created_at,
              COUNT(a.id) AS plays,
              COALESCE(SUM(CASE WHEN a.solved = 1 THEN 1 ELSE 0 END), 0) AS solves,
              COALESCE(SUM(CASE WHEN a.created_at >= ? THEN 1 ELSE 0 END), 0) AS plays_week,
              COALESCE(SUM(CASE WHEN a.solved = 1 AND a.updated_at >= ? THEN 1 ELSE 0 END), 0) AS solves_week,
              MAX(a.updated_at) AS last_at
         FROM puzzles p LEFT JOIN attempts a ON a.puzzle_id = p.id
        WHERE p.owner_id = ?
        GROUP BY p.id
        ORDER BY (MAX(a.updated_at) IS NULL), MAX(a.updated_at) DESC, p.created_at DESC
        LIMIT ?`,
    )
    .bind(week, week, uid, MAX_PUZZLES)
    .all<StatRow>()

  return (results ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    surface: row.surface,
    truth: row.truth,
    hint: row.hint,
    difficulty: row.difficulty,
    tags: safeTags(row.tags),
    visibility: row.visibility as Visibility,
    createdAt: row.created_at,
    plays: row.plays,
    solves: row.solves,
    playsThisWeek: row.plays_week,
    solvesThisWeek: row.solves_week,
    lastActivityAt: row.last_at,
  }))
}

export function authorSummary(puzzles: AuthorPuzzle[]): AuthorSummary {
  return puzzles.reduce<AuthorSummary>(
    (acc, puzzle) => ({
      total: acc.total + 1,
      public: acc.public + (puzzle.visibility === 'public' ? 1 : 0),
      plays: acc.plays + puzzle.plays,
      solves: acc.solves + puzzle.solves,
      playsThisWeek: acc.playsThisWeek + puzzle.playsThisWeek,
      solvesThisWeek: acc.solvesThisWeek + puzzle.solvesThisWeek,
    }),
    { total: 0, public: 0, plays: 0, solves: 0, playsThisWeek: 0, solvesThisWeek: 0 },
  )
}

/** 作者得到的赞与留言总数：主页的，加上名下所有题上的。 */
export async function countAuthorSocial(
  db: D1Like,
  uid: string,
): Promise<{ likes: number; comments: number }> {
  const [likes, comments] = await Promise.all([
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM likes
          WHERE (target_type = 'profile' AND target_id = ?)
             OR (target_type = 'puzzle' AND target_id IN (SELECT id FROM puzzles WHERE owner_id = ?))`,
      )
      .bind(uid, uid)
      .first<{ n: number }>(),
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM comments
          WHERE (target_type = 'profile' AND target_id = ?)
             OR (target_type = 'puzzle' AND target_id IN (SELECT id FROM puzzles WHERE owner_id = ?))`,
      )
      .bind(uid, uid)
      .first<{ n: number }>(),
  ])
  return { likes: likes?.n ?? 0, comments: comments?.n ?? 0 }
}

/** 里程碑。门槛刻意选得低——早期能亮一枚，比高不可攀更有用。 */
const BADGE_RULES: { key: string; test: (r: RecognitionCounts) => boolean }[] = [
  { key: '首汤', test: (r) => r.puzzles >= 1 },
  { key: '有人解开', test: (r) => r.solves >= 1 },
  { key: '十人解开', test: (r) => r.solves >= 10 },
  { key: '百人问过', test: (r) => r.plays >= 100 },
  { key: '被赞过', test: (r) => r.likes >= 1 },
  { key: '有留言', test: (r) => r.comments >= 1 },
]

export interface RecognitionCounts {
  /** 公开的题数 */
  puzzles: number
  plays: number
  solves: number
  likes: number
  comments: number
}

export interface Recognition extends RecognitionCounts {
  /** 已获得的徽章 key（中文文案，前端 t() 翻），按固定顺序 */
  badges: string[]
}

export function deriveBadges(counts: RecognitionCounts): string[] {
  return BADGE_RULES.filter((rule) => rule.test(counts)).map((rule) => rule.key)
}

export function recognise(counts: RecognitionCounts): Recognition {
  return { ...counts, badges: deriveBadges(counts) }
}

export async function authorActivity(
  db: D1Like,
  uid: string,
  limit = 30,
): Promise<AuthorEvent[]> {
  const take = clampLimit(limit)

  const [plays, solves, puzzleComments, puzzleLikes, profileComments, profileLikes] =
    await Promise.all([
      db
        .prepare(
          `SELECT a.puzzle_id AS pid, p.title AS title, a.created_at AS at
             FROM attempts a JOIN puzzles p ON p.id = a.puzzle_id
            WHERE p.owner_id = ? ORDER BY a.created_at DESC LIMIT ?`,
        )
        .bind(uid, take)
        .all<{ pid: string; title: string; at: number }>(),
      db
        .prepare(
          `SELECT a.puzzle_id AS pid, p.title AS title, a.updated_at AS at
             FROM attempts a JOIN puzzles p ON p.id = a.puzzle_id
            WHERE p.owner_id = ? AND a.solved = 1
            ORDER BY a.updated_at DESC LIMIT ?`,
        )
        .bind(uid, take)
        .all<{ pid: string; title: string; at: number }>(),
      db
        .prepare(
          `SELECT c.target_id AS pid, p.title AS title, c.created_at AS at, c.body AS body,
                  COALESCE(u.display_name, u.handle, '匿名') AS actor
             FROM comments c
             JOIN puzzles p ON p.id = c.target_id
             LEFT JOIN users u ON u.id = c.author_id
            WHERE c.target_type = 'puzzle' AND p.owner_id = ?
            ORDER BY c.created_at DESC LIMIT ?`,
        )
        .bind(uid, take)
        .all<{ pid: string; title: string; at: number; body: string; actor: string }>(),
      db
        .prepare(
          `SELECT l.target_id AS pid, p.title AS title, l.created_at AS at
             FROM likes l JOIN puzzles p ON p.id = l.target_id
            WHERE l.target_type = 'puzzle' AND p.owner_id = ?
            ORDER BY l.created_at DESC LIMIT ?`,
        )
        .bind(uid, take)
        .all<{ pid: string; title: string; at: number }>(),
      db
        .prepare(
          `SELECT c.created_at AS at, c.body AS body,
                  COALESCE(u.display_name, u.handle, '匿名') AS actor
             FROM comments c LEFT JOIN users u ON u.id = c.author_id
            WHERE c.target_type = 'profile' AND c.target_id = ?
            ORDER BY c.created_at DESC LIMIT ?`,
        )
        .bind(uid, take)
        .all<{ at: number; body: string; actor: string }>(),
      db
        .prepare(
          `SELECT l.created_at AS at FROM likes l
            WHERE l.target_type = 'profile' AND l.target_id = ?
            ORDER BY l.created_at DESC LIMIT ?`,
        )
        .bind(uid, take)
        .all<{ at: number }>(),
    ])

  const events: AuthorEvent[] = [
    ...(plays.results ?? []).map<AuthorEvent>((row) => ({
      kind: 'play',
      target: 'puzzle',
      at: row.at,
      puzzleId: row.pid,
      puzzleTitle: row.title,
      body: '',
      actor: '',
    })),
    ...(solves.results ?? []).map<AuthorEvent>((row) => ({
      kind: 'solve',
      target: 'puzzle',
      at: row.at,
      puzzleId: row.pid,
      puzzleTitle: row.title,
      body: '',
      actor: '',
    })),
    ...(puzzleComments.results ?? []).map<AuthorEvent>((row) => ({
      kind: 'comment',
      target: 'puzzle',
      at: row.at,
      puzzleId: row.pid,
      puzzleTitle: row.title,
      body: row.body,
      actor: row.actor,
    })),
    ...(puzzleLikes.results ?? []).map<AuthorEvent>((row) => ({
      kind: 'like',
      target: 'puzzle',
      at: row.at,
      puzzleId: row.pid,
      puzzleTitle: row.title,
      body: '',
      actor: '',
    })),
    ...(profileComments.results ?? []).map<AuthorEvent>((row) => ({
      kind: 'comment',
      target: 'profile',
      at: row.at,
      puzzleId: null,
      puzzleTitle: '',
      body: row.body,
      actor: row.actor,
    })),
    ...(profileLikes.results ?? []).map<AuthorEvent>((row) => ({
      kind: 'like',
      target: 'profile',
      at: row.at,
      puzzleId: null,
      puzzleTitle: '',
      body: '',
      actor: '',
    })),
  ]

  events.sort((a, b) => b.at - a.at)
  return events.slice(0, take)
}
