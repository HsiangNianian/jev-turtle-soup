import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'

import {
  ApiError,
  askHost,
  health,
  normaliseSurface,
  revealGame,
  startGame,
  type GameEnv,
  type Puzzle,
  type PuzzleStore,
} from '../shared/game.ts'

/** Dev-only in-memory stand-in for D1: sessions live as long as the process. */
function memoryStore(): PuzzleStore {
  const puzzles = new Map<string, Puzzle & { difficulty: string; createdAt: number }>()
  return {
    async create(puzzle, meta) {
      const id = crypto.randomUUID()
      puzzles.set(id, { ...puzzle, ...meta })
      return id
    },
    async get(id) {
      const found = puzzles.get(id)
      return found ? { ...found } : null
    },
    async sweep(olderThan) {
      for (const [id, puzzle] of puzzles) {
        if (puzzle.createdAt < olderThan) puzzles.delete(id)
      }
    },
    async recentSurfaces(limit) {
      return [...puzzles.values()]
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, limit)
        .map((puzzle) => normaliseSurface(puzzle.surface))
    },
  }
}

const store = memoryStore()

function sendJson(res: ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body)
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(payload)
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  if (!chunks.length) return {}
  const raw = Buffer.concat(chunks).toString('utf8')
  if (!raw.trim()) return {}
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    throw new ApiError(400, '请求体不是合法的 JSON')
  }
}

const POST_ROUTES = new Set(['/api/game/new', '/api/game/ask', '/api/game/reveal'])

async function route(env: GameEnv, req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const path = url.pathname

  if (path.startsWith('/api/auth/')) {
    // Auth needs KV + D1 + the email binding, which only exist in the Worker runtime.
    sendJson(res, 501, {
      error:
        '登录接口需要 Workers 运行时（KV / D1 / 邮件绑定）。本地全栈调试请用 npm run dev:worker',
    })
    return
  }

  if (path === '/api/health') {
    if (req.method !== 'GET') {
      sendJson(res, 405, { error: '方法不被允许' })
      return
    }
    sendJson(res, 200, health(env))
    return
  }
  if (!POST_ROUTES.has(path)) {
    sendJson(res, 404, { error: '未知接口' })
    return
  }
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: '方法不被允许' })
    return
  }

  const body = await readJson(req)
  if (path === '/api/game/new') {
    sendJson(res, 200, await startGame(env, store, body))
    return
  }
  if (path === '/api/game/reveal') {
    sendJson(res, 200, await revealGame(store, body))
    return
  }
  sendJson(res, 200, await askHost(env, store, body))
}

async function handler(env: GameEnv, req: IncomingMessage, res: ServerResponse) {
  if (!req.url?.startsWith('/api/')) return false
  try {
    await route(env, req, res)
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 500
    const message = error instanceof Error ? error.message : '服务器内部错误'
    if (status >= 500) console.error('[turtle-soup]', error)
    sendJson(res, status, { error: message })
  }
  return true
}

/**
 * Dev-only adapter: serves the same /api surface as `worker/index.ts` through the
 * Vite dev server, so `npm run dev` and the deployed Worker behave identically.
 */
export function turtleSoupApi(env: GameEnv): Plugin {
  return {
    name: 'turtle-soup-api',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        void handler(env, req, res).then((handled) => {
          if (!handled) next()
        })
      })
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        void handler(env, req, res).then((handled) => {
          if (!handled) next()
        })
      })
    },
  }
}
