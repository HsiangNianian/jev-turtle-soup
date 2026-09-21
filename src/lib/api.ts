export interface GameSession {
  sessionId: string
  title: string
  surface: string
  difficulty: string
  source: 'llm' | 'builtin' | 'library'
  hostGreeting: string
  /** 题库里的题：判读走 /api/library/puzzles/:id/ask */
  libraryId?: string
}

/** 汤底只存在于服务端；只有揭晓时才拿到。 */
export interface RevealResult {
  title: string
  truth: string
  hint: string
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
  /** 仅在本次揭晓时返回（服务端不主动给答案）。 */
  truth?: string
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

export type Genre = 'realistic' | 'supernatural'

export interface GenerateProgress {
  stage: 'thinking' | 'writing'
  chars: number
  round: number
}

/** 出题接口是 SSE：边生成边拿进度，避免长静默连接被掐断。 */
export async function createGame(
  difficulty: string,
  theme: string,
  genre: Genre,
  locale: string,
  onProgress?: (progress: GenerateProgress) => void,
): Promise<GameSession> {
  const response = await fetch('/api/game/new', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({ difficulty, theme, genre, locale }),
  })

  const streamed = response.headers.get('content-type')?.includes('event-stream')
  if (!streamed) {
    // 本地 dev 中间件没有 SSE，退回一次性 JSON
    const data = (await response.json().catch(() => ({}))) as { error?: string }
    if (!response.ok) throw new Error(data.error || `请求失败（${response.status}）`)
    return data as GameSession
  }
  if (!response.body) throw new Error('连接中断，请重试')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let result: GameSession | null = null
  let failure: string | null = null

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const frames = buffer.split('\n\n')
    buffer = frames.pop() ?? ''
    for (const frame of frames) {
      const event = frame.match(/^event: (\w+)/m)?.[1]
      const raw = frame.match(/^data: (.*)$/m)?.[1]
      if (!event || !raw) continue
      let payload: unknown
      try {
        payload = JSON.parse(raw)
      } catch {
        continue
      }
      if (event === 'progress') onProgress?.(payload as GenerateProgress)
      if (event === 'done') result = payload as GameSession
      if (event === 'error') failure = (payload as { error?: string }).error ?? '生成失败'
    }
  }

  if (failure) throw new Error(failure)
  if (!result) throw new Error('生成中断，请重试')
  return result
}

export interface LuckPayload {
  date: string
  score: number
  tier: string
  good: string
  bad: string
}

export interface AskContext {
  locale: string
  playerKey: string
  seq: number
  luck?: LuckPayload
}

export function askHost(
  session: GameSession,
  message: string,
  history: ChatMessage[],
  context: AskContext,
) {
  return postJson<HostTurn>('/api/game/ask', {
    puzzleId: session.sessionId,
    message,
    history: history.map(({ role, text }) => ({ role, text })),
    ...context,
  })
}

export function revealGame(sessionId: string) {
  return postJson<RevealResult>('/api/game/reveal', { puzzleId: sessionId })
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
