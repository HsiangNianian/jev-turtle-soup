import type { D1Like } from './auth.ts'
import { ApiError } from './errors.ts'
import { submitReport } from './logs.ts'

/**
 * 点赞与留言板，给「作者主页」和「题库里的汤」共用。
 *
 * - 点赞匿名：登录了用 uid，没登录用本机设备号，同一个人对一个对象只能赞一次
 * - 留言要登录：有署名才谈得上留言板
 * - 删除：留言的作者本人，或者这个对象的主人（作者主页的作者 / 题目题主）
 */
export type TargetType = 'profile' | 'puzzle'

const MAX_COMMENT_CHARS = 300

export interface SocialTarget {
  type: TargetType
  id: string
  /** 这个对象的归属者：作者主页是本人，题目是题主 */
  ownerId: string
}

export interface CommentView {
  id: string
  body: string
  createdAt: number
  author: { handle: string; displayName: string }
  mine: boolean
  canDelete: boolean
}

export interface SocialPayload {
  likes: number
  liked: boolean
  comments: CommentView[]
  /** 这页归不归当前登录的人管 */
  canModerate: boolean
  signedIn: boolean
}

interface CommentRow {
  id: string
  body: string
  created_at: number
  author_id: string
  handle: string | null
  display_name: string | null
}

/** 把 URL 里的 kind + id 落到一个真实对象上；私密的东西一律当作不存在。 */
export async function resolveTarget(db: D1Like, kind: string, id: string): Promise<SocialTarget> {
  if (kind === 'profile') {
    const row = await db
      .prepare('SELECT id, profile_public FROM users WHERE handle = ?')
      .bind(id.toLowerCase())
      .first<{ id: string; profile_public: number }>()
    if (!row || row.profile_public === 0) throw new ApiError(404, '找不到这个作者')
    return { type: 'profile', id: row.id, ownerId: row.id }
  }
  if (kind === 'puzzle') {
    const row = await db
      .prepare("SELECT id, owner_id FROM puzzles WHERE id = ? AND visibility = 'public'")
      .bind(id)
      .first<{ id: string; owner_id: string }>()
    if (!row) throw new ApiError(404, '这道汤不存在，或者作者没有公开')
    return { type: 'puzzle', id: row.id, ownerId: row.owner_id }
  }
  throw new ApiError(404, '不知道要对谁点赞')
}

export function likerKey(uid: string | null, deviceKey: unknown): string {
  if (uid) return uid
  const raw = typeof deviceKey === 'string' ? deviceKey.trim() : ''
  return raw.slice(0, 64) || 'anon'
}

async function likeCount(db: D1Like, target: SocialTarget): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM likes WHERE target_type = ? AND target_id = ?')
    .bind(target.type, target.id)
    .first<{ n: number }>()
  return row?.n ?? 0
}

async function listComments(
  db: D1Like,
  target: SocialTarget,
  viewerUid: string | null,
): Promise<CommentView[]> {
  const { results } = await db
    .prepare(
      `SELECT c.id, c.body, c.created_at, c.author_id, u.handle, u.display_name
         FROM comments c
         LEFT JOIN users u ON u.id = c.author_id
        WHERE c.target_type = ? AND c.target_id = ?
        ORDER BY c.created_at DESC
        LIMIT 100`,
    )
    .bind(target.type, target.id)
    .all<CommentRow>()

  return (results ?? []).map((row) => ({
    id: row.id,
    body: row.body,
    createdAt: row.created_at,
    author: {
      handle: row.handle ?? '',
      displayName: row.display_name ?? row.handle ?? '匿名',
    },
    mine: viewerUid !== null && row.author_id === viewerUid,
    canDelete: viewerUid !== null && (row.author_id === viewerUid || target.ownerId === viewerUid),
  }))
}

export async function getSocial(
  db: D1Like,
  target: SocialTarget,
  key: string,
  viewerUid: string | null,
): Promise<SocialPayload> {
  const [likes, liked, comments] = await Promise.all([
    likeCount(db, target),
    db
      .prepare(
        'SELECT 1 AS ok FROM likes WHERE target_type = ? AND target_id = ? AND player_key = ?',
      )
      .bind(target.type, target.id, key)
      .first<{ ok: number }>(),
    listComments(db, target, viewerUid),
  ])
  return {
    likes,
    liked: Boolean(liked),
    comments,
    canModerate: viewerUid !== null && viewerUid === target.ownerId,
    signedIn: viewerUid !== null,
  }
}

/** 点赞 / 取消；返回最新的数字，省得前端自己猜。 */
export async function setLike(
  db: D1Like,
  target: SocialTarget,
  key: string,
  on: boolean,
): Promise<{ likes: number; liked: boolean }> {
  if (on) {
    // 唯一索引兜底：重复点赞不会变成两条
    await db
      .prepare(
        `INSERT OR IGNORE INTO likes (id, target_type, target_id, player_key, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(crypto.randomUUID(), target.type, target.id, key, Date.now())
      .run()
  } else {
    await db
      .prepare('DELETE FROM likes WHERE target_type = ? AND target_id = ? AND player_key = ?')
      .bind(target.type, target.id, key)
      .run()
  }
  return { likes: await likeCount(db, target), liked: on }
}

export async function addComment(
  db: D1Like,
  target: SocialTarget,
  authorId: string,
  body: unknown,
): Promise<CommentView> {
  const text = typeof body === 'string' ? body.trim() : ''
  if (text.length < 2) throw new ApiError(400, '留言太短了，至少写两个字')
  if (text.length > MAX_COMMENT_CHARS) {
    throw new ApiError(400, `留言太长了（最多 ${MAX_COMMENT_CHARS} 字）`)
  }
  const id = crypto.randomUUID()
  const now = Date.now()
  await db
    .prepare(
      `INSERT INTO comments (id, target_type, target_id, author_id, body, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, target.type, target.id, authorId, text, now)
    .run()

  const row = await db
    .prepare(
      `SELECT c.id, c.body, c.created_at, c.author_id, u.handle, u.display_name
         FROM comments c LEFT JOIN users u ON u.id = c.author_id
        WHERE c.id = ?`,
    )
    .bind(id)
    .first<CommentRow>()
  return {
    id,
    body: text,
    createdAt: now,
    author: {
      handle: row?.handle ?? '',
      displayName: row?.display_name ?? row?.handle ?? '匿名',
    },
    mine: true,
    canDelete: true,
  }
}

/** 删除留言：只有留言作者本人，或者这个对象的主人能删。 */
export async function deleteComment(db: D1Like, commentId: string, uid: string): Promise<void> {
  const row = await db
    .prepare('SELECT id, target_type, target_id, author_id FROM comments WHERE id = ?')
    .bind(commentId)
    .first<{ id: string; target_type: string; target_id: string; author_id: string }>()
  if (!row) throw new ApiError(404, '这条留言已经不在了')

  let ownerId: string | null = null
  if (row.target_type === 'puzzle') {
    const puzzle = await db
      .prepare('SELECT owner_id FROM puzzles WHERE id = ?')
      .bind(row.target_id)
      .first<{ owner_id: string }>()
    ownerId = puzzle?.owner_id ?? null
  } else {
    ownerId = row.target_id
  }

  if (row.author_id !== uid && ownerId !== uid) {
    throw new ApiError(403, '只能删除自己的留言')
  }
  await db.prepare('DELETE FROM comments WHERE id = ?').bind(commentId).run()
}

/** 举报一条留言：把留言本身存进快照，方便事后追溯。 */
export async function reportComment(
  db: D1Like,
  commentId: string,
  viewer: { uid: string | null; playerKey: string },
  note: string,
  locale: string,
): Promise<{ id: string }> {
  const row = await db
    .prepare(
      `SELECT c.id, c.body, c.target_type, c.target_id, c.created_at,
              u.handle, u.display_name
         FROM comments c LEFT JOIN users u ON u.id = c.author_id
        WHERE c.id = ?`,
    )
    .bind(commentId)
    .first<{
      id: string
      body: string
      target_type: string
      target_id: string
      created_at: number
      handle: string | null
      display_name: string | null
    }>()
  if (!row) throw new ApiError(404, '这条留言已经不在了')

  return submitReport(db, {
    puzzleId: '',
    kind: 'comment',
    note,
    snapshot: {
      commentId: row.id,
      body: row.body,
      targetType: row.target_type,
      targetId: row.target_id,
      createdAt: row.created_at,
      author: { handle: row.handle, displayName: row.display_name },
    },
    playerKey: viewer.uid ?? viewer.playerKey,
    locale,
    targetType: 'comment',
    targetId: commentId,
  })
}
