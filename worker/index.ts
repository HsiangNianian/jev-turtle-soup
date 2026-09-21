import {
  ApiError,
  askHost,
  health,
  normaliseSurface,
  revealGame,
  startGame,
  type GameEnv,
  type PuzzleStore,
} from '../shared/game.ts'
import { logTurn, purgeOldLogs, submitReport } from '../shared/logs.ts'
import { composeDaily, utcDateKey } from '../shared/daily.ts'
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
  defaultDisplayName,
  deletePuzzle,
  ensureHandle,
  getMyProfile,
  getPublicProfile,
  getPublicPuzzle,
  listOwnPuzzles,
  listPublicPuzzles,
  listTags,
  revealLibraryPuzzle,
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

interface DailyRow {
  date: string
  puzzle_id: string
  title: string
  surface: string
  truth: string
  story: string
  hint: string
  tags: string
  difficulty: string
  review_json: string | null
  attempts: number
  relaxed: number
  created_at: number
}

function dailyByDate(db: D1Like, date: string) {
  return db.prepare('SELECT * FROM dailies WHERE date = ?').bind(date).first<DailyRow>()
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
    { difficulty: draft.difficulty, createdAt: Date.now(), visibility: 'daily' },
  )
  await db
    .prepare(
      `INSERT INTO dailies
         (date, puzzle_id, title, surface, truth, story, hint, tags, difficulty, review_json, attempts, relaxed, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      date,
      puzzleId,
      draft.title,
      draft.surface,
      draft.truth,
      draft.story,
      draft.hint,
      JSON.stringify(draft.tags),
      draft.difficulty,
      JSON.stringify(draft.review),
      draft.attempts,
      draft.relaxed ? 1 : 0,
      Date.now(),
    )
    .run()
  console.log(
    `[daily] ${date} 已生成《${draft.title}》｜${draft.attempts} 次尝试｜relaxed=${draft.relaxed}`,
  )
}

function puzzleStore(db: D1Like): PuzzleStore {
  return {
    async create(puzzle, meta) {
      const id = crypto.randomUUID()
      await db
        .prepare(
          `INSERT INTO puzzles (id, owner_id, title, surface, truth, hint, difficulty, tags, visibility, plays, solves, created_at)
           VALUES (?, '', ?, ?, ?, ?, ?, '[]', ?, 0, 0, ?)`,
        )
        .bind(
          id,
          puzzle.title,
          puzzle.surface,
          puzzle.truth,
          puzzle.hint,
          meta.difficulty,
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
      await purgeOldLogs(db)
    },
    async recentSurfaces(limit) {
      const { results } = await db
        .prepare(
          'SELECT surface FROM puzzles WHERE visibility = ? ORDER BY created_at DESC LIMIT ?',
        )
        .bind(SESSION_VISIBILITY, Math.max(1, Math.min(limit, 100)))
        .all<{ surface: string }>()
      return (results ?? []).map((row) => normaliseSurface(row.surface))
    },
  }
}

function requireDb(env: Env): D1Like {
  if (!env.DB) throw new ApiError(503, '数据库尚未配置')
  return env.DB
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
    const result = await requestCode(deps, email)
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
      const items = await listPublicPuzzles(db, {
        sort: url.searchParams.get('sort') ?? 'new',
        limit: Number(url.searchParams.get('limit') ?? 20),
        offset: Number(url.searchParams.get('offset') ?? 0),
        query: url.searchParams.get('q') ?? '',
        tag: url.searchParams.get('tag') ?? '',
      })
      return json({ items })
    }
    if (request.method === 'POST') {
      const current = await requireUser(request, env)
      const body = await readJson(request)
      await ensureHandle(db, current.uid)
      return json(await createPuzzle(db, current.uid, body))
    }
    return json({ error: '方法不被允许' }, 405)
  }

  if (!pathname.startsWith('/api/library/puzzles/')) return null
  const rest = pathname.slice('/api/library/puzzles/'.length)
  const [rawId, action] = rest.split('/')
  const id = decodeURIComponent(rawId ?? '')
  if (!id) return null

  if (!action) {
    if (request.method === 'GET') return json(await getPublicPuzzle(db, id))
    const current = await requireUser(request, env)
    if (request.method === 'PATCH')
      return json(await updatePuzzle(db, current.uid, id, await readJson(request)))
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

async function routeMe(request: Request, env: Env, pathname: string): Promise<Response | null> {
  const db = requireDb(env)

  if (pathname === '/api/me/profile') {
    const current = await requireUser(request, env)
    if (request.method === 'GET') return json({ profile: await getMyProfile(db, current.uid) })
    if (request.method === 'PATCH') {
      return json({ profile: await updateProfile(db, current.uid, await readJson(request)) })
    }
    return json({ error: '方法不被允许' }, 405)
  }

  if (pathname === '/api/me/puzzles') {
    if (request.method !== 'GET') return json({ error: '方法不被允许' }, 405)
    const current = await requireUser(request, env)
    return json({ items: await listOwnPuzzles(db, current.uid) })
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
  const handle = decodeURIComponent(pathname.slice('/api/u/'.length)).toLowerCase()
  if (!handle) return null
  return json({ profile: await getPublicProfile(requireDb(env), handle) })
}

const SSE_HEADERS = {
  'content-type': 'text/event-stream; charset=utf-8',
  'cache-control': 'no-cache, no-transform',
  connection: 'keep-alive',
}

/**
 * 出题要花几十秒到几分钟。普通请求在这段时间里一个字节都不发，
 * 长静默连接会被边缘掐掉；改成 SSE 边思考边回报，连接一直是活的。
 */
function gameStream(env: Env, store: PuzzleStore, body: Record<string, unknown>): Response {
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
        const result = await startGame(env, store, body, (progress) => send('progress', progress))
        send('done', result)
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

const POST_ROUTES = new Set(['/api/game/new', '/api/game/ask', '/api/game/reveal'])

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
        'SELECT date, title, difficulty, tags, relaxed FROM dailies ORDER BY date DESC LIMIT 60',
      )
      .all<{ date: string; title: string; difficulty: string; tags: string; relaxed: number }>()
    return json({
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
          relaxed: row.relaxed === 1,
        }
      }),
    })
  }

  const dailyMatch = /^\/api\/daily\/(\d{4}-\d{2}-\d{2})$/.exec(pathname)
  if (dailyMatch) {
    if (request.method !== 'GET') return json({ error: '方法不被允许' }, 405)
    const row = await dailyByDate(requireDb(env), dailyMatch[1])
    if (!row) throw new ApiError(404, '没有这一天的官方汤')
    return json({ daily: dailyPayload(row, row.date === utcDateKey()) })
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

  if (pathname === '/api/library/tags') {
    if (request.method !== 'GET') return json({ error: '方法不被允许' }, 405)
    return json({ items: await listTags(requireDb(env)) })
  }

  const library = await routeLibrary(request, env, pathname, url)
  if (library) return library
  const me = await routeMe(request, env, pathname)
  if (me) return me
  const profile = await routeProfile(request, env, pathname)
  if (profile) return profile

  if (pathname === '/api/health') {
    if (request.method !== 'GET') return json({ error: '方法不被允许' }, 405)
    return json(health(env))
  }
  if (!POST_ROUTES.has(pathname)) return json({ error: '未知接口' }, 404)
  if (request.method !== 'POST') return json({ error: '方法不被允许' }, 405)

  const db = requireDb(env)
  const store = puzzleStore(db)
  const body = await readJson(request)
  if (pathname === '/api/game/new') {
    const wantsStream = request.headers.get('accept')?.includes('text/event-stream')
    return wantsStream ? gameStream(env, store, body) : json(await startGame(env, store, body))
  }
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
  }
  return new Response(applyMeta(html, locale, url.toString(), override), {
    status: response.status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      // HTML 绝不能被缓存：否则引用的 bundle 哈希会在下次部署后失效
      'cache-control': 'no-store, must-revalidate',
      vary: 'accept-language',
    },
  })
}

export default {
  /** Cron：00:00 UTC 生成当天官方汤；每 6 小时补一次，防止当天缺题。 */
  async scheduled(
    _event: { scheduledTime: number },
    env: Env,
    ctx: { waitUntil(promise: Promise<unknown>): void },
  ): Promise<void> {
    ctx.waitUntil(
      generateTodayDaily(env).catch((error) => {
        console.error('[daily] 生成失败：', error)
      }),
    )
  },

  async fetch(
    request: Request,
    env: Env,
    _ctx?: { waitUntil(promise: Promise<unknown>): void },
  ): Promise<Response> {
    const url = new URL(request.url)

    // 管理触发：和出题一样走 SSE，边跑边回报进度。
    // 注意不能用 waitUntil 后台跑——HTTP 请求的 waitUntil 只续命约 30 秒，
    // 而这个流水线要几分钟，会被掐掉（Cron 才有 15 分钟额度）。
    if (url.pathname === '/api/daily/generate') {
      if (request.method !== 'POST') return json({ error: '方法不被允许' }, 405)
      const adminToken = env.DAILY_ADMIN_TOKEN ?? env.AUTH_SECRET
      if (!adminToken || request.headers.get('x-admin-token') !== adminToken) {
        return json({ error: '无权操作' }, 403)
      }
      let replace = false
      try {
        const body = await readJson(request)
        replace = Boolean(body.replace)
      } catch {
        /* 允许空 body */
      }

      const encoder = new TextEncoder()
      const stream = new ReadableStream({
        async start(controller) {
          let closed = false
          const send = (event: string, data: unknown) => {
            if (closed) return
            controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
          }
          const ping = setInterval(() => {
            if (!closed) controller.enqueue(encoder.encode(': ping\n\n'))
          }, 8000)
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
            send('error', { error: error instanceof Error ? error.message : '生成失败' })
          } finally {
            clearInterval(ping)
            closed = true
            controller.close()
          }
        },
      })
      return new Response(stream, {
        headers: {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-store',
        },
      })
    }

    if (url.pathname.startsWith('/api/')) {
      try {
        return await route(request, env, url)
      } catch (error) {
        const status = error instanceof ApiError ? error.status : 500
        const message = error instanceof Error ? error.message : '服务器内部错误'
        if (status >= 500) console.error('[turtle-soup]', error)
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
