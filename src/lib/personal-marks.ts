import type { ChatMessage } from './api'

export type PersonalMark = 'useful' | 'not-useful'
export type MarkFilter = 'all' | 'marked' | PersonalMark
export type Marks = Record<string, PersonalMark>

export function personalMarksKey(owner: string | null, kind: 'solo' | 'room', id: string) {
  return `turtle-soup.marks.v1:${JSON.stringify([owner, kind, id])}`
}

export function markFor(marks: Marks, id: string): PersonalMark | undefined {
  return Object.hasOwn(marks, id) ? marks[id] : undefined
}

export function matchesMark(marks: Marks, filter: MarkFilter, id?: string) {
  if (filter === 'all') return true
  const mark = id ? markFor(marks, id) : undefined
  return filter === 'marked' ? Boolean(mark) : mark === filter
}

/** A host greeting / reveal notice is not an answer to the preceding question. */
export function soloQuestionGroups(messages: ChatMessage[]) {
  const groups = new Map<string, string>()
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index]
    if (message.role !== 'player') continue
    groups.set(message.id, message.id)
    const answer = messages[index + 1]
    if (answer?.role === 'host') groups.set(answer.id, message.id)
  }
  return groups
}

function decode(raw: string | null): Marks {
  if (!raw) return {}
  try {
    const data: unknown = JSON.parse(raw)
    if (!data || typeof data !== 'object' || Array.isArray(data)) return {}
    return Object.fromEntries(
      Object.entries(data).filter(([, value]) => value === 'useful' || value === 'not-useful'),
    )
  } catch {
    return {}
  }
}

/** Deliberately separate from cloud saves, room events, and model request history. */
export class PersonalMarksStore {
  private snapshot: { marks: Marks; error: boolean } = { marks: {}, error: false }
  private listeners = new Set<() => void>()
  readonly key: string
  private storage: () => Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

  constructor(key: string, storage: () => Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>) {
    this.key = key
    this.storage = storage
    this.refresh()
  }

  getSnapshot = () => this.snapshot
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  private publish(marks: Marks, error = false) {
    this.snapshot = { marks, error }
    this.listeners.forEach((listener) => listener())
  }
  refresh = () => {
    try {
      this.publish(decode(this.storage().getItem(this.key)))
    } catch {
      this.publish(this.snapshot.marks, true)
    }
  }
  toggle = (id: string, value: PersonalMark) => {
    try {
      const storage = this.storage()
      // Read the latest map so another tab's unrelated marks are retained.
      let marks = decode(storage.getItem(this.key))
      if (markFor(marks, id) === value) delete marks[id]
      else marks = { ...marks, [id]: value }
      if (Object.keys(marks).length) storage.setItem(this.key, JSON.stringify(marks))
      else storage.removeItem(this.key)
      this.publish(marks)
    } catch {
      // Never display an unsaved change as though it survived a refresh.
      this.publish(this.snapshot.marks, true)
    }
  }
}
