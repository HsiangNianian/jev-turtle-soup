import type { ArchivedGame } from '@turtle-soup/client-core/archive'
import { archiveStore, type Owner } from './archive-store'
export * from '@turtle-soup/client-core/archive'

export function loadGames(owner: Owner): ArchivedGame[] {
  return archiveStore().space(owner).games
}

export function saveGames(games: ArchivedGame[], owner: Owner): boolean {
  return archiveStore().save(owner, games)
}
