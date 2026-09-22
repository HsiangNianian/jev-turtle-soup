import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ArchiveStore, ARCHIVE_KEY, LEGACY_KEY } from '../src/lib/archive-store'
import { SaveSync } from '../src/lib/save-sync'
import { SaveRequestError } from '../src/lib/save-client'
import type { ArchivedGame } from '../src/lib/archive'
import { fetchMe } from '../src/lib/auth-client'

export function game(id = 'one', updatedAt = 10): ArchivedGame {
  return {
    id,
    updatedAt,
    title: id,
    surface: 'surface',
    messages: [],
    difficulty: '中等',
    source: 'library',
    hostGreeting: '',
    hint: '',
    createdAt: 1,
    revealed: false,
    truth: null,
    solved: false,
    closeness: null,
    turnCount: 0,
    status: 'active',
  }
}
function memoryStorage() {
  const map = new Map<string, string>()
  return {
    map,
    getItem: vi.fn((key: string) => map.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      map.set(key, value)
    }),
  }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
function network() {
  const cloud = new Map<string, ArchivedGame>()
  return {
    cloud,
    listSaves: vi.fn(async () => [...cloud.values()]),
    putSave: vi.fn(async (value: ArchivedGame) => {
      cloud.set(value.id, value)
      return { ok: true }
    }),
    deleteSave: vi.fn(async (id: string) => {
      cloud.delete(id)
      return { ok: true }
    }),
  }
}
let storage: ReturnType<typeof memoryStorage>
let store: ArchiveStore
let api: ReturnType<typeof network>
let sync: SaveSync
const tick = (ms = 500) => vi.advanceTimersByTimeAsync(ms)
beforeEach(() => {
  vi.useFakeTimers()
  storage = memoryStorage()
  store = new ArchiveStore(storage)
  api = network()
  sync = new SaveSync(store, api)
})
afterEach(() => {
  sync.dispose()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('durable sync queue', () => {
  it('retries a failed upload and only then acknowledges it', async () => {
    store.save(null, [game()])
    api.putSave.mockRejectedValueOnce(new TypeError('offline'))
    sync.setUser('A', true)
    await tick()
    expect(store.space('A').pending).toHaveLength(1)
    expect(sync.getSnapshot()).toMatchObject({ status: 'offline', imported: 0 })
    await tick(1000)
    expect(api.cloud.has('one')).toBe(true)
    expect(store.space('A').pending).toHaveLength(0)
    expect(sync.getSnapshot()).toMatchObject({ status: 'synced', imported: 1 })
  })
  it('retains deletion across refresh and applies it before merging the cloud list', async () => {
    api.cloud.set('one', game())
    sync.setUser('A', true)
    await tick()
    store.save('A', [])
    api.deleteSave.mockRejectedValueOnce(new TypeError('offline'))
    await tick()
    sync.dispose()
    store = new ArchiveStore(storage)
    sync = new SaveSync(store, api)
    expect(store.space('A').pending[0].kind).toBe('delete')
    sync.setUser('A', true)
    await tick()
    expect(store.space('A').games).toEqual([])
    expect(api.cloud.size).toBe(0)
  })
  it('retries the initial list without losing local records or prematurely uploading', async () => {
    store.save('A', [game()])
    api.listSaves.mockRejectedValueOnce(new TypeError('offline'))
    sync.setUser('A', true)
    await tick(0)
    expect(api.putSave).not.toHaveBeenCalled()
    expect(store.space('A').pending).toHaveLength(1)
    await tick(1000)
    expect(api.cloud.size).toBe(1)
  })
  it('counts partial imports only after successful responses and resumes the remainder', async () => {
    store.save(null, [game('one'), game('two'), game('three')])
    api.putSave
      .mockImplementationOnce(async (entry) => {
        api.cloud.set(entry.id, entry)
        return { ok: true }
      })
      .mockRejectedValueOnce(new SaveRequestError(500, 'broken'))
    sync.setUser('A', true)
    await tick()
    expect(sync.getSnapshot().imported).toBe(1)
    expect(store.space('A').pending.map((op) => op.id)).toEqual(['two', 'three'])
    await tick(1000)
    expect(sync.getSnapshot().imported).toBe(3)
  })
  it('imports more than 200 games through individual PUTs', async () => {
    store.save(
      null,
      Array.from({ length: 205 }, (_, i) => game(`${i}`)),
    )
    sync.setUser('A', true)
    await tick()
    expect(api.putSave).toHaveBeenCalledTimes(205)
    expect(sync.getSnapshot().imported).toBe(205)
  })
  it('coalesces edits for 500ms and does not let an older acknowledgement clear a newer edit', async () => {
    sync.setUser('A', true)
    await tick(0)
    store.save('A', [game('one', 10)])
    await tick(250)
    store.save('A', [game('one', 11)])
    await tick(250)
    expect(api.putSave).not.toHaveBeenCalled()
    const inflight = deferred<{ ok: boolean }>()
    api.putSave.mockImplementationOnce(async () => inflight.promise)
    await tick(250)
    store.save('A', [game('one', 12)])
    inflight.resolve({ ok: true })
    await tick(0)
    expect(store.space('A').pending).toHaveLength(1)
    await tick()
    expect(api.cloud.get('one')?.updatedAt).toBe(12)
    expect(api.putSave).toHaveBeenCalledTimes(2)
  })
  it('serializes PUT followed immediately by DELETE', async () => {
    const inflight = deferred<{ ok: boolean }>()
    api.putSave.mockImplementationOnce(async (entry) => {
      await inflight.promise
      api.cloud.set(entry.id, entry)
      return { ok: true }
    })
    store.save('A', [game()])
    sync.setUser('A', true)
    await tick()
    store.save('A', [])
    await tick()
    expect(api.deleteSave).not.toHaveBeenCalled()
    inflight.resolve({ ok: true })
    await tick(0)
    expect(api.cloud.size).toBe(0)
    expect(store.space('A').pending).toEqual([])
  })
  it('ignores a late response after an account switch and aborts its request', async () => {
    const inflight = deferred<ArchivedGame[]>()
    api.listSaves.mockImplementationOnce(() => inflight.promise)
    sync.setUser('A', true)
    await tick(0)
    // The fake ignores abort, to prove generation checking independently of fetch.
    const signal = (api.listSaves.mock.calls[0] as unknown as [{ signal: AbortSignal }])[0].signal
    sync.setUser('B', true)
    await tick()
    expect(signal.aborted).toBe(true)
    inflight.resolve([game('A-only')])
    await tick()
    expect(store.space('B').games).toEqual([])
    expect(sync.getSnapshot().owner).toBe('B')
  })
  it('does not duplicate work on repeated start and stop/remount', async () => {
    store.save('A', [game()])
    sync.setUser('A', true)
    sync.setUser('A', true)
    sync.stop()
    sync.setUser('A', true)
    await tick()
    expect(api.listSaves).toHaveBeenCalledOnce()
    expect(api.putSave).toHaveBeenCalledOnce()
  })
  it('keeps A separate through A → guest → B and waits for authentication after refresh', async () => {
    store.save(null, [game('guest')])
    store.save('A', [game('A')])
    sync.setUser('A', false)
    await tick(10000)
    expect(api.listSaves).not.toHaveBeenCalled()
    expect(store.space(null).games).toHaveLength(1)
    sync.setUser('A', true)
    await tick()
    sync.setUser(null, false)
    expect(store.space(null).games).toEqual([])
    api.cloud.clear()
    sync.setUser('B', true)
    await tick()
    expect(store.space('B').games).toEqual([])
    expect(store.space('A').games).toHaveLength(2)
    expect(store.space('B').pending).toEqual([])
  })
  it.each([401, 409, 400, 413])(
    'keeps HTTP %i operations pending with an explicit failure state',
    async (status) => {
      store.save('A', [game()])
      api.putSave.mockRejectedValue(new SaveRequestError(status, 'rejected'))
      sync.setUser('A', true)
      await tick()
      await tick(120000)
      expect(api.putSave).toHaveBeenCalledOnce()
      expect(store.space('A').pending).toHaveLength(1)
      expect(sync.getSnapshot().status).toBe(status === 401 || status === 409 ? 'auth' : 'error')
    },
  )
  it('resumes a 401 queue only after the same account is authenticated again', async () => {
    store.save('A', [game()])
    api.putSave.mockRejectedValueOnce(new SaveRequestError(401, 'expired'))
    sync.setUser('A', true)
    await tick()
    sync.retry()
    await tick(10000)
    expect(api.putSave).toHaveBeenCalledOnce()
    sync.setUser('A', true)
    await tick()
    expect(sync.getSnapshot().status).toBe('synced')
    expect(api.putSave).toHaveBeenCalledTimes(2)
  })
  it('keeps a late upload acknowledgement in its original account after switching', async () => {
    const inflight = deferred<{ ok: boolean }>()
    store.save('A', [game()])
    api.putSave.mockImplementationOnce(() => inflight.promise)
    sync.setUser('A', true)
    await tick()
    sync.setUser('B', true)
    await tick()
    inflight.resolve({ ok: true })
    await tick()
    expect(store.space('A').pending).toHaveLength(1)
    expect(store.space('B').pending).toHaveLength(0)
    expect(sync.getSnapshot()).toMatchObject({ owner: 'B', imported: 0 })
  })
  it('backs off by 1, 2, 4, 8, 16, 30, 30 seconds and allows early retry', async () => {
    store.save('A', [game()])
    api.putSave.mockRejectedValue(new SaveRequestError(429, 'wait'))
    sync.setUser('A', true)
    await tick()
    let calls = 1
    for (const delay of [1000, 2000, 4000, 8000, 16000, 30000, 30000]) {
      await tick(delay - 1)
      expect(api.putSave).toHaveBeenCalledTimes(calls)
      await tick(1)
      expect(api.putSave).toHaveBeenCalledTimes(++calls)
    }
    api.putSave.mockResolvedValue({ ok: true })
    sync.retry()
    await tick(0)
    expect(sync.getSnapshot().status).toBe('synced')
  })
  it('retains a local record absent from the limited cloud list and preserves equal timestamps', () => {
    store.save('A', [game('not-in-list'), game('equal')])
    store.merge('A', [{ ...game('equal'), title: 'server at same time' }])
    expect(store.space('A').games.map((entry) => entry.title)).toEqual(['not-in-list', 'equal'])
  })
})

describe('migration and storage failure', () => {
  it.each([null, 'cached-A'])(
    'migrates the shared archive once to %s, keeping the backup',
    (owner) => {
      const legacy = JSON.stringify([game()])
      storage.map.delete(ARCHIVE_KEY)
      storage.map.set(LEGACY_KEY, legacy)
      if (owner)
        storage.map.set('turtle-soup.cache.v1.me', JSON.stringify({ at: 0, value: { uid: owner } }))
      store = new ArchiveStore(storage)
      expect(store.space(owner).games).toHaveLength(1)
      store.save(owner, [])
      store = new ArchiveStore(storage)
      expect(store.space(owner).games).toEqual([])
      expect(storage.map.get(LEGACY_KEY)).toBe(legacy)
    },
  )
  it('transfers guest games only once and binds them to the first account', () => {
    store.save(null, [game()])
    expect(store.claimGuest('A')).toBe(true)
    store.claimGuest('B')
    expect(store.space('A').games).toHaveLength(1)
    expect(store.space(null).games).toEqual([])
    expect(store.space('B').games).toEqual([])
  })
  it('does not mark a failed migration complete or erase the old archive', () => {
    storage.map.delete(ARCHIVE_KEY)
    const legacy = JSON.stringify([game()])
    storage.map.set(LEGACY_KEY, legacy)
    storage.setItem.mockImplementation(() => {
      throw new Error('quota')
    })
    store = new ArchiveStore(storage)
    expect(store.storageError).toBe(true)
    expect(storage.map.has(ARCHIVE_KEY)).toBe(false)
    expect(storage.map.get(LEGACY_KEY)).toBe(legacy)
  })
  it('does not clear disk guest data on failed transfer or upload unpersisted changes', async () => {
    store.save(null, [game()])
    const previous = storage.map.get(ARCHIVE_KEY)
    storage.setItem.mockImplementation(() => {
      throw new Error('quota')
    })
    sync.setUser('A', true)
    await tick()
    expect(storage.map.get(ARCHIVE_KEY)).toBe(previous)
    expect(api.putSave).not.toHaveBeenCalled()
    expect(sync.getSnapshot().status).toBe('storage')
    storage.setItem.mockImplementation((key, value) => {
      storage.map.set(key, value)
    })
    sync.retry()
    await tick()
    expect(sync.getSnapshot()).toMatchObject({ status: 'synced', imported: 1 })
    expect(new ArchiveStore(storage).space(null).games).toEqual([])
  })
  it('shows unsaved progress when persistence fails during play, then retries it', async () => {
    sync.setUser('A', true)
    await tick()
    storage.setItem.mockImplementation(() => {
      throw new Error('quota')
    })
    expect(store.save('A', [game()])).toBe(false)
    await tick(30000)
    expect(api.putSave).not.toHaveBeenCalled()
    expect(sync.getSnapshot().status).toBe('storage')
    storage.setItem.mockImplementation((key, value) => {
      storage.map.set(key, value)
    })
    sync.retry()
    await tick()
    expect(api.cloud.size).toBe(1)
  })
  it('retains edits made before storage can be read, without deleting unseen disk records', () => {
    store.save('A', [game('existing')])
    storage.getItem.mockImplementation(() => {
      throw new Error('blocked')
    })
    const blocked = new ArchiveStore(storage)
    expect(blocked.save('A', [game('new')])).toBe(false)
    expect(blocked.storageError).toBe(true)
    storage.getItem.mockImplementation((key) => storage.map.get(key) ?? null)
    expect(blocked.retryStorage('A')).toBe(true)
    expect(new ArchiveStore(storage).space('A').games.map((entry) => entry.id)).toEqual([
      'existing',
      'new',
    ])
  })
  it('preserves a corrupt migration source and does not mark it complete', () => {
    storage.map.delete(ARCHIVE_KEY)
    storage.map.set(LEGACY_KEY, '[null]')
    const broken = new ArchiveStore(storage)
    expect(broken.storageError).toBe(true)
    expect(broken.retryStorage(null)).toBe(false)
    expect(storage.map.has(ARCHIVE_KEY)).toBe(false)
    expect(storage.map.get(LEGACY_KEY)).toBe('[null]')
  })
  it('retains the operation if persisting its acknowledgement fails', async () => {
    store.save(null, [game()])
    api.putSave.mockImplementationOnce(async () => {
      storage.setItem.mockImplementation(() => {
        throw new Error('quota')
      })
      return { ok: true }
    })
    sync.setUser('A', true)
    await tick()
    expect(store.space('A').pending).toHaveLength(1)
    expect(sync.getSnapshot()).toMatchObject({ status: 'storage', imported: 0 })
    storage.setItem.mockImplementation((key, value) => {
      storage.map.set(key, value)
    })
    sync.retry()
    await tick()
    expect(sync.getSnapshot()).toMatchObject({ status: 'synced', imported: 1 })
  })
  it('distinguishes unavailable authentication from a definite signed-out response', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response('{}', { status: 503 }))
        .mockResolvedValueOnce(new Response('{}', { status: 401 })),
    )
    await expect(fetchMe()).rejects.toThrow('503')
    await expect(fetchMe()).resolves.toBeNull()
  })
})
