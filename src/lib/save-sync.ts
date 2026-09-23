import { SaveSync as CoreSaveSync } from '@turtle-soup/client-core/save-sync'
import type { SaveTransport } from '@turtle-soup/client-core/transport'
import { ArchiveStore, archiveStore } from './archive-store'
import { deleteSave, listSaves, putSave } from './save-client'
export type { SyncState } from '@turtle-soup/client-core/save-sync'

export class SaveSync extends CoreSaveSync {
  constructor(store: ArchiveStore, api: SaveTransport = { listSaves, putSave, deleteSave }) {
    super(store, api)
  }
}
let instance: SaveSync | undefined
export function saveSync(): SaveSync {
  return (instance ??= new SaveSync(archiveStore()))
}
