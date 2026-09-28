import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import { build } from 'esbuild'
import {
  Miniflare,
  convertV4MiniflareOptions,
  Response as MFResponse,
  type WebSocket as MFSocket,
} from 'miniflare'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSession } from '../shared/auth'
import { createRoom, joinRoom as joinState, roomCommand } from '../shared/room-engine'
import { projectRoom, teamRecords, listMyRooms } from '../shared/room-store'
import type { D1Like } from '../shared/auth'
import type { RoomSnapshot, RoomServerMessage } from '../shared/room-protocol'

const secret = 'isolated-room-runtime-tests'
const host = 'https://hgt.mmstudio.games'
let mf: Miniflare
let persist: string
let modelCalls = 0
let modelMode: 'answer' | 'reveal' | 'solve' | 'hold' = 'answer'
let releaseModel: (() => void) | undefined
const modelRequests: Record<string, unknown>[] = []
const tokens: Record<string, string> = {}
const sockets: MFSocket[] = []

async function request(
  path: string,
  uid = 'alice',
  body?: unknown,
  extra?: Record<string, string>,
) {
  return mf.dispatchFetch(host + path, {
    method: body === undefined ? 'GET' : 'POST',
    redirect: 'manual',
    headers: {
      cookie: `ts_session=${tokens[uid] ?? ''}`,
      origin: host,
      ...(body === undefined ? {} : { 'content-type': 'application/json', 'x-room-protocol': '1' }),
      ...extra,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}
async function json<T>(path: string, uid = 'alice', body?: unknown): Promise<T> {
  const r = await request(path, uid, body)
  const value = await r.json()
  expect(r.status, JSON.stringify(value)).toBeLessThan(300)
  return value as T
}
async function create(puzzleId = 'public', uid = 'alice') {
  return json<RoomSnapshot>('/api/rooms', uid, { puzzleId, requestId: crypto.randomUUID() })
}
async function joinRoom(s: RoomSnapshot, uid: string) {
  return json<RoomSnapshot>('/api/rooms/join', uid, { code: s.inviteCode })
}
async function socket(roomId: string, uid: string, after = 0) {
  const { ticket } = await json<{ ticket: string }>(`/api/rooms/${roomId}/ticket`, uid, {})
  const r = await request(`/api/rooms/${roomId}/ws?after=${after}`, uid, undefined, {
    upgrade: 'websocket',
    'sec-websocket-protocol': `soup-room-v1, ticket.${ticket}`,
  })
  expect(r.status).toBe(101)
  const ws = r.webSocket!
  const messages: RoomServerMessage[] = []
  ws.addEventListener('message', (e) => {
    if (e.data !== 'pong') {
      const message = JSON.parse(String(e.data))
      messages.push(message)
      if (message.terminal) ws.close(1000)
    }
  })
  let closed = 0
  ws.addEventListener('close', (e) => {
    closed = e.code
  })
  ws.accept()
  sockets.push(ws)
  return {
    ws,
    messages,
    ticket,
    closed: () => closed,
    send: (c: Record<string, unknown>) => {
      const cmd = { commandId: crypto.randomUUID(), ...c }
      ws.send(JSON.stringify(cmd))
      return cmd
    },
  }
}
async function until<T>(get: () => T | undefined | false, timeout = 6000): Promise<T> {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const value = get()
    if (value) return value
    await new Promise((r) => setTimeout(r, 15))
  }
  throw new Error('Timed out waiting for room state')
}
function latest(c: Awaited<ReturnType<typeof socket>>): RoomSnapshot | undefined {
  return c.messages.filter((m) => m.type === 'snapshot' || m.type === 'update').at(-1)?.snapshot
}
async function playing(uid = 'alice', other = 'bob') {
  const room = await create('public', uid)
  await joinRoom(room, other)
  const a = await socket(room.roomId, uid)
  const b = await socket(room.roomId, other)
  await until(() => latest(a)?.members.filter((m) => m.disconnectedAt === null).length === 2)
  a.send({ type: 'start' })
  await until(() => latest(a)?.phase === 'playing' && latest(b)?.phase === 'playing')
  return { room, a, b }
}

beforeAll(async () => {
  const output = await build({
    entryPoints: ['tests/fixtures/room-worker.ts'],
    bundle: true,
    write: false,
    format: 'esm',
    target: 'es2023',
    platform: 'neutral',
    conditions: ['workerd', 'browser'],
    external: ['cloudflare:workers'],
  })
  persist = await mkdtemp(join(tmpdir(), 'soup-room-test-'))
  mf = new Miniflare(
    convertV4MiniflareOptions({
      name: 'room-tests',
      modules: true,
      script: output.outputFiles[0].text,
      compatibilityDate: '2026-09-20',
      durableObjects: {
        ROOMS: { className: 'SoupRoom', useSQLite: true },
        ROOM_LIMITS: { className: 'RoomLimit', useSQLite: true },
      },
      durableObjectsPersist: join(persist, 'do'),
      d1Databases: ['DB', 'LEGACY_DB'],
      kvNamespaces: ['AUTH_KV'],
      d1Persist: join(persist, 'd1'),
      kvPersist: join(persist, 'kv'),
      bindings: {
        AUTH_SECRET: secret,
        ROOMS_ENABLED: '1',
        TYPESAFE_API_KEY: 'isolated-fake-model',
      },
      outboundService: async (req) => {
        if (!req.url.startsWith('https://api.typesafe.ai/'))
          throw new Error('Unexpected external request')
        modelCalls++
        modelRequests.push((await req.json()) as Record<string, unknown>)
        const mode = modelMode
        if (mode === 'hold')
          await new Promise<void>((resolve) => {
            releaseModel = resolve
          })
        const intent = mode === 'reveal' ? 'meta' : mode === 'solve' ? 'guess' : 'yes_no_question'
        const choice = (choice: string) => ({
          choice,
          confidence: 1,
          probabilities: { [choice]: 1 },
        })
        return MFResponse.json({
          model: 'isolated-test',
          answers: {
            intent: choice(intent),
            verdict: choice('yes'),
            motive_correct: { noul: 1 },
            method_correct: { noul: 1 },
            twist_correct: { noul: 1 },
            solved: { noul: mode === 'solve' ? 1 : 0 },
            meta_request: choice(mode === 'reveal' ? 'full_answer' : 'none'),
          },
        })
      },
    }),
  )
  const db = await mf.getD1Database('DB')
  const schema = (await readFile('db/schema.sql', 'utf8')).replace(/--[^\n]*/g, '')
  for (const statement of schema.split(';').filter((s) => s.trim()))
    await db.prepare(statement).run()
  const kv = await mf.getKVNamespace('AUTH_KV')
  for (const uid of ['alice', 'bob', 'carol', 'dave', 'erin', 'frank', 'mallory']) {
    await db
      .prepare('INSERT INTO users(id,email,display_name,created_at) VALUES(?,?,?,?)')
      .bind(uid, `${uid}@example.test`, uid, Date.now())
      .run()
    tokens[uid] = await createSession(kv, secret, { id: uid, email: `${uid}@example.test` })
  }
  for (const visibility of ['public', 'private', 'daily']) {
    await db
      .prepare(
        'INSERT INTO puzzles(id,owner_id,title,surface,truth,hint,visibility,created_at) VALUES(?,?,?,?,?,?,?,?)',
      )
      .bind(
        visibility,
        'author',
        'Runtime soup',
        'Only the surface',
        'PRIVATE_TRUTH_CANARY',
        'PRIVATE_HINT_CANARY',
        visibility,
        Date.now(),
      )
      .run()
  }
}, 30_000)
afterAll(async () => {
  releaseModel?.()
  for (const ws of sockets) {
    try {
      ws.close()
    } catch {
      /* already closed */
    }
  }
  await mf?.dispose()
  if (persist) await rm(persist, { recursive: true, force: true })
})

describe('room Worker and real WebSockets', { timeout: 15000 }, () => {
  it('requires auth, same origin and JSON protocol; excludes private/future puzzles', async () => {
    expect((await request('/api/rooms', 'nobody', {})).status).toBe(401)
    expect(
      (await request('/api/rooms', 'alice', {}, { origin: 'https://attacker.test' })).status,
    ).toBe(403)
    expect(
      (await request('/api/rooms', 'alice', {}, { 'content-type': 'text/plain' })).status,
    ).toBe(415)
    for (const puzzleId of ['private', 'daily'])
      expect(
        (await request('/api/rooms', 'alice', { puzzleId, requestId: crypto.randomUUID() })).status,
      ).toBe(404)
    const r = await request('/api/rooms/config', 'alice', undefined, {
      'x-forwarded-proto': 'http',
    })
    expect(r.status).toBe(308)
  })
  it('creates idempotently, consumes session-bound tickets once and rejects outsiders', async () => {
    const body = { puzzleId: 'public', requestId: crypto.randomUUID() }
    const s = await json<RoomSnapshot>('/api/rooms', 'alice', body)
    const again = await json<RoomSnapshot>('/api/rooms', 'alice', body)
    expect(again.roomId).toBe(s.roomId)
    expect(again.inviteCode).toBe(s.inviteCode)
    expect(JSON.stringify(s)).not.toContain('PRIVATE_')
    expect((await request(`/api/rooms/${s.roomId}`, 'mallory')).status).toBe(404)
    expect((await request(`/api/rooms/${s.roomId}/ticket`, 'mallory', {})).status).toBe(403)
    const a = await socket(s.roomId, 'alice')
    const replay = await request(`/api/rooms/${s.roomId}/ws`, 'alice', undefined, {
      upgrade: 'websocket',
      'sec-websocket-protocol': `soup-room-v1,ticket.${a.ticket}`,
    })
    expect(replay.status).toBe(401)
    const { ticket } = await json<{ ticket: string }>(`/api/rooms/${s.roomId}/ticket`, 'alice', {})
    const stolen = await request(`/api/rooms/${s.roomId}/ws`, 'mallory', undefined, {
      upgrade: 'websocket',
      'sec-websocket-protocol': `soup-room-v1,ticket.${ticket}`,
    })
    expect(stolen.status).toBe(401)
  })
  it('serializes simultaneous questions, deduplicates commands and keeps discussion out of Jev', async () => {
    const { room, a, b } = await playing('bob', 'carol')
    const before = modelCalls
    const chat = b.send({ type: 'discuss', text: 'CHAT_MUST_NOT_REACH_JEV' })
    await until(() =>
      a.messages.some((m) => 'events' in m && m.events.some((e) => e.text === chat.text)),
    )
    expect(modelCalls).toBe(before)
    const q = a.send({ type: 'ask', text: 'Is it a person?', locale: 'en' })
    a.ws.send(JSON.stringify(q))
    b.send({ type: 'ask', text: 'Did it happen indoors?', locale: 'en', commandId: q.commandId })
    await until(() => latest(a)?.turns === 2)
    expect(modelCalls).toBe(before + 2)
    expect(JSON.stringify(modelRequests.slice(before))).not.toContain('CHAT_MUST_NOT_REACH_JEV')
    const page = await json<{
      snapshot: RoomSnapshot
      events: { type: string; questionId?: string }[]
    }>(`/api/rooms/${room.roomId}`, 'bob')
    const questions = page.events.filter((e) => e.type === 'question')
    expect(new Set(questions.map((e) => e.questionId)).size).toBe(2)
    expect(JSON.stringify(a.messages)).not.toContain('PRIVATE_')
    a.ws.send(JSON.stringify({ ...q, text: 'mutated replay' }))
    await until(() => a.messages.some((m) => m.type === 'error' && m.status === 409))
    const db = await mf.getD1Database('DB')
    const rooms = await mf.getDurableObjectNamespace('ROOMS')
    await rooms.get(rooms.idFromName(room.roomId)).flushForTest()
    expect(
      (
        await db
          .prepare('SELECT count(*) AS n FROM turn_logs WHERE room_id=?')
          .bind(room.roomId)
          .first<{ n: number }>()
      )?.n,
    ).toBe(2)
    expect(
      (
        await db
          .prepare('SELECT count(*) AS n FROM attempts WHERE puzzle_id=?')
          .bind('public')
          .first<{ n: number }>()
      )?.n,
    ).toBe(0)
  })
  it('allows concurrent device tickets for one member without revoking each other', async () => {
    const room = await create('public', 'mallory')
    const one = await json<{ ticket: string }>(`/api/rooms/${room.roomId}/ticket`, 'mallory', {})
    const two = await json<{ ticket: string }>(`/api/rooms/${room.roomId}/ticket`, 'mallory', {})
    for (const { ticket } of [one, two]) {
      const r = await request(`/api/rooms/${room.roomId}/ws`, 'mallory', undefined, {
        upgrade: 'websocket',
        'sec-websocket-protocol': `soup-room-v1,ticket.${ticket}`,
      })
      expect(r.status).toBe(101)
      r.webSocket!.accept()
      sockets.push(r.webSocket!)
    }
  })
  it('requires a unanimous vote even for an explicit text request, then records consent once', async () => {
    const { room, a, b } = await playing('carol', 'dave')
    modelMode = 'reveal'
    a.send({ type: 'ask', text: 'Please show the full answer', locale: 'en' })
    await until(() => latest(b)?.vote)
    expect(JSON.stringify(a.messages)).not.toContain('PRIVATE_')
    b.send({ type: 'vote', voteId: latest(b)!.vote!.id, agree: true })
    await until(() => latest(a)?.phase === 'revealed')
    expect(latest(a)?.report?.truth).toBe('PRIVATE_TRUTH_CANARY')
    await until(() => a.closed() === 1000 && b.closed() === 1000)
    expect((await request(`/api/rooms/${room.roomId}/ticket`, 'carol', {})).status).toBe(403)
    const rooms = await mf.getDurableObjectNamespace('ROOMS')
    await rooms.get(rooms.idFromName(room.roomId)).flushForTest()
    expect(await rooms.get(rooms.idFromName(room.roomId)).alarmForTest()).toBeNull()
    const archive = await json<{ snapshot: RoomSnapshot }>(`/api/rooms/${room.roomId}`, 'carol')
    expect(archive.snapshot.report?.truth).toBe('PRIVATE_TRUTH_CANARY')
    expect(archive.snapshot.revision).toBe(latest(a)?.revision)
    const db = await mf.getD1Database('DB')
    expect(
      (await db.prepare('SELECT count(*) AS n FROM manual_reveals').first<{ n: number }>())?.n,
    ).toBe(2)
    modelMode = 'answer'
  })
  it('disconnects every device on leave, keeps the archive and requires a rejoin before a new socket', async () => {
    const { room, a, b } = await playing('alice', 'bob')
    const revision = latest(a)!.revision
    const other = await socket(room.roomId, 'alice')
    await until(() => latest(other))
    expect(latest(other)?.revision).toBe(revision)
    const { ticket } = await json<{ ticket: string }>(
      `/api/rooms/${room.roomId}/ticket`,
      'alice',
      {},
    )
    const rooms = await mf.getDurableObjectNamespace('ROOMS')
    const stub = rooms.get(rooms.idFromName(room.roomId))
    await stub.historyForTest(230)
    const late = await socket(room.roomId, 'alice')
    await until(() =>
      late.messages.some((m) => 'events' in m && m.events.some((e) => e.text === 'History 229')),
    )
    expect(latest(late)?.revision).toBe(revision + 1)
    a.send({ type: 'leave' })
    await until(() => a.closed() === 1000 && latest(other)?.readOnly && latest(late)?.readOnly)
    expect(await stub.openSocketsForTest('alice')).toBe(0)
    // Finish the close handshake on the second test peer, just as the clients do
    // after consuming the last read-only page (workerd has already closed its side).
    other.ws.close(1000)
    late.ws.close(1000)
    expect(latest(a)?.members.find((m) => m.uid === 'alice')?.seat).toBe('left')
    expect(
      a.messages
        .flatMap((m) => ('events' in m ? m.events : []))
        .some((e) => e.text === 'History 229'),
    ).toBe(true)
    expect(a.messages.some((m) => m.type === 'update' && m.hasMore)).toBe(true)
    expect(b.closed()).toBe(0)
    expect((await request(`/api/rooms/${room.roomId}/ticket`, 'alice', {})).status).toBe(403)
    const stale = await request(`/api/rooms/${room.roomId}/ws`, 'alice', undefined, {
      upgrade: 'websocket',
      'sec-websocket-protocol': `soup-room-v1,ticket.${ticket}`,
    })
    expect(stale.status).toBe(403)
    const archive = await json<{ snapshot: RoomSnapshot }>(`/api/rooms/${room.roomId}`, 'alice')
    expect(archive.snapshot.readOnly).toBe(true)
    expect(archive.snapshot.revision).toBe(latest(a)?.revision)
    expect(archive.snapshot.hostId).toBe('bob')
    await joinRoom(room, 'alice')
    const rejoined = await socket(room.roomId, 'alice')
    await until(() => latest(rejoined)?.readOnly === false)
  })
  it('fences a late answer after its lease expires and requires an explicit retry', async () => {
    const { room, a } = await playing('dave', 'erin')
    modelMode = 'hold'
    const before = modelCalls
    a.send({ type: 'ask', text: 'Hold this answer', locale: 'en' })
    await until(() => modelCalls === before + 1 && releaseModel)
    const rooms = await mf.getDurableObjectNamespace('ROOMS')
    await rooms.get(rooms.idFromName(room.roomId)).expireLeaseForTest()
    await until(() => latest(a)?.failed.length === 1)
    releaseModel!()
    releaseModel = undefined
    await new Promise((r) => setTimeout(r, 100))
    expect(latest(a)?.turns).toBe(0)
    expect(modelCalls).toBe(before + 1)
    modelMode = 'answer'
    a.send({ type: 'retry', questionId: latest(a)!.failed[0].id })
    await until(() => latest(a)?.turns === 1)
    expect(modelCalls).toBe(before + 2)
  })
  it('cuts off kicked users and invalidates logged-out sockets before broadcasting', async () => {
    const { room, a, b } = await playing('erin', 'frank')
    await joinRoom(room, 'mallory')
    const c = await socket(room.roomId, 'mallory')
    await until(() => latest(a)?.members.length === 3)
    a.send({ type: 'kick', uid: 'mallory' })
    await until(() => c.messages.some((m) => m.type === 'error' && m.terminal === 'removed'))
    const cutoff = await json<{ snapshot: RoomSnapshot; events: unknown[] }>(
      `/api/rooms/${room.roomId}`,
      'mallory',
    )
    expect(cutoff.snapshot.inviteCode).toBeUndefined()
    expect((await request('/api/rooms/join', 'mallory', { code: room.inviteCode })).status).toBe(
      403,
    )
    const tokenPayload = JSON.parse(Buffer.from(tokens.frank.split('.')[0], 'base64url').toString())
    await (await mf.getKVNamespace('AUTH_KV')).delete(`sess:${tokenPayload.sid}`)
    a.send({ type: 'discuss', text: 'Only current members may receive this' })
    await until(() => b.messages.some((m) => m.type === 'error' && m.terminal === 'auth'))
    expect(JSON.stringify(b.messages)).not.toContain('Only current members may receive this')
    const later = await json<{ snapshot: RoomSnapshot; events: unknown[] }>(
      `/api/rooms/${room.roomId}`,
      'mallory',
    )
    expect(later).toEqual(cutoff)
  })
  it('rejects expired tickets, forged commands, cross-room references and oversized frames', async () => {
    const { room, a } = await playing('bob', 'alice')
    const before = modelCalls
    const rooms = await mf.getDurableObjectNamespace('ROOMS')
    const stub = rooms.get(rooms.idFromName(room.roomId))
    const { ticket } = await json<{ ticket: string }>(`/api/rooms/${room.roomId}/ticket`, 'bob', {})
    await stub.expireTicketsForTest()
    expect(
      (
        await request(`/api/rooms/${room.roomId}/ws`, 'bob', undefined, {
          upgrade: 'websocket',
          'sec-websocket-protocol': `soup-room-v1,ticket.${ticket}`,
        })
      ).status,
    ).toBe(401)
    a.send({ type: 'ask', text: 'Forged', locale: 'en', uid: 'alice', solved: true })
    await until(() => a.messages.some((m) => m.type === 'error' && m.status === 400))
    a.send({
      type: 'ask',
      text: 'Foreign reference',
      locale: 'en',
      referenceId: crypto.randomUUID(),
    })
    await until(() => a.messages.filter((m) => m.type === 'error' && m.status === 400).length === 2)
    a.ws.send('x'.repeat(9000))
    await until(() => a.messages.some((m) => m.type === 'error' && m.status === 413))
    expect(modelCalls).toBe(before)
  })
  it('recovers SQLite state and event cursors after process loss without calling Jev again', async () => {
    const { room, a, b } = await playing('carol', 'erin')
    a.send({ type: 'ask', text: 'A persisted question', locale: 'en' })
    await until(() => latest(a)?.turns === 1)
    const seq = latest(a)!.eventSeq
    const before = modelCalls
    const rooms = await mf.getDurableObjectNamespace('ROOMS')
    const stub = rooms.get(rooms.idFromName(room.roomId))
    await stub.flushForTest()
    a.ws.close()
    b.ws.close()
    await stub.abortForTest().catch(() => undefined)
    const resumed = await socket(room.roomId, 'carol', seq)
    resumed.send({ type: 'discuss', text: 'After recovery' })
    await until(() =>
      resumed.messages.some(
        (m) => 'events' in m && m.events.some((e) => e.text === 'After recovery'),
      ),
    )
    const page = await json<{ snapshot: RoomSnapshot; events: { seq: number; text: string }[] }>(
      `/api/rooms/${room.roomId}/events?after=${seq}`,
      'carol',
    )
    expect(page.snapshot.turns).toBe(1)
    expect(page.events.every((e) => e.seq > seq)).toBe(true)
    expect(page.events.some((e) => e.text === 'After recovery')).toBe(true)
    expect(modelCalls).toBe(before)
    await rooms.get(rooms.idFromName(room.roomId)).historyForTest(230)
    const recent = await json<{ events: { seq: number }[]; hasMore: boolean }>(
      `/api/rooms/${room.roomId}`,
      'carol',
    )
    const earlier = await json<{ events: { seq: number }[]; hasMore: boolean }>(
      `/api/rooms/${room.roomId}/events?before=${recent.events[0].seq}`,
      'carol',
    )
    expect(recent.events).toHaveLength(100)
    expect(recent.hasMore).toBe(true)
    expect(earlier.events).toHaveLength(100)
    expect(earlier.events.at(-1)!.seq).toBe(recent.events[0].seq - 1)
  })
  it('retries the D1 outbox after an outage while retaining the answer and a single model call', async () => {
    const { room, a } = await playing('dave', 'bob')
    const db = await mf.getD1Database('DB')
    const rooms = await mf.getDurableObjectNamespace('ROOMS')
    await db.prepare('ALTER TABLE turn_logs RENAME TO unavailable_turn_logs').run()
    const before = modelCalls
    try {
      a.send({ type: 'ask', text: 'The index is offline', locale: 'en' })
      await until(() => latest(a)?.turns === 1)
      await rooms.get(rooms.idFromName(room.roomId)).flushForTest()
    } finally {
      await db.prepare('ALTER TABLE unavailable_turn_logs RENAME TO turn_logs').run()
    }
    await rooms.get(rooms.idFromName(room.roomId)).flushForTest()
    expect(
      (
        await db
          .prepare('SELECT count(*) AS n FROM turn_logs WHERE room_id=?')
          .bind(room.roomId)
          .first<{ n: number }>()
      )?.n,
    ).toBe(1)
    expect(modelCalls).toBe(before + 1)
  })
  it('projects team records separately, excludes author participation and deduplicates reveal consent', async () => {
    const db = (await mf.getD1Database('DB')) as unknown as D1Like
    const now = Date.now()
    const puzzle = {
      id: 'stats-only',
      ownerId: 'author',
      title: 'Stats',
      surface: 'Surface',
      truth: 'Secret',
      hint: '',
      difficulty: '中等',
    }
    const actor = { uid: 'alice', name: 'Alice', handle: 'alice' }
    for (const [turns, phase, author] of [
      [4, 'solved', false],
      [19, 'solved', false],
      [1, 'solved', true],
      [99, 'revealed', false],
      [50, 'playing', false],
    ] as const) {
      const state = createRoom(crypto.randomUUID(), crypto.randomUUID(), puzzle, actor, now).state
      state.phase = phase
      state.turns = turns
      state.authorParticipated = author
      state.revision = 3
      await projectRoom(db, state)
      const stale = structuredClone(state)
      stale.revision = 2
      stale.turns = 999
      await projectRoom(db, stale)
    }
    expect(await teamRecords(db, 'stats-only')).toEqual({
      shortestTeamSolveTurns: 4,
      longestTeamSolveTurns: 19,
    })
    expect(await teamRecords(db, 'unknown')).toEqual({
      shortestTeamSolveTurns: null,
      longestTeamSolveTurns: null,
    })
    const reveal = createRoom(crypto.randomUUID(), crypto.randomUUID(), puzzle, actor, now).state
    reveal.phase = 'revealed'
    reveal.finishedAt = now
    reveal.revealVoters = ['alice', 'bob', 'author']
    reveal.revision = 1
    await projectRoom(db, reveal)
    await projectRoom(db, reveal)
    expect(
      (
        await db
          .prepare('SELECT count(*) AS n FROM manual_reveals WHERE puzzle_id=?')
          .bind(puzzle.id)
          .first<{ n: number }>()
      )?.n,
    ).toBe(2)
    expect(
      (
        await db
          .prepare('SELECT count(*) AS n FROM attempts WHERE puzzle_id=?')
          .bind(puzzle.id)
          .first<{ n: number }>()
      )?.n,
    ).toBe(0)
  })
  it('keeps a removed member’s archive listing frozen while the remaining table continues', async () => {
    const db = (await mf.getD1Database('DB')) as unknown as D1Like
    const now = Date.now(),
      actor = { uid: 'alice', name: 'Alice', handle: 'alice' }
    let state = createRoom(
      crypto.randomUUID(),
      crypto.randomUUID(),
      {
        id: 'cutoff-only',
        ownerId: 'author',
        title: 'Cutoff',
        surface: 'Surface',
        truth: 'Secret',
        hint: '',
        difficulty: '中等',
      },
      actor,
      now,
    ).state
    state = joinState(state, { uid: 'mallory', name: 'M', handle: 'm' }, now).state
    state.turns = 3
    state = roomCommand(
      state,
      'alice',
      { commandId: crypto.randomUUID(), type: 'kick', uid: 'mallory' },
      now + 1,
    ).state
    state.revision = 1
    await projectRoom(db, state)
    const before = (await listMyRooms(db, 'mallory')).find((r) => r.roomId === state.id)
    state.phase = 'solved'
    state.turns = 13
    state.updatedAt = now + 5000
    state.revision = 2
    await projectRoom(db, state)
    expect((await listMyRooms(db, 'mallory')).find((r) => r.roomId === state.id)).toEqual(before)
    expect(before?.turns).toBe(3)
  })
  it('upgrades the pre-room database without losing existing user data', async () => {
    const db = await mf.getD1Database('LEGACY_DB')
    for (const file of ['tests/fixtures/pre-room-schema.sql', 'db/migrations/020-rooms.sql']) {
      for (const sql of (await readFile(file, 'utf8'))
        .replace(/--[^\n]*/g, '')
        .split(';')
        .filter((s) => s.trim()))
        await db.prepare(sql).run()
      if (file.endsWith('pre-room-schema.sql'))
        await db
          .prepare(
            "INSERT INTO users(id,email,created_at) VALUES('legacy','legacy@example.test',1)",
          )
          .run()
    }
    expect((await db.prepare("SELECT id FROM users WHERE id='legacy'").first())?.id).toBe('legacy')
    expect(
      (await db.prepare('PRAGMA table_info(turn_logs)').all()).results.map((c) => c.name),
    ).toContain('room_id')
    expect((await db.prepare('SELECT COUNT(*) AS n FROM rooms').first())?.n).toBe(0)
  })
})
