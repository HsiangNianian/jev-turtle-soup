import { ApiError } from './errors.ts'
import {
  ROOM_CAPACITY,
  ROOM_IDLE_MS,
  ROOM_PROTOCOL,
  ROOM_RECONNECT_MS,
  ROOM_VOTE_MS,
  type RoomActor,
  type RoomCommand,
  type RoomEvent,
  type RoomMember,
  type RoomPhase,
  type RoomPuzzle,
  type RoomQuestion,
  type RoomSnapshot,
  type RoomTurn,
  type RoomVote,
} from './room-protocol.ts'

export interface RoomSecretPuzzle extends RoomPuzzle {
  ownerId: string
  truth: string
  hint: string
  story?: string
}
export interface RoomState {
  id: string
  revision: number
  inviteCode: string
  puzzle: RoomSecretPuzzle
  phase: RoomPhase
  hostId: string
  createdAt: number
  updatedAt: number
  eventSeq: number
  turns: number
  members: RoomMember[]
  queue: RoomQuestion[]
  processing: (RoomQuestion & { leaseId: string; deadline: number }) | null
  failed: RoomQuestion[]
  recentQuestions: { id: string; uid: string; text: string }[]
  vote: RoomVote | null
  revealPending: string | null
  invitationsOpen: boolean
  authorParticipated: boolean
  revealVoters: string[]
  finishedAt: number | null
  discussionCount: number
}
export interface RoomChange {
  state: RoomState
  events: RoomEvent[]
}
export const isRoomFinished = (s: RoomState) =>
  ['solved', 'revealed', 'abandoned'].includes(s.phase)
export const seated = (s: RoomState) => s.members.filter((m) => m.seat === 'seated')
export const memberOf = (s: RoomState, uid: string) => s.members.find((m) => m.uid === uid)

function requireSeat(s: RoomState, uid: string) {
  const member = memberOf(s, uid)
  if (!member || member.seat !== 'seated') throw new ApiError(403, '你已不在这一桌')
  return member
}
function emit(change: RoomChange, now: number, event: Omit<RoomEvent, 'seq' | 'id' | 'at'>) {
  change.events.push({ ...event, seq: ++change.state.eventSeq, id: crypto.randomUUID(), at: now })
}
function system(c: RoomChange, now: number, text: string) {
  emit(c, now, { type: 'system', text })
}
function cancelVote(c: RoomChange, now: number, reason: string) {
  if (c.state.vote || c.state.revealPending) system(c, now, reason)
  c.state.vote = null
  c.state.revealPending = null
}
function finish(c: RoomChange, phase: 'solved' | 'revealed' | 'abandoned', now: number) {
  const s = c.state
  s.phase = phase
  s.finishedAt = now
  s.updatedAt = now
  s.queue = []
  s.failed = []
  s.processing = null
  s.vote = null
  s.revealPending = null
  s.invitationsOpen = false
  system(
    c,
    now,
    phase === 'solved'
      ? '同桌共同结案。'
      : phase === 'revealed'
        ? '全体同意，汤底已揭晓。'
        : '这一桌已中止，记录已保存。',
  )
}
function leave(c: RoomChange, uid: string, now: number, removed = false) {
  const s = c.state
  const member = requireSeat(s, uid)
  cancelVote(c, now, '成员发生变化，本次揭晓投票已取消。')
  member.seat = removed ? 'removed' : 'left'
  member.disconnectedAt = now
  s.queue = s.queue.filter((q) => q.uid !== uid)
  s.failed = s.failed.filter((q) => q.uid !== uid)
  system(c, now, `${member.name}${removed ? '已被移出同桌' : '已离座'}。`)
  if (removed) {
    member.cutoffSeq = s.eventSeq
    member.cutoffTurns = s.turns
  }
  if (s.hostId === uid) {
    const next = seated(s).sort(
      (a, b) =>
        Number(a.disconnectedAt !== null) - Number(b.disconnectedAt !== null) ||
        a.joinedAt - b.joinedAt,
    )[0]
    s.hostId = next?.uid ?? ''
    if (next) system(c, now, `${next.name}成为房主。`)
  }
}
function openVote(c: RoomChange, uid: string, now: number) {
  const s = c.state
  if (s.puzzle.dailyDate === new Date(now).toISOString().slice(0, 10))
    throw new ApiError(409, '今天的官方汤还不能主动揭晓')
  requireSeat(s, uid)
  if (seated(s).length < 2) throw new ApiError(409, '至少两人在座才能发起共同揭晓')
  s.vote = {
    id: crypto.randomUUID(),
    requestedBy: uid,
    members: seated(s).map((m) => m.uid),
    agreed: [uid],
    expiresAt: now + ROOM_VOTE_MS,
  }
  s.revealPending = null
  system(c, now, `${requireSeat(s, uid).name}发起揭晓投票，需要全体在座成员同意。`)
}

export function createRoom(
  id: string,
  inviteCode: string,
  puzzle: RoomSecretPuzzle,
  actor: RoomActor,
  now: number,
): RoomChange {
  const state: RoomState = {
    id,
    revision: 0,
    inviteCode,
    puzzle,
    phase: 'waiting',
    hostId: actor.uid,
    createdAt: now,
    updatedAt: now,
    eventSeq: 0,
    turns: 0,
    members: [{ ...actor, joinedAt: now, seat: 'seated', disconnectedAt: now, questions: 0 }],
    queue: [],
    processing: null,
    failed: [],
    recentQuestions: [],
    vote: null,
    revealPending: null,
    invitationsOpen: true,
    authorParticipated: actor.uid === puzzle.ownerId,
    revealVoters: [],
    finishedAt: null,
    discussionCount: 0,
  }
  const c = { state, events: [] as RoomEvent[] }
  system(c, now, `${actor.name}开了一桌。`)
  return c
}

export function joinRoom(previous: RoomState, actor: RoomActor, now: number): RoomChange {
  const c = { state: structuredClone(previous), events: [] as RoomEvent[] }
  const s = c.state
  const existing = memberOf(s, actor.uid)
  if (existing?.seat === 'removed') throw new ApiError(403, '你已被移出这一桌')
  if (existing?.seat === 'seated' || (existing && isRoomFinished(s))) return c
  if (isRoomFinished(s) || (!s.invitationsOpen && !existing))
    throw new ApiError(409, '这一桌已停止接受邀请')
  if (seated(s).length >= ROOM_CAPACITY) throw new ApiError(409, '这一桌已经坐满了')
  if (!existing && s.members.length >= 100)
    throw new ApiError(409, '这一桌参与人数已达上限，请另开一桌')
  cancelVote(c, now, '有新成员入座，本次揭晓投票已取消。')
  if (existing) Object.assign(existing, actor, { seat: 'seated', disconnectedAt: now })
  else
    s.members.push({ ...actor, joinedAt: now, seat: 'seated', disconnectedAt: now, questions: 0 })
  if (!s.hostId) s.hostId = actor.uid
  s.authorParticipated ||= actor.uid === s.puzzle.ownerId
  s.updatedAt = now
  system(c, now, `${actor.name}入座了。`)
  return c
}

export function roomPresence(
  previous: RoomState,
  uid: string,
  connected: boolean,
  now: number,
): RoomChange {
  const c = { state: structuredClone(previous), events: [] as RoomEvent[] }
  const member = memberOf(c.state, uid)
  if (member?.seat === 'seated' && !isRoomFinished(c.state)) {
    member.disconnectedAt = connected ? null : (member.disconnectedAt ?? now)
  }
  return c
}

export function roomCommand(
  previous: RoomState,
  uid: string,
  cmd: RoomCommand,
  now: number,
  lookup?: (id: string) => RoomQuestion['reference'] | undefined,
): RoomChange {
  const c = { state: structuredClone(previous), events: [] as RoomEvent[] }
  const s = c.state
  const member = requireSeat(s, uid)
  if (isRoomFinished(s)) throw new ApiError(409, '这一桌已经结束，可以回看共同案卷')
  if (['start', 'kick', 'transfer', 'invitations'].includes(cmd.type) && s.hostId !== uid)
    throw new ApiError(403, '只有房主可以这样操作')
  switch (cmd.type) {
    case 'start':
      if (s.phase !== 'waiting') throw new ApiError(409, '这一桌已经开始了')
      if (seated(s).filter((m) => m.disconnectedAt === null).length < 2)
        throw new ApiError(409, '至少两人在线才能开始')
      s.phase = 'playing'
      system(c, now, '开局了。正式问题交给砚，桌内讨论可以随时继续。')
      break
    case 'discuss':
      if (s.discussionCount >= 10_000) throw new ApiError(429, '这一桌的讨论记录已达上限')
      s.discussionCount++
      emit(c, now, { type: 'discussion', actorId: uid, text: cmd.text })
      break
    case 'ask': {
      if (s.phase !== 'playing' || seated(s).length < 2)
        throw new ApiError(409, '请等同桌成员到齐并开始')
      if (s.vote || s.revealPending) throw new ApiError(409, '请先完成本次揭晓投票')
      if (s.turns + s.queue.length + (s.processing ? 1 : 0) >= 600)
        throw new ApiError(429, '这一桌的提问已达上限，可以共同揭晓或另开一桌')
      if (s.processing?.uid === uid || s.queue.some((q) => q.uid === uid))
        throw new ApiError(409, '你已经有一个问题在等砚回答')
      const reference = cmd.referenceId ? lookup?.(cmd.referenceId) : undefined
      if (cmd.referenceId && !reference) throw new ApiError(400, '引用的问题不属于这一桌')
      const question: RoomQuestion = {
        id: crypto.randomUUID(),
        uid,
        text: cmd.text,
        locale: cmd.locale,
        at: now,
        ...(reference ? { reference } : {}),
      }
      s.failed = s.failed.filter((q) => q.uid !== uid)
      s.queue.push(question)
      emit(c, now, {
        type: 'question',
        actorId: uid,
        text: cmd.text,
        questionId: question.id,
        referenceId: reference?.id,
      })
      break
    }
    case 'cancel': {
      const question = s.queue.find((q) => q.id === cmd.questionId && q.uid === uid)
      if (!question) throw new ApiError(409, '只能撤回自己尚未处理的问题')
      s.queue = s.queue.filter((q) => q !== question)
      system(c, now, `${member.name}撤回了排队的问题。`)
      break
    }
    case 'retry': {
      if (s.turns + s.queue.length + (s.processing ? 1 : 0) >= 600)
        throw new ApiError(429, '这一桌的提问已达上限，可以共同揭晓或另开一桌')
      if (s.phase !== 'playing' || seated(s).length < 2 || s.vote || s.revealPending)
        throw new ApiError(409, '现在不能重试，请等同桌恢复推理')
      if (s.processing?.uid === uid || s.queue.some((q) => q.uid === uid))
        throw new ApiError(409, '你已经有一个问题在等砚回答')
      const question = s.failed.find((q) => q.id === cmd.questionId && q.uid === uid)
      if (!question) throw new ApiError(404, '没有可重试的问题')
      s.failed = s.failed.filter((q) => q !== question)
      const { error: _error, ...retry } = question
      s.queue.push(retry)
      system(c, now, `${member.name}重试了刚才的问题。`)
      break
    }
    case 'reveal':
      if (s.phase !== 'playing') throw new ApiError(409, '请先开始这一桌')
      if (s.vote || s.revealPending) throw new ApiError(409, '已有揭晓投票在进行')
      if (s.puzzle.dailyDate === new Date(now).toISOString().slice(0, 10))
        throw new ApiError(409, '今天的官方汤还不能主动揭晓')
      if (seated(s).length < 2) throw new ApiError(409, '至少两人在座才能共同揭晓')
      if (s.processing) {
        s.revealPending = uid
        system(c, now, '当前问题答完后，将发起共同揭晓投票。')
      } else openVote(c, uid, now)
      break
    case 'vote':
      if (
        !s.vote ||
        s.vote.id !== cmd.voteId ||
        s.vote.expiresAt <= now ||
        !s.vote.members.includes(uid)
      )
        throw new ApiError(409, '本次投票已经失效')
      if (!cmd.agree) {
        cancelVote(c, now, `${member.name}选择继续推理，本次投票未通过。`)
        break
      }
      if (!s.vote.agreed.includes(uid)) s.vote.agreed.push(uid)
      if (s.vote.members.every((id) => s.vote!.agreed.includes(id))) {
        s.revealVoters = [...s.vote.members]
        finish(c, 'revealed', now)
      }
      break
    case 'leave':
      leave(c, uid, now)
      break
    case 'kick':
      if (cmd.uid === uid) throw new ApiError(400, '请使用离座操作')
      leave(c, cmd.uid, now, true)
      break
    case 'transfer':
      requireSeat(s, cmd.uid)
      s.hostId = cmd.uid
      system(c, now, `${requireSeat(s, cmd.uid).name}成为房主。`)
      break
    case 'invitations':
      s.invitationsOpen = cmd.open
      break
  }
  s.updatedAt = now
  return c
}

/** Start a persisted lease before any external I/O. A stale completion cannot commit. */
export function nextRoomQuestion(previous: RoomState, now: number): RoomChange {
  const c = { state: structuredClone(previous), events: [] as RoomEvent[] }
  const s = c.state
  if (s.phase !== 'playing' || s.processing || s.vote || seated(s).length < 2) return c
  if (s.revealPending) {
    const uid = s.revealPending
    s.revealPending = null
    if (memberOf(s, uid)?.seat === 'seated') openVote(c, uid, now)
    return c
  }
  const question = s.queue.shift()
  if (question) s.processing = { ...question, leaseId: crypto.randomUUID(), deadline: now + 50_000 }
  return c
}

export function completeRoomQuestion(
  previous: RoomState,
  leaseId: string,
  turn: RoomTurn | null,
  error: string | null,
  now: number,
): RoomChange {
  const c = { state: structuredClone(previous), events: [] as RoomEvent[] }
  const s = c.state
  const question = s.processing
  if (!question || question.leaseId !== leaseId || isRoomFinished(s)) return c
  s.processing = null
  if (!turn) {
    if (memberOf(s, question.uid)?.seat === 'seated') {
      s.failed = s.failed.filter((q) => q.uid !== question.uid)
      s.failed.push({
        id: question.id,
        uid: question.uid,
        text: question.text,
        locale: question.locale,
        at: question.at,
        reference: question.reference,
        error: error ?? '砚暂时没有回应，请重试',
      })
    }
    system(c, now, error ?? '砚暂时没有回应，提问者可以重试。')
    return c
  }
  // Select public fields explicitly. A judge response may also contain private truth/story/debug.
  const answer: RoomTurn = {
    intent: turn.intent,
    verdict: turn.verdict,
    reply: turn.reply,
    solved: turn.solved,
    revealed: turn.solved,
    closeness: turn.closeness,
    replyLocale: turn.replyLocale,
  }
  if (turn.verdict === 'reveal' || turn.verdict === 'reveal_vote') {
    answer.revealed = false
    answer.reply =
      s.puzzle.dailyDate === new Date(now).toISOString().slice(0, 10)
        ? '今天的官方汤还不能主动揭晓。'
        : '揭晓需要全体同桌同意，请在投票中确认。'
    if (
      !s.vote &&
      memberOf(s, question.uid)?.seat === 'seated' &&
      seated(s).length >= 2 &&
      s.puzzle.dailyDate !== new Date(now).toISOString().slice(0, 10)
    )
      openVote(c, question.uid, now)
  }
  if (['yes_no_question', 'guess'].includes(turn.intent)) {
    s.turns++
    const member = memberOf(s, question.uid)
    if (member) member.questions++
    s.recentQuestions = [
      ...s.recentQuestions,
      { id: question.id, uid: question.uid, text: question.text },
    ].slice(-10)
  }
  emit(c, now, {
    type: 'answer',
    actorId: question.uid,
    questionId: question.id,
    text: answer.reply,
    turn: answer,
  })
  if (turn.solved) finish(c, 'solved', now)
  return c
}

export function tickRoom(previous: RoomState, now: number): RoomChange {
  const c = { state: structuredClone(previous), events: [] as RoomEvent[] }
  const s = c.state
  if (isRoomFinished(s)) return c
  if (now - s.updatedAt >= ROOM_IDLE_MS) {
    finish(c, 'abandoned', now)
    return c
  }
  for (const member of seated(s)) {
    if (member.disconnectedAt !== null && now - member.disconnectedAt >= ROOM_RECONNECT_MS)
      leave(c, member.uid, now)
  }
  if (s.vote && s.vote.expiresAt <= now) cancelVote(c, now, '揭晓投票超时，继续推理。')
  if (s.processing && s.processing.deadline <= now) {
    const failed = completeRoomQuestion(
      s,
      s.processing.leaseId,
      null,
      '这次回答未能完成，请重试。',
      now,
    )
    c.state = failed.state
    c.events.push(...failed.events)
  }
  return c
}

export function roomSnapshot(s: RoomState, uid: string): RoomSnapshot {
  const member = memberOf(s, uid)
  if (!member) throw new ApiError(404, '没有这份同桌案卷')
  const removed = member.seat === 'removed'
  const { id, title, surface, difficulty, dailyDate } = s.puzzle
  const publicQuestion = (q: RoomQuestion): RoomQuestion => ({
    id: q.id,
    uid: q.uid,
    text: q.text,
    locale: q.locale,
    at: q.at,
    reference: q.reference,
    error: q.error,
  })
  return {
    protocol: ROOM_PROTOCOL,
    revision: removed ? member.cutoffSeq! : s.revision,
    roomId: s.id,
    meId: uid,
    puzzle: { id, title, surface, difficulty, dailyDate },
    phase: removed ? 'abandoned' : s.phase,
    hostId: removed ? '' : s.hostId,
    createdAt: s.createdAt,
    updatedAt: removed ? member.disconnectedAt! : s.updatedAt,
    eventSeq: removed ? member.cutoffSeq! : s.eventSeq,
    turns: removed ? (member.cutoffTurns ?? 0) : s.turns,
    members: removed ? [{ ...member }] : s.members.map((m) => ({ ...m })),
    queue: removed ? [] : s.queue.map(publicQuestion),
    processing: removed || !s.processing ? null : publicQuestion(s.processing),
    failed: removed ? [] : s.failed.map(publicQuestion),
    vote: removed ? null : structuredClone(s.vote),
    revealPending: !removed && Boolean(s.revealPending),
    invitationsOpen: !removed && s.invitationsOpen,
    readOnly: removed || isRoomFinished(s) || member.seat !== 'seated',
    ...(!removed && !isRoomFinished(s) ? { inviteCode: s.inviteCode } : {}),
    ...(!removed && s.finishedAt
      ? {
          report: {
            outcome: s.phase as 'solved' | 'revealed' | 'abandoned',
            turns: s.turns,
            finishedAt: s.finishedAt,
            authorParticipated: s.authorParticipated,
            ...(s.phase === 'solved' || s.phase === 'revealed'
              ? { truth: s.puzzle.truth, hint: s.puzzle.hint, story: s.puzzle.story }
              : {}),
          },
        }
      : {}),
  }
}
