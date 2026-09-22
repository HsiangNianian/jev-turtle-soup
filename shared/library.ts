import type { D1Like } from './auth.ts'
import { ApiError } from './errors.ts'
import { askError, judge, readLocale, rerankCandidates, scoreGenre, type GameEnv } from './game.ts'
import { logTurn } from './logs.ts'
import { utcDateKey } from './daily.ts'

export type Visibility = 'public' | 'private'

export const VISIBILITIES: Visibility[] = ['public', 'private']
const DIFFICULTIES = ['简单', '中等', '困难']

/**
 * 题材坐标的兜底：Jev 打不了分（没密钥 / 调用失败）时，用标签估一个。
 * 只覆盖已知的标签，都没命中就当它不好不坏（50）。
 */
const GENRE_TAG_HINTS: Record<string, number> = {
  怪力乱神: 95,
  灵异: 90,
  诡物: 88,
  民俗: 78,
  幻觉: 72,
  替身: 66,
  记忆: 54,
  反转: 52,
  心理: 46,
  密室: 32,
  雨夜: 30,
  都市: 28,
  巧合: 26,
  电梯: 24,
  误会: 22,
  推理: 20,
  本格: 10,
}

export function genreFromTags(tags: string[]): number {
  const hits = tags
    .map((tag) => GENRE_TAG_HINTS[tag])
    .filter((value): value is number => typeof value === 'number')
  if (!hits.length) return 50
  return Math.round(hits.reduce((sum, value) => sum + value, 0) / hits.length)
}

export interface OwnerInfo {
  handle: string
  displayName: string
}

export interface PublicPuzzle {
  id: string
  title: string
  surface: string
  difficulty: string
  tags: string[]
  plays: number
  solves: number
  createdAt: number
  owner: OwnerInfo
  /** 0 = 本格·逻辑推理，100 = 变格·怪力乱神；没打过分为 null */
  genreScore: number | null
  /** 官方每日汤（过期之后才进题库），列表和详情上要有一枚标识 */
  official: boolean
}

interface PuzzleRow {
  id: string
  owner_id: string
  title: string
  surface: string
  truth: string
  hint: string
  difficulty: string
  tags: string
  visibility: string
  plays: number
  solves: number
  genre_score: number | null
  created_at: number
}

interface OwnedRow extends PuzzleRow {
  owner_handle: string | null
  owner_name: string | null
}

function text(value: unknown, field: string, max: number, required = true): string {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (required && !raw) throw new ApiError(400, `请填写${field}`)
  if (raw.length > max) throw new ApiError(400, `${field}太长了（最多 ${max} 字）`)
  return raw
}

function parseTags(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const tags = value
    .filter((tag): tag is string => typeof tag === 'string')
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 5)
    .map((tag) => tag.slice(0, 12))
  return [...new Set(tags)]
}

function difficulty(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : ''
  return DIFFICULTIES.includes(raw) ? raw : '中等'
}

function visibility(value: unknown, fallback: Visibility = 'public'): Visibility {
  return value === 'private' || value === 'public' ? value : fallback
}

function toPublic(
  row: OwnedRow | (PuzzleRow & { owner_handle?: string | null; owner_name?: string | null }),
): PublicPuzzle {
  return {
    id: row.id,
    title: row.title,
    surface: row.surface,
    difficulty: row.difficulty,
    tags: safeTags(row.tags),
    plays: row.plays,
    solves: row.solves,
    createdAt: row.created_at,
    owner: {
      handle: row.owner_handle ?? '',
      displayName: row.owner_name ?? row.owner_handle ?? '匿名',
    },
    genreScore:
      typeof row.genre_score === 'number' && Number.isFinite(row.genre_score)
        ? row.genre_score
        : null,
    official: row.visibility === 'daily',
  }
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

/**
 * 作者信息用 LEFT JOIN：官方汤的 owner_id 是空串（没有作者），
 * INNER JOIN 会把它整行滤掉——题库里就永远看不到过期的官汤。
 */
const OWNER_SELECT = `SELECT p.*, u.handle AS owner_handle, u.display_name AS owner_name
  FROM puzzles p LEFT JOIN users u ON u.id = p.owner_id`

/**
 * 题库里能玩的题：用户公开的，加上**过了当天**的官方汤。
 * 今天的官方汤还没揭晓，不能进题库——否则汤底就等于摆在列表里了。
 * 用 IN 子查询而不是 JOIN，免得 dailies 那边一旦有重复行把结果乘出来。
 */
const PLAYABLE = `(p.visibility = 'public'
  OR (p.visibility = 'daily' AND p.id IN (SELECT puzzle_id FROM dailies WHERE date < ?)))`

/**
 * 关键字检索：标题、汤面、标签、作者名与主页地址一次全搜。
 * 汤底**不参与**——它不该通过搜索结果泄露出去。
 */
export async function listPublicPuzzles(
  db: D1Like,
  options: {
    sort: string
    limit: number
    offset: number
    query: string
    /** 0–100 的题材目标：给了就按「离这个位置有多近」排序，最近的排前面 */
    genre?: number
  },
): Promise<PublicPuzzle[]> {
  const limit = Math.min(Math.max(options.limit || 20, 1), 50)
  const offset = Math.max(options.offset || 0, 0)
  const query = options.query.trim()
  const secondary = options.sort === 'hot' ? 'p.plays DESC, p.created_at DESC' : 'p.created_at DESC'
  const genre = Number.isFinite(options.genre)
    ? Math.min(Math.max(options.genre ?? 0, 0), 100)
    : null

  const filters = [PLAYABLE]
  const bindings: unknown[] = [utcDateKey()]
  if (query) {
    const like = likePattern(query)
    filters.push(
      `(p.title LIKE ? ESCAPE '\\' OR p.surface LIKE ? ESCAPE '\\' OR p.tags LIKE ? ESCAPE '\\'
        OR u.display_name LIKE ? ESCAPE '\\' OR u.handle LIKE ? ESCAPE '\\')`,
    )
    bindings.push(like, like, like, like, like)
  }
  // 没打过分的按中间值算，免得刚上传的题因为 NULL 被甩到最后
  const order =
    genre === null ? secondary : `ABS(COALESCE(p.genre_score, 50) - ?) ASC, ${secondary}`
  if (genre !== null) bindings.push(genre)
  bindings.push(limit, offset)

  const { results } = await db
    .prepare(`${OWNER_SELECT} WHERE ${filters.join(' AND ')} ORDER BY ${order} LIMIT ? OFFSET ?`)
    .bind(...bindings)
    .all<OwnedRow>()
  return (results ?? []).map(toPublic)
}

/** `%` `_` `\` 在 LIKE 里有特殊含义，搜索词里出现时按字面匹配。 */
function likePattern(query: string): string {
  return `%${query.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`
}

/**
 * 搜索 = 快检索 + 语义重排。
 * SQL 先按关键字捞出候选（标题 / 汤面 / 标签 / 作者），再让 Jev 逐条判
 * 「这是不是要找的那道」，按分数重排；重排失败就退回关键字顺序，搜索照常可用。
 */
export async function searchPublicPuzzles(
  env: GameEnv,
  db: D1Like,
  options: { sort: string; query: string; genre?: number; limit?: number },
): Promise<PublicPuzzle[]> {
  const items = await listPublicPuzzles(db, {
    sort: options.sort,
    limit: options.limit ?? 20,
    offset: 0,
    query: options.query,
    genre: options.genre,
  })
  const query = options.query.trim()
  if (!query || items.length < 2) return items

  const scores = await rerankCandidates(
    env,
    query,
    items.map((item) => ({
      id: item.id,
      title: item.title,
      surface: item.surface,
      tags: item.tags,
      author: item.owner.displayName,
    })),
  )
  if (!scores) return items

  // 分数只是相对次序；同分时靠稳定排序保留关键字检索给出的顺序
  return [...items].sort((a, b) => (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0))
}

export async function getPublicPuzzle(
  db: D1Like,
  id: string,
): Promise<PublicPuzzle & { ownerBio: string }> {
  const row = await db
    .prepare(`${OWNER_SELECT} WHERE p.id = ? AND ${PLAYABLE}`)
    .bind(id, utcDateKey())
    .first<OwnedRow & { bio?: string }>()
  if (!row) throw new ApiError(404, '这道汤不存在，或者作者没有公开')
  const owner = await db
    .prepare('SELECT bio FROM users WHERE id = ?')
    .bind(row.owner_id)
    .first<{ bio: string }>()
  return { ...toPublic(row), ownerBio: owner?.bio ?? '' }
}

async function loadPlayable(
  db: D1Like,
  id: string,
  uid: string | null,
  locale: 'zh-CN' | 'en' | 'ja',
): Promise<PuzzleRow> {
  const row = await db.prepare('SELECT * FROM puzzles WHERE id = ?').bind(id).first<PuzzleRow>()
  if (!row) throw askError(locale, 'notFound')
  if (row.visibility === 'public' || row.owner_id === uid) return row

  /*
   * 过期的官方汤进了题库，就得和公开的题一样能问 —— 之前漏了这一处：
   * 列表和详情都放行了，唯独提问还只认 visibility='public'，
   * 于是从题库点进去玩过期官汤，问第一句就被回「这道汤没有公开」。
   * 今天的官方汤仍然不算（还没揭晓，`date < today` 把它挡在外面）。
   */
  const expired = await db
    .prepare('SELECT 1 AS ok FROM dailies WHERE puzzle_id = ? AND date < ?')
    .bind(id, utcDateKey())
    .first<{ ok: number }>()
  if (!expired) throw askError(locale, 'notPublic')
  return row
}

export async function askLibraryPuzzle(
  env: GameEnv,
  db: D1Like,
  uid: string | null,
  viewerKey: string,
  id: string,
  body: Record<string, unknown>,
) {
  const row = await loadPlayable(db, id, uid, readLocale(body.locale))
  const turn = await judge(
    env,
    { title: row.title, surface: row.surface, truth: row.truth, hint: row.hint },
    body,
  )

  await logTurn(db, {
    puzzleId: id,
    kind: 'library',
    seq: typeof body.seq === 'number' ? body.seq : 0,
    playerKey: viewerKey,
    locale: typeof body.locale === 'string' ? body.locale : '',
    message: typeof body.message === 'string' ? body.message : '',
    reply: turn.reply,
    intent: turn.intent,
    verdict: turn.verdict,
    closeness: turn.closeness,
    solved: turn.solved,
    confidence: turn.confidence,
    model: turn.model,
    debug: turn.debug,
    history: body.history,
  })

  const now = Date.now()
  await recordPlay(db, id, viewerKey, turn.solved, now)
  return turn
}

/**
 * 记一次对局。**两条路都走这里**：题库提问、以及会话路径（现在实际上就是官汤）。
 *
 * 语义：`plays` = 按玩家去重后「问过至少一句」的人数，`solves` = 其中解开的人数。
 * 去重靠 `attempts` 表（`puzzle_id + player_key`）。
 *
 * 顺手修了一个老 bug：`solves` 原本只在「这条 attempts 已存在」的分支里加，
 * 于是**第一句就猜中的玩家只算 plays、不算 solves**。
 */
export async function recordPlay(
  db: D1Like,
  puzzleId: string,
  playerKey: string,
  solved: boolean,
  now = Date.now(),
): Promise<void> {
  const existing = await db
    .prepare('SELECT id, solved FROM attempts WHERE puzzle_id = ? AND player_key = ?')
    .bind(puzzleId, playerKey)
    .first<{ id: string; solved: number }>()

  if (!existing) {
    await db
      .prepare(
        'INSERT INTO attempts (id, puzzle_id, player_key, solved, turns, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)',
      )
      .bind(crypto.randomUUID(), puzzleId, playerKey, solved ? 1 : 0, now, now)
      .run()
    await db.prepare('UPDATE puzzles SET plays = plays + 1 WHERE id = ?').bind(puzzleId).run()
    if (solved) {
      await db.prepare('UPDATE puzzles SET solves = solves + 1 WHERE id = ?').bind(puzzleId).run()
    }
    return
  }

  await db
    .prepare('UPDATE attempts SET turns = turns + 1, updated_at = ? WHERE id = ?')
    .bind(now, existing.id)
    .run()
  if (solved && !existing.solved) {
    await db.prepare('UPDATE attempts SET solved = 1 WHERE id = ?').bind(existing.id).run()
    await db.prepare('UPDATE puzzles SET solves = solves + 1 WHERE id = ?').bind(puzzleId).run()
  }
}

export async function revealLibraryPuzzle(
  db: D1Like,
  id: string,
  uid: string | null,
  locale: 'zh-CN' | 'en' | 'ja' = 'zh-CN',
) {
  const row = await loadPlayable(db, id, uid, locale)
  return { title: row.title, truth: row.truth, hint: row.hint }
}

export async function createPuzzle(
  env: GameEnv,
  db: D1Like,
  uid: string,
  body: Record<string, unknown>,
) {
  const puzzle = {
    title: text(body.title, '标题', 40),
    surface: text(body.surface, '汤面', 200),
    truth: text(body.truth, '汤底', 2000),
    hint: text(body.hint, '提示', 200, false),
    difficulty: difficulty(body.difficulty),
    tags: parseTags(body.tags),
    visibility: visibility(body.visibility),
  }
  const id = crypto.randomUUID()
  // 题材坐标：发布时让 Jev 判一次，判不了就退回标签估算
  const genreScore = (await scoreGenre(env, puzzle)) ?? genreFromTags(puzzle.tags)
  await db
    .prepare(
      `INSERT INTO puzzles (id, owner_id, title, surface, truth, hint, difficulty, tags, visibility, plays, solves, genre_score, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)`,
    )
    .bind(
      id,
      uid,
      puzzle.title,
      puzzle.surface,
      puzzle.truth,
      puzzle.hint,
      puzzle.difficulty,
      JSON.stringify(puzzle.tags),
      puzzle.visibility,
      genreScore,
      Date.now(),
    )
    .run()
  return { id }
}

/**
 * 给还没打分的公开题补分。跑在定时维护里——LLM 调用不能塞进列表请求的热路径。
 */
export async function scoreUnscoredPuzzles(env: GameEnv, db: D1Like, limit = 5): Promise<number> {
  const { results } = await db
    .prepare(
      // 官方汤（visibility='daily'）也一起补：它的题材分和题库共用同一份存储
      `SELECT id, title, surface, truth, hint, tags FROM puzzles
        WHERE visibility IN ('public', 'daily') AND genre_score IS NULL
        ORDER BY created_at DESC LIMIT ?`,
    )
    .bind(Math.max(1, Math.min(Math.trunc(limit), 20)))
    .all<{
      id: string
      title: string
      surface: string
      truth: string
      hint: string
      tags: string
    }>()

  let scored = 0
  for (const row of results ?? []) {
    const value =
      (await scoreGenre(env, {
        title: row.title,
        surface: row.surface,
        truth: row.truth,
        hint: row.hint,
      })) ?? genreFromTags(safeTags(row.tags))
    await db.prepare('UPDATE puzzles SET genre_score = ? WHERE id = ?').bind(value, row.id).run()
    scored += 1
  }
  return scored
}

export async function updatePuzzle(
  env: GameEnv,
  db: D1Like,
  uid: string,
  id: string,
  body: Record<string, unknown>,
) {
  const row = await db
    .prepare('SELECT owner_id FROM puzzles WHERE id = ?')
    .bind(id)
    .first<{ owner_id: string }>()
  if (!row) throw new ApiError(404, '这道汤不存在')
  if (row.owner_id !== uid) throw new ApiError(403, '只能修改自己上传的汤')

  const fields: string[] = []
  const values: unknown[] = []
  const set = (column: string, value: unknown) => {
    fields.push(`${column} = ?`)
    values.push(value)
  }

  if (body.title !== undefined) set('title', text(body.title, '标题', 40))
  if (body.surface !== undefined) set('surface', text(body.surface, '汤面', 200))
  if (body.truth !== undefined) set('truth', text(body.truth, '汤底', 2000))
  if (body.hint !== undefined) set('hint', text(body.hint, '提示', 200, false))
  if (body.difficulty !== undefined) set('difficulty', difficulty(body.difficulty))
  if (body.tags !== undefined) set('tags', JSON.stringify(parseTags(body.tags)))
  if (body.visibility !== undefined) set('visibility', visibility(body.visibility))

  if (!fields.length) throw new ApiError(400, '没有要修改的内容')
  values.push(id, uid)
  await db
    .prepare(`UPDATE puzzles SET ${fields.join(', ')} WHERE id = ? AND owner_id = ?`)
    .bind(...values)
    .run()

  // 题面/汤底变了，题材坐标要重打；标签变了也得跟着动，否则会留一个过时的分
  if (body.surface !== undefined || body.truth !== undefined || body.tags !== undefined) {
    const updated = await db
      .prepare('SELECT title, surface, truth, hint, tags FROM puzzles WHERE id = ?')
      .bind(id)
      .first<{ title: string; surface: string; truth: string; hint: string; tags: string }>()
    if (updated) {
      const score = (await scoreGenre(env, updated)) ?? genreFromTags(safeTags(updated.tags))
      await db.prepare('UPDATE puzzles SET genre_score = ? WHERE id = ?').bind(score, id).run()
    }
  }
  return { ok: true }
}

export async function deletePuzzle(db: D1Like, uid: string, id: string) {
  const row = await db
    .prepare('SELECT owner_id FROM puzzles WHERE id = ?')
    .bind(id)
    .first<{ owner_id: string }>()
  if (!row) throw new ApiError(404, '这道汤不存在')
  if (row.owner_id !== uid) throw new ApiError(403, '只能删除自己上传的汤')
  await db.prepare('DELETE FROM attempts WHERE puzzle_id = ?').bind(id).run()
  await db
    .prepare("DELETE FROM comments WHERE target_type = 'puzzle' AND target_id = ?")
    .bind(id)
    .run()
  await db
    .prepare("DELETE FROM likes WHERE target_type = 'puzzle' AND target_id = ?")
    .bind(id)
    .run()
  await db.prepare('DELETE FROM puzzles WHERE id = ?').bind(id).run()
  return { ok: true }
}

export async function listOwnPuzzles(db: D1Like, uid: string) {
  const { results } = await db
    .prepare('SELECT * FROM puzzles WHERE owner_id = ? ORDER BY created_at DESC LIMIT 200')
    .bind(uid)
    .all<PuzzleRow>()
  return (results ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    surface: row.surface,
    difficulty: row.difficulty,
    tags: safeTags(row.tags),
    visibility: row.visibility as Visibility,
    plays: row.plays,
    solves: row.solves,
    createdAt: row.created_at,
    truth: row.truth,
    hint: row.hint,
  }))
}

export interface Profile {
  uid: string
  email?: string
  handle: string
  displayName: string
  bio: string
  profilePublic: boolean
  createdAt: number
  /** 各自最后一次「真的改了」的时间；null 表示还没改过，随时可改 */
  handleChangedAt: number | null
  displayNameChangedAt: number | null
  bioChangedAt: number | null
}

/** 主页地址一年只能自定义一次，昵称和简介 30 天一次。 */
export const HANDLE_COOLDOWN_MS = 1000 * 60 * 60 * 24 * 365
export const PROFILE_FIELD_COOLDOWN_MS = 1000 * 60 * 60 * 24 * 30

function formatDay(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10)
}

/** 冷却期内不许再改；只拦「真的改了」的情况，原样提交不算。 */
function assertCooldown(label: string, last: number | null, windowMs: number): void {
  if (last === null) return
  const readyAt = last + windowMs
  if (Date.now() < readyAt) {
    throw new ApiError(429, `${label}在冷却期内，下次可以修改的日期是 ${formatDay(readyAt)}`)
  }
}

export function defaultHandle(): string {
  return `u-${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`
}

export function defaultDisplayName(email: string): string {
  const local = email.split('@')[0] ?? ''
  return local.slice(0, 24) || '匿名'
}

/** Every user gets a handle on first use, so profile URLs always resolve. */
export async function ensureHandle(db: D1Like, uid: string): Promise<string> {
  const row = await db
    .prepare('SELECT handle FROM users WHERE id = ?')
    .bind(uid)
    .first<{ handle: string | null }>()
  if (row?.handle) return row.handle
  const handle = defaultHandle()
  await db
    .prepare('UPDATE users SET handle = ?, updated_at = ? WHERE id = ?')
    .bind(handle, Date.now(), uid)
    .run()
  return handle
}

async function profileRow(db: D1Like, where: string, value: string) {
  return db
    .prepare(
      `SELECT id, email, handle, display_name, bio, profile_public, created_at,
              handle_changed_at, display_name_changed_at, bio_changed_at
         FROM users WHERE ${where} = ?`,
    )
    .bind(value)
    .first<{
      id: string
      email: string
      handle: string | null
      display_name: string | null
      bio: string
      profile_public: number
      created_at: number
      handle_changed_at: number | null
      display_name_changed_at: number | null
      bio_changed_at: number | null
    }>()
}

export async function getMyProfile(db: D1Like, uid: string): Promise<Profile> {
  const handle = await ensureHandle(db, uid)
  const row = await profileRow(db, 'id', uid)
  if (!row) throw new ApiError(404, '账号不存在')
  return {
    uid: row.id,
    email: row.email,
    handle: row.handle ?? handle,
    displayName: row.display_name ?? defaultDisplayName(row.email),
    bio: row.bio ?? '',
    profilePublic: row.profile_public !== 0,
    createdAt: row.created_at,
    handleChangedAt: row.handle_changed_at ?? null,
    displayNameChangedAt: row.display_name_changed_at ?? null,
    bioChangedAt: row.bio_changed_at ?? null,
  }
}

export async function updateProfile(db: D1Like, uid: string, body: Record<string, unknown>) {
  // 要先拿到旧值：冷却只针对「真的改了」，原样提交既不算改动也不该被拦
  const current = await profileRow(db, 'id', uid)
  if (!current) throw new ApiError(404, '账号不存在')

  const fields: string[] = []
  const values: unknown[] = []
  const set = (column: string, value: unknown) => {
    fields.push(`${column} = ?`)
    values.push(value)
  }
  const now = Date.now()

  if (body.displayName !== undefined) {
    const displayName = text(body.displayName, '昵称', 24)
    if (displayName !== (current.display_name ?? '')) {
      assertCooldown('昵称', current.display_name_changed_at ?? null, PROFILE_FIELD_COOLDOWN_MS)
      set('display_name', displayName)
      set('display_name_changed_at', now)
    }
  }
  if (body.bio !== undefined) {
    const bio = text(body.bio, '个人简介', 200, false)
    if (bio !== (current.bio ?? '')) {
      assertCooldown('个人简介', current.bio_changed_at ?? null, PROFILE_FIELD_COOLDOWN_MS)
      set('bio', bio)
      set('bio_changed_at', now)
    }
  }
  if (body.profilePublic !== undefined) {
    set('profile_public', body.profilePublic ? 1 : 0)
  }
  if (body.handle !== undefined) {
    const handle = text(body.handle, '主页地址', 20).toLowerCase()
    if (!/^[a-z0-9][a-z0-9-]{2,19}$/.test(handle)) {
      throw new ApiError(400, '主页地址只能用 3-20 位小写字母、数字或连字符')
    }
    if (handle !== (current.handle ?? '')) {
      assertCooldown('主页地址', current.handle_changed_at ?? null, HANDLE_COOLDOWN_MS)
      const taken = await db
        .prepare('SELECT id FROM users WHERE handle = ? AND id != ?')
        .bind(handle, uid)
        .first<{ id: string }>()
      if (taken) throw new ApiError(409, '这个主页地址已经被占用了')
      set('handle', handle)
      set('handle_changed_at', now)
    }
  }

  if (!fields.length) throw new ApiError(400, '没有要修改的内容')
  set('updated_at', now)
  values.push(uid)
  await db
    .prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run()
  return getMyProfile(db, uid)
}

export async function getPublicProfile(db: D1Like, handle: string) {
  const row = await profileRow(db, 'handle', handle)
  if (!row) throw new ApiError(404, '找不到这个作者')
  const base = {
    handle: row.handle ?? handle,
    displayName: row.display_name ?? defaultDisplayName(row.email),
    createdAt: row.created_at,
  }
  if (row.profile_public === 0) {
    return { ...base, bio: '', profilePublic: false, puzzles: [] }
  }
  const { results } = await db
    .prepare(
      `SELECT p.*, u.handle AS owner_handle, u.display_name AS owner_name
       FROM puzzles p JOIN users u ON u.id = p.owner_id
       WHERE p.owner_id = ? AND p.visibility = 'public'
       ORDER BY p.created_at DESC LIMIT 100`,
    )
    .bind(row.id)
    .all<OwnedRow>()
  return {
    ...base,
    bio: row.bio ?? '',
    profilePublic: true,
    puzzles: (results ?? []).map(toPublic),
  }
}
