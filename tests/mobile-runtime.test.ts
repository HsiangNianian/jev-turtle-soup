import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import type { HostTurn } from '../packages/client-core/src/types'
import type { LibraryPuzzle, TokenSession } from '../packages/client-core/src/public-types'
import { beginTurn, newGame } from '../packages/client-core/src/game'

const native = vi.hoisted(() => ({
  kv: new Map<string, string>(),
  databases: new Map<string, DatabaseSync>(),
  credentials: null as string | null,
  get: vi.fn(),
  set: vi.fn(),
  remove: vi.fn(),
}))
vi.mock('expo-crypto', () => ({ randomUUID: () => crypto.randomUUID() }))
vi.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'zh' }] }))
vi.mock('expo-secure-store', () => ({
  getItemAsync: native.get,
  setItemAsync: native.set,
  deleteItemAsync: native.remove,
}))
vi.mock('expo-sqlite/kv-store', () => ({
  default: {
    getItemSync: (key: string) => native.kv.get(key) ?? null,
    setItemSync: (key: string, value: string) => native.kv.set(key, value),
  },
}))
vi.mock('expo-sqlite', async () => {
  const { DatabaseSync } = await import('node:sqlite')
  return {
    openDatabaseSync: (name: string) => {
      if (!native.databases.has(name)) native.databases.set(name, new DatabaseSync(':memory:'))
      const db = native.databases.get(name)!
      return {
        execSync: (sql: string) => db.exec(sql),
        runSync: (sql: string, params: (string | number | null)[]) =>
          db.prepare(sql).run(...params),
        getAllSync: (sql: string, params: (string | number | null)[]) =>
          db.prepare(sql).all(...params),
      }
    },
  }
})
import { NativeRuntime } from '../mobile/src/platform/runtime'

const session = (uid: string): TokenSession => ({
  user: { uid, email: `${uid}@test.example` },
  token: `token-${uid}`,
  expiresAt: Date.now() + 100000,
})
const puzzle: LibraryPuzzle = {
  id: 'library-one',
  title: 'case',
  surface: 'surface',
  difficulty: '普通',
  tags: [],
  plays: 0,
  solves: 0,
  createdAt: 0,
  genreScore: 50,
  owner: { handle: 'author', displayName: 'Author' },
  official: false,
  featured: false,
}
const runtimes: NativeRuntime[] = []
const runtime = () => {
  const instance = new NativeRuntime()
  runtimes.push(instance)
  return instance
}
const deferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
const turn = {
  solved: false,
  revealed: false,
  reply: 'yes',
  verdict: 'yes',
  closeness: 10,
  replyLocale: 'en',
  debug: {},
} as HostTurn
beforeEach(() => {
  vi.useFakeTimers()
  native.kv.clear()
  native.credentials = null
  native.get.mockReset().mockImplementation(async () => native.credentials)
  native.set.mockReset().mockImplementation(async (_key: string, value: string) => {
    native.credentials = value
  })
  native.remove.mockReset().mockImplementation(async () => {
    native.credentials = null
  })
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(async () => Response.json({ ok: true, items: [] })),
  )
})
afterEach(() => {
  for (const instance of runtimes.splice(0)) instance.sync.dispose()
  for (const db of native.databases.values()) db.close()
  native.databases.clear()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

it('restores an interrupted account save offline without uploading until identity is verified', async () => {
  const initial = runtime()
  const game = beginTurn(
    newGame(puzzle, '', () => crypto.randomUUID()),
    'why',
    () => crypto.randomUUID(),
  )
  initial.store.save('A', [game])
  native.credentials = JSON.stringify(session('A'))
  const next = runtime()
  vi.spyOn(next.api, 'me').mockRejectedValue(new Error('offline'))
  const put = vi.spyOn(next.api, 'putSave')
  await next.start()
  await vi.advanceTimersByTimeAsync(5000)
  expect(next.owner).toBe('A')
  expect(next.confirmed).toBe(false)
  expect(next.game(game.id)?.pendingAsk?.state).toBe('interrupted')
  expect(put).not.toHaveBeenCalled()
})

it('keeps a late answer in its old account after logout and leaves a new guest case untouched', async () => {
  const app = runtime()
  await app.start()
  vi.spyOn(app.api, 'verifyCode').mockResolvedValue(session('A'))
  await app.login('A@test.example', '123456')
  const id = app.startGame(puzzle)
  const answer = deferred<HostTurn>()
  vi.spyOn(app.api, 'ask').mockReturnValue(answer.promise)
  const sending = app.send(id, 'why')
  await app.logout()
  const guest = app.startGame(puzzle)
  answer.resolve(turn)
  await sending
  expect(app.owner).toBeNull()
  expect(app.game(guest)?.turnCount).toBe(0)
  const old = app.store.space('A').games.find((game) => game.id === id)!
  expect(old.messages.filter((message) => message.role === 'player')).toHaveLength(1)
  expect(old.pendingAsk?.state).toBe('interrupted')
  expect(old.messages.at(-1)?.role).toBe('player')
})

it('does not resurrect a session when logout races a secure credential write', async () => {
  const app = runtime()
  await app.start()
  vi.spyOn(app.api, 'verifyCode').mockResolvedValue(session('A'))
  const writing = deferred<void>()
  const entered = deferred<void>()
  native.set.mockImplementation(async (_key: string, value: string) => {
    entered.resolve()
    await writing.promise
    native.credentials = value
  })
  const login = app.login('A@test.example', '123456')
  await entered.promise
  const logout = app.logout()
  writing.resolve()
  await Promise.all([login, logout])
  expect(native.credentials).toBeNull()
  expect(app.owner).toBeNull()
  expect(app.confirmed).toBe(false)
})

it('pauses the visible identity if secure credential deletion fails', async () => {
  const app = runtime()
  await app.start()
  vi.spyOn(app.api, 'verifyCode').mockResolvedValue(session('A'))
  await app.login('A@test.example', '123456')
  native.remove.mockRejectedValueOnce(new Error('keychain unavailable'))
  await app.logout()
  expect(app.owner).toBe('A')
  expect(app.confirmed).toBe(false)
  expect(app.authError).toBe('无法清除登录信息，请重试')
})

it('turns cloud-imported sending state into a manual retry, and can recover missing solved truth', async () => {
  const app = runtime()
  await app.start()
  vi.spyOn(app.api, 'verifyCode').mockResolvedValue(session('A'))
  await app.login('A@test.example', '123456')
  const game = beginTurn(
    newGame(puzzle, '', () => crypto.randomUUID()),
    'why',
    () => crypto.randomUUID(),
  )
  app.store.merge('A', [game])
  expect(app.game(game.id)?.pendingAsk?.state).toBe('interrupted')
  vi.spyOn(app.api, 'ask').mockResolvedValue({ ...turn, solved: true })
  const reveal = vi
    .spyOn(app.api, 'reveal')
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue({ truth: 'solution', hint: '' })
  await app.send(game.id, '', true)
  expect(app.game(game.id)?.status).toBe('solved')
  expect(app.game(game.id)?.truth).toBeNull()
  await app.reveal(game.id)
  expect(reveal).toHaveBeenCalledTimes(2)
  expect(app.game(game.id)?.truth).toBe('solution')
  expect(app.game(game.id)?.status).toBe('solved')
})
