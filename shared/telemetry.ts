import type { D1Like } from './auth.ts'

/**
 * 客户端错误上报。
 *
 * 和「反馈」是互补的两件事：反馈要玩家自己发现、自己描述，而**白屏的时候
 * 他根本按不到反馈按钮** —— 最需要知道的故障恰好手动不了。所以这一条是自动的。
 *
 * 只收技术信息：错误、堆栈、路径、版本。**不收任何题面、对话或邮箱** ——
 * 错误上报不该变成偷偷上传用户数据。
 */
export interface ClientErrorInput {
  message: string
  stack?: string
  path?: string
  buildId?: string
  locale?: string
  source?: string
}

/** 表里最多留这么多个不同的错误，超了就只累加已有的、不再开新行。 */
const MAX_DISTINCT_ERRORS = 500

function cut(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : ''
}

/** FNV-1a：同步、无依赖，够用来把同一条错误归到一起。 */
function fnv1a(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

export function errorHash(input: ClientErrorInput): string {
  return fnv1a(`${cut(input.message, 300)}|${cut(input.buildId, 40)}`)
}

export interface StoredClientError {
  hash: string
  message: string
  stack: string
  path: string
  buildId: string
  locale: string
  source: string
  count: number
  firstAt: number
  lastAt: number
}

export async function recordClientError(
  db: D1Like,
  input: ClientErrorInput,
): Promise<{ ok: true }> {
  const message = cut(input.message, 300).trim()
  // 空消息没有诊断价值，只会占一行
  if (!message) return { ok: true }

  const hash = errorHash(input)
  const now = Date.now()
  const existing = await db
    .prepare('SELECT hash FROM client_errors WHERE hash = ?')
    .bind(hash)
    .first<{ hash: string }>()

  if (existing) {
    await db
      .prepare('UPDATE client_errors SET count = count + 1, last_at = ? WHERE hash = ?')
      .bind(now, hash)
      .run()
    return { ok: true }
  }

  const total = await db
    .prepare('SELECT COUNT(*) AS n FROM client_errors')
    .first<{ n: number }>()
  if ((total?.n ?? 0) >= MAX_DISTINCT_ERRORS) return { ok: true }

  await db
    .prepare(
      `INSERT INTO client_errors (hash, message, stack, path, build_id, locale, source, count, first_at, last_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    )
    .bind(
      hash,
      message,
      cut(input.stack, 2000),
      cut(input.path, 200),
      cut(input.buildId, 40),
      cut(input.locale, 12),
      cut(input.source, 24),
      now,
      now,
    )
    .run()
  return { ok: true }
}

interface ErrorRow {
  hash: string
  message: string
  stack: string
  path: string
  build_id: string
  locale: string
  source: string
  count: number
  first_at: number
  last_at: number
}

/** 按出现次数倒序 —— 最该先看的排在最前面。 */
export async function listClientErrors(db: D1Like, limit = 50): Promise<StoredClientError[]> {
  const { results } = await db
    .prepare(
      `SELECT hash, message, stack, path, build_id, locale, source, count, first_at, last_at
         FROM client_errors ORDER BY count DESC, last_at DESC LIMIT ?`,
    )
    .bind(Math.max(1, Math.min(Math.trunc(limit), 200)))
    .all<ErrorRow>()

  return (results ?? []).map((row) => ({
    hash: row.hash,
    message: row.message,
    stack: row.stack,
    path: row.path,
    buildId: row.build_id,
    locale: row.locale,
    source: row.source,
    count: row.count,
    firstAt: row.first_at,
    lastAt: row.last_at,
  }))
}
