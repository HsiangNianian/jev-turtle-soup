import { revealGame, type GameSession, type RevealResult } from '@/lib/api'
import { revealLibraryPuzzle } from '@/lib/library-client'
import { getDeviceId } from '@/lib/luck'

/** Both entry points return the same answer and original-story payload. */
export function revealSession(
  session: Pick<GameSession, 'sessionId' | 'libraryId'>,
  locale: string,
  manual = false,
): Promise<RevealResult> {
  return session.libraryId
    ? revealLibraryPuzzle(session.libraryId, locale, manual, manual ? getDeviceId() : undefined)
    : revealGame(session.sessionId, locale)
}
