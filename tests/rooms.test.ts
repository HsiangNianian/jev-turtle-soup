import { describe, expect, it } from 'vitest'
import {
  createRoom,
  joinRoom,
  roomCommand,
  roomPresence,
  roomSnapshot,
  nextRoomQuestion,
  completeRoomQuestion,
  tickRoom,
  type RoomState,
} from '../shared/room-engine'
import {
  ROOM_RECONNECT_MS,
  ROOM_IDLE_MS,
  ROOM_VOTE_MS,
  type RoomCommand,
  type RoomTurn,
} from '../shared/room-protocol'

const now = Date.parse('2026-09-27T05:00:00Z')
const owner = { uid: 'alice', name: '甲', handle: 'alice' }
const bob = { uid: 'bob', name: '乙', handle: 'bob' }
const puzzle = {
  id: 'puzzle',
  title: '海',
  surface: '汤面',
  difficulty: '中等',
  ownerId: 'author',
  truth: '秘密汤底',
  story: '秘密原始故事',
  hint: '提示',
}
const cmd = (input: Omit<RoomCommand, 'commandId'> | Record<string, unknown>) =>
  ({ commandId: crypto.randomUUID(), ...input }) as RoomCommand
const answer: RoomTurn = {
  intent: 'yes_no_question',
  verdict: 'yes',
  reply: '是。',
  solved: false,
  revealed: false,
  closeness: null,
}
function table(): RoomState {
  let s = createRoom(crypto.randomUUID(), 'ABCDEFGH2345', puzzle, owner, now).state
  s = joinRoom(s, bob, now).state
  s = roomPresence(s, owner.uid, true, now).state
  return roomPresence(s, bob.uid, true, now).state
}
const start = () => roomCommand(table(), owner.uid, cmd({ type: 'start' }), now).state
function ask(s: RoomState, uid = owner.uid): RoomState {
  return roomCommand(s, uid, cmd({ type: 'ask', text: '他在船上吗？', locale: 'zh-CN' }), now).state
}

describe('shared table state and disclosure', () => {
  it('withholds the entire answer key in public snapshots', () => {
    const s = table()
    const publicJson = JSON.stringify(roomSnapshot(s, owner.uid))
    expect(publicJson).not.toContain(puzzle.truth)
    expect(publicJson).not.toContain(puzzle.story)
    expect(publicJson).not.toContain('ownerId')
    expect(() => roomSnapshot(s, 'outsider')).toThrow('没有这份同桌案卷')
  })
  it('requires the host and two connected seats to begin', () => {
    const s = table()
    expect(() => roomCommand(s, bob.uid, cmd({ type: 'start' }), now)).toThrow('房主')
    const offline = roomPresence(s, bob.uid, false, now).state
    expect(() => roomCommand(offline, owner.uid, cmd({ type: 'start' }), now)).toThrow(
      '至少两人在线',
    )
    expect(roomCommand(s, owner.uid, cmd({ type: 'start' }), now).state.phase).toBe('playing')
  })
  it('serializes different players and rejects a second outstanding question', () => {
    let s = ask(ask(start()), bob.uid)
    expect(() => ask(s)).toThrow('已经有一个问题')
    s = nextRoomQuestion(s, now).state
    expect(s.processing?.uid).toBe(owner.uid)
    expect(s.queue.map((q) => q.uid)).toEqual([bob.uid])
    expect(nextRoomQuestion(s, now).state.processing?.leaseId).toBe(s.processing?.leaseId)
    s = completeRoomQuestion(s, s.processing!.leaseId, answer, null, now).state
    expect(s.turns).toBe(1)
    expect(nextRoomQuestion(s, now).state.processing?.uid).toBe(bob.uid)
  })
  it('allows discussion during model I/O without counting or using it as model history', () => {
    let s = nextRoomQuestion(ask(start()), now).state
    s = roomCommand(s, bob.uid, cmd({ type: 'discuss', text: '我觉得他是船长' }), now).state
    expect(s.turns).toBe(0)
    expect(s.recentQuestions).toEqual([])
    expect(s.processing).not.toBeNull()
  })
  it('prevents taking another member’s question out of the queue', () => {
    const s = ask(start())
    expect(() =>
      roomCommand(s, bob.uid, cmd({ type: 'cancel', questionId: s.queue[0].id }), now),
    ).toThrow('自己')
    expect(
      roomCommand(s, owner.uid, cmd({ type: 'cancel', questionId: s.queue[0].id }), now).state
        .queue,
    ).toEqual([])
  })
  it('allows late joins, caps seats, and never undoes the author participation flag', () => {
    let s = joinRoom(start(), { uid: 'author', name: '作者', handle: 'author' }, now).state
    s = roomCommand(s, 'author', cmd({ type: 'leave' }), now).state
    expect(s.authorParticipated).toBe(true)
    for (let i = 0; i < 4; i++)
      s = joinRoom(s, { uid: `friend${i}`, name: '朋友', handle: '' }, now).state
    expect(() => joinRoom(s, { uid: 'extra', name: '多余', handle: '' }, now)).toThrow('坐满')
  })
  it('waits for an in-flight answer before opening a reveal vote', () => {
    let s = nextRoomQuestion(ask(start()), now).state
    s = roomCommand(s, bob.uid, cmd({ type: 'reveal' }), now).state
    expect(s.vote).toBeNull()
    expect(s.revealPending).toBe(bob.uid)
    s = completeRoomQuestion(s, s.processing!.leaseId, answer, null, now).state
    s = nextRoomQuestion(s, now).state
    expect(s.vote?.agreed).toEqual([bob.uid])
    expect(() => ask(s)).toThrow('投票')
  })
  it('reveals only after unanimous agreement and rejects votes on other ballots', () => {
    let s = roomCommand(start(), owner.uid, cmd({ type: 'reveal' }), now).state
    expect(() =>
      roomCommand(s, bob.uid, cmd({ type: 'vote', voteId: crypto.randomUUID(), agree: true }), now),
    ).toThrow('失效')
    expect(roomSnapshot(s, bob.uid).report).toBeUndefined()
    s = roomCommand(s, bob.uid, cmd({ type: 'vote', voteId: s.vote!.id, agree: true }), now).state
    expect(s.phase).toBe('revealed')
    expect(s.revealVoters).toEqual(['alice', 'bob'])
    expect(roomSnapshot(s, owner.uid).report).toMatchObject({
      truth: puzzle.truth,
      story: puzzle.story,
    })
  })
  it('a no, timeout, or change in seats cancels rather than silently reduces unanimity', () => {
    const s = roomCommand(start(), owner.uid, cmd({ type: 'reveal' }), now).state
    expect(
      roomCommand(s, bob.uid, cmd({ type: 'vote', voteId: s.vote!.id, agree: false }), now).state
        .vote,
    ).toBeNull()
    expect(tickRoom(s, now + ROOM_VOTE_MS).state.vote).toBeNull()
    expect(joinRoom(s, { uid: 'third', name: '丙', handle: '' }, now).state.vote).toBeNull()
    expect(roomCommand(s, owner.uid, cmd({ type: 'kick', uid: bob.uid }), now).state.phase).toBe(
      'playing',
    )
  })
  it('keeps today’s bowl locked, including natural-language answer requests', () => {
    const s = start()
    s.puzzle.dailyDate = '2026-09-27'
    expect(() => roomCommand(s, owner.uid, cmd({ type: 'reveal' }), now)).toThrow('今天')
    const running = nextRoomQuestion(ask(s), now).state
    const result = completeRoomQuestion(
      running,
      running.processing!.leaseId,
      { ...answer, intent: 'meta', verdict: 'reveal', revealed: true },
      null,
      now,
    )
    expect(result.state.vote).toBeNull()
    expect(result.events.at(-1)?.turn?.revealed).toBe(false)
    expect(JSON.stringify(roomSnapshot(result.state, bob.uid))).not.toContain(puzzle.truth)
  })
  it('a text request cannot bypass voting or leak unexpected judge fields', () => {
    const s = nextRoomQuestion(ask(start()), now).state
    const result = completeRoomQuestion(
      s,
      s.processing!.leaseId,
      {
        ...answer,
        intent: 'meta',
        verdict: 'reveal_vote',
        revealed: false,
        truth: puzzle.truth,
        story: puzzle.story,
      } as RoomTurn,
      null,
      now,
    )
    expect(result.state.vote).not.toBeNull()
    expect(result.state.turns).toBe(0)
    expect(JSON.stringify(result.events)).not.toContain(puzzle.truth)
    expect(JSON.stringify(result.events)).not.toContain(puzzle.story)
  })
  it('solving ends the table even for today and clears the remaining queue', () => {
    let s = start()
    s.puzzle.dailyDate = '2026-09-27'
    s = nextRoomQuestion(ask(ask(s), bob.uid), now).state
    s = completeRoomQuestion(
      s,
      s.processing!.leaseId,
      { ...answer, intent: 'guess', solved: true, revealed: true },
      null,
      now,
    ).state
    expect(s.phase).toBe('solved')
    expect(s.queue).toEqual([])
    expect(s.revealVoters).toEqual([])
    expect(roomSnapshot(s, owner.uid).report?.story).toBe(puzzle.story)
  })
  it('leases expire to explicit retry and ignore late completions', () => {
    let s = nextRoomQuestion(ask(start()), now).state
    const lease = s.processing!.leaseId
    const question = s.processing!.id
    s = tickRoom(s, now + 50_001).state
    expect(s.failed).toHaveLength(1)
    expect(s.turns).toBe(0)
    expect(completeRoomQuestion(s, lease, answer, null, now).events).toEqual([])
    s = roomCommand(s, owner.uid, cmd({ type: 'retry', questionId: question }), now + 50_002).state
    s = nextRoomQuestion(s, now + 50_002).state
    expect(s.processing!.id).toBe(question)
    expect(s.processing!.leaseId).not.toBe(lease)
    s = completeRoomQuestion(s, s.processing!.leaseId, answer, null, now + 50_003).state
    expect(s.turns).toBe(1)
  })
  it('reserves a disconnected seat, then transfers the host and pauses the queue', () => {
    let s = roomPresence(ask(start(), bob.uid), owner.uid, false, now).state
    expect(tickRoom(s, now + ROOM_RECONNECT_MS - 1).state.hostId).toBe(owner.uid)
    s = tickRoom(s, now + ROOM_RECONNECT_MS).state
    expect(s.hostId).toBe(bob.uid)
    expect(nextRoomQuestion(s, now).state.processing).toBeNull()
    expect(joinRoom(s, owner, now).state.members.find((m) => m.uid === owner.uid)?.seat).toBe(
      'seated',
    )
  })
  it('removed members cannot rejoin, vote, read later roster changes, or see the answer', () => {
    let s = roomCommand(start(), owner.uid, cmd({ type: 'kick', uid: bob.uid }), now).state
    const cutoff = roomSnapshot(s, bob.uid).eventSeq
    expect(() => joinRoom(s, bob, now)).toThrow('移出')
    expect(() => roomCommand(s, bob.uid, cmd({ type: 'discuss', text: '偷发' }), now)).toThrow(
      '不在',
    )
    s = joinRoom(s, { uid: 'third', name: '丙', handle: '' }, now).state
    s = nextRoomQuestion(ask(s), now).state
    s = completeRoomQuestion(
      s,
      s.processing!.leaseId,
      { ...answer, intent: 'guess', solved: true, revealed: true },
      null,
      now,
    ).state
    const view = roomSnapshot(s, bob.uid)
    expect(view.eventSeq).toBe(cutoff)
    expect(view.members.map((m) => m.uid)).toEqual([bob.uid])
    expect(view.report).toBeUndefined()
    expect(view.inviteCode).toBeUndefined()
  })
  it('ends idle rooms with a preserved, non-spoiling record', () => {
    const s = tickRoom(start(), now + ROOM_IDLE_MS).state
    expect(s.phase).toBe('abandoned')
    expect(roomSnapshot(s, owner.uid).report?.truth).toBeUndefined()
  })
  it('does not partially mutate authoritative state on invalid commands', () => {
    const s = start()
    const before = structuredClone(s)
    expect(() =>
      roomCommand(
        s,
        owner.uid,
        cmd({ type: 'ask', text: '他呢？', locale: 'zh-CN', referenceId: crypto.randomUUID() }),
        now,
      ),
    ).toThrow('不属于')
    expect(s).toEqual(before)
  })
  it('allows a former seated member to return when new invitations are closed', () => {
    let s = roomCommand(start(), bob.uid, cmd({ type: 'leave' }), now).state
    s = roomCommand(s, owner.uid, cmd({ type: 'invitations', open: false }), now).state
    expect(joinRoom(s, bob, now).state.members.find((m) => m.uid === bob.uid)?.seat).toBe('seated')
    expect(() => joinRoom(s, { uid: 'new', name: 'New', handle: '' }, now)).toThrow('停止接受邀请')
  })
  it('counts an in-flight question toward the table cap', () => {
    let s = start()
    s.turns = 599
    s = nextRoomQuestion(ask(s), now).state
    expect(() => ask(s, bob.uid)).toThrow('上限')
  })
})
