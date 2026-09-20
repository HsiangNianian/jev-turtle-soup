export interface GameSession {
  sessionId: string
  title: string
  surface: string
  truth: string
  hint: string
  difficulty: string
  source: 'llm' | 'builtin' | 'library'
  hostGreeting: string
  /** 题库里的题：汤底留在服务端，判读走 /api/library/puzzles/:id/ask */
  libraryId?: string
}

export interface ChoiceDebug {
  choice: string
  confidence: number
  probabilities: Record<string, number>
}

export interface ScoreDebug {
  score: number
  confidence: number
  probabilities: Record<string, number>
}

export interface DebugInfo {
  intent: ChoiceDebug
  verdict: ChoiceDebug
  solved: number
  closeness: ScoreDebug
  metaRequest: {
    choice: string
    confidence: number
  }
}

export interface HostTurn {
  intent: string
  verdict: string
  solved: boolean
  revealed: boolean
  closeness: number | null
  confidence: number | null
  reply: string
  model: string
  debug: DebugInfo
}

export interface HealthInfo {
  ok: boolean
  typesafeConfigured: boolean
  llm: { provider: string; model: string } | null
  fallbackPuzzles: number
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = (await response.json().catch(() => ({}))) as { error?: string }
  if (!response.ok) {
    throw new Error(data.error || `请求失败（${response.status}）`)
  }
  return data as T
}

export function fetchHealth() {
  return fetch('/api/health').then(async (response) => {
    if (!response.ok) throw new Error('无法读取服务状态')
    return (await response.json()) as HealthInfo
  })
}

export function createGame(difficulty: string, theme: string) {
  return postJson<GameSession>('/api/game/new', { difficulty, theme })
}

export function askHost(session: GameSession, message: string, history: ChatMessage[]) {
  return postJson<HostTurn>('/api/game/ask', {
    puzzle: {
      title: session.title,
      surface: session.surface,
      truth: session.truth,
      hint: session.hint,
    },
    message,
    history: history.map(({ role, text }) => ({ role, text })),
  })
}

export interface ChatMessage {
  id: string
  role: 'host' | 'player'
  text: string
  tone?: 'normal' | 'verdict' | 'celebrate' | 'error'
  verdict?: string
  closeness?: number | null
  debug?: DebugInfo
  model?: string
}
