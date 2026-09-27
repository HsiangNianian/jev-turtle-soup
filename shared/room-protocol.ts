import { z } from 'zod'

export const ROOM_PROTOCOL = 1 as const
export const ROOM_CAPACITY = 6
export const ROOM_RECONNECT_MS = 120_000
export const ROOM_VOTE_MS = 60_000
export const ROOM_IDLE_MS = 86_400_000
export const ROOM_FRAME_BYTES = 8192
export const ROOM_MESSAGE_CHARS = 600

export type RoomPhase = 'waiting' | 'playing' | 'solved' | 'revealed' | 'abandoned'
export type RoomLocale = 'zh-CN' | 'en' | 'ja'
export interface RoomActor {
  uid: string
  name: string
  handle: string
}
export interface RoomMember extends RoomActor {
  joinedAt: number
  seat: 'seated' | 'left' | 'removed'
  disconnectedAt: number | null
  questions: number
  cutoffSeq?: number
  cutoffTurns?: number
}
export interface RoomPuzzle {
  id: string
  title: string
  surface: string
  difficulty: string
  dailyDate?: string
}
export interface RoomQuestion {
  id: string
  uid: string
  text: string
  locale: RoomLocale
  at: number
  reference?: { id: string; uid: string; text: string }
  error?: string
}
export interface RoomTurn {
  intent: string
  verdict: string
  reply: string
  solved: boolean
  revealed: boolean
  closeness: number | null
  replyLocale?: RoomLocale
}
export interface RoomVote {
  id: string
  requestedBy: string
  members: string[]
  agreed: string[]
  expiresAt: number
}
export interface RoomReport {
  outcome: 'solved' | 'revealed' | 'abandoned'
  turns: number
  finishedAt: number
  authorParticipated: boolean
  truth?: string
  hint?: string
  story?: string
}
export interface RoomEvent {
  seq: number
  id: string
  at: number
  type: 'system' | 'discussion' | 'question' | 'answer'
  actorId?: string
  text: string
  questionId?: string
  referenceId?: string
  turn?: RoomTurn
}
export interface RoomSnapshot {
  protocol: typeof ROOM_PROTOCOL
  revision: number
  roomId: string
  meId: string
  phase: RoomPhase
  hostId: string
  puzzle: RoomPuzzle
  createdAt: number
  updatedAt: number
  eventSeq: number
  turns: number
  members: RoomMember[]
  queue: RoomQuestion[]
  processing: RoomQuestion | null
  failed: RoomQuestion[]
  vote: RoomVote | null
  revealPending: boolean
  invitationsOpen: boolean
  readOnly: boolean
  inviteCode?: string
  report?: RoomReport
}
export interface RoomSummary {
  roomId: string
  title: string
  phase: RoomPhase
  turns: number
  updatedAt: number
}
export type RoomServerMessage =
  | { type: 'snapshot'; snapshot: RoomSnapshot; events: RoomEvent[]; hasMore: boolean }
  | { type: 'update'; snapshot: RoomSnapshot; events: RoomEvent[] }
  | { type: 'ack'; commandId: string; eventSeq: number }
  | {
      type: 'error'
      commandId?: string
      status: number
      error: string
      terminal?: 'auth' | 'removed'
    }

const id = z.string().uuid()
const plain = z.string().trim().min(1).max(ROOM_MESSAGE_CHARS)
const base = { commandId: id }
export const roomCommandSchema = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('start') }).strict(),
  z.object({ ...base, type: z.literal('discuss'), text: plain }).strict(),
  z
    .object({
      ...base,
      type: z.literal('ask'),
      text: plain,
      locale: z.enum(['zh-CN', 'en', 'ja']),
      referenceId: id.optional(),
    })
    .strict(),
  z.object({ ...base, type: z.literal('cancel'), questionId: id }).strict(),
  z.object({ ...base, type: z.literal('retry'), questionId: id }).strict(),
  z.object({ ...base, type: z.literal('reveal') }).strict(),
  z.object({ ...base, type: z.literal('vote'), voteId: id, agree: z.boolean() }).strict(),
  z.object({ ...base, type: z.literal('leave') }).strict(),
  z.object({ ...base, type: z.literal('kick'), uid: z.string().min(1).max(128) }).strict(),
  z.object({ ...base, type: z.literal('transfer'), uid: z.string().min(1).max(128) }).strict(),
  z.object({ ...base, type: z.literal('invitations'), open: z.boolean() }).strict(),
])
export type RoomCommand = z.infer<typeof roomCommandSchema>

/** Codes contain 60 random bits. Links are parsed, never followed as API URLs. */
export function parseRoomCode(input: string): string | null {
  let code = input.trim()
  if (/^https?:\/\//i.test(code)) {
    try {
      const url = new URL(code)
      if (url.origin !== 'https://hgt.mmstudio.games' || url.pathname !== '/rooms/join') return null
      code = url.searchParams.get('code') ?? ''
    } catch {
      return null
    }
  }
  code = code.replace(/[ -]/g, '').toUpperCase()
  return /^[A-HJ-NP-Z2-9]{12}$/.test(code) ? code : null
}
