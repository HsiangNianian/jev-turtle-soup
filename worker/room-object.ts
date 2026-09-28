import { DurableObject } from 'cloudflare:workers'
import { readSession } from '../shared/auth.ts'
import { ApiError } from '../shared/errors.ts'
import { judge } from '../shared/game.ts'
import {
  createRoom,
  joinRoom,
  memberOf,
  roomCommand,
  roomPresence,
  roomSnapshot,
  tickRoom,
  nextRoomQuestion,
  completeRoomQuestion,
  isRoomFinished,
  seated,
  type RoomChange,
  type RoomState,
} from '../shared/room-engine.ts'
import {
  ROOM_IDLE_MS,
  ROOM_RECONNECT_MS,
  type RoomEvent,
  type RoomServerMessage,
} from '../shared/room-protocol.ts'
import type { RoomEnv, RoomPage, RoomResult, RoomRPC } from '../shared/room-rpc.ts'
import { parseRoomCommand, roomHash, ROOM_WS_PROTOCOL } from '../shared/room-security.ts'
import { projectRoom } from '../shared/room-store.ts'

interface Attachment {
  uid: string
  token: string
  lastSeq: number
}
type PayloadRow = { payload: string }

/** A room is the only writer of its transcript, votes, queue and answer key. */
export class SoupRoom extends DurableObject<RoomEnv> {
  private broadcasting = false
  private flushPromise: Promise<void> | null = null

  constructor(ctx: DurableObjectState, env: RoomEnv) {
    super(ctx, env)
    const sql = ctx.storage.sql
    sql.exec(
      'CREATE TABLE IF NOT EXISTS head (id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL)',
    )
    sql.exec(
      'CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY, payload TEXT NOT NULL, question_id TEXT, type TEXT NOT NULL)',
    )
    sql.exec('CREATE INDEX IF NOT EXISTS question_events ON events(question_id, type)')
    sql.exec(
      'CREATE TABLE IF NOT EXISTS commands (uid TEXT NOT NULL, id TEXT NOT NULL, fingerprint TEXT NOT NULL, seq INTEGER NOT NULL, PRIMARY KEY(uid,id))',
    )
    sql.exec(
      'CREATE TABLE IF NOT EXISTS tickets (hash TEXT PRIMARY KEY, uid TEXT NOT NULL, session_hash TEXT NOT NULL, expires INTEGER NOT NULL)',
    )
    sql.exec(
      'CREATE TABLE IF NOT EXISTS counters (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL)',
    )
    sql.exec(
      'CREATE TABLE IF NOT EXISTS outbox (id TEXT PRIMARY KEY, kind TEXT NOT NULL, payload TEXT NOT NULL)',
    )
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'))
  }

  private state(): RoomState {
    const row = this.ctx.storage.sql
      .exec<PayloadRow>('SELECT payload FROM head WHERE id=1')
      .toArray()[0]
    if (!row) throw new ApiError(404, '没有这一桌')
    return JSON.parse(row.payload) as RoomState
  }
  private hasState() {
    return this.ctx.storage.sql.exec('SELECT id FROM head WHERE id=1').toArray().length > 0
  }
  private async result<T>(fn: () => T | Promise<T>): Promise<RoomResult<T>> {
    try {
      return { ok: true, value: await fn() }
    } catch (error) {
      if (!(error instanceof ApiError))
        console.error('[room] operation failed', error instanceof Error ? error.name : 'unknown')
      return {
        ok: false,
        status: error instanceof ApiError ? error.status : 503,
        error: error instanceof ApiError ? error.message : '同桌暂时无法连接，请稍后重试',
      }
    }
  }
  private limit(uid: string, action: string, max: number, windowMs = 10_000) {
    const now = Date.now()
    const sql = this.ctx.storage.sql
    sql.exec('DELETE FROM counters WHERE expires <= ?', now)
    const bucket = Math.floor(now / windowMs)
    const key = `${uid}:${action}:${bucket}`
    const count =
      sql.exec<{ count: number }>('SELECT count FROM counters WHERE key=?', key).toArray()[0]
        ?.count ?? 0
    if (count >= max) throw new ApiError(429, '操作太快了，请稍等一下')
    sql.exec(
      'INSERT INTO counters(key,count,expires) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1',
      key,
      (bucket + 1) * windowMs,
    )
  }
  private save(
    change: RoomChange,
    command?: { uid: string; id: string; fingerprint: string },
    log?: unknown,
  ) {
    const s = change.state
    s.revision++
    const sql = this.ctx.storage.sql
    this.ctx.storage.transactionSync(() => {
      const payload = JSON.stringify(s)
      sql.exec('INSERT OR REPLACE INTO head(id,payload) VALUES(1,?)', payload)
      for (const event of change.events)
        sql.exec(
          'INSERT INTO events(seq,payload,question_id,type) VALUES(?,?,?,?)',
          event.seq,
          JSON.stringify(event),
          event.questionId ?? null,
          event.type,
        )
      if (command)
        sql.exec(
          'INSERT INTO commands(uid,id,fingerprint,seq) VALUES(?,?,?,?)',
          command.uid,
          command.id,
          command.fingerprint,
          s.eventSeq,
        )
      sql.exec("INSERT OR REPLACE INTO outbox(id,kind,payload) VALUES('index','index',?)", payload)
      if (log && typeof log === 'object') {
        const value = log as { questionId: string }
        sql.exec(
          "INSERT OR IGNORE INTO outbox(id,kind,payload) VALUES(?,'turn',?)",
          `turn:${value.questionId}`,
          JSON.stringify(log),
        )
      }
    })
    // All critical writes are synchronous and precede network work. Alarms recover the rest.
    void this.schedule().catch(() => console.error('[room] alarm scheduling failed'))
    void this.broadcast().catch(() => console.error('[room] broadcast failed'))
    void this.flush().catch(() => console.error('[room] projection flush failed'))
  }
  private housekeeping() {
    if (!this.hasState()) return
    const s = this.state()
    const change = tickRoom(s, Date.now())
    if (change.events.length) this.save(change)
    this.ctx.storage.sql.exec('DELETE FROM tickets WHERE expires <= ?', Date.now())
  }
  private async schedule() {
    if (!this.hasState()) return
    const s = this.state()
    const now = Date.now()
    const times: number[] = []
    if (!isRoomFinished(s)) {
      times.push(s.updatedAt + ROOM_IDLE_MS)
      for (const m of seated(s))
        if (m.disconnectedAt !== null) times.push(m.disconnectedAt + ROOM_RECONNECT_MS)
      if (s.processing) times.push(s.processing.deadline)
      if (s.vote) times.push(s.vote.expiresAt)
    }
    if (this.ctx.storage.sql.exec('SELECT id FROM outbox LIMIT 1').toArray().length)
      times.push(now + 5000)
    if (times.length) await this.ctx.storage.setAlarm(Math.max(now + 100, Math.min(...times)))
    else await this.ctx.storage.deleteAlarm()
  }
  private flush(): Promise<void> {
    if (!this.flushPromise)
      this.flushPromise = this.flushPending().finally(() => {
        this.flushPromise = null
      })
    return this.flushPromise
  }
  private async flushPending() {
    if (!this.env.DB) return
    try {
      const sql = this.ctx.storage.sql
      for (const row of sql
        .exec<{ id: string; kind: string; payload: string }>('SELECT * FROM outbox LIMIT 50')
        .toArray()) {
        if (row.kind === 'index')
          await projectRoom(this.env.DB, JSON.parse(row.payload) as RoomState)
        else {
          const log = JSON.parse(row.payload) as {
            roomId: string
            questionId: string
            puzzleId: string
            uid: string
            seq: number
            locale: string
            message: string
            reply: string
            intent: string
            verdict: string
            solved: boolean
            closeness: number | null
            model: string
            debug: unknown
            history: unknown
            at: number
          }
          await this.env.DB.prepare(
            `INSERT OR IGNORE INTO turn_logs(id,puzzle_id,kind,seq,player_key,locale,message,reply,intent,verdict,solved,closeness,model,debug_json,history_json,created_at,room_id,question_id)
            VALUES(?,?,'room',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          )
            .bind(
              crypto.randomUUID(),
              log.puzzleId,
              log.seq,
              log.uid,
              log.locale,
              log.message,
              log.reply,
              log.intent,
              log.verdict,
              log.solved ? 1 : 0,
              log.closeness,
              log.model,
              JSON.stringify(log.debug),
              JSON.stringify(log.history),
              log.at,
              log.roomId,
              log.questionId,
            )
            .run()
        }
        // A newer projection may have been queued while D1 was awaited.
        sql.exec('DELETE FROM outbox WHERE id=? AND payload=?', row.id, row.payload)
      }
    } catch (error) {
      console.error(
        '[room] durable projection pending retry',
        error instanceof Error ? error.name : 'unknown',
      )
    } finally {
      await this.schedule()
    }
  }

  private events(
    uid: string,
    after?: number,
    before?: number,
  ): { events: RoomEvent[]; hasMore: boolean } {
    const s = this.state()
    const member = memberOf(s, uid)
    if (!member) throw new ApiError(404, '没有这份同桌案卷')
    const cutoff = member.seat === 'removed' ? member.cutoffSeq! : s.eventSeq
    const forward = after !== undefined
    const rows = forward
      ? this.ctx.storage.sql
          .exec<PayloadRow>(
            'SELECT payload FROM events WHERE seq>? AND seq<=? ORDER BY seq LIMIT 101',
            after,
            cutoff,
          )
          .toArray()
      : this.ctx.storage.sql
          .exec<PayloadRow>(
            'SELECT payload FROM events WHERE seq<? AND seq<=? ORDER BY seq DESC LIMIT 101',
            before ?? cutoff + 1,
            cutoff,
          )
          .toArray()
    const events = rows.slice(0, 100).map((row) => JSON.parse(row.payload) as RoomEvent)
    return { events: forward ? events : events.reverse(), hasMore: rows.length > 100 }
  }

  async create(input: Parameters<RoomRPC['create']>[0]) {
    return this.result(async () => {
      if (this.hasState()) {
        const existing = this.state()
        if (existing.puzzle.id !== input.puzzle.id || existing.members[0]?.uid !== input.actor.uid)
          throw new ApiError(409, '该请求编号已用于另一桌')
      } else this.save(createRoom(input.id, input.code, input.puzzle, input.actor, Date.now()))
      // A failed initial projection is safe to retry with the same deterministic room ID.
      await this.flush()
      const indexed = await this.env.DB?.prepare('SELECT id FROM rooms WHERE id=?')
        .bind(input.id)
        .first()
      if (!indexed) throw new ApiError(503, '这一桌正在准备，请稍后重试')
      return roomSnapshot(this.state(), input.actor.uid)
    })
  }
  async join(actor: Parameters<RoomRPC['join']>[0]) {
    return this.result(() => {
      this.housekeeping()
      const change = joinRoom(this.state(), actor, Date.now())
      if (change.events.length) this.save(change)
      return roomSnapshot(this.state(), actor.uid)
    })
  }
  async page(uid: string, after?: number, before?: number): Promise<RoomResult<RoomPage>> {
    return this.result(() => {
      this.housekeeping()
      return { snapshot: roomSnapshot(this.state(), uid), ...this.events(uid, after, before) }
    })
  }
  async ticket(uid: string, sessionToken: string) {
    return this.result(async () => {
      this.housekeeping()
      this.liveState(uid)
      this.limit(uid, 'ticket', 6, 60_000)
      const ticket = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll('-', '')
      const [hash, sessionHash] = await Promise.all([roomHash(ticket), roomHash(sessionToken)])
      // The member may leave, be kicked, or the room may finish while crypto yields.
      this.liveState(uid)
      const expiresAt = Date.now() + 30_000
      this.ctx.storage.sql.exec('DELETE FROM tickets WHERE expires<=?', Date.now())
      this.ctx.storage.sql.exec(
        'INSERT INTO tickets(hash,uid,session_hash,expires) VALUES(?,?,?,?)',
        hash,
        uid,
        sessionHash,
        expiresAt,
      )
      return { ticket, expiresAt }
    })
  }

  private liveState(uid: string): RoomState {
    const s = this.state()
    const member = memberOf(s, uid)
    if (!member || member.seat === 'removed') throw new ApiError(403, '不能连接这一桌')
    if (isRoomFinished(s) || member.seat !== 'seated')
      throw new ApiError(403, '当前为只读案卷，可刷新记录或返回我的同桌')
    return s
  }

  private async authenticated(attachment: Attachment): Promise<boolean> {
    if (!this.env.AUTH_KV || !this.env.AUTH_SECRET) return false
    const user = await readSession(this.env.AUTH_KV, this.env.AUTH_SECRET, attachment.token)
    return user?.uid === attachment.uid
  }
  async fetch(request: Request): Promise<Response> {
    // Only the Worker forwards these headers, after its session and Origin checks.
    const outcome = await this.result(async () => {
      if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket')
        throw new ApiError(426, '需要 WebSocket 连接')
      const uid = request.headers.get('x-room-uid') ?? ''
      const token = request.headers.get('x-room-token') ?? ''
      const protocols = (request.headers.get('sec-websocket-protocol') ?? '')
        .split(',')
        .map((p) => p.trim())
      const ticket = protocols.find((p) => p.startsWith('ticket.'))?.slice(7) ?? ''
      if (!protocols.includes(ROOM_WS_PROTOCOL) || !/^[a-f0-9]{64}$/.test(ticket))
        throw new ApiError(401, '连接凭证已失效，请重新连接')
      const [hash, sessionHash] = await Promise.all([roomHash(ticket), roomHash(token)])
      const attachment: Attachment = {
        uid,
        token,
        lastSeq: Math.max(0, Number(request.headers.get('x-room-after') ?? 0)),
      }
      if (!(await this.authenticated(attachment))) throw new ApiError(401, '请重新登录')
      const row = this.ctx.storage.sql
        .exec<{ uid: string; session_hash: string; expires: number }>(
          'SELECT * FROM tickets WHERE hash=?',
          hash,
        )
        .toArray()[0]
      if (!row || row.uid !== uid || row.session_hash !== sessionHash || row.expires <= Date.now())
        throw new ApiError(401, '连接凭证已失效，请重新连接')
      // Consume synchronously before accepting: simultaneous handshakes cannot reuse it.
      this.ctx.storage.sql.exec('DELETE FROM tickets WHERE hash=?', hash)
      this.housekeeping()
      const s = this.liveState(uid)
      if (
        this.ctx.getWebSockets(uid).filter((ws) => ws.readyState === WebSocket.OPEN).length >= 3 ||
        this.ctx.getWebSockets().length >= 24
      )
        throw new ApiError(429, '同桌连接太多，请关闭其他页面后重试')
      const pair = new WebSocketPair()
      const client = pair[0],
        server = pair[1]
      this.ctx.acceptWebSocket(server, [uid])
      attachment.lastSeq = Math.min(
        Number.isSafeInteger(attachment.lastSeq) ? attachment.lastSeq : 0,
        s.eventSeq,
      )
      server.serializeAttachment(attachment)
      if (memberOf(s, uid)?.disconnectedAt !== null)
        this.save(roomPresence(s, uid, true, Date.now()))
      // A second device may not change presence, so catch up independently of broadcasts.
      let first = true
      let more: boolean
      do {
        const page = this.events(uid, attachment.lastSeq)
        const message: RoomServerMessage = {
          type: first ? 'snapshot' : 'update',
          snapshot: roomSnapshot(this.state(), uid),
          ...page,
        }
        server.send(JSON.stringify(message))
        attachment.lastSeq = page.events.at(-1)?.seq ?? attachment.lastSeq
        server.serializeAttachment(attachment)
        first = false
        more = page.hasMore
      } while (more)
      void this.drive().catch(() => console.error('[room] scheduling question failed'))
      return new Response(null, {
        status: 101,
        webSocket: client,
        headers: { 'sec-websocket-protocol': ROOM_WS_PROTOCOL },
      })
    })
    return outcome.ok
      ? outcome.value
      : Response.json(
          { error: outcome.error },
          { status: outcome.status, headers: { 'cache-control': 'no-store' } },
        )
  }

  private async broadcast() {
    if (this.broadcasting || !this.hasState()) return
    this.broadcasting = true
    try {
      let revision: number
      do {
        revision = this.state().revision
        for (const ws of this.ctx.getWebSockets()) {
          if (ws.readyState !== WebSocket.OPEN) continue
          const a = ws.deserializeAttachment() as Attachment
          try {
            if (!(await this.authenticated(a))) {
              this.send(ws, { type: 'error', status: 401, error: '请重新登录', terminal: 'auth' })
              ws.close(4001, '请重新登录')
              continue
            }
            const s = this.state()
            if (memberOf(s, a.uid)?.seat === 'removed') {
              this.send(ws, {
                type: 'error',
                status: 403,
                error: '已被移出同桌',
                terminal: 'removed',
              })
              ws.close(4003, '已被移出同桌')
              continue
            }
            let more = true
            while (more) {
              const page = this.events(a.uid, a.lastSeq)
              const message: RoomServerMessage = {
                type: 'update',
                snapshot: roomSnapshot(this.state(), a.uid),
                events: page.events,
                hasMore: page.hasMore,
              }
              ws.send(JSON.stringify(message))
              a.lastSeq = page.events.at(-1)?.seq ?? a.lastSeq
              ws.serializeAttachment(a)
              more = page.hasMore
            }
            // Deliver every missing event, including the final report, before closing.
            if (roomSnapshot(this.state(), a.uid).readOnly) ws.close(1000, '共同案卷已保存')
          } catch {
            ws.close(1011, '连接暂时中断，请重连')
          }
        }
      } while (this.state().revision !== revision)
    } finally {
      this.broadcasting = false
    }
  }
  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    let commandId: string | undefined
    const a = ws.deserializeAttachment() as Attachment
    try {
      // Bound work before KV/crypto/model calls. Never use the client's claimed identity.
      this.limit(a.uid, 'frame', 30)
      if (typeof raw !== 'string') throw new ApiError(400, '只接受文字消息')
      const command = parseRoomCommand(raw)
      commandId = command.commandId
      if (!(await this.authenticated(a))) {
        this.send(ws, { type: 'error', status: 401, error: '请重新登录', terminal: 'auth' })
        ws.close(4001, '请重新登录')
        return
      }
      this.housekeeping()
      const s = this.state()
      if (memberOf(s, a.uid)?.seat !== 'seated') throw new ApiError(403, '你已不在这一桌')
      const fingerprint = JSON.stringify(command)
      const previous = this.ctx.storage.sql
        .exec<{ fingerprint: string; seq: number }>(
          'SELECT fingerprint,seq FROM commands WHERE uid=? AND id=?',
          a.uid,
          commandId,
        )
        .toArray()[0]
      if (previous) {
        if (previous.fingerprint !== fingerprint)
          throw new ApiError(409, '同一个请求编号不能用于不同操作')
        this.send(ws, { type: 'ack', commandId, eventSeq: previous.seq })
        return
      }
      this.limit(
        a.uid,
        command.type === 'discuss' ? 'chat' : 'action',
        command.type === 'discuss' ? 5 : 10,
      )
      const change = roomCommand(s, a.uid, command, Date.now(), (id) => {
        const row = this.ctx.storage.sql
          .exec<PayloadRow>(
            "SELECT payload FROM events WHERE question_id=? AND type='question' LIMIT 1",
            id,
          )
          .toArray()[0]
        if (!row) return undefined
        const event = JSON.parse(row.payload) as RoomEvent
        return { id, uid: event.actorId!, text: event.text }
      })
      this.save(change, { uid: a.uid, id: commandId, fingerprint })
      this.send(ws, { type: 'ack', commandId, eventSeq: change.state.eventSeq })
      await this.drive()
    } catch (error) {
      this.send(ws, {
        type: 'error',
        commandId,
        status: error instanceof ApiError ? error.status : 503,
        error: error instanceof ApiError ? error.message : '操作暂未完成，请稍后重试',
      })
      if (error instanceof ApiError && (error.status === 413 || error.status === 429))
        ws.close(4008, '请稍后重新连接')
    }
  }
  private send(ws: WebSocket, message: RoomServerMessage) {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message))
  }

  private async drive() {
    const before = this.state()
    const next = nextRoomQuestion(before, Date.now())
    if (!next.state.processing && !next.events.length) return
    if (before.processing) return
    this.save(next)
    const active = next.state.processing
    if (!active) return
    const leaseId = active.leaseId
    const puzzle = next.state.puzzle
    try {
      if (
        this.env.ROOM_LIMITS &&
        !(await this.env.ROOM_LIMITS.getByName(`user:${active.uid}`).check(
          'judge',
          120,
          3600_000,
          `${next.state.id}:${leaseId}`,
        ))
      )
        throw new ApiError(429, '这一小时的提问较多，请休息一下再重试。')
      // Rate-limit RPC also yields. An expired lease must not start another model call.
      if (this.state().processing?.leaseId !== leaseId) return
      const turn = await judge(
        this.env,
        puzzle,
        { message: active.text, locale: active.locale },
        {
          truthLocked: puzzle.dailyDate === new Date().toISOString().slice(0, 10),
          manualReveal: 'vote',
          room: {
            speakerId: active.uid,
            recentQuestions: next.state.recentQuestions,
            reference: active.reference,
          },
        },
      )
      const current = this.state()
      if (current.processing?.leaseId !== leaseId || isRoomFinished(current)) return
      const change = completeRoomQuestion(current, leaseId, turn, null, Date.now())
      this.save(change, undefined, {
        roomId: current.id,
        questionId: active.id,
        puzzleId: puzzle.id,
        uid: active.uid,
        seq: change.state.turns,
        locale: active.locale,
        message: active.text,
        reply: turn.reply,
        intent: turn.intent,
        verdict: turn.verdict,
        solved: turn.solved,
        closeness: turn.closeness,
        model: turn.model,
        debug: turn.debug,
        history: next.state.recentQuestions,
        at: Date.now(),
      })
    } catch (error) {
      const current = this.state()
      if (current.processing?.leaseId !== leaseId || isRoomFinished(current)) return
      const message =
        error instanceof ApiError && error.status < 500
          ? error.message
          : '砚暂时没有回应，提问者可以重试。'
      this.save(completeRoomQuestion(current, leaseId, null, message, Date.now()))
    }
    await this.drive()
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string) {
    ws.close(code, reason)
    this.disconnected(ws)
  }
  async webSocketError(ws: WebSocket) {
    ws.close(1011, '连接中断')
    this.disconnected(ws)
  }
  private disconnected(ws: WebSocket) {
    const a = ws.deserializeAttachment() as Attachment
    if (
      !this.hasState() ||
      this.ctx
        .getWebSockets(a.uid)
        .some((other) => other !== ws && other.readyState === WebSocket.OPEN)
    )
      return
    const s = this.state()
    const member = memberOf(s, a.uid)
    if (!isRoomFinished(s) && member?.seat === 'seated' && member.disconnectedAt === null)
      this.save(roomPresence(s, a.uid, false, Date.now()))
  }
  async alarm() {
    this.housekeeping()
    await this.flush()
    await this.drive()
    await this.schedule()
  }
}
