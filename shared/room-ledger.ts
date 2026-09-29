import type { RoomEvent, RoomTurn } from './room-protocol.js'

export type LedgerVerdict = 'yes' | 'no' | 'partly' | 'irrelevant' | 'solved'
export interface RoomLedgerItem {
  id: string
  question: string
  actorId?: string
  verdict: LedgerVerdict
}

export function roomVerdict(turn?: RoomTurn): LedgerVerdict | null {
  if (turn?.solved) return 'solved'
  switch (turn?.verdict) {
    case 'yes':
    case 'no':
    case 'partly':
    case 'irrelevant':
      return turn.verdict
    default:
      return null
  }
}

/** Discussion can fall between a question and its answer; adjacency is not a pairing key. */
export function buildRoomLedger(events: RoomEvent[]): RoomLedgerItem[] {
  const questions = new Map<string, RoomEvent>()
  const answers = new Map<string, LedgerVerdict>()
  for (const event of [...events].sort((a, b) => a.seq - b.seq)) {
    if (!event.questionId) continue
    if (event.type === 'question') questions.set(event.questionId, event)
    if (event.type === 'answer') {
      const verdict = roomVerdict(event.turn)
      if (verdict) answers.set(event.questionId, verdict)
    }
  }
  return [...questions].flatMap(([id, question]) => {
    const verdict = answers.get(id)
    return verdict ? [{ id, question: question.text, actorId: question.actorId, verdict }] : []
  })
}
