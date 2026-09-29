import { describe, expect, it } from 'vitest'
import {
  PersonalMarksStore,
  matchesMark,
  personalMarksKey,
  soloQuestionGroups,
} from '../src/lib/personal-marks'
import type { ChatMessage } from '../src/lib/api'
import type { RoomEvent } from '../shared/room-protocol'
import fixture from './fixtures/room-ledger.json'

function storage() {
  const data = new Map<string, string>()
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value)
    },
    removeItem: (key: string) => {
      data.delete(key)
    },
  }
}

describe('personal browser marks', () => {
  it('persists, changes classification, cancels, and reads back after reopening', () => {
    const disk = storage()
    const key = personalMarksKey('alice', 'solo', 'one')
    const store = new PersonalMarksStore(key, () => disk)
    store.toggle('q1', 'useful')
    const reopened = new PersonalMarksStore(key, () => disk)
    expect(reopened.getSnapshot()).toEqual({ marks: { q1: 'useful' }, error: false })
    reopened.toggle('q1', 'not-useful')
    expect(reopened.getSnapshot().marks).toEqual({ q1: 'not-useful' })
    reopened.toggle('q1', 'not-useful')
    expect(disk.getItem(key)).toBeNull()
  })

  it('isolates guest, different users, sessions and room IDs even with delimiters in IDs', () => {
    const keys = [
      personalMarksKey(null, 'solo', 'same'),
      personalMarksKey('guest', 'solo', 'same'),
      personalMarksKey('alice', 'solo', 'same'),
      personalMarksKey('alice', 'room', 'same'),
      personalMarksKey('alice', 'solo', 'other'),
      personalMarksKey('bob', 'solo', 'same'),
      personalMarksKey('alice:solo', 'room', 'same'),
      personalMarksKey('alice', 'solo', 'room:same'),
    ]
    expect(new Set(keys).size).toBe(keys.length)
    const disk = storage()
    new PersonalMarksStore(keys[0], () => disk).toggle('q1', 'useful')
    for (const key of keys.slice(1))
      expect(new PersonalMarksStore(key, () => disk).getSnapshot().marks).toEqual({})
  })

  it('merges unrelated changes from other tabs and reflects external deletions', () => {
    const disk = storage()
    const a = new PersonalMarksStore('key', () => disk)
    const b = new PersonalMarksStore('key', () => disk)
    a.toggle('q1', 'useful')
    b.toggle('q2', 'not-useful')
    a.refresh()
    expect(a.getSnapshot().marks).toEqual({ q1: 'useful', q2: 'not-useful' })
    disk.removeItem('key')
    a.refresh()
    expect(a.getSnapshot().marks).toEqual({})
  })

  it('ignores malformed data and rejects unsupported marks', () => {
    const disk = storage()
    for (const raw of ['broken', 'null', '[]', '42']) {
      disk.setItem('key', raw)
      expect(new PersonalMarksStore('key', () => disk).getSnapshot().marks).toEqual({})
    }
    disk.setItem('key', JSON.stringify({ q1: 'useful', q2: 'bad', q3: {} }))
    const store = new PersonalMarksStore('key', () => disk)
    expect(store.getSnapshot().marks).toEqual({ q1: 'useful' })
    expect(matchesMark({}, 'marked', 'constructor')).toBe(false)
    store.toggle('__proto__', 'useful')
    expect(
      matchesMark(
        new PersonalMarksStore('key', () => disk).getSnapshot().marks,
        'useful',
        '__proto__',
      ),
    ).toBe(true)
  })

  it('does not pretend a write succeeded when storage is full or blocked, and can retry', () => {
    const disk = storage()
    const store = new PersonalMarksStore('key', () => disk)
    store.toggle('q1', 'useful')
    const write = disk.setItem
    disk.setItem = () => {
      throw new Error('QuotaExceededError')
    }
    store.toggle('q1', 'not-useful')
    expect(store.getSnapshot()).toEqual({ marks: { q1: 'useful' }, error: true })
    disk.setItem = write
    store.toggle('q1', 'not-useful')
    expect(store.getSnapshot()).toEqual({ marks: { q1: 'not-useful' }, error: false })
    const blocked = new PersonalMarksStore('key', () => {
      throw new Error('SecurityError')
    })
    blocked.toggle('q1', 'useful')
    expect(blocked.getSnapshot()).toEqual({ marks: {}, error: true })
  })

  it('filters a solo question and its reply together without including greetings or reveal notices', () => {
    const messages: ChatMessage[] = [
      { id: 'g', role: 'host', text: 'greeting' },
      { id: 'q1', role: 'player', text: 'first' },
      { id: 'a1', role: 'host', text: 'answer' },
      { id: 'notice', role: 'host', text: 'reveal' },
      { id: 'q2', role: 'player', text: 'second' },
      { id: 'a2', role: 'host', text: 'error', tone: 'error' },
      { id: 'pending', role: 'player', text: 'pending' },
    ]
    const groups = soloQuestionGroups(messages)
    const marks = { q1: 'useful', q2: 'not-useful', pending: 'useful' } as const
    const ids = (filter: Parameters<typeof matchesMark>[1]) =>
      messages.filter((m) => matchesMark(marks, filter, groups.get(m.id))).map((m) => m.id)
    expect(ids('all')).toEqual(messages.map((m) => m.id))
    expect(ids('useful')).toEqual(['q1', 'a1', 'pending'])
    expect(ids('not-useful')).toEqual(['q2', 'a2'])
    expect(ids('marked')).toEqual(['q1', 'a1', 'q2', 'a2', 'pending'])
    expect(messages[1]).toEqual({ id: 'q1', role: 'player', text: 'first' })
  })

  it('pairs room marks by question ID across discussion, replay and earlier pages', () => {
    const events = fixture as RoomEvent[]
    const question = events.find((e) => e.type === 'question')!
    const id = question.questionId!
    const answer = events.find((e) => e.type === 'answer' && e.questionId === id)!
    const marks = { [id]: 'useful' } as const
    const filter = (items: RoomEvent[]) =>
      items.filter((e) =>
        matchesMark(
          marks,
          'useful',
          e.type === 'question' || e.type === 'answer' ? e.questionId : undefined,
        ),
      )
    expect(filter([answer])).toEqual([answer])
    expect(filter(events)).toEqual([question, answer])
    expect(filter([...events].reverse())).toEqual([answer, question])
    expect(filter(events.filter((e) => e.type === 'discussion'))).toEqual([])
  })
})
