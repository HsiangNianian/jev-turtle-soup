import { readCookie, readSession, SESSION_COOKIE } from '../shared/auth.ts'
import { ApiError } from '../shared/errors.ts'
import { parseRoomCode } from '../shared/room-protocol.ts'
import type { RoomEnv, RoomResult } from '../shared/room-rpc.ts'
import { roomActor, roomPuzzle, listMyRooms } from '../shared/room-store.ts'
import {
  newRoomCode,
  readRoomBody,
  roomCreationId,
  roomHash,
  roomOriginAllowed,
  ROOM_UUID,
} from '../shared/room-security.ts'
import { submitReport } from '../shared/logs.ts'

function response(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
  })
}
function unwrap<T>(result: RoomResult<T>): T {
  if (!result.ok) throw new ApiError(result.status, result.error)
  return result.value
}
function pageNumber(raw: string | null): number | undefined {
  if (raw === null) return undefined
  const n = Number(raw)
  if (!Number.isSafeInteger(n) || n < 0) throw new ApiError(400, '无效的记录位置')
  return n
}

export async function routeRooms(request: Request, env: RoomEnv): Promise<Response | null> {
  const url = new URL(request.url)
  if (!(
    url.pathname === '/api/rooms' ||
    url.pathname.startsWith('/api/rooms/') ||
    url.pathname === '/api/me/rooms' ||
    url.pathname.startsWith('/api/me/rooms/')
  ))
    return null
  try {
    roomOriginAllowed(request)
    if (url.pathname === '/api/rooms/config' && request.method === 'GET')
      return response({ enabled: env.ROOMS_ENABLED === '1', protocol: 1, capacity: 6 })
    if (!env.ROOMS || !env.ROOM_LIMITS || !env.DB || !env.AUTH_KV || !env.AUTH_SECRET)
      throw new ApiError(503, '同桌暂未开放')
    const token = readCookie(request.headers.get('cookie'), SESSION_COOKIE)
    const session = await readSession(env.AUTH_KV, env.AUTH_SECRET, token)
    if (!session || !token) throw new ApiError(401, '请先登录再入座')
    const gate = env.ROOM_LIMITS.getByName(`user:${session.uid}`)
    if (!(await gate.check('http', 120, 60_000))) throw new ApiError(429, '操作太快了，请稍后再试')
    if (url.pathname === '/api/me/rooms' && request.method === 'GET')
      return response({ items: await listMyRooms(env.DB, session.uid) })
    const hide = /^\/api\/me\/rooms\/([^/]+)\/hide$/.exec(url.pathname)
    if (hide && request.method === 'POST') {
      await readRoomBody(request)
      if (!ROOM_UUID.test(hide[1])) throw new ApiError(404, '没有这份同桌案卷')
      await env.DB.prepare('UPDATE room_members SET hidden=1 WHERE room_id=? AND uid=?')
        .bind(hide[1], session.uid)
        .run()
      return response({ ok: true })
    }
    if (url.pathname === '/api/rooms' && request.method === 'POST') {
      if (env.ROOMS_ENABLED !== '1') throw new ApiError(503, '暂时不能开新桌，已有同桌可以继续')
      const body = await readRoomBody(request)
      if (
        typeof body.puzzleId !== 'string' ||
        body.puzzleId.length > 128 ||
        typeof body.requestId !== 'string'
      )
        throw new ApiError(400, '缺少题目或请求编号')
      const id = await roomCreationId(session.uid, body.requestId)
      if (
        !(await gate.check('create-hour', 5, 3600_000, body.requestId)) ||
        !(await gate.check('create-day', 20, 86_400_000, body.requestId))
      )
        throw new ApiError(429, '开桌太频繁，请先玩完已有同桌')
      const [actor, puzzle] = await Promise.all([
        roomActor(env.DB, session.uid),
        roomPuzzle(env.DB, body.puzzleId),
      ])
      return response(
        unwrap(await env.ROOMS.getByName(id).create({ id, code: newRoomCode(), puzzle, actor })),
        201,
      )
    }
    if (url.pathname === '/api/rooms/join' && request.method === 'POST') {
      const body = await readRoomBody(request)
      if (!(await gate.check('join', 10, 60_000))) throw new ApiError(429, '尝试太频繁，请稍后再试')
      const code = typeof body.code === 'string' ? parseRoomCode(body.code) : null
      if (!code) throw new ApiError(400, '请输入有效的邀请码或海龟汤邀请链接')
      const row = await env.DB.prepare('SELECT id FROM rooms WHERE invite_hash=?')
        .bind(await roomHash(code))
        .first<{ id: string }>()
      if (!row) throw new ApiError(404, '邀请码无效或这一桌尚未准备好')
      return response(
        unwrap(await env.ROOMS.getByName(row.id).join(await roomActor(env.DB, session.uid))),
      )
    }
    const match = /^\/api\/rooms\/([^/]+)(?:\/(ticket|ws|events|report))?$/.exec(url.pathname)
    if (!match || !ROOM_UUID.test(match[1])) throw new ApiError(404, '没有这一桌')
    const room = env.ROOMS.getByName(match[1])
    const action = match[2]
    if ((!action || action === 'events') && request.method === 'GET')
      return response(
        unwrap(
          await room.page(
            session.uid,
            pageNumber(url.searchParams.get('after')),
            pageNumber(url.searchParams.get('before')),
          ),
        ),
      )
    if (action === 'ticket' && request.method === 'POST') {
      await readRoomBody(request)
      return response(unwrap(await room.ticket(session.uid, token)))
    }
    if (action === 'ws' && request.method === 'GET') {
      if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket')
        throw new ApiError(426, '需要 WebSocket 连接')
      const protocols = request.headers.get('sec-websocket-protocol') ?? ''
      if (protocols.length > 256) throw new ApiError(400, '无效的连接协议')
      return await room.fetch(
        new Request('https://room.internal/ws', {
          headers: {
            upgrade: 'websocket',
            'sec-websocket-protocol': protocols,
            'x-room-uid': session.uid,
            'x-room-token': token,
            'x-room-after': String(pageNumber(url.searchParams.get('after')) ?? 0),
          },
        }),
      )
    }
    if (action === 'report' && request.method === 'POST') {
      const body = await readRoomBody(request)
      if (!(await gate.check('report', 5, 3600_000)))
        throw new ApiError(429, '反馈太频繁，请稍后再试')
      const page = unwrap(await room.page(session.uid))
      const result = await submitReport(env.DB, {
        puzzleId: page.snapshot.puzzle.id,
        kind: 'room',
        playerKey: session.uid,
        note: typeof body.note === 'string' ? body.note : '',
        locale: 'zh-CN',
        targetType: 'room',
        targetId: match[1],
        snapshot: {
          roomId: match[1],
          title: page.snapshot.puzzle.title,
          messages: page.events.map((e) => ({
            role: e.type === 'answer' ? 'host' : 'player',
            text: e.text,
            actorId: e.actorId,
            questionId: e.questionId,
          })),
        },
      })
      return response(result)
    }
    return response({ error: '方法不被允许' }, 405)
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 503
    // Avoid echoing Cloudflare/D1 exceptions or a URL containing credentials.
    if (status >= 500)
      console.error('[room-route] request failed', error instanceof Error ? error.name : 'unknown')
    return response(
      { error: error instanceof ApiError ? error.message : '同桌暂时无法连接，请稍后重试' },
      status,
    )
  }
}
