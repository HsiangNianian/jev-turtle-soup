import type { D1Like } from './auth.ts'
import { ApiError } from './errors.ts'

/**
 * 管理后台的数据层。
 *
 * 鉴权走**登录态 + admins 表**，不是共享口令：管理页面是给具体的人用的，
 * 谁删了哪条应该能对上号。口令只保留给机器调用的 /api/audit/* 那一类。
 */

function clamp(limit: number, fallback = 100, max = 500): number {
  if (!Number.isFinite(limit)) return fallback
  return Math.max(1, Math.min(Math.trunc(limit), max))
}

function parseJson(value: unknown): unknown {
  if (typeof value !== 'string' || !value) return null
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

/** 这个 uid 是不是管理员。表很小，主键查询，随便查。 */
export async function isAdmin(db: D1Like, uid: string | null | undefined): Promise<boolean> {
  if (!uid) return false
  const row = await db
    .prepare('SELECT uid FROM admins WHERE uid = ?')
    .bind(uid)
    .first<{ uid: string }>()
  return Boolean(row)
}

export interface AdminEntry {
  uid: string
  email: string
  displayName: string | null
  handle: string | null
  createdAt: number
}

interface AdminRow {
  uid: string
  email: string | null
  display_name: string | null
  handle: string | null
  created_at: number
}

/** 管理员列表。LEFT JOIN —— 用户行没了也要把名单本身显示出来，否则无从清理。 */
export async function listAdmins(db: D1Like): Promise<AdminEntry[]> {
  const { results } = await db
    .prepare(
      `SELECT a.uid, u.email, u.display_name, u.handle, a.created_at
         FROM admins a LEFT JOIN users u ON u.id = a.uid
        ORDER BY a.created_at ASC`,
    )
    .all<AdminRow>()

  return (results ?? []).map((row) => ({
    uid: row.uid,
    email: row.email ?? '',
    displayName: row.display_name ?? null,
    handle: row.handle ?? null,
    createdAt: row.created_at,
  }))
}

interface UserRow {
  id: string
  email: string
  display_name: string | null
  handle: string | null
}

/** 按 uid 或邮箱加管理员；两种都认，找不到人就说清楚。 */
export async function addAdmin(
  db: D1Like,
  input: { uid?: string; email?: string },
): Promise<AdminEntry> {
  const uid = (input.uid ?? '').trim()
  const email = (input.email ?? '').trim().toLowerCase()
  let user: UserRow | null = null
  if (uid) {
    user =
      (await db
        .prepare('SELECT id, email, display_name, handle FROM users WHERE id = ?')
        .bind(uid)
        .first<UserRow>()) ?? null
  } else if (email) {
    user =
      (await db
        .prepare('SELECT id, email, display_name, handle FROM users WHERE email = ?')
        .bind(email)
        .first<UserRow>()) ?? null
  } else {
    throw new ApiError(400, '请填写用户 id 或邮箱')
  }
  if (!user) throw new ApiError(404, '找不到这个用户（他得先登录过一次）')

  const now = Date.now()
  await db
    .prepare('INSERT OR IGNORE INTO admins (uid, created_at) VALUES (?, ?)')
    .bind(user.id, now)
    .run()
  return {
    uid: user.id,
    email: user.email,
    displayName: user.display_name,
    handle: user.handle,
    createdAt: now,
  }
}

/** 移除管理员。至少留一名 —— 免得手一滑把所有人都删了，谁也进不去。 */
export async function removeAdmin(db: D1Like, uid: string): Promise<void> {
  if (!uid) throw new ApiError(400, '缺少 uid')
  const row = await db
    .prepare('SELECT uid FROM admins WHERE uid = ?')
    .bind(uid)
    .first<{ uid: string }>()
  if (!row) return
  const total = await db.prepare('SELECT COUNT(*) AS n FROM admins').first<{ n: number }>()
  if ((total?.n ?? 0) <= 1) throw new ApiError(400, '至少保留一名管理员')
  await db.prepare('DELETE FROM admins WHERE uid = ?').bind(uid).run()
}

const REPORT_STATUSES = ['open', 'resolved', 'dismissed'] as const
export type ReportStatus = (typeof REPORT_STATUSES)[number]

export interface AdminReport {
  id: string
  puzzleId: string | null
  puzzleTitle: string | null
  kind: string | null
  playerKey: string | null
  locale: string | null
  note: string
  status: string
  createdAt: number
  targetType: string | null
  targetId: string | null
  snapshot: unknown
}

interface ReportRow {
  id: string
  puzzle_id: string | null
  puzzle_title: string | null
  kind: string | null
  player_key: string | null
  locale: string | null
  note: string
  status: string
  created_at: number
  target_type: string | null
  target_id: string | null
  snapshot_json: string | null
}

export async function listReports(db: D1Like, limit = 100): Promise<AdminReport[]> {
  const { results } = await db
    .prepare(
      `SELECT r.id, r.puzzle_id, p.title AS puzzle_title, r.kind, r.player_key, r.locale,
              r.note, r.status, r.created_at, r.target_type, r.target_id, r.snapshot_json
         FROM reports r LEFT JOIN puzzles p ON p.id = r.puzzle_id
        ORDER BY r.created_at DESC
        LIMIT ?`,
    )
    .bind(clamp(limit))
    .all<ReportRow>()

  return (results ?? []).map((row) => ({
    id: row.id,
    puzzleId: row.puzzle_id,
    puzzleTitle: row.puzzle_title,
    kind: row.kind,
    playerKey: row.player_key,
    locale: row.locale,
    note: row.note,
    status: row.status,
    createdAt: row.created_at,
    targetType: row.target_type,
    targetId: row.target_id,
    snapshot: parseJson(row.snapshot_json),
  }))
}

export async function setReportStatus(db: D1Like, id: string, status: string): Promise<void> {
  if (!id) throw new ApiError(400, '缺少 id')
  if (!REPORT_STATUSES.includes(status as ReportStatus)) throw new ApiError(400, '未知的状态')
  await db.prepare('UPDATE reports SET status = ? WHERE id = ?').bind(status, id).run()
}

export async function deleteReport(db: D1Like, id: string): Promise<void> {
  if (!id) throw new ApiError(400, '缺少 id')
  await db.prepare('DELETE FROM reports WHERE id = ?').bind(id).run()
}

export async function deleteJudgeFlag(db: D1Like, id: string): Promise<void> {
  if (!id) throw new ApiError(400, '缺少 id')
  await db.prepare('DELETE FROM judge_flags WHERE id = ?').bind(id).run()
}

export async function deleteClientError(db: D1Like, hash: string): Promise<void> {
  if (!hash) throw new ApiError(400, '缺少 hash')
  await db.prepare('DELETE FROM client_errors WHERE hash = ?').bind(hash).run()
}

/** 清空全部客户端错误。一次白屏能刷出几百条，逐条删不现实。 */
export async function clearClientErrors(db: D1Like): Promise<void> {
  await db.prepare('DELETE FROM client_errors').run()
}
