import { ArchiveStore, archiveStore, type Owner } from './archive-store'
import { deleteSave, listSaves, putSave, SaveRequestError } from './save-client'

export interface SyncState {
  owner: Owner
  status: 'local' | 'syncing' | 'synced' | 'offline' | 'error' | 'auth' | 'storage'
  imported: number
  httpStatus?: number
}
const BACKOFF = [1000, 2000, 4000, 8000, 16000, 30000]
const transport = { listSaves, putSave, deleteSave }

/** One serial queue per active account. Disk is the source of pending operations. */
export class SaveSync {
  private state: SyncState = { owner: null, status: 'local', imported: 0 }
  private listeners = new Set<() => void>()
  private generation = 0
  private controller?: AbortController
  private timer?: ReturnType<typeof setTimeout>
  private running: number | null = null
  private confirmed = false
  private active = false
  private pulled = false
  private failures = 0
  private unsubscribe: () => void
  private store: ArchiveStore
  private api: typeof transport

  constructor(store: ArchiveStore, api = transport) {
    this.store = store
    this.api = api
    this.unsubscribe = store.subscribe((event) => {
      if (store.storageError) {
        this.publish({ status: 'storage' })
        return
      }
      if (this.state.status === 'storage') {
        this.publish({
          status: this.state.owner ? (this.confirmed ? 'syncing' : 'offline') : 'local',
        })
      }
      if (event.owner !== this.state.owner || event.kind !== 'local') return
      if (!['offline', 'error', 'auth'].includes(this.state.status)) this.schedule(500)
    })
  }
  getSnapshot = (): SyncState => this.state
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  private publish(change: Partial<SyncState>) {
    this.state = { ...this.state, ...change }
    for (const listener of this.listeners) listener()
  }

  setUser(owner: Owner, confirmed: boolean) {
    if (
      this.active &&
      owner === this.state.owner &&
      confirmed === this.confirmed &&
      this.state.status !== 'auth'
    )
      return
    const changed = owner !== this.state.owner
    this.stop()
    this.active = true
    this.confirmed = confirmed
    this.pulled = false
    this.failures = 0
    this.publish({
      owner,
      imported: changed ? 0 : this.state.imported,
      httpStatus: undefined,
      status: this.store.storageError
        ? 'storage'
        : owner
          ? confirmed
            ? 'syncing'
            : 'offline'
          : 'local',
    })
    if (owner && confirmed && !this.store.storageError) {
      this.store.claimGuest(owner)
      this.schedule(0)
    }
  }

  stop() {
    this.active = false
    this.generation++
    this.controller?.abort()
    this.controller = undefined
    clearTimeout(this.timer)
    this.timer = undefined
    this.running = null
  }
  dispose() {
    this.stop()
    this.unsubscribe()
  }

  retry = () => {
    if (this.store.storageError && !this.store.retryStorage(this.state.owner)) return
    if (!this.state.owner) {
      this.publish({ status: 'local' })
      return
    }
    if (!this.confirmed) return
    if (this.state.status === 'auth') return // Caller must confirm authentication again.
    this.failures = 0
    this.publish({ status: 'syncing', httpStatus: undefined })
    if (this.state.owner) this.store.claimGuest(this.state.owner)
    this.schedule(0)
  }

  /** Online/visibility listeners are mounted once by the application, and removed on cleanup. */
  private schedule(delay: number) {
    if (
      !this.active ||
      !this.confirmed ||
      !this.state.owner ||
      this.store.storageError ||
      this.running !== null
    )
      return
    clearTimeout(this.timer)
    this.publish({ status: 'syncing' })
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.run()
    }, delay)
  }

  private async run() {
    const owner = this.state.owner
    if (!owner || !this.active || !this.confirmed || this.store.storageError) return
    const generation = this.generation
    const current = () => generation === this.generation && this.active
    this.running = generation
    const controller = new AbortController()
    this.controller = controller
    const options = { owner, signal: controller.signal }
    let nextDelay: number | undefined
    try {
      if (!this.pulled) {
        const server = await this.api.listSaves(options)
        if (!current()) return
        if (!this.store.merge(owner, server)) return
        this.pulled = true
        this.failures = 0
      }
      while (current() && !this.store.storageError) {
        const space = this.store.space(owner)
        const op = space.pending[0]
        if (!op) {
          this.publish({ status: 'synced', httpStatus: undefined })
          return
        }
        if (op.readyAt > Date.now()) {
          nextDelay = op.readyAt - Date.now()
          return
        }
        if (op.kind === 'delete') {
          await this.api.deleteSave(op.id, options)
        } else {
          const game = space.games.find((entry) => entry.id === op.id)!
          await this.api.putSave(game, options)
        }
        if (!current()) return
        const ack = this.store.acknowledge(owner, op)
        if (!ack.saved) return
        if (ack.imported) this.publish({ imported: this.state.imported + 1 })
        this.failures = 0
      }
    } catch (error) {
      if (!current()) return
      const status = error instanceof SaveRequestError ? error.status : undefined
      if (status === 401 || status === 409) {
        this.publish({ status: 'auth', httpStatus: status })
      } else if (status === undefined || status === 429 || status >= 500) {
        nextDelay = BACKOFF[Math.min(this.failures++, BACKOFF.length - 1)]
        this.publish({ status: status === undefined ? 'offline' : 'error', httpStatus: status })
      } else {
        this.publish({ status: 'error', httpStatus: status })
      }
    } finally {
      if (current()) {
        this.running = null
        this.controller = undefined
        // Keep the failure visible during backoff; new edits must not bypass it.
        if (nextDelay !== undefined && !this.store.storageError) {
          this.timer = setTimeout(() => {
            this.timer = undefined
            this.publish({ status: 'syncing' })
            void this.run()
          }, nextDelay)
        }
      }
    }
  }
}

let instance: SaveSync | undefined
export function saveSync(): SaveSync {
  return (instance ??= new SaveSync(archiveStore()))
}
