import type { ArchivedGame } from './archive'

export const ARCHIVE_KEY = 'turtle-soup.archive.v2'
export const LEGACY_KEY = 'turtle-soup.archive.v1'
export type Owner = string | null
export interface PendingSave {
  id: string
  kind: 'put' | 'delete'
  revision: string
  readyAt: number
  imported: boolean
}
interface Space {
  games: ArchivedGame[]
  pending: PendingSave[]
}
interface ArchiveData {
  version: 2
  spaces: Record<string, Space>
  guestClaimedBy?: string
}
export interface ArchiveChange {
  owner: Owner
  kind: 'local' | 'remote' | 'ack' | 'error'
}
const spaceKey = (owner: Owner) => (owner === null ? 'guest' : `user:${owner}`)
const empty = (): Space => ({ games: [], pending: [] })
const operation = (id: string, kind: PendingSave['kind'], imported = false): PendingSave => ({
  id,
  kind,
  imported,
  revision: crypto.randomUUID(),
  readyAt: Date.now() + 500,
})

/** All spaces share one atomic localStorage write, including migration and guest transfer. */
export class ArchiveStore {
  private data: ArchiveData = { version: 2, spaces: {} }
  private listeners = new Set<(event: ArchiveChange) => void>()
  private unreadable = false
  private unreadableChanges = new Map<Owner, Space>()
  storageError = false

  private storage: Pick<Storage, 'getItem' | 'setItem'>

  constructor(storage: Pick<Storage, 'getItem' | 'setItem'>) {
    this.storage = storage
    this.read()
  }

  private read() {
    try {
      const raw = this.storage.getItem(ARCHIVE_KEY)
      if (raw) {
        const data = JSON.parse(raw) as ArchiveData
        if (
          data.version !== 2 ||
          !data.spaces ||
          Object.values(data.spaces).some(
            (space) => !Array.isArray(space.games) || !Array.isArray(space.pending),
          )
        )
          throw new Error('Invalid archive')
        this.data = data
        this.unreadable = false
        this.storageError = false
        return
      }
      const legacy = this.storage.getItem(LEGACY_KEY)
      const games: ArchivedGame[] = legacy ? JSON.parse(legacy) : []
      if (
        !Array.isArray(games) ||
        games.some(
          (game) =>
            !game ||
            typeof game.id !== 'string' ||
            typeof game.title !== 'string' ||
            typeof game.surface !== 'string' ||
            !Array.isArray(game.messages),
        )
      ) {
        throw new Error('Invalid legacy archive')
      }
      const cached = this.storage.getItem('turtle-soup.cache.v1.me')
      const uid = cached ? JSON.parse(cached)?.value?.uid : null
      const owner = typeof uid === 'string' ? uid : null
      this.data = {
        version: 2,
        spaces: {
          [spaceKey(owner)]: {
            games,
            pending: games.map((game) => operation(game.id, 'put', true)),
          },
        },
      }
      this.unreadable = false
      // The old key is retained as a backup. The v2 record itself is the migration marker.
      this.commit(this.data, owner, 'local')
    } catch {
      this.unreadable = true
      this.storageError = true
    }
  }

  subscribe(listener: (event: ArchiveChange) => void) {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private emit(owner: Owner, kind: ArchiveChange['kind']) {
    for (const listener of this.listeners) listener({ owner, kind })
  }

  private commit(next: ArchiveData, owner: Owner, kind: ArchiveChange['kind']): boolean {
    if (this.unreadable) {
      this.emit(owner, 'error')
      return false
    }
    this.data = next // Keep unsaved edits in memory for explicit retry; never upload them yet.
    try {
      this.storage.setItem(ARCHIVE_KEY, JSON.stringify(next))
      this.storageError = false
      this.emit(owner, kind)
      return true
    } catch {
      this.storageError = true
      this.emit(owner, 'error')
      return false
    }
  }

  retryStorage(owner: Owner): boolean {
    if (this.unreadable) this.read()
    if (this.unreadable) return false
    // Edits made while storage could not even be read must survive a later recovery.
    // Only their explicit operations are applied; unseen disk records are never treated as deletions.
    for (const [changedOwner, changes] of this.unreadableChanges) {
      const current = this.space(changedOwner)
      const games = new Map(current.games.map((game) => [game.id, game]))
      const pending = new Map(current.pending.map((op) => [op.id, op]))
      for (const op of changes.pending) {
        if (op.kind === 'delete') games.delete(op.id)
        else
          games.set(
            op.id,
            changes.games.find((game) => game.id === op.id)!,
          )
        pending.set(op.id, op)
      }
      this.data.spaces[spaceKey(changedOwner)] = {
        games: [...games.values()],
        pending: [...pending.values()],
      }
    }
    const saved = this.commit(this.data, owner, 'remote')
    if (saved) this.unreadableChanges.clear()
    return saved
  }

  space(owner: Owner): Readonly<Space> {
    return (
      (this.unreadable ? this.unreadableChanges.get(owner) : undefined) ??
      this.data.spaces[spaceKey(owner)] ??
      empty()
    )
  }

  private update(owner: Owner, space: Space, kind: ArchiveChange['kind']) {
    if (this.unreadable) {
      this.unreadableChanges.set(owner, space)
      this.emit(owner, 'error')
      return false
    }
    return this.commit(
      { ...this.data, spaces: { ...this.data.spaces, [spaceKey(owner)]: space } },
      owner,
      kind,
    )
  }

  save(owner: Owner, games: ArchivedGame[]): boolean {
    const old = this.space(owner)
    const pending = new Map(old.pending.map((op) => [op.id, op]))
    const before = new Map(old.games.map((game) => [game.id, game]))
    for (const game of games) {
      if (JSON.stringify(before.get(game.id)) !== JSON.stringify(game)) {
        pending.set(game.id, operation(game.id, 'put', pending.get(game.id)?.imported))
      }
      before.delete(game.id)
    }
    for (const id of before.keys()) pending.set(id, operation(id, 'delete'))
    if (!this.storageError && JSON.stringify(old.games) === JSON.stringify(games)) return true
    return this.update(owner, { games, pending: [...pending.values()] }, 'local')
  }

  claimGuest(uid: string): boolean {
    if (this.storageError) return false
    if (this.data.guestClaimedBy && this.data.guestClaimedBy !== uid) return true
    const guest = this.space(null)
    const target = this.space(uid)
    const games = new Map(target.games.map((game) => [game.id, game]))
    const pending = new Map(target.pending.map((op) => [op.id, op]))
    for (const game of guest.games) {
      if (pending.get(game.id)?.kind === 'delete') continue
      const existing = games.get(game.id)
      if (!existing || game.updatedAt > existing.updatedAt) {
        games.set(game.id, game)
        pending.set(game.id, operation(game.id, 'put', true))
      }
    }
    // Destination and cleared source are persisted together. Failure leaves disk sources intact.
    return this.commit(
      {
        ...this.data,
        guestClaimedBy: uid,
        spaces: {
          ...this.data.spaces,
          guest: empty(),
          [spaceKey(uid)]: { games: [...games.values()], pending: [...pending.values()] },
        },
      },
      uid,
      'remote',
    )
  }

  merge(uid: string, server: ArchivedGame[]): boolean {
    const local = this.space(uid)
    const games = new Map(local.games.map((game) => [game.id, game]))
    const pending = new Map(local.pending.map((op) => [op.id, op]))
    const remote = new Map(server.map((game) => [game.id, game]))
    for (const game of server) {
      if (pending.get(game.id)?.kind === 'delete') continue
      const existing = games.get(game.id)
      if (!existing || game.updatedAt > existing.updatedAt) {
        games.set(game.id, game)
        pending.delete(game.id)
      }
    }
    for (const game of games.values()) {
      const existing = remote.get(game.id)
      if (!pending.has(game.id) && (!existing || game.updatedAt > existing.updatedAt)) {
        pending.set(game.id, operation(game.id, 'put', true))
      }
    }
    // A limited list cannot establish that an unreturned save was deleted remotely.
    return this.update(
      uid,
      {
        games: [...games.values()].sort((a, b) => b.updatedAt - a.updatedAt),
        pending: [...pending.values()],
      },
      'remote',
    )
  }

  acknowledge(uid: string, op: PendingSave): { saved: boolean; imported: boolean } {
    const space = this.space(uid)
    const matching = space.pending.find(
      (entry) => entry.id === op.id && entry.revision === op.revision,
    )
    if (!matching) return { saved: true, imported: false }
    const before = this.data
    const saved = this.update(
      uid,
      { ...space, pending: space.pending.filter((entry) => entry !== matching) },
      'ack',
    )
    if (!saved) this.data = before // Retry the idempotent request if its acknowledgement could not persist.
    return { saved, imported: saved && op.kind === 'put' && op.imported }
  }
}

let instance: ArchiveStore | undefined
export function archiveStore(): ArchiveStore {
  // Access itself may throw in private browsing; defer it into the guarded storage methods.
  return (instance ??= new ArchiveStore({
    getItem: (key) => localStorage.getItem(key),
    setItem: (key, value) => localStorage.setItem(key, value),
  }))
}
