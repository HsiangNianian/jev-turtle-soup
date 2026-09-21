import type { D1Like } from './auth.ts'
import { ApiError } from './errors.ts'
import { askError, judge, readLocale, type GameEnv } from './game.ts'
import { logTurn } from './logs.ts'

export type Visibility = 'public' | 'private'

export const VISIBILITIES: Visibility[] = ['public', 'private']
const DIFFICULTIES = ['简单', '中等', '困难']

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

const OWNER_SELECT = `SELECT p.*, u.handle AS owner_handle, u.display_name AS owner_name
  FROM puzzles p JOIN users u ON u.id = p.owner_id`

export async function listPublicPuzzles(
  db: D1Like,
  options: { sort: string; limit: number; offset: number; query: string; tag?: string },
): Promise<PublicPuzzle[]> {
  const limit = Math.min(Math.max(options.limit || 20, 1), 50)
  const offset = Math.max(options.offset || 0, 0)
  const query = options.query.trim()
  const tag = (options.tag ?? '').trim().slice(0, 12)
  const order = options.sort === 'hot' ? 'p.plays DESC, p.created_at DESC' : 'p.created_at DESC'

  const filters = [`p.visibility = 'public'`]
  const bindings: unknown[] = []
  if (query) {
    filters.push('p.title LIKE ?')
    bindings.push(`%${query}%`)
  }
  if (tag) {
    // tags are a JSON array string; match the quoted value so prefixes don't leak
    filters.push('p.tags LIKE ?')
    bindings.push(`%"${tag}"%`)
  }
  bindings.push(limit, offset)

  const { results } = await db
    .prepare(`${OWNER_SELECT} WHERE ${filters.join(' AND ')} ORDER BY ${order} LIMIT ? OFFSET ?`)
    .bind(...bindings)
    .all<OwnedRow>()
  return (results ?? []).map(toPublic)
}

/** Tag counts across public puzzles, most used first. */
export async function listTags(db: D1Like): Promise<{ tag: string; count: number }[]> {
  const { results } = await db
    .prepare(`SELECT tags FROM puzzles WHERE visibility = 'public' LIMIT 500`)
    .all<{ tags: string }>()
  const counts = new Map<string, number>()
  for (const row of results ?? []) {
    for (const tag of safeTags(row.tags)) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
}

export async function getPublicPuzzle(
  db: D1Like,
  id: string,
): Promise<PublicPuzzle & { ownerBio: string }> {
  const row = await db
    .prepare(`${OWNER_SELECT} WHERE p.id = ? AND p.visibility = 'public'`)
    .bind(id)
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
  if (row.visibility !== 'public' && row.owner_id !== uid) {
    throw askError(locale, 'notPublic')
  }
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
  const existing = await db
    .prepare('SELECT id, solved FROM attempts WHERE puzzle_id = ? AND player_key = ?')
    .bind(id, viewerKey)
    .first<{ id: string; solved: number }>()

  if (!existing) {
    await db
      .prepare(
        'INSERT INTO attempts (id, puzzle_id, player_key, solved, turns, created_at, updated_at) VALUES (?, ?, ?, 0, 1, ?, ?)',
      )
      .bind(crypto.randomUUID(), id, viewerKey, now, now)
      .run()
    await db.prepare('UPDATE puzzles SET plays = plays + 1 WHERE id = ?').bind(id).run()
  } else {
    await db
      .prepare('UPDATE attempts SET turns = turns + 1, updated_at = ? WHERE id = ?')
      .bind(now, existing.id)
      .run()
    if (turn.solved && !existing.solved) {
      await db.prepare('UPDATE attempts SET solved = 1 WHERE id = ?').bind(existing.id).run()
      await db.prepare('UPDATE puzzles SET solves = solves + 1 WHERE id = ?').bind(id).run()
    }
  }

  return turn
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

export async function createPuzzle(db: D1Like, uid: string, body: Record<string, unknown>) {
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
  await db
    .prepare(
      `INSERT INTO puzzles (id, owner_id, title, surface, truth, hint, difficulty, tags, visibility, plays, solves, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?)`,
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
      Date.now(),
    )
    .run()
  return { id }
}

export async function updatePuzzle(
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
      `SELECT id, email, handle, display_name, bio, profile_public, created_at FROM users WHERE ${where} = ?`,
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
  }
}

export async function updateProfile(db: D1Like, uid: string, body: Record<string, unknown>) {
  const fields: string[] = []
  const values: unknown[] = []
  const set = (column: string, value: unknown) => {
    fields.push(`${column} = ?`)
    values.push(value)
  }

  if (body.displayName !== undefined) {
    set('display_name', text(body.displayName, '昵称', 24))
  }
  if (body.bio !== undefined) {
    set('bio', text(body.bio, '个人简介', 200, false))
  }
  if (body.profilePublic !== undefined) {
    set('profile_public', body.profilePublic ? 1 : 0)
  }
  if (body.handle !== undefined) {
    const handle = text(body.handle, '主页地址', 20).toLowerCase()
    if (!/^[a-z0-9][a-z0-9-]{2,19}$/.test(handle)) {
      throw new ApiError(400, '主页地址只能用 3-20 位小写字母、数字或连字符')
    }
    const taken = await db
      .prepare('SELECT id FROM users WHERE handle = ? AND id != ?')
      .bind(handle, uid)
      .first<{ id: string }>()
    if (taken) throw new ApiError(409, '这个主页地址已经被占用了')
    set('handle', handle)
  }

  if (!fields.length) throw new ApiError(400, '没有要修改的内容')
  set('updated_at', Date.now())
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
