import {
  ApiError,
  askHost,
  health,
  revealGame,
  startGame,
  type GameEnv,
  type PuzzleStore,
} from '../shared/game.ts'
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
          SESSION_VISIBILITY,
          meta.createdAt,
        )
        .run()
      return id
    },
    async get(id) {
      const row = await db
        .prepare(
          `SELECT title, surface, truth, hint, difficulty FROM puzzles
           WHERE id = ? AND visibility = ?`,
        )
        .bind(id, SESSION_VISIBILITY)
        .first<{ title: string; surface: string; truth: string; hint: string; difficulty: string }>()
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
      user: { email: current.email, uid: current.uid, name: profile.displayName, handle: profile.handle },
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
    return json(
      { user: { email: user.email, uid: user.id, name: user.displayName } },
      200,
      { 'set-cookie': sessionCookie(token) },
    )
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
    if (request.method === 'PATCH') return json(await updatePuzzle(db, current.uid, id, await readJson(request)))
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
    return json(await revealLibraryPuzzle(db, id, current.uid))
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

async function routeProfile(request: Request, env: Env, pathname: string): Promise<Response | null> {
  if (!pathname.startsWith('/api/u/')) return null
  if (request.method !== 'GET') return json({ error: '方法不被允许' }, 405)
  const handle = decodeURIComponent(pathname.slice('/api/u/'.length)).toLowerCase()
  if (!handle) return null
  return json({ profile: await getPublicProfile(requireDb(env), handle) })
}

const POST_ROUTES = new Set(['/api/game/new', '/api/game/ask', '/api/game/reveal'])

async function route(request: Request, env: Env, url: URL): Promise<Response> {
  const pathname = url.pathname

  if (pathname.startsWith('/api/auth/')) {
    const handled = await routeAuth(request, env, pathname)
    return handled ?? json({ error: '未知接口' }, 404)
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
  if (pathname === '/api/game/new') return json(await startGame(env, store, body))
  if (pathname === '/api/game/reveal') return json(await revealGame(store, body))
  return json(await askHost(env, store, body))
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
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
    if (env.ASSETS) return env.ASSETS.fetch(request)
    return new Response('Not Found', { status: 404 })
  },
}
