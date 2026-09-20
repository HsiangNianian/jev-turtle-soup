import type { ChatMessage, GameSession } from '@/lib/api'

export type GameStatus = 'active' | 'solved' | 'revealed' | 'abandoned'

export interface ArchivedGame {
  id: string
  title: string
  surface: string
  difficulty: string
  source: 'llm' | 'builtin' | 'library'
  hostGreeting: string
  hint: string
  createdAt: number
  updatedAt: number
  messages: ChatMessage[]
  revealed: boolean
  truth: string | null
  solved: boolean
  closeness: number | null
  turnCount: number
  status: GameStatus
}

const STORAGE_KEY = 'turtle-soup.archive.v1'

export const STATUS_LABEL: Record<GameStatus, string> = {
  active: '在办',
  solved: '已结案',
  revealed: '已揭晓',
  abandoned: '已中止',
}

function isArchivedGame(value: unknown): value is ArchivedGame {
  if (!value || typeof value !== 'object') return false
  const game = value as Partial<ArchivedGame>
  return (
    typeof game.id === 'string' &&
    typeof game.title === 'string' &&
    typeof game.surface === 'string' &&
    Array.isArray(game.messages)
  )
}

export function loadGames(): ArchivedGame[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isArchivedGame)
  } catch {
    return []
  }
}

export function saveGames(games: ArchivedGame[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(games))
  } catch {
    /* 隐私模式或超出配额时静默失败，游戏仍可继续 */
  }
}

export function upsertGame(games: ArchivedGame[], game: ArchivedGame): ArchivedGame[] {
  const index = games.findIndex((item) => item.id === game.id)
  if (index === -1) return [game, ...games]
  const next = games.slice()
  next[index] = game
  return next
}

export function toSession(game: ArchivedGame): GameSession {
  return {
    sessionId: game.id,
    title: game.title,
    surface: game.surface,
    difficulty: game.difficulty,
    source: game.source,
    hostGreeting: game.hostGreeting,
  }
}

export function buildLedger(messages: ChatMessage[]): { id: string; question: string; verdict: string }[] {
  const verdicts = ['yes', 'no', 'partly', 'irrelevant']
  const items: { id: string; question: string; verdict: string }[] = []
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]
    if (message.role !== 'player') continue
    const next = messages[index + 1]
    if (!next || next.role !== 'host') continue
    if (next.tone === 'celebrate') {
      items.push({ id: message.id, question: message.text, verdict: 'solved' })
    } else if (next.verdict && verdicts.includes(next.verdict)) {
      items.push({ id: message.id, question: message.text, verdict: next.verdict })
    }
  }
  return items
}

export function formatWhen(timestamp: number): string {
  const date = new Date(timestamp)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
