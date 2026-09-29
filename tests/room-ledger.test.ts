import { describe, expect, it } from 'vitest'
import { buildRoomLedger, roomVerdict } from '../shared/room-ledger'
import type { RoomEvent } from '../shared/room-protocol'
import fixture from './fixtures/room-ledger.json'

const events = fixture as RoomEvent[]
describe('shared room question ledger', () => {
  it('pairs by ID, preserves authors and order, skips discussion, pending, hints and failed answers', () => {
    const ledger = buildRoomLedger(events)
    expect(ledger.map((e) => e.id)).toEqual(['q1', 'q2', 'q3', 'q4', 'q7'])
    expect(ledger.map((e) => e.verdict)).toEqual(['yes', 'no', 'partly', 'irrelevant', 'solved'])
    expect(ledger[1]).toMatchObject({ question: '是陌生人吗？', actorId: 'bob' })
  })
  it('does not duplicate reconnect replay or depend on arrival order', () => {
    expect(buildRoomLedger([...events].reverse().concat(events))).toEqual(buildRoomLedger(events))
  })
  it('waits for an earlier question page instead of associating an orphan answer with the wrong player', () => {
    const earlier = events.slice(0, 3)
    const latest = events.slice(3)
    expect(buildRoomLedger(latest).map((e) => e.id)).toEqual(['q3', 'q4', 'q7'])
    expect(buildRoomLedger([...latest, ...earlier])).toEqual(buildRoomLedger(events))
  })
  it('never creates a judgement for system messages or missing / unsupported verdicts', () => {
    expect(roomVerdict()).toBeNull()
    expect(buildRoomLedger([])).toEqual([])
    expect(buildRoomLedger(events.filter((e) => e.type !== 'question'))).toEqual([])
  })
})
