import type { ArchivedGame } from './archive'
import type { ChatMessage, GameSession, HostTurn, RevealResult } from './types'
import type { DailyDetail, LibraryPuzzle } from './public-types'

export const utcToday = (now = new Date()) => now.toISOString().slice(0, 10)
export const isDailyLocked = (game: Pick<GameSession, 'source' | 'dailyDate'>, now = new Date()) =>
  game.source === 'daily' && game.dailyDate === utcToday(now)
export function toneFor(turn: { solved: boolean; verdict: string }): ChatMessage['tone'] {
  return turn.solved
    ? 'celebrate'
    : ['yes', 'no', 'partly', 'irrelevant'].includes(turn.verdict)
      ? 'verdict'
      : 'normal'
}
export function newGame(
  input: DailyDetail | LibraryPuzzle,
  greeting: string,
  uuid: () => string,
  now = Date.now(),
): ArchivedGame {
  const daily = 'puzzleId' in input
  return {
    id: daily ? input.puzzleId : uuid(),
    title: input.title,
    surface: input.surface,
    difficulty: input.difficulty,
    source: daily ? 'daily' : 'library',
    hostGreeting: greeting,
    ...(daily ? { dailyDate: input.date, sourceLocale: input.locale } : { libraryId: input.id }),
    hint: '',
    createdAt: now,
    updatedAt: now,
    messages: [{ id: uuid(), role: 'host', text: greeting }],
    revealed: false,
    truth: null,
    solved: false,
    closeness: null,
    turnCount: 0,
    status: 'active',
    draft: '',
  }
}
export const touchGame = (game: ArchivedGame, change: Partial<ArchivedGame>): ArchivedGame => ({
  ...game,
  ...change,
  updatedAt: Math.max(Date.now(), game.updatedAt + 1),
})

export function beginTurn(
  game: ArchivedGame,
  text: string,
  uuid: () => string,
  retry = false,
): ArchivedGame {
  if (game.status !== 'active' || game.pendingAsk?.state === 'sending')
    throw new Error('Game is not ready for a new turn')
  if (game.pendingAsk && !retry) throw new Error('Resolve the interrupted question first')
  if (retry) {
    if (!game.pendingAsk || !game.messages.some((m) => m.id === game.pendingAsk!.messageId))
      throw new Error('No interrupted question')
    return touchGame(game, {
      pendingAsk: { ...game.pendingAsk, id: uuid(), state: 'sending', error: undefined },
    })
  }
  const message = text.trim()
  if (!message) throw new Error('Empty question')
  const messageId = uuid()
  return touchGame(game, {
    messages: [...game.messages, { id: messageId, role: 'player', text: message }],
    draft: '',
    turnCount: game.turnCount + 1,
    pendingAsk: { id: uuid(), messageId, state: 'sending' },
  })
}
export function turnInput(game: ArchivedGame) {
  const index = game.messages.findIndex((m) => m.id === game.pendingAsk?.messageId)
  if (index < 0) throw new Error('Missing pending message')
  return { message: game.messages[index].text, history: game.messages.slice(0, index) }
}
export function finishTurn(
  game: ArchivedGame,
  requestId: string,
  turn: HostTurn,
  uuid: () => string,
): ArchivedGame {
  if (game.status !== 'active' || game.pendingAsk?.id !== requestId) return game
  return touchGame(game, {
    pendingAsk: undefined,
    messages: [
      ...game.messages,
      {
        id: uuid(),
        role: 'host',
        text: turn.reply,
        tone: toneFor(turn),
        verdict: turn.verdict,
        replyLocale: turn.replyLocale,
        closeness: turn.closeness,
        model: turn.model,
        debug: turn.debug,
      },
    ],
    closeness:
      typeof turn.closeness === 'number'
        ? Math.max(game.closeness ?? 0, turn.closeness)
        : game.closeness,
    solved: turn.solved,
    revealed: turn.solved || turn.revealed,
    truth: turn.truth ?? game.truth,
    status: turn.solved ? 'solved' : turn.revealed ? 'revealed' : 'active',
  })
}
export function failTurn(game: ArchivedGame, requestId: string, error?: string): ArchivedGame {
  if (game.pendingAsk?.id !== requestId || game.status !== 'active') return game
  return touchGame(game, {
    pendingAsk: { ...game.pendingAsk, state: error ? 'failed' : 'interrupted', error },
  })
}
export function revealTurn(game: ArchivedGame, result: RevealResult): ArchivedGame {
  return touchGame(game, {
    truth: result.truth,
    hint: result.hint,
    revealed: true,
    status: game.solved ? 'solved' : 'revealed',
  })
}
