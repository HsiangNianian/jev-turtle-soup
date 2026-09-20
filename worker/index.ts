import { ApiError, askHost, health, startGame, type GameEnv } from '../shared/game.ts'

export interface Env extends GameEnv {
  ASSETS?: { fetch: (request: Request) => Promise<Response> }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
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

async function route(request: Request, env: Env, pathname: string): Promise<Response> {
  if (request.method === 'GET' && pathname === '/api/health') return json(health(env))
  if (request.method !== 'POST') return json({ error: '方法不被允许' }, 405)

  const body = await readJson(request)
  if (pathname === '/api/game/new') return json(await startGame(env, body))
  if (pathname === '/api/game/ask') return json(await askHost(env, body))
  return json({ error: '未知接口' }, 404)
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
