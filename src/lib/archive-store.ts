import { ArchiveStore } from '@turtle-soup/client-core/archive-store'
export * from '@turtle-soup/client-core/archive-store'

let instance: ArchiveStore | undefined
export function archiveStore(): ArchiveStore {
  return (instance ??= new ArchiveStore({
    getItem: (key) => localStorage.getItem(key),
    setItem: (key, value) => localStorage.setItem(key, value),
  }))
}
