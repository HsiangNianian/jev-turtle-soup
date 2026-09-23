import type {
  GameSession,
  HostTurn,
  HealthInfo,
  RevealResult,
  AskContext,
  ChatMessage,
} from '@turtle-soup/client-core/types'
export type {
  GameSession,
  RevealResult,
  ChoiceDebug,
  ScoreDebug,
  DebugInfo,
  HostTurn,
  HealthInfo,
  LuckPayload,
  AskContext,
  ChatMessage,
} from '@turtle-soup/client-core/types'

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

export function revealGame(sessionId: string, locale: string) {
  return postJson<RevealResult>('/api/game/reveal', { puzzleId: sessionId, locale })
}
