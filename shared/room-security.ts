import { ApiError } from './errors.ts'
import { ROOM_FRAME_BYTES, roomCommandSchema, type RoomCommand } from './room-protocol.ts'

export const ROOM_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export const ROOM_WS_PROTOCOL = 'soup-room-v1'

export function roomOriginAllowed(request: Request): void {
  const origin = request.headers.get('origin')
  if (origin && origin !== new URL(request.url).origin)
    throw new ApiError(403, '此来源不能访问同桌')
  if (request.headers.get('sec-fetch-site') === 'cross-site')
    throw new ApiError(403, '请从海龟汤页面进入同桌')
}

/** Native clients have no Origin. JSON + a custom header cannot be sent by an HTML form. */
export async function readRoomBody(request: Request): Promise<Record<string, unknown>> {
  roomOriginAllowed(request)
  if (
    request.headers.get('x-room-protocol') !== '1' ||
    request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json'
  ) {
    throw new ApiError(415, '请使用当前版本的同桌客户端')
  }
  if (Number(request.headers.get('content-length') ?? 0) > ROOM_FRAME_BYTES)
    throw new ApiError(413, '请求太长了')
  const reader = request.body?.getReader()
  if (!reader) throw new ApiError(400, '缺少请求内容')
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > ROOM_FRAME_BYTES) {
        await reader.cancel()
        throw new ApiError(413, '请求太长了')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const data = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    data.set(chunk, offset)
    offset += chunk.length
  }
  try {
    const body: unknown = JSON.parse(
      new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(data),
    )
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('object required')
    return body as Record<string, unknown>
  } catch {
    throw new ApiError(400, '请求格式不正确')
  }
}

export function parseRoomCommand(raw: string): RoomCommand {
  if (new TextEncoder().encode(raw).byteLength > ROOM_FRAME_BYTES)
    throw new ApiError(413, '消息太长了')
  let input: unknown
  try {
    input = JSON.parse(raw)
  } catch {
    throw new ApiError(400, '消息格式不正确')
  }
  const result = roomCommandSchema.safeParse(input)
  if (!result.success) throw new ApiError(400, '同桌操作格式不正确，请更新客户端')
  return result.data
}

export async function roomHash(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('')
}
export function newRoomCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  // 32 symbols, rejection is unnecessary; each character carries exactly 5 bits.
  return Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => alphabet[b & 31]).join('')
}
export async function roomCreationId(uid: string, requestId: string): Promise<string> {
  if (!ROOM_UUID.test(requestId)) throw new ApiError(400, '缺少有效的开桌请求编号')
  const h = await roomHash(`room:${uid}:${requestId}`)
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`
}
