import type { ChatMessage } from './api'
import type { RoomEvent } from '../../shared/room-protocol'

/** Presentation only: never rewrite the history sent to the host or saved in an archive. */
export function soloTranscript(messages: ChatMessage[]) {
  const groups: { message: ChatMessage; answer?: ChatMessage; number?: number }[] = []
  let number = 0
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i]
    if (message.role !== 'player') {
      groups.push({ message })
      continue
    }
    const answer = messages[i + 1]?.role === 'host' ? messages[++i] : undefined
    groups.push({ message, answer, number: ++number })
  }
  return groups
}

/** Pair by question ID, including replies separated by discussion or pagination. */
export function roomTranscript(events: RoomEvent[]) {
  const ordered = [...events].sort((a, b) => a.seq - b.seq)
  const questions = new Set(
    ordered.filter((e) => e.type === 'question' && e.questionId).map((e) => e.questionId!),
  )
  const answers = new Map<string, RoomEvent[]>()
  for (const e of ordered) {
    if (e.type !== 'answer' || !e.questionId || !questions.has(e.questionId)) continue
    answers.set(e.questionId, [...(answers.get(e.questionId) ?? []), e])
  }
  return ordered.flatMap((event) => {
    if (event.type === 'answer' && event.questionId && questions.has(event.questionId)) return []
    return [
      { event, answers: event.type === 'question' ? (answers.get(event.questionId!) ?? []) : [] },
    ]
  })
}

export function messageVerdict(message?: ChatMessage): string | null {
  if (message?.tone === 'celebrate' || message?.verdict === 'solved') return 'solved'
  return message?.verdict && ['yes', 'no', 'partly', 'irrelevant'].includes(message.verdict)
    ? message.verdict
    : null
}
