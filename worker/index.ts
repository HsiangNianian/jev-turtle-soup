import {
  ApiError,
  askHost,
  health,
  startGame,
  type GameEnv,
} from '../shared/game.ts'
import {
  clearedCookie,
  normaliseEmail,
  readCookie,
  requestCode,
  SESSION_COOKIE,
  sessionCookie,
  verifyCode,
  verifySession,
  type AuthDeps,
  type D1Like,
  type EmailLike,
  type KVLike,
} from '../shared/auth.ts'

export interface Env extends GameEnv {
  ASSETS?: { fetch: (request: Request) => Promise<Response> }
  AUTH_KV?: KVLike
  DB?: D1Like
  EMAIL?: EmailLike
  AUTH_SECRET?: string
  MAIL_FROM?: string
  AUTH_EXPOSE_CODE?: string
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

async function currentUser(request: Request, env: Env) {
  const secret = env.AUTH_SECRET
  if (!secret) return null
  const token = readCookie(request.headers.get('cookie'), SESSION_COOKIE)
  const session = await verifySession(token, secret)
  if (!session) return null
  return { email: session.email, uid: session.uid }
}

async function routeAuth(
  request: Request,
  env: Env,
  pathname: string,
): Promise<Response | null> {
  const deps = authDeps(env)

  if (pathname === '/api/auth/me') {
    if (request.method !== 'GET') return json({ error: '方法不被允许' }, 405)
    const user = await currentUser(request, env)
    return user ? json({ user }) : json({ user: null }, 401)
  }

  if (pathname === '/api/auth/logout') {
    if (request.method !== 'POST') return json({ error: '方法不被允许' }, 405)
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
    return json(
      { user: { email: user.email, uid: user.id, name: user.displayName } },
      200,
      { 'set-cookie': sessionCookie(token) },
    )
  }

  return null
}

const POST_ROUTES = new Set(['/api/game/new', '/api/game/ask'])

async function route(request: Request, env: Env, pathname: string): Promise<Response> {
  if (pathname.startsWith('/api/auth/')) {
    const handled = await routeAuth(request, env, pathname)
    if (handled) return handled
    return json({ error: '未知接口' }, 404)
  }

  if (pathname === '/api/health') {
    if (request.method !== 'GET') return json({ error: '方法不被允许' }, 405)
    return json(health(env))
  }
  if (!POST_ROUTES.has(pathname)) return json({ error: '未知接口' }, 404)
  if (request.method !== 'POST') return json({ error: '方法不被允许' }, 405)

  const body = await readJson(request)
  if (pathname === '/api/game/new') return json(await startGame(env, body))
  return json(await askHost(env, body))
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/api/')) {
      try {
        return await route(request, env, url.pathname)
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
