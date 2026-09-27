import {
  roomCommandSchema,
  type RoomCommand,
  type RoomEvent,
  type RoomSnapshot,
  type RoomSummary,
  type RoomServerMessage,
} from '../../shared/room-protocol'
import type { RoomPage } from '../../shared/room-rpc'

export class RoomError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}
export async function roomRequest<T>(
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    cache: 'no-store',
    signal,
    ...(body === undefined
      ? {}
      : {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-room-protocol': '1' },
          body: JSON.stringify(body),
        }),
  })
  const value = await response.json().catch(() => ({}))
  if (!response.ok)
    throw new RoomError(value.error || '同桌暂时无法连接，请稍后重试', response.status)
  return value as T
}
export const roomAPI = {
  create: (puzzleId: string, requestId: string) =>
    roomRequest<RoomSnapshot>('/api/rooms', { puzzleId, requestId }),
  join: (code: string) => roomRequest<RoomSnapshot>('/api/rooms/join', { code }),
  list: () => roomRequest<{ items: RoomSummary[] }>('/api/me/rooms'),
  hide: (id: string) => roomRequest(`/api/me/rooms/${encodeURIComponent(id)}/hide`, {}),
  report: (id: string, note: string) =>
    roomRequest(`/api/rooms/${encodeURIComponent(id)}/report`, { note }),
}
export type RoomAction = RoomCommand extends infer C
  ? C extends RoomCommand
    ? Omit<C, 'commandId'>
    : never
  : never
export interface RoomClientState {
  snapshot: RoomSnapshot | null
  events: RoomEvent[]
  status: 'connecting' | 'online' | 'offline' | 'auth' | 'removed' | 'error'
  error: string | null
  hasEarlier: boolean
  pending: number
  rejected?: RoomCommand
}
type Pending = { at: number; command: RoomCommand }

/** One instance belongs to exactly one account and room. Only commands awaiting ACK persist. */
export class RoomConnection {
  private current: RoomClientState = {
    snapshot: null,
    events: [],
    status: 'connecting',
    error: null,
    hasEarlier: false,
    pending: 0,
  }
  private listeners = new Set<() => void>()
  private socket: WebSocket | null = null
  private controller: AbortController | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined
  private heartbeat: ReturnType<typeof setInterval> | undefined
  private stopped = true
  private connecting = false
  private attempt = 0
  private pending: Pending[] = []
  private cursor = 0
  private lastMessageAt = 0
  private readonly owner: string
  private readonly roomId: string
  private readonly key: string
  constructor(owner: string, roomId: string) {
    this.owner = owner
    this.roomId = roomId
    this.key = `soup:room-pending:v1:${owner}:${roomId}`
  }
  getSnapshot = () => this.current
  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }
  private set(patch: Partial<RoomClientState>) {
    this.current = { ...this.current, ...patch }
    for (const fn of this.listeners) fn()
  }
  private path(suffix = '') {
    return `/api/rooms/${encodeURIComponent(this.roomId)}${suffix}`
  }
  private persist() {
    if (this.pending.length) localStorage.setItem(this.key, JSON.stringify(this.pending))
    else localStorage.removeItem(this.key)
    this.set({ pending: this.pending.length })
  }
  start() {
    if (!this.stopped) return
    this.stopped = false
    try {
      const raw: unknown = JSON.parse(localStorage.getItem(this.key) ?? '[]')
      if (Array.isArray(raw))
        this.pending = raw.slice(-12).flatMap((item) => {
          const parsed = roomCommandSchema.safeParse(item?.command)
          return parsed.success && Date.now() - Number(item.at) < 600_000
            ? [{ at: Number(item.at), command: parsed.data }]
            : []
        })
      this.persist()
    } catch {
      this.set({ error: '浏览器无法保存待确认操作，请检查存储空间' })
    }
    window.addEventListener('online', this.resume)
    document.addEventListener('visibilitychange', this.resume)
    void this.connect()
  }
  stop() {
    this.stopped = true
    this.connecting = false
    clearTimeout(this.reconnectTimer)
    clearInterval(this.heartbeat)
    this.controller?.abort()
    this.socket?.close(1000)
    this.socket = null
    window.removeEventListener('online', this.resume)
    document.removeEventListener('visibilitychange', this.resume)
  }
  private resume = () => {
    if (
      !this.stopped &&
      this.socket?.readyState === WebSocket.OPEN &&
      Date.now() - this.lastMessageAt > 45_000
    ) {
      const ws = this.socket
      this.socket = null
      ws.close()
      this.retryLater()
    }
    if (!this.stopped && document.visibilityState !== 'hidden' && this.current.status === 'offline')
      this.reconnect()
  }
  reconnect = () => {
    clearTimeout(this.reconnectTimer)
    void this.connect()
  }
  clearError = () => this.set({ error: null })
  private accept(
    page: RoomPage | { snapshot: RoomSnapshot; events: RoomEvent[] },
    initial = false,
  ) {
    if (
      page.snapshot.protocol !== 1 ||
      page.snapshot.meId !== this.owner ||
      page.snapshot.roomId !== this.roomId
    ) {
      this.stop()
      this.set({ status: 'auth', snapshot: null, events: [], error: '账号已变化，请重新登录' })
      return
    }
    const events = new Map(this.current.events.map((e) => [e.seq, e]))
    for (const event of page.events) events.set(event.seq, event)
    this.cursor = Math.max(this.cursor, ...page.events.map((e) => e.seq))
    const snapshot =
      !this.current.snapshot || page.snapshot.revision >= this.current.snapshot.revision
        ? page.snapshot
        : this.current.snapshot
    this.set({
      snapshot,
      events: [...events.values()].sort((a, b) => a.seq - b.seq),
      ...(initial && 'hasMore' in page ? { hasEarlier: page.hasMore } : {}),
    })
  }
  private async connect() {
    if (this.stopped || this.connecting || this.socket?.readyState === WebSocket.OPEN) return
    this.connecting = true
    const controller = new AbortController()
    this.controller = controller
    this.set({ status: 'connecting' })
    try {
      if (!this.current.snapshot) {
        const page = await roomRequest<RoomPage>(this.path(), undefined, controller.signal)
        if (this.stopped || controller.signal.aborted) return
        this.accept(page, true)
      }
      if (this.stopped || controller.signal.aborted) return
      if (this.current.snapshot?.members.find((m) => m.uid === this.owner)?.seat === 'removed') {
        this.set({ status: 'removed' })
        return
      }
      const { ticket } = await roomRequest<{ ticket: string }>(
        this.path('/ticket'),
        {},
        controller.signal,
      )
      if (this.stopped || controller.signal.aborted) return
      const url = new URL(this.path(`/ws?after=${this.cursor}`), location.origin)
      url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
      const ws = new WebSocket(url, ['soup-room-v1', `ticket.${ticket}`])
      this.socket = ws
      ws.onopen = () => {
        if (this.stopped || this.socket !== ws) {
          ws.close()
          return
        }
        this.lastMessageAt = Date.now()
        clearInterval(this.heartbeat)
        this.heartbeat = setInterval(() => {
          if (Date.now() - this.lastMessageAt > 60_000) {
            this.socket = null
            ws.close()
            clearInterval(this.heartbeat)
            this.retryLater()
            return
          }
          if (ws.readyState === WebSocket.OPEN) ws.send('ping')
        }, 25_000)
      }
      ws.onmessage = (event) => {
        if (this.stopped || this.socket !== ws) return
        this.lastMessageAt = Date.now()
        if (event.data === 'pong') return
        try {
          const message = JSON.parse(String(event.data)) as RoomServerMessage
          if (message.type === 'snapshot' || message.type === 'update') {
            this.accept(message)
            // A cookie can change between the HTTP read and the handshake. Verify
            // the socket's account before replaying this account's pending commands.
            if (this.stopped || this.socket !== ws) return
            if (this.current.status !== 'online') {
              this.attempt = 0
              this.set({ status: 'online', error: null })
              for (const item of this.pending) ws.send(JSON.stringify(item.command))
            }
          } else if (message.type === 'ack' || message.type === 'error') {
            if (message.type === 'error' && message.terminal) {
              this.terminal(message.terminal)
              return
            }
            if (message.commandId) {
              if (message.type === 'error')
                this.set({
                  rejected: this.pending.find((p) => p.command.commandId === message.commandId)
                    ?.command,
                })
              this.pending = this.pending.filter((p) => p.command.commandId !== message.commandId)
              this.persist()
            }
            if (message.type === 'error') this.set({ error: message.error })
          }
        } catch {
          this.set({ error: '收到的同桌记录无法读取，请重新连接' })
        }
      }
      ws.onerror = () => {
        /* close drives reconnect; errors do not discard pending commands */
      }
      ws.onclose = (e) => {
        if (this.stopped || this.socket !== ws) return
        this.socket = null
        clearInterval(this.heartbeat)
        if (e.code === 4001 || e.code === 4003) {
          this.terminal(e.code === 4001 ? 'auth' : 'removed')
          return
        }
        this.retryLater()
      }
    } catch (error) {
      if (this.stopped || controller.signal.aborted) return
      if (error instanceof RoomError && error.status === 401) this.terminal('auth')
      else if (error instanceof RoomError && [403, 404].includes(error.status))
        this.set({ status: error.status === 401 ? 'auth' : 'error', error: error.message })
      else this.retryLater()
    } finally {
      if (this.controller === controller) this.connecting = false
    }
  }
  private terminal(kind: 'auth' | 'removed') {
    const ws = this.socket
    this.socket = null
    ws?.close(1000)
    clearInterval(this.heartbeat)
    clearTimeout(this.reconnectTimer)
    if (kind === 'removed') {
      this.pending = []
      try {
        this.persist()
      } catch {
        /* old operations still cannot pass membership checks */
      }
    }
    this.set({
      status: kind,
      snapshot: null,
      events: [],
      error: kind === 'auth' ? '登录已过期，请重新登录' : '你已被移出这一桌',
    })
    if (kind === 'auth') window.dispatchEvent(new Event('turtle-soup:auth-check'))
    if (kind === 'removed')
      void roomRequest<RoomPage>(this.path())
        .then((p) => {
          if (!this.stopped) this.accept(p, true)
        })
        .catch(() => undefined)
  }
  private retryLater() {
    this.set({ status: 'offline' })
    clearTimeout(this.reconnectTimer)
    this.reconnectTimer = setTimeout(
      () => void this.connect(),
      Math.min(30_000, 3000 * 2 ** this.attempt++),
    )
  }
  send(action: RoomAction) {
    if (this.current.status !== 'online' || this.socket?.readyState !== WebSocket.OPEN)
      throw new Error('连接恢复后再发送，内容可以先留在输入框')
    if (this.pending.length >= 12) throw new Error('请等前面的操作确认后再试')
    const command = roomCommandSchema.parse({ ...action, commandId: crypto.randomUUID() })
    this.pending.push({ at: Date.now(), command })
    try {
      this.persist()
    } catch {
      this.pending.pop()
      throw new Error('无法保存待确认操作，请检查浏览器存储空间')
    }
    this.socket.send(JSON.stringify(command))
  }
  async earlier() {
    const first = this.current.events[0]?.seq
    if (!first) return
    const page = await roomRequest<RoomPage>(this.path(`/events?before=${first}`))
    if (this.stopped) return
    this.accept(page)
    this.set({ hasEarlier: page.hasMore })
  }
}
