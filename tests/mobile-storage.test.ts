import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ArchiveStore, ARCHIVE_KEY } from '../packages/client-core/src/archive-store'
import { sqliteArchiveStorage, type SyncDatabase } from '../packages/client-core/src/sqlite-archive'
import { newGame } from '../packages/client-core/src/game'

let sqlite: DatabaseSync
let db: SyncDatabase
let store: ArchiveStore
let legacy: Map<string, string>
const game = (id: string) =>
  newGame(
    { puzzleId: id, date: '2026-09-20', title: id, surface: 'surface', difficulty: '普通' },
    '',
    () => crypto.randomUUID(),
  )
const storage = () =>
  sqliteArchiveStorage(db, {
    getItem: (key) => legacy.get(key) ?? null,
    setItem: (key, value) => {
      legacy.set(key, value)
    },
  })
const restart = () => new ArchiveStore(storage())
beforeEach(() => {
  sqlite = new DatabaseSync(':memory:')
  db = {
    execSync: (sql) => sqlite.exec(sql),
    runSync: vi.fn((sql, params) => sqlite.prepare(sql).run(...params)),
    getAllSync: <T>(sql: string, params: (string | number | null)[]) =>
      sqlite.prepare(sql).all(...params) as T[],
  }
  legacy = new Map()
  store = restart()
})
afterEach(() => sqlite.close())

it('updates one long conversation without rewriting the other 199, and restores the queue after restart', () => {
  const games = Array.from({ length: 200 }, (_, i) => ({
    ...game(`case-${i}`),
    messages: Array.from({ length: 300 }, (_, j) => ({
      id: `m-${j}`,
      role: 'player' as const,
      text: 'long message '.repeat(25),
      createdAt: j,
    })),
  }))
  expect(store.save('A', games)).toBe(true)
  vi.mocked(db.runSync).mockClear()
  const changed = games.map((value, i) =>
    i === 50 ? { ...value, draft: 'new question', updatedAt: value.updatedAt + 1 } : value,
  )
  expect(store.save('A', changed)).toBe(true)
  const writes = vi
    .mocked(db.runSync)
    .mock.calls.filter(([sql]) => sql.startsWith('INSERT INTO native_archive_games'))
  expect(writes).toHaveLength(1)
  expect(writes[0][1][1]).toBe('case-50')
  expect(restart().space('A')).toEqual(store.space('A'))
})

it('rolls back a failed guest transfer and then retries games, ownership and pending operations together', () => {
  store.save(null, [game('guest')])
  store.save('A', [game('owned')])
  const run = db.runSync
  db.runSync = (sql, params) => {
    if (sql.startsWith('INSERT INTO native_archive_meta')) throw new Error('disk full')
    return run(sql, params)
  }
  expect(store.claimGuest('A')).toBe(false)
  const disk = restart()
  expect(disk.space(null).games.map((g) => g.id)).toEqual(['guest'])
  expect(disk.space('A').games.map((g) => g.id)).toEqual(['owned'])
  db.runSync = run
  expect(store.retryStorage('A')).toBe(true)
  const recovered = restart()
  expect(recovered.space(null).games).toEqual([])
  expect(recovered.space('A').games.map((g) => g.id)).toEqual(['owned', 'guest'])
  expect(recovered.space('A').pending.map((op) => op.id)).toEqual(['owned', 'guest'])
  recovered.save(null, [game('later-guest')])
  recovered.claimGuest('B')
  expect(restart().space('B').games).toEqual([])
})

it('recovers unreadable storage without overwriting unseen records, including after a fresh adapter read', () => {
  store.save('A', [game('disk')])
  const read = db.getAllSync
  db.getAllSync = () => {
    throw new Error('temporarily unavailable')
  }
  const blocked = restart()
  expect(blocked.storageError).toBe(true)
  blocked.save('A', [game('local')])
  db.getAllSync = read
  expect(blocked.retryStorage('A')).toBe(true)
  expect(
    restart()
      .space('A')
      .games.map((g) => g.id),
  ).toEqual(['disk', 'local'])
})

it('migrates the existing KV archive and persists deletions and reordering', () => {
  sqlite.exec('DELETE FROM native_archive_meta')
  legacy.set(
    ARCHIVE_KEY,
    JSON.stringify({
      version: 2,
      spaces: { guest: { games: [game('one'), game('two'), game('three')], pending: [] } },
    }),
  )
  store = restart()
  const [one, , three] = store.space(null).games
  store.save(null, [three, one])
  expect(
    restart()
      .space(null)
      .games.map((g) => g.id),
  ).toEqual(['three', 'one'])
  expect(restart().space(null).pending).toEqual([
    expect.objectContaining({ id: 'two', kind: 'delete' }),
  ])
  expect(legacy.has(ARCHIVE_KEY)).toBe(true)
})
