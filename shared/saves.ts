import type { D1Like } from './auth.ts'
import { ApiError } from './errors.ts'

/**
 * 云端存档：登录后把本机进度镜像到账号，换设备不丢。
 *
 * 一局一行（不是每人一整块 JSON）：单局有大小上限，整块会顶到行大小限制。
 * 写入一律「新的覆盖旧的」——冲突时以 updatedAt 晚的为准，所以客户端可以
 * 放心地把本机存档整批推上来，服务端自己会取舍。
 */

const MAX_GAMES = 200
const MAX_PAYLOAD = 256 * 1024

interface StoredGame {
  id: string
  title: string
  surface: string
  updatedAt: number
  [key: string]: unknown
}

/** 只校验「恢复进度所必需」的字段，其余原样透传（存档结构会演进）。 */
function validGame(raw: unknown): StoredGame | null {
  if (!raw || typeof raw !== 'object') return null
  const game = raw as Record<string, unknown>
  if (typeof game.id !== 'string' || !game.id) return null
  if (typeof game.title !== 'string' || typeof game.surface !== 'string') return null
  if (!Array.isArray(game.messages)) return null
  if (typeof game.updatedAt !== 'number' || !Number.isFinite(game.updatedAt)) return null
  return game as StoredGame
}

function serialize(game: StoredGame): string {
  const payload = JSON.stringify(game)
  if (payload.length > MAX_PAYLOAD) throw new ApiError(413, '这一局的进度太大了，暂时无法同步')
  return payload
}

async function upsert(db: D1Like, uid: string, game: StoredGame): Promise<void> {
  await db
    .prepare(
      `INSERT INTO saves (uid, game_id, payload, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(uid, game_id) DO UPDATE SET
         payload = excluded.payload, updated_at = excluded.updated_at
       WHERE excluded.updated_at > saves.updated_at`,
    )
    .bind(uid, game.id, serialize(game), game.updatedAt)
    .run()
}

export async function listSaves(db: D1Like, uid: string): Promise<unknown[]> {
  const { results } = await db
    .prepare('SELECT payload FROM saves WHERE uid = ? ORDER BY updated_at DESC LIMIT ?')
    .bind(uid, MAX_GAMES)
    .all<{ payload: string }>()
  const games: unknown[] = []
  for (const row of results ?? []) {
    try {
      games.push(JSON.parse(row.payload))
    } catch {
      /* 坏行跳过，不影响其它存档 */
    }
  }
  return games
}

export async function putSave(db: D1Like, uid: string, raw: unknown): Promise<void> {
  const game = validGame(raw)
  if (!game) throw new ApiError(400, '存档格式不对')
  await upsert(db, uid, game)
}

/** 整批并入（登录时把本机进度推上来）。逐条 upsert，旧的不会盖掉新的。 */
export async function importSaves(
  db: D1Like,
  uid: string,
  rawList: unknown,
): Promise<{ imported: number; skipped: number }> {
  if (!Array.isArray(rawList)) throw new ApiError(400, '存档格式不对')
  const games = rawList.map(validGame).filter((game): game is StoredGame => game !== null)
  const capped = games.slice(0, MAX_GAMES)
  for (const game of capped) await upsert(db, uid, game)
  return { imported: capped.length, skipped: games.length - capped.length }
}

export async function deleteSave(db: D1Like, uid: string, id: string): Promise<void> {
  if (!id) throw new ApiError(400, '缺少 id')
  await db.prepare('DELETE FROM saves WHERE uid = ? AND game_id = ?').bind(uid, id).run()
}
