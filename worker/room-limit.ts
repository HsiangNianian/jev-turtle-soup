import { DurableObject } from 'cloudflare:workers'

/** One small gate per authenticated account; limits work across Worker isolates. */
export class RoomLimit extends DurableObject<unknown> {
  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env)
    ctx.storage.sql.exec(
      'CREATE TABLE IF NOT EXISTS counters (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL)',
    )
    ctx.storage.sql.exec(
      'CREATE TABLE IF NOT EXISTS requests (key TEXT PRIMARY KEY, expires INTEGER NOT NULL)',
    )
  }

  async check(
    action: string,
    limit: number,
    windowMs: number,
    requestId?: string,
  ): Promise<boolean> {
    const now = Date.now()
    const sql = this.ctx.storage.sql
    sql.exec('DELETE FROM counters WHERE expires <= ?', now)
    sql.exec('DELETE FROM requests WHERE expires <= ?', now)
    const requestKey = `${action}:${requestId}`
    if (requestId && sql.exec('SELECT key FROM requests WHERE key=?', requestKey).toArray().length)
      return true
    const bucket = Math.floor(now / windowMs)
    const key = `${action}:${bucket}`
    const count =
      sql.exec<{ count: number }>('SELECT count FROM counters WHERE key=?', key).toArray()[0]
        ?.count ?? 0
    if (count >= limit) return false
    const expires = (bucket + 1) * windowMs
    this.ctx.storage.transactionSync(() => {
      sql.exec(
        'INSERT INTO counters(key, count, expires) VALUES(?, 1, ?) ON CONFLICT(key) DO UPDATE SET count=count+1',
        key,
        expires,
      )
      if (requestId)
        sql.exec('INSERT OR REPLACE INTO requests(key, expires) VALUES(?, ?)', requestKey, expires)
    })
    await this.ctx.storage.setAlarm(now + 86_400_000)
    return true
  }
  async alarm() {
    this.ctx.storage.sql.exec('DELETE FROM counters WHERE expires <= ?', Date.now())
    this.ctx.storage.sql.exec('DELETE FROM requests WHERE expires <= ?', Date.now())
  }
}
