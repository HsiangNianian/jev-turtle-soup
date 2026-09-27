import type { D1Like, KVLike } from './auth.ts'
import type { GameEnv } from './game.ts'
import type { RoomSecretPuzzle } from './room-engine.ts'
import type { RoomActor, RoomEvent, RoomSnapshot } from './room-protocol.ts'

export type RoomResult<T> = { ok: true; value: T } | { ok: false; status: number; error: string }
export interface RoomPage {
  snapshot: RoomSnapshot
  events: RoomEvent[]
  hasMore: boolean
}
export interface RoomRPC {
  create(input: {
    id: string
    code: string
    puzzle: RoomSecretPuzzle
    actor: RoomActor
  }): Promise<RoomResult<RoomSnapshot>>
  join(actor: RoomActor): Promise<RoomResult<RoomSnapshot>>
  page(uid: string, after?: number, before?: number): Promise<RoomResult<RoomPage>>
  ticket(
    uid: string,
    sessionToken: string,
  ): Promise<RoomResult<{ ticket: string; expiresAt: number }>>
  fetch(request: Request): Promise<Response>
}
export interface RoomLimitRPC {
  check(action: string, limit: number, windowMs: number, requestId?: string): Promise<boolean>
}
export interface RoomBindings {
  ROOMS?: { getByName(name: string): RoomRPC }
  ROOM_LIMITS?: { getByName(name: string): RoomLimitRPC }
  ROOMS_ENABLED?: string
}
export interface RoomEnv extends GameEnv, RoomBindings {
  DB?: D1Like
  AUTH_KV?: KVLike
  AUTH_SECRET?: string
}
