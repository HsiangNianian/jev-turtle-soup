import { describe, expect, it } from 'vitest'
import { roomTranscript, soloTranscript } from '../src/lib/play-transcript'
import type { ChatMessage } from '../src/lib/api'
import type { RoomEvent } from '../shared/room-protocol'

describe('paired play transcript', () => {
  it('retains greetings, retry errors and pending solo questions without changing history', () => {
    const messages: ChatMessage[] = [
      { id: 'g', role: 'host', text: 'Hello' },
      { id: 'q1', role: 'player', text: 'First?' },
      { id: 'error', role: 'host', text: 'Retry', tone: 'error' },
      { id: 'q2', role: 'player', text: 'Second?' },
    ]
    const before = JSON.stringify(messages)
    const groups = soloTranscript(messages)
    expect(groups.map((g) => g.message.id)).toEqual(['g', 'q1', 'q2'])
    expect(groups[1].answer?.id).toBe('error')
    expect(groups[2].answer).toBeUndefined()
    expect(groups[2].number).toBe(2)
    expect(JSON.stringify(messages)).toBe(before)
  })

  const event = (seq: number, type: RoomEvent['type'], questionId?: string): RoomEvent => ({
    seq,
    type,
    questionId,
    id: String(seq),
    text: String(seq),
    at: seq,
  })
  it('pairs across discussion by identity and retains every event exactly once', () => {
    const events = [
      event(1, 'question', 'q1'),
      event(2, 'discussion'),
      event(3, 'question', 'q2'),
      event(4, 'answer', 'q1'),
      event(5, 'system'),
      event(6, 'answer', 'q2'),
      event(7, 'answer', 'q1'),
    ]
    const before = JSON.stringify(events)
    const groups = roomTranscript([...events].reverse())
    expect(groups[0].answers.map((e) => e.seq)).toEqual([4, 7])
    expect(groups[2].answers.map((e) => e.seq)).toEqual([6])
    expect(
      groups
        .flatMap(({ event: e, answers }) => [e, ...answers])
        .map((e) => e.seq)
        .sort(),
    ).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(JSON.stringify(events)).toBe(before)
  })
  it('keeps an orphan paginated answer visible until its question is loaded', () => {
    const answer = event(3, 'answer', 'older')
    const recent = event(4, 'question', 'recent')
    expect(roomTranscript([answer, recent])[0]).toEqual({ event: answer, answers: [] })
    const combined = roomTranscript([event(1, 'question', 'older'), answer, recent])
    expect(combined).toHaveLength(2)
    expect(combined[0].answers).toEqual([answer])
  })
})
