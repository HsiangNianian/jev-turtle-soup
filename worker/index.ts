import {
  ApiError,
  askHost,
  health,
  revealGame,
  SESSION_RETENTION_MS,
  type GameEnv,
  type PuzzleStore,
} from '../shared/game.ts'
import { logTurn, purgeOldLogs, submitReport } from '../shared/logs.ts'
import {
  addAdmin,
  clearClientErrors,
  deleteClientError,
  deleteJudgeFlag,
  deleteReport,
  isAdmin,
  listAdmins,
  listPuzzlesForAdmin,
  listReports,
  removeAdmin,
  setPuzzleFeatured,
  setReportStatus,
} from '../shared/admin.ts'
import { composeDaily, LOCALE_LABEL_ZH, utcDateKey } from '../shared/daily.ts'
import {
  DIGEST_WINDOW_MS,
  listDigestRecipients,
  renderDigest,
  sendDigest,
  unsubscribeByToken,
} from '../shared/digest.ts'
import {
  authorActivity,
  authorSummary,
  countAuthorSocial,
  countUnreadActivity,
  listOwnPuzzles,
  markActivitySeen,
  recognise,
} from '../shared/author.ts'
import { inspectJudgments, listJudgeFlags, type AuditResult } from '../shared/audit.ts'
import { listClientErrors, recordClientError, recordWorkerError } from '../shared/telemetry.ts'
import {
  addComment,
  deleteComment,
  getSocial,
  likerKey,
  reportComment,
  resolveTarget,
  setLike,
} from '../shared/social.ts'
import { askError, readLocale } from '../shared/game.ts'
import { applyMeta, pickMetaLocale, type MetaOverride } from '../shared/meta.ts'
import {
  clearedCookie,
  destroySession,
  normaliseEmail,
  readCookie,
  readSession,
  requestCode,
  SESSION_COOKIE,
  sessionCookie,
  verifyCode,
  type AuthDeps,
  type D1Like,
  type EmailLike,
  type KVLike,
} from '../shared/auth.ts'
import {
  askLibraryPuzzle,
  createPuzzle,
  recordPlay,
  defaultDisplayName,
  deletePuzzle,
  ensureHandle,
  getMyProfile,
  getPublicProfile,
  getPublicPuzzle,
  listPublicPuzzles,
  searchPublicPuzzles,
  revealLibraryPuzzle,
  scoreUnscoredPuzzles,
  updateProfile,
  updatePuzzle,
} from '../shared/library.ts'

export interface Env extends GameEnv {
  ASSETS?: { fetch: (request: Request) => Promise<Response> }
  AUTH_KV?: KVLike
  DB?: D1Like
  EMAIL?: EmailLike
  AUTH_SECRET?: string
  MAIL_FROM?: string
  AUTH_EXPOSE_CODE?: string
  DAILY_ADMIN_TOKEN?: string
}

interface Viewer {
  uid: string | null
  email: string | null
}

/**
 * 半静态的读接口允许**浏览器**缓存（private）：重复打开同一个页面就不必再走一次网络。
 * 一律 private —— 不让 Cloudflare 边缘缓存 JSON，省得再遇到「改了但边缘还是旧的」。
 */
const BROWSER_CACHE = { 'cache-control': 'private, max-age=300' }
const SHORT_BROWSER_CACHE = { 'cache-control': 'private, max-age=60' }

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    },
  })
}

/** 邮件里点进来的落地页：极小的一张 HTML，中英各一句。 */
function htmlPage(title: string, message: string): Response {
  return new Response(
    `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">` +
      `<meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · 海龟汤调查局</title></head>` +
      `<body style="font-family:ui-monospace,Menlo,monospace;line-height:1.9;color:#17150f;max-width:32rem;margin:12vh auto;padding:0 1.25rem">` +
      `<h1 style="font-size:1.4rem">${title}</h1><p>${message}</p></body></html>`,
    {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
    },
  )
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text()
  if (!text.trim()) return {}
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    throw new ApiError(400, '请求体不是合法的 JSON')
  }
}

function sessionToken(request: Request): string | null {
  return readCookie(request.headers.get('cookie'), SESSION_COOKIE)
}

const SESSION_VISIBILITY = 'session'

/** 每天 04:00 UTC 跑维护（清理日志 + 巡检判读），跟出题的 Cron 分开。 */
const MAINTENANCE_CRON = '0 4 * * *'

interface DailyRow {
  date: string
  puzzle_id: string
  // 下面这些可玩字段来自 JOIN puzzles —— dailies 不再自己存一份
  title: string
  surface: string
  truth: string
  hint: string
  tags: string
  difficulty: string
  genre_score: number | null
  plays: number
  solves: number
  // 以下是每日独有的
  story: string
  review_json: string | null
  generate_attempts: number
  relaxed: number
  locale: string | null
  genre_target: number | null
  created_at: number
}

/** 每日独有的列 + 从 puzzles 借来的可玩字段。 */
const DAILY_SELECT = `SELECT d.*, p.title, p.surface, p.truth, p.hint, p.tags, p.difficulty,
         p.genre_score, p.plays, p.solves
    FROM dailies d JOIN puzzles p ON p.id = d.puzzle_id`

function dailyByDate(db: D1Like, date: string) {
  return db
    .prepare(`${DAILY_SELECT} WHERE d.date = ?`)
    .bind(date)
    .first<DailyRow>()
}

/** 这道题是不是「今天的」官方汤——当天的汤不许提前揭晓。 */
async function isLockedDaily(db: D1Like, puzzleId: string): Promise<boolean> {
  const row = await db
    .prepare('SELECT date FROM dailies WHERE puzzle_id = ?')
    .bind(puzzleId)
    .first<{ date: string }>()
  return row?.date === utcDateKey()
}

function dailyPayload(row: DailyRow, locked: boolean) {
  let tags: string[] = []
  try {
    tags = JSON.parse(row.tags) as string[]
  } catch {
    tags = []
  }
  return {
    date: row.date,
    title: row.title,
    puzzleId: row.puzzle_id,
    surface: row.surface,
    difficulty: row.difficulty,
    tags,
    /** 这碗汤原生用什么语言写的——非该语言的读者要能一眼看出来 */
    locale: row.locale ?? 'zh-CN',
    /** 实际落点（0 本格 · 100 变格），没打过分就是 null */
    genreScore: row.genre_score ?? null,
    /** 有多少人问过；今天这碗只报这个 */
    plays: row.plays,
    /** 解开的人数：今天那碗不给，免得提前透露难度 */
    solves: locked ? null : row.solves,
    locked,
    relaxed: row.relaxed === 1,
    ...(locked
      ? {}
      : {
          truth: row.truth,
          story: row.story,
          hint: row.hint,
          review: row.review_json ? (JSON.parse(row.review_json) as unknown) : null,
        }),
  }
}

/**
 * 生成当天官方汤：先写完整故事，再凝练汤底/汤面，再由 Jev 审核，
 * 不过就带着问题重来并逐次放宽；全不过则发布分数最高的一版。
 */
async function generateTodayDaily(
  env: Env,
  onProgress?: (progress: import('../shared/daily.ts').DailyProgress) => void,
): Promise<void> {
  const db = requireDb(env)
  const date = utcDateKey()
  if (await dailyByDate(db, date)) {
    console.log(`[daily] ${date} 已存在，跳过`)
    return
  }
  const { results } = await db
    .prepare('SELECT title, surface FROM dailies ORDER BY created_at DESC LIMIT 10')
    .all<{ title: string; surface: string }>()
  const avoid = (results ?? []).map((row) => `${row.title}｜${row.surface}`)

  const draft = await composeDaily(env, { avoid, date, onProgress })
  const store = puzzleStore(db)
  const puzzleId = await store.create(
    { title: draft.title, surface: draft.surface, truth: draft.truth, hint: draft.hint },
    {
      difficulty: draft.difficulty,
      createdAt: Date.now(),
      visibility: 'daily',
      tags: draft.tags,
    },
  )
  // 题材分只存 puzzles 那一份（滑块、卡片、官汤读的都是它）
  if (draft.genreScore !== null) {
    await db
      .prepare('UPDATE puzzles SET genre_score = ? WHERE id = ?')
      .bind(draft.genreScore, puzzleId)
      .run()
  }
  await db
    .prepare(
      `INSERT INTO dailies
         (date, puzzle_id, story, review_json, generate_attempts, relaxed, locale, genre_target, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      date,
      puzzleId,
      draft.story,
      JSON.stringify(draft.review),
      draft.attempts,
      draft.relaxed ? 1 : 0,
      draft.locale,
      draft.genreTarget,
      Date.now(),
    )
    .run()
  console.log(
    `[daily] ${date} 已生成《${draft.title}》｜${LOCALE_LABEL_ZH[draft.locale]}｜题材 ${draft.tag}／目标 ${draft.genreTarget}／实测 ${draft.genreScore ?? '—'}｜${draft.attempts} 次尝试｜relaxed=${draft.relaxed}`,
  )
}

/** 管理接口统一走一个口令：DAILY_ADMIN_TOKEN，没配就退回 AUTH_SECRET。 */
function requireAdmin(request: Request, env: Env): void {
  const token = env.DAILY_ADMIN_TOKEN ?? env.AUTH_SECRET
  if (!token || request.headers.get('x-admin-token') !== token) {
    throw new ApiError(403, '无权操作')
  }
}

/**
 * 定时维护：清理过期日志与临时对局 + 巡检可疑判读。
 * 每一项失败互不影响——日志清理不该因为巡检没钱了就跟着停。
 */
async function runMaintenance(
  env: Env,
  options: {
    audit?: boolean
    limit?: number
    days?: number
    onProgress?: (chars: number) => void
  } = {},
): Promise<{ purged: boolean; swept: boolean; scored: number; audit: AuditResult | null }> {
  const db = requireDb(env)
  let purged = false
  let swept = false
  let scored = 0
  let audit: AuditResult | null = null

  try {
    await purgeOldLogs(db)
    purged = true
  } catch (error) {
    console.warn('[maintenance] 清理旧日志失败：', error)
    await reportWorkerError(env, error, 'worker:maintenance', 'cron:purge')
  }

  try {
    // 临时对局以前是「出题时顺手清」，出题下线后改由这里定期清
    await puzzleStore(db).sweep(Date.now() - SESSION_RETENTION_MS)
    swept = true
  } catch (error) {
    console.warn('[maintenance] 清理过期对局失败：', error)
    await reportWorkerError(env, error, 'worker:maintenance', 'cron:sweep')
  }

  try {
    // 每次补几道题的题材分（上传时判失败、或后来才公开的）
    scored = await scoreUnscoredPuzzles(env, db)
  } catch (error) {
    console.warn('[maintenance] 题材补分失败：', error)
    await reportWorkerError(env, error, 'worker:maintenance', 'cron:score')
  }

  if (options.audit !== false) {
    try {
      audit = await inspectJudgments(env, db, {
        limit: options.limit,
        days: options.days,
        onProgress: options.onProgress,
      })
    } catch (error) {
      console.warn('[maintenance] 判读巡检失败：', error)
      await reportWorkerError(env, error, 'worker:maintenance', 'cron:audit')
    }
  }

  return { purged, swept, scored, audit }
}

function puzzleStore(db: D1Like): PuzzleStore {
  return {
    async create(puzzle, meta) {
      const id = crypto.randomUUID()
      await db
        .prepare(
          `INSERT INTO puzzles (id, owner_id, title, surface, truth, hint, difficulty, tags, visibility, plays, solves, created_at)
           VALUES (?, '', ?, ?, ?, ?, ?, ?, ?, 0, 0, ?)`,
        )
        .bind(
          id,
          puzzle.title,
          puzzle.surface,
          puzzle.truth,
          puzzle.hint,
          meta.difficulty,
          JSON.stringify(meta.tags ?? []),
          meta.visibility ?? SESSION_VISIBILITY,
          meta.createdAt,
        )
        .run()
      return id
    },
    async get(id) {
      const row = await db
        .prepare(
          `SELECT title, surface, truth, hint, difficulty, visibility FROM puzzles
           WHERE id = ? AND visibility IN (?, 'daily')`,
        )
        .bind(id, SESSION_VISIBILITY)
        .first<{
          title: string
          surface: string
          truth: string
          hint: string
          difficulty: string
          visibility: string
        }>()
      return row ?? null
    },
    async sweep(olderThan) {
      await db
        .prepare('DELETE FROM puzzles WHERE visibility = ? AND created_at < ?')
        .bind(SESSION_VISIBILITY, olderThan)
        .run()
    },
  }
}

function requireDb(env: Env): D1Like {
  if (!env.DB) throw new ApiError(503, '数据库尚未配置')
  return env.DB
}

/**
 * URL 里的百分号编码可能是坏的：有人手改链接、分享被截断、爬虫乱扫。
 * 那是客户端给了坏输入，不该变成 500 —— 而且 decodeURIComponent 抛的是
 * URIError，落进兜底 catch 就是「服务器错误」，看着像我们的锅。
 */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    throw new ApiError(400, '链接格式不正确')
  }
}

/**
 * 把 Worker 侧未处理的异常也送进错误台账。
 *
 * 以前这类错误只进 console.error —— 不 tail 就永远看不见，等玩家反馈时已经
 * 影响了一批人。现在和客户端错误共用一张表和 /api/errors 出口。
 *
 * **尽力而为**：上报本身失败绝不能再抛一次，否则会把一个 500 变成更糟的崩溃。
 */
async function reportWorkerError(
  env: Env,
  error: unknown,
  source: string,
  path?: string,
): Promise<void> {
  if (!env.DB) return
  try {
    const message =
      error instanceof Error ? error.message || error.name : String(error)
    await recordWorkerError(env.DB, {
      message,
      stack: error instanceof Error ? (error.stack ?? '') : '',
      path,
      source,
    })
  } catch {
    /* 上报失败就算了 */
  }
}

async function viewer(request: Request, env: Env): Promise<Viewer> {
  const secret = env.AUTH_SECRET
  if (!secret || !env.AUTH_KV) return { uid: null, email: null }
  const session = await readSession(env.AUTH_KV, secret, sessionToken(request))
  return session ? { uid: session.uid, email: session.email } : { uid: null, email: null }
}

async function requireUser(request: Request, env: Env) {
  const current = await viewer(request, env)
  if (!current.uid) throw new ApiError(401, '请先登录')
  return current as { uid: string; email: string }
}

/**
 * 管理接口的入口：必须是登录用户，且 uid 在 admins 表里。
 * 和 requireAdmin（共享口令）分开：口令是给机器/cron 调的，这个是给人用的。
 */
async function requireAdminSession(request: Request, env: Env): Promise<{ uid: string; email: string }> {
  const current = await requireUser(request, env)
  if (!(await isAdmin(requireDb(env), current.uid))) throw new ApiError(403, '无权访问')
  return current
}

function authDeps(env: Env): AuthDeps {
  if (!env.AUTH_KV || !env.DB || !env.AUTH_SECRET) {
    throw new ApiError(503, '登录服务尚未配置')
  }
  return {
    db: env.DB,
    kv: env.AUTH_KV,
    email: env.EMAIL,
    secret: env.AUTH_SECRET,
    fromEmail: env.MAIL_FROM?.trim() || 'noreply@hgt.mmstudio.games',
    exposeCode: env.AUTH_EXPOSE_CODE === '1',
  }
}

async function routeAuth(request: Request, env: Env, pathname: string): Promise<Response | null> {
  const deps = authDeps(env)

  if (pathname === '/api/auth/me') {
    if (request.method !== 'GET') return json({ error: '方法不被允许' }, 405)
    const current = await viewer(request, env)
    if (!current.uid) return json({ user: null }, 401)
    const profile = await getMyProfile(env.DB!, current.uid)
    return json({
      user: {
        email: current.email,
        uid: current.uid,
        name: profile.displayName,
        handle: profile.handle,
        // 前端据此决定要不要给「管理后台」入口
        isAdmin: await isAdmin(env.DB!, current.uid),
      },
    })
  }

  if (pathname === '/api/auth/logout') {
    if (request.method !== 'POST') return json({ error: '方法不被允许' }, 405)
    await destroySession(env.AUTH_KV!, env.AUTH_SECRET!, sessionToken(request))
    return json({ ok: true }, 200, { 'set-cookie': clearedCookie() })
  }

  if (pathname === '/api/auth/request') {
    if (request.method !== 'POST') return json({ error: '方法不被允许' }, 405)
    const body = await readJson(request)
    const email = normaliseEmail(body.email)
    if (!email) throw new ApiError(400, '请输入有效的邮箱地址')
    const result = await requestCode(deps, email, body.locale)
    return json({ ok: true, sent: result.sent, code: result.code })
  }

  if (pathname === '/api/auth/verify') {
    if (request.method !== 'POST') return json({ error: '方法不被允许' }, 405)
    const body = await readJson(request)
    const email = normaliseEmail(body.email)
    const code = typeof body.code === 'string' ? body.code.replace(/\D/g, '') : ''
    if (!email) throw new ApiError(400, '请输入有效的邮箱地址')
    if (code.length !== 6) throw new ApiError(400, '请输入 6 位验证码')
    const { token, user } = await verifyCode(deps, email, code)
    await env
      .DB!.prepare('UPDATE users SET display_name = ? WHERE id = ? AND display_name IS NULL')
      .bind(defaultDisplayName(email), user.id)
      .run()
    await ensureHandle(env.DB!, user.id)
    // 记住界面语言（周报按它写）；顺便给从没看过动态的人一个起点。
    // 没有起点的话「未读」永远是 0，那枚红点自己启动不了 ——
    // 而且「从上次登录到现在有什么新动静」本来就是想看的东西。
    const locale = body.locale === 'en' || body.locale === 'ja' ? body.locale : 'zh-CN'
    await env.DB!
      .prepare(
        'UPDATE users SET locale = ?, activity_seen_at = COALESCE(activity_seen_at, ?) WHERE id = ?',
      )
      .bind(locale, Date.now(), user.id)
      .run()
    return json({ user: { email: user.email, uid: user.id, name: user.displayName } }, 200, {
      'set-cookie': sessionCookie(token),
    })
  }

  return null
}

async function routeLibrary(
  request: Request,
  env: Env,
  pathname: string,
  url: URL,
): Promise<Response | null> {
  const db = requireDb(env)

  if (pathname === '/api/library/puzzles') {
    if (request.method === 'GET') {
      const rawGenre = url.searchParams.get('genre')
      const genre = rawGenre === null ? undefined : Number(rawGenre)
      const items = await listPublicPuzzles(db, {
        sort: url.searchParams.get('sort') ?? 'new',
        limit: Number(url.searchParams.get('limit') ?? 20),
        offset: Number(url.searchParams.get('offset') ?? 0),
        query: url.searchParams.get('q') ?? '',
        genre: Number.isFinite(genre) ? genre : undefined,
      })
      return json({ items }, 200, SHORT_BROWSER_CACHE)
    }
    if (request.method === 'POST') {
      const current = await requireUser(request, env)
      const body = await readJson(request)
      await ensureHandle(db, current.uid)
      return json(await createPuzzle(env, db, current.uid, body))
    }
    return json({ error: '方法不被允许' }, 405)
  }

  // 语义重排：关键字检索已经在 GET 里返回过了，这里再让 Jev 把候选重新排一次。
  // 单独一个 POST 是为了不把模型调用塞进「边打字边搜」的那条路上。
  if (pathname === '/api/library/search/rerank') {
    if (request.method !== 'POST') return json({ error: '方法不被允许' }, 405)
    const body = await readJson(request)
    const query = typeof body.q === 'string' ? body.q : ''
    if (!query.trim()) return json({ items: [] })
    const rawGenre = body.genre
    const genre = typeof rawGenre === 'number' && Number.isFinite(rawGenre) ? rawGenre : undefined
    const items = await searchPublicPuzzles(env, db, {
      sort: typeof body.sort === 'string' ? body.sort : 'new',
      query,
      genre,
    })
    return json({ items })
  }

  if (!pathname.startsWith('/api/library/puzzles/')) return null
  const rest = pathname.slice('/api/library/puzzles/'.length)
  const [rawId, action] = rest.split('/')
  const id = safeDecode(rawId ?? '')
  if (!id) return null

  if (!action) {
    if (request.method === 'GET') return json(await getPublicPuzzle(db, id))
    const current = await requireUser(request, env)
    if (request.method === 'PATCH')
      return json(await updatePuzzle(env, db, current.uid, id, await readJson(request)))
    if (request.method === 'DELETE') return json(await deletePuzzle(db, current.uid, id))
    return json({ error: '方法不被允许' }, 405)
  }

  if (action === 'ask') {
    if (request.method !== 'POST') return json({ error: '方法不被允许' }, 405)
    const body = await readJson(request)
    const current = await viewer(request, env)
    const playerKey =
      current.uid ?? (typeof body.playerKey === 'string' ? body.playerKey.slice(0, 64) : 'anon')
    return json(await askLibraryPuzzle(env, db, current.uid, playerKey, id, body))
  }

  if (action === 'reveal') {
    if (request.method !== 'POST') return json({ error: '方法不被允许' }, 405)
    const current = await viewer(request, env)
    const body = await readJson(request)
    return json(await revealLibraryPuzzle(db, id, current.uid, readLocale(body.locale)))
  }

  return null
}

async function routeMe(
  request: Request,
  env: Env,
  pathname: string,
  url: URL,
): Promise<Response | null> {
  const db = requireDb(env)

  if (pathname === '/api/me/profile') {
    const current = await requireUser(request, env)
    if (request.method === 'GET') return json({ profile: await getMyProfile(db, current.uid) })
    if (request.method === 'PATCH') {
      return json({ profile: await updateProfile(db, current.uid, await readJson(request)) })
    }
    return json({ error: '方法不被允许' }, 405)
  }

  // 作者看板：自己的题 + 统计（另有 summary 让前端少算一次）
  if (pathname === '/api/me/puzzles') {
    if (request.method !== 'GET') return json({ error: '方法不被允许' }, 405)
    const current = await requireUser(request, env)
    const items = await listOwnPuzzles(db, current.uid)
    const summary = authorSummary(items)
    const social = await countAuthorSocial(db, current.uid)
    const recognition = recognise({
      puzzles: summary.public,
      plays: summary.plays,
      solves: summary.solves,
      likes: social.likes,
      comments: social.comments,
    })
    return json({ items, summary, recognition })
  }

  // 作者动态流：从 attempts / comments / likes 现算，不新增表
  if (pathname === '/api/me/activity') {
    if (request.method !== 'GET') return json({ error: '方法不被允许' }, 405)
    const current = await requireUser(request, env)
    const limit = Number(url.searchParams.get('limit') ?? '30')
    return json({ items: await authorActivity(db, current.uid, limit) })
  }

  // 未读动态数：动态看到哪了记在 users.activity_seen_at
  if (pathname === '/api/me/notifications') {
    if (request.method !== 'GET') return json({ error: '方法不被允许' }, 405)
    const current = await requireUser(request, env)
    const row = await db
      .prepare('SELECT activity_seen_at FROM users WHERE id = ?')
      .bind(current.uid)
      .first<{ activity_seen_at: number | null }>()
    const unread = await countUnreadActivity(db, current.uid, row?.activity_seen_at ?? null)
    return json({ unread })
  }
  if (pathname === '/api/me/notifications/seen') {
    if (request.method !== 'POST') return json({ error: '方法不被允许' }, 405)
    const current = await requireUser(request, env)
    await markActivitySeen(db, current.uid)
    return json({ ok: true })
  }

  return null
}

async function routeProfile(
  request: Request,
  env: Env,
  pathname: string,
): Promise<Response | null> {
  if (!pathname.startsWith('/api/u/')) return null
  if (request.method !== 'GET') return json({ error: '方法不被允许' }, 405)
  const handle = safeDecode(pathname.slice('/api/u/'.length)).toLowerCase()
  if (!handle) return null
  return json({ profile: await getPublicProfile(requireDb(env), handle) })
}

/**
 * 管理后台。全部走登录态 + admins 表；数据本身复用各自模块的读函数
 * （listJudgeFlags / listClientErrors），只有「改名/删除」这类动作放这里。
 */
async function routeAdmin(
  request: Request,
  env: Env,
  pathname: string,
  url: URL,
): Promise<Response | null> {
  if (!pathname.startsWith('/api/admin/')) return null
  const db = requireDb(env)
  await requireAdminSession(request, env)

  if (pathname === '/api/admin/reports') {
    if (request.method !== 'GET') return json({ error: '方法不被允许' }, 405)
    const limit = Number(url.searchParams.get('limit') ?? '100')
    return json({ items: await listReports(db, limit) })
  }
  if (pathname.startsWith('/api/admin/reports/')) {
    const id = safeDecode(pathname.slice('/api/admin/reports/'.length))
    if (request.method === 'PATCH') {
      const body = await readJson(request)
      await setReportStatus(db, id, typeof body.status === 'string' ? body.status : '')
      return json({ ok: true })
    }
    if (request.method === 'DELETE') {
      await deleteReport(db, id)
      return json({ ok: true })
    }
    return json({ error: '方法不被允许' }, 405)
  }

  if (pathname === '/api/admin/flags') {
    if (request.method !== 'GET') return json({ error: '方法不被允许' }, 405)
    const limit = Number(url.searchParams.get('limit') ?? '100')
    return json({ items: await listJudgeFlags(db, limit) })
  }
  if (pathname.startsWith('/api/admin/flags/')) {
    if (request.method !== 'DELETE') return json({ error: '方法不被允许' }, 405)
    await deleteJudgeFlag(db, safeDecode(pathname.slice('/api/admin/flags/'.length)))
    return json({ ok: true })
  }

  if (pathname === '/api/admin/errors') {
    if (request.method === 'GET') {
      const limit = Number(url.searchParams.get('limit') ?? '100')
      return json({ items: await listClientErrors(db, limit) })
    }
    if (request.method === 'DELETE') {
      await clearClientErrors(db)
      return json({ ok: true })
    }
    return json({ error: '方法不被允许' }, 405)
  }
  if (pathname.startsWith('/api/admin/errors/')) {
    if (request.method !== 'DELETE') return json({ error: '方法不被允许' }, 405)
    await deleteClientError(db, safeDecode(pathname.slice('/api/admin/errors/'.length)))
    return json({ ok: true })
  }

  if (pathname === '/api/admin/admins') {
    if (request.method === 'GET') return json({ items: await listAdmins(db) })
    if (request.method === 'POST') {
      const body = await readJson(request)
      const entry = await addAdmin(db, {
        uid: typeof body.uid === 'string' ? body.uid : undefined,
        email: typeof body.email === 'string' ? body.email : undefined,
      })
      return json({ admin: entry })
    }
    return json({ error: '方法不被允许' }, 405)
  }
  if (pathname.startsWith('/api/admin/admins/')) {
    if (request.method !== 'DELETE') return json({ error: '方法不被允许' }, 405)
    await removeAdmin(db, safeDecode(pathname.slice('/api/admin/admins/'.length)))
    return json({ ok: true })
  }

  // 作者周报：手动触发，先预览再发。只在过去一周有动静时才发。
  if (pathname === '/api/admin/digest') {
    if (request.method !== 'GET') return json({ error: '方法不被允许' }, 405)
    const recipients = await listDigestRecipients(db, Date.now() - DIGEST_WINDOW_MS)
    return json({
      windowMs: DIGEST_WINDOW_MS,
      recipients: recipients.map((item) => ({
        uid: item.uid,
        email: item.email,
        displayName: item.displayName,
        locale: item.locale,
        total: item.total,
        counts: item.counts,
      })),
      // 拿第一位当样例；没人符合条件就是 null
      preview: recipients[0] ? renderDigest(recipients[0], url.origin) : null,
    })
  }
  if (pathname === '/api/admin/digest/send') {
    if (request.method !== 'POST') return json({ error: '方法不被允许' }, 405)
    const recipients = await listDigestRecipients(db, Date.now() - DIGEST_WINDOW_MS)
    let sent = 0
    let failed = 0
    for (const item of recipients) {
      if (await sendDigest(env, item, url.origin)) sent += 1
      else failed += 1
    }
    return json({ sent, failed, total: recipients.length })
  }

  // 题库精选位：给公开题打 / 取消精选
  if (pathname === '/api/admin/puzzles') {
    if (request.method !== 'GET') return json({ error: '方法不被允许' }, 405)
    const limit = Number(url.searchParams.get('limit') ?? '100')
    return json({ items: await listPuzzlesForAdmin(db, limit) })
  }
  if (pathname.startsWith('/api/admin/puzzles/')) {
    if (request.method !== 'PATCH') return json({ error: '方法不被允许' }, 405)
    const id = safeDecode(pathname.slice('/api/admin/puzzles/'.length))
    const body = await readJson(request)
    await setPuzzleFeatured(db, id, Boolean(body.featured))
    return json({ ok: true })
  }

  return json({ error: '未知接口' }, 404)
}

/**
 * 点赞与留言板：作者主页（profile/:handle）和题库的汤（puzzle/:id）共用一套。
 * 点赞匿名（登录用 uid，否则用设备号），留言要登录。
 */
async function routeSocial(
  request: Request,
  env: Env,
  pathname: string,
  url: URL,
): Promise<Response | null> {
  if (!pathname.startsWith('/api/social/')) return null
  const db = requireDb(env)

  const commentMatch = /^\/api\/social\/comments\/([^/]+)(?:\/(report))?$/.exec(pathname)
  if (commentMatch) {
    const commentId = decodeURIComponent(commentMatch[1])
    const current = await viewer(request, env)

    if (commentMatch[2] === 'report') {
      if (request.method !== 'POST') return json({ error: '方法不被允许' }, 405)
      const body = await readJson(request)
      const note = typeof body.note === 'string' ? body.note : ''
      const deviceKey = typeof body.playerKey === 'string' ? body.playerKey.slice(0, 64) : 'anon'
      return json(
        await reportComment(
          db,
          commentId,
          { uid: current.uid, playerKey: deviceKey },
          note.trim() || '举报了一条留言',
          typeof body.locale === 'string' ? body.locale : '',
        ),
      )
    }

    if (request.method !== 'DELETE') return json({ error: '方法不被允许' }, 405)
    if (!current.uid) throw new ApiError(401, '请先登录')
    await deleteComment(db, commentId, current.uid)
    return json({ ok: true })
  }

  const match = /^\/api\/social\/(profile|puzzle)\/([^/]+)(?:\/(like|comments))?$/.exec(pathname)
  if (!match) return null
  const kind = match[1]
  const rawId = decodeURIComponent(match[2])
  const action = match[3]
  const target = await resolveTarget(db, kind, rawId)
  const current = await viewer(request, env)

  if (!action) {
    if (request.method !== 'GET') return json({ error: '方法不被允许' }, 405)
    const key = likerKey(current.uid, url.searchParams.get('playerKey'))
    return json(await getSocial(db, target, key, current.uid))
  }

  if (action === 'like') {
    if (request.method !== 'POST' && request.method !== 'DELETE') {
      return json({ error: '方法不被允许' }, 405)
    }
    const key = likerKey(current.uid, url.searchParams.get('playerKey'))
    return json(await setLike(db, target, key, request.method === 'POST'))
  }

  if (request.method !== 'POST') return json({ error: '方法不被允许' }, 405)
  if (!current.uid) throw new ApiError(401, '请先登录')
  const body = await readJson(request)
  await ensureHandle(db, current.uid)
  return json({ comment: await addComment(db, target, current.uid, body.body) })
}

const SSE_HEADERS = {
  'content-type': 'text/event-stream; charset=utf-8',
  'cache-control': 'no-cache, no-transform',
  connection: 'keep-alive',
}

/**
 * 生成类接口（出题、每日汤）都要跑几十秒到几分钟。普通请求在这段时间里
 * 一个字节都不发，长静默连接会被边缘掐掉；改成 SSE 边思考边回报，连接一直是活的。
 */
function sseStream(run: (send: (event: string, data: unknown) => void) => Promise<void>): Response {
  const encoder = new TextEncoder()
  let closed = false
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        if (closed) return
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
      }
      const ping = setInterval(() => {
        if (!closed) controller.enqueue(encoder.encode(': ping\n\n'))
      }, 8000)
      try {
        await run(send)
      } catch (error) {
        send('error', { error: error instanceof Error ? error.message : '生成失败' })
      } finally {
        clearInterval(ping)
        closed = true
        controller.close()
      }
    },
    cancel() {
      closed = true
    },
  })
  return new Response(stream, { headers: SSE_HEADERS })
}

const POST_ROUTES = new Set(['/api/game/ask', '/api/game/reveal'])

async function route(request: Request, env: Env, url: URL): Promise<Response> {
  const pathname = url.pathname

  if (pathname.startsWith('/api/auth/')) {
    const handled = await routeAuth(request, env, pathname)
    return handled ?? json({ error: '未知接口' }, 404)
  }
  if (pathname === '/api/daily') {
    if (request.method !== 'GET') return json({ error: '方法不被允许' }, 405)
    const db = requireDb(env)
    const today = await dailyByDate(db, utcDateKey())
    const { results } = await db
      .prepare(
        `SELECT d.date, p.title, p.difficulty, p.tags, p.plays, p.solves, d.relaxed
           FROM dailies d JOIN puzzles p ON p.id = d.puzzle_id
          ORDER BY d.date DESC LIMIT 60`,
      )
      .all<{
        date: string
        title: string
        difficulty: string
        tags: string
        plays: number
        solves: number
        relaxed: number
      }>()
    return json(
      {
        today: today ? dailyPayload(today, true) : null,
        history: (results ?? []).map((row) => {
          let tags: string[] = []
          try {
            tags = JSON.parse(row.tags) as string[]
          } catch {
            tags = []
          }
          return {
            date: row.date,
            title: row.title,
            difficulty: row.difficulty,
            tags,
            plays: row.plays,
            solves: row.solves,
            relaxed: row.relaxed === 1,
          }
        }),
      },
      200,
      BROWSER_CACHE,
    )
  }

  const dailyMatch = /^\/api\/daily\/(\d{4}-\d{2}-\d{2})$/.exec(pathname)
  if (dailyMatch) {
    if (request.method !== 'GET') return json({ error: '方法不被允许' }, 405)
    const row = await dailyByDate(requireDb(env), dailyMatch[1])
    if (!row) throw new ApiError(404, '没有这一天的官方汤')
    return json({ daily: dailyPayload(row, row.date === utcDateKey()) }, 200, BROWSER_CACHE)
  }

  if (pathname === '/api/reports') {
    if (request.method !== 'POST') return json({ error: '方法不被允许' }, 405)
    const body = await readJson(request)
    const current = await viewer(request, env)
    return json(
      await submitReport(requireDb(env), {
        puzzleId: typeof body.puzzleId === 'string' ? body.puzzleId : '',
        kind: typeof body.kind === 'string' ? body.kind : '',
        note: typeof body.note === 'string' ? body.note : '',
        snapshot: body.snapshot,
        playerKey: current.uid ?? (typeof body.playerKey === 'string' ? body.playerKey : 'anon'),
        locale: typeof body.locale === 'string' ? body.locale : '',
      }),
    )
  }

  const library = await routeLibrary(request, env, pathname, url)
  if (library) return library
  const social = await routeSocial(request, env, pathname, url)
  if (social) return social
  const me = await routeMe(request, env, pathname, url)
  if (me) return me
  const profile = await routeProfile(request, env, pathname)
  if (profile) return profile
  const admin = await routeAdmin(request, env, pathname, url)
  if (admin) return admin

  // 周报退订：邮件里点进来的，不需要登录，凭令牌
  if (pathname === '/api/digest/unsubscribe') {
    if (request.method !== 'GET') return json({ error: '方法不被允许' }, 405)
    const ok = await unsubscribeByToken(requireDb(env), url.searchParams.get('t') ?? '')
    return ok
      ? htmlPage(
          '已退订',
          '不会再收到作者周报了。<br><span lang="en">Unsubscribed from the weekly author digest.</span>',
        )
      : htmlPage(
          '链接无效',
          '这个退订链接已经失效或不对。<br><span lang="en">This unsubscribe link is invalid.</span>',
        )
  }

  if (pathname === '/api/health') {
    if (request.method !== 'GET') return json({ error: '方法不被允许' }, 405)
    return json(health(env), 200, SHORT_BROWSER_CACHE)
  }
  if (!POST_ROUTES.has(pathname)) return json({ error: '未知接口' }, 404)
  if (request.method !== 'POST') return json({ error: '方法不被允许' }, 405)

  const db = requireDb(env)
  const store = puzzleStore(db)
  const body = await readJson(request)
  if (pathname === '/api/game/reveal') {
    const targetId = typeof body.puzzleId === 'string' ? body.puzzleId : ''
    if (targetId && (await isLockedDaily(db, targetId))) {
      throw askError(readLocale(body.locale), 'locked')
    }
    return json(await revealGame(store, body))
  }

  const lockedId = typeof body.puzzleId === 'string' ? body.puzzleId : ''
  const truthLocked = lockedId ? await isLockedDaily(db, lockedId) : false
  const turn = await askHost(env, store, body, { truthLocked })
  // 会话路径以前完全不记 plays/solves，所以过期官汤进题库后一直是 0 / 0。
  // 计数语义和题库那条路一样：按玩家去重，问过算 plays，解开算 solves。
  if (lockedId) {
    const current = await viewer(request, env)
    const playerKey =
      current.uid ?? (typeof body.playerKey === 'string' ? body.playerKey.slice(0, 64) : 'anon')
    await recordPlay(db, lockedId, playerKey, turn.solved)
  }
  await logTurn(db, {
    puzzleId: typeof body.puzzleId === 'string' ? body.puzzleId : '',
    kind: 'session',
    seq: typeof body.seq === 'number' ? body.seq : 0,
    playerKey: typeof body.playerKey === 'string' ? body.playerKey : '',
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
  return json(turn)
}

/**
 * 分享卡片：爬虫不跑 JS，所以在这里按 Accept-Language 改写 HTML 里的 meta。
 * 作者页与题目页用真实内容，其它页面用站点文案。
 */
async function pageOverride(env: Env, pathname: string): Promise<MetaOverride> {
  const db = env.DB
  if (!db) return {}

  const handle = /^\/u\/([^/]+)$/.exec(pathname)?.[1]
  if (handle) {
    const row = await db
      .prepare('SELECT display_name, handle, bio, profile_public FROM users WHERE handle = ?')
      .bind(decodeURIComponent(handle).toLowerCase())
      .first<{
        display_name: string | null
        handle: string | null
        bio: string
        profile_public: number
      }>()
    if (row) {
      return {
        title: row.display_name ?? row.handle ?? undefined,
        description: row.profile_public === 0 ? undefined : row.bio || undefined,
      }
    }
  }

  const id = /^\/library\/([^/]+)$/.exec(pathname)?.[1]
  if (id) {
    const row = await db
      .prepare("SELECT title, surface FROM puzzles WHERE id = ? AND visibility = 'public'")
      .bind(decodeURIComponent(id))
      .first<{ title: string; surface: string }>()
    // 汤面可以给爬虫看，汤底永远不给
    if (row) return { title: row.title, description: row.surface }
  }

  return {}
}

async function serveHtml(
  request: Request,
  env: Env,
  url: URL,
  response: Response,
): Promise<Response> {
  const html = await response.text()
  const locale = pickMetaLocale(request.headers.get('accept-language'))
  let override: MetaOverride = {}
  try {
    override = await pageOverride(env, url.pathname)
  } catch (error) {
    console.warn('[turtle-soup] 读取分享卡片内容失败：', error)
    await reportWorkerError(env, error, 'worker:meta', url.pathname)
  }
  return new Response(applyMeta(html, locale, url.toString(), override), {
    status: response.status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      // HTML 绝不能被缓存：否则引用的 bundle 哈希会在下次部署后失效
      'cache-control': 'no-store, must-revalidate',
      vary: 'accept-language',
      // 半年内浏览器会自己把 http 换成 https，不再经过上面那次跳转
      'strict-transport-security': 'max-age=15552000',
    },
  })
}

export default {
  /**
   * Cron 分两条线：
   * - 00:00 / 每 6 小时：生成当天官方汤（缺题时补）
   * - 04:00：清理过期日志，并巡检最近的可疑判读
   */
  async scheduled(
    event: { scheduledTime: number; cron?: string },
    env: Env,
    ctx: { waitUntil(promise: Promise<unknown>): void },
  ): Promise<void> {
    if (event.cron === MAINTENANCE_CRON) {
      ctx.waitUntil(
        runMaintenance(env)
          .then((result) =>
            console.log(
              `[maintenance] 清日志=${result.purged}｜清对局=${result.swept}｜题材补分=${result.scored}｜巡检=${
                result.audit
                  ? `${result.audit.checked} 条，改判 ${result.audit.flagged} 条`
                  : '跳过'
              }`,
            ),
          )
          .catch((error) => {
            console.error('[maintenance] 失败：', error)
            return reportWorkerError(env, error, 'worker:cron', 'cron:maintenance')
          }),
      )
      return
    }
    ctx.waitUntil(
      generateTodayDaily(env).catch((error) => {
        console.error('[daily] 生成失败：', error)
        return reportWorkerError(env, error, 'worker:cron', 'cron:daily')
      }),
    )
  },

  async fetch(
    request: Request,
    env: Env,
    _ctx?: { waitUntil(promise: Promise<unknown>): void },
  ): Promise<Response> {
    const url = new URL(request.url)

    // http 一律跳 https。这不只是「好看」：
    // 非安全上下文里 crypto.randomUUID 之类的 API 直接不存在，
    // 而且浏览器地址栏会标「不安全」——iOS Safari 尤其显眼。
    const forwardedProto = request.headers.get('x-forwarded-proto')
    if (forwardedProto === 'http' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
      url.protocol = 'https:'
      return Response.redirect(url.toString(), 308)
    }

    // 客户端错误上报：公开入口（玩家崩了才用得上），按哈希聚合
    if (url.pathname === '/api/errors') {
      const db = requireDb(env)
      if (request.method === 'POST') {
        const body = await readJson(request)
        await recordClientError(db, {
          message: typeof body.message === 'string' ? body.message : '',
          stack: typeof body.stack === 'string' ? body.stack : '',
          path: typeof body.path === 'string' ? body.path : '',
          buildId: typeof body.buildId === 'string' ? body.buildId : '',
          locale: typeof body.locale === 'string' ? body.locale : '',
          source: typeof body.source === 'string' ? body.source : '',
        })
        return json({ ok: true })
      }
      if (request.method === 'GET') {
        try {
          requireAdmin(request, env)
        } catch (error) {
          return json({ error: error instanceof Error ? error.message : '无权操作' }, 403)
        }
        const limit = Number(url.searchParams.get('limit') ?? '50')
        return json({ items: await listClientErrors(db, limit) })
      }
      return json({ error: '方法不被允许' }, 405)
    }

    // 巡检结果：给管理用的只读出口，方便回看改判了哪些
    if (url.pathname === '/api/audit/flags' || url.pathname === '/api/audit/run') {
      const runPath = url.pathname.endsWith('/run')
      if (request.method !== (runPath ? 'POST' : 'GET')) {
        return json({ error: '方法不被允许' }, 405)
      }
      try {
        requireAdmin(request, env)
        if (runPath) {
          let body: Record<string, unknown> = {}
          try {
            body = await readJson(request)
          } catch {
            /* 允许空 body */
          }
          const limit = typeof body.limit === 'number' ? body.limit : undefined
          const days = typeof body.days === 'number' ? body.days : undefined
          return json(await runMaintenance(env, { limit, days }))
        }
        const limit = Number(url.searchParams.get('limit') ?? '50')
        return json({ items: await listJudgeFlags(requireDb(env), limit) })
      } catch (error) {
        const status = error instanceof ApiError ? error.status : 500
        if (status >= 500) {
          console.error('[audit]', error)
          await reportWorkerError(env, error, 'worker:audit', url.pathname)
        }
        return json({ error: error instanceof Error ? error.message : '服务器内部错误' }, status)
      }
    }

    // 管理触发：和出题一样走 SSE，边跑边回报进度。
    // 注意不能用 waitUntil 后台跑——HTTP 请求的 waitUntil 只续命约 30 秒，
    // 而这个流水线要几分钟，会被掐掉（Cron 才有 15 分钟额度）。
    if (url.pathname === '/api/daily/generate') {
      if (request.method !== 'POST') return json({ error: '方法不被允许' }, 405)
      try {
        requireAdmin(request, env)
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : '无权操作' }, 403)
      }
      let replace = false
      try {
        const body = await readJson(request)
        replace = Boolean(body.replace)
      } catch {
        /* 允许空 body */
      }

      return sseStream(async (send) => {
        try {
          const db = requireDb(env)
          if (replace) {
            await db.prepare('DELETE FROM dailies WHERE date = ?').bind(utcDateKey()).run()
          }
          await generateTodayDaily(env, (progress) => send('progress', progress))
          const row = await dailyByDate(db, utcDateKey())
          send('done', { daily: row ? dailyPayload(row, true) : null })
        } catch (error) {
          console.error('[daily] 手动生成失败：', error)
          await reportWorkerError(env, error, 'worker:daily', url.pathname)
          throw error
        }
      })
    }

    if (url.pathname.startsWith('/api/')) {
      try {
        return await route(request, env, url)
      } catch (error) {
        const status = error instanceof ApiError ? error.status : 500
        const message = error instanceof Error ? error.message : '服务器内部错误'
        if (status >= 500) {
          console.error('[turtle-soup]', error)
          await reportWorkerError(env, error, 'worker:route', url.pathname)
        }
        return json({ error: message }, status)
      }
    }
    if (env.ASSETS) {
      const response = await env.ASSETS.fetch(request)
      const type = response.headers.get('content-type') ?? ''
      // 缺失的构建产物要返回真 404：SPA 兜底会把 HTML 当 JS 返回，
      // 浏览器拿到一坨 HTML 解析失败，页面就是一片空白。
      if (url.pathname.startsWith('/assets/') && type.includes('text/html')) {
        return new Response('Not Found', { status: 404, headers: { 'cache-control': 'no-store' } })
      }
      if (request.method === 'GET' && type.includes('text/html')) {
        return serveHtml(request, env, url, response)
      }
      return response
    }
    return new Response('Not Found', { status: 404 })
  },
}
