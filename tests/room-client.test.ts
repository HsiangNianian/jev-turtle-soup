import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { RoomConnection } from '../src/lib/room-client'
import type { RoomSnapshot } from '../shared/room-protocol'

const roomId = '2af74801-5790-440c-bdac-a97d8651a3dc'
const snapshot: RoomSnapshot = {
  protocol: 1,
  revision: 1,
  roomId,
  meId: 'alice',
  phase: 'playing',
  hostId: 'alice',
  puzzle: { id: 'p', title: 'test', surface: 'surface', difficulty: '中等' },
  createdAt: 1,
  updatedAt: 1,
  eventSeq: 0,
  turns: 0,
  members: [
    {
      uid: 'alice',
      name: 'A',
      handle: 'a',
      joinedAt: 1,
      seat: 'seated',
      disconnectedAt: null,
      questions: 0,
    },
  ],
  queue: [],
  processing: null,
  failed: [],
  vote: null,
  revealPending: false,
  invitationsOpen: true,
  readOnly: false,
}
class Socket {
  static OPEN = 1
  static sockets: Socket[] = []
  readyState = 0
  sent: string[] = []
  onopen: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: ((e: { code: number }) => void) | null = null
  onerror: (() => void) | null = null
  constructor(
    public url: string,
    public protocols: string[],
  ) {
    Socket.sockets.push(this)
  }
  open(value: RoomSnapshot | false = snapshot) {
    this.readyState = 1
    this.onopen?.()
    if (value) this.receive({ type: 'snapshot', snapshot: value, events: [] })
  }
  send(text: string) {
    this.sent.push(text)
  }
  close(code = 1000) {
    this.readyState = 3
    this.onclose?.({ code })
  }
  receive(value: unknown) {
    this.onmessage?.({ data: JSON.stringify(value) })
  }
}
let storage: Map<string, string>
const connections: RoomConnection[] = []
const make = (owner = 'alice') => {
  const c = new RoomConnection(owner, roomId)
  connections.push(c)
  return c
}
async function settle() {
  await vi.advanceTimersByTimeAsync(1)
}
beforeEach(() => {
  vi.useFakeTimers()
  storage = new Map()
  Socket.sockets = []
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => storage.set(k, v),
    removeItem: (k: string) => storage.delete(k),
  })
  vi.stubGlobal('window', new EventTarget())
  vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }))
  vi.stubGlobal('location', { origin: 'https://hgt.mmstudio.games', protocol: 'https:' })
  vi.stubGlobal('WebSocket', Socket)
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async (url: string) =>
        new Response(
          JSON.stringify(
            url.endsWith('/ticket')
              ? { ticket: 'temporary-secret' }
              : { snapshot, events: [], hasMore: false },
          ),
        ),
    ),
  )
})
afterEach(() => {
  for (const c of connections.splice(0)) c.stop()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
it('persists an unacknowledged command before send and replays its same ID after refresh', async () => {
  const first = make()
  first.start()
  await settle()
  const ws = Socket.sockets[0]
  ws.open()
  first.send({ type: 'ask', text: 'Question', locale: 'en' })
  const original = ws.sent[0]
  expect([...storage.values()][0]).toContain(JSON.parse(original).commandId)
  expect(ws.url).not.toContain('temporary-secret')
  first.stop()
  const second = make()
  second.start()
  await settle()
  const next = Socket.sockets.at(-1)!
  next.open()
  expect(next.sent).toEqual([original])
  next.receive({ type: 'ack', commandId: JSON.parse(original).commandId, eventSeq: 1 })
  expect(storage.size).toBe(0)
  expect(second.getSnapshot().pending).toBe(0)
})
it('does not send the previous account pending messages with another account cookie', async () => {
  const first = make()
  first.start()
  await settle()
  Socket.sockets[0].open()
  first.send({ type: 'discuss', text: 'Alice private draft' })
  first.stop()
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async (url: string) =>
        new Response(
          JSON.stringify(
            url.endsWith('/ticket')
              ? { ticket: 'bob-ticket' }
              : { snapshot: { ...snapshot, meId: 'bob' }, events: [], hasMore: false },
          ),
        ),
    ),
  )
  const bob = make('bob')
  bob.start()
  await settle()
  const ws = Socket.sockets.at(-1)!
  ws.open()
  expect(ws.sent).toEqual([])
  expect(JSON.stringify(bob.getSnapshot())).not.toContain('Alice private draft')
})
it('deduplicates replayed events and ignores older snapshots', async () => {
  const c = make()
  c.start()
  await settle()
  const ws = Socket.sockets[0]
  ws.open()
  const event = { id: 'e1', seq: 1, at: 1, type: 'question', actorId: 'alice', text: 'Question' }
  ws.receive({
    type: 'update',
    snapshot: { ...snapshot, revision: 3, eventSeq: 1, turns: 2 },
    events: [event],
  })
  ws.receive({
    type: 'update',
    snapshot: { ...snapshot, revision: 2, eventSeq: 1, turns: 1 },
    events: [event],
  })
  expect(c.getSnapshot().events).toEqual([event])
  expect(c.getSnapshot().snapshot?.turns).toBe(2)
})
it('closes and clears private room state on logout without waiting for a close frame', async () => {
  const c = make()
  c.start()
  await settle()
  const ws = Socket.sockets[0]
  ws.open()
  const auth = vi.fn()
  window.addEventListener('turtle-soup:auth-check', auth)
  ws.receive({ type: 'error', terminal: 'auth', status: 401, error: 'login' })
  expect(c.getSnapshot()).toMatchObject({ snapshot: null, events: [], status: 'auth' })
  expect(ws.readyState).toBe(3)
  expect(auth).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(120000)
  expect(Socket.sockets).toHaveLength(1)
})
it('survives mount cleanup while initial requests are pending', async () => {
  const c = make()
  c.start()
  c.stop()
  c.start()
  await settle()
  expect(Socket.sockets).toHaveLength(1)
  Socket.sockets[0].open()
  expect(c.getSnapshot().status).toBe('online')
})
it('restores a rejected message so it can be edited without resending it automatically', async () => {
  const c = make()
  c.start()
  await settle()
  const ws = Socket.sockets[0]
  ws.open()
  c.send({ type: 'ask', text: 'Keep this question', locale: 'en' })
  const command = JSON.parse(ws.sent[0])
  ws.receive({ type: 'error', status: 409, commandId: command.commandId, error: 'Voting' })
  expect(c.getSnapshot().rejected).toEqual(command)
  expect(c.getSnapshot().pending).toBe(0)
  expect(ws.sent).toHaveLength(1)
})

it('waits for socket identity before replaying pending commands after an account-cookie switch', async () => {
  const c = make()
  c.start()
  await settle()
  const first = Socket.sockets[0]
  first.open()
  c.send({ type: 'discuss', text: 'Private Alice command' })
  c.stop()
  c.start()
  await settle()
  const second = Socket.sockets.at(-1)!
  second.open(false)
  expect(second.sent).toEqual([])
  second.receive({ type: 'snapshot', snapshot: { ...snapshot, meId: 'bob' }, events: [] })
  expect(second.sent).toEqual([])
  expect(c.getSnapshot()).toMatchObject({ status: 'auth', snapshot: null, events: [] })
})
