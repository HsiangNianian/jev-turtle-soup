export interface GameSession {
  sessionId: string
  title: string
  surface: string
  difficulty: string
  source: 'llm' | 'builtin' | 'library' | 'daily'
  hostGreeting: string
  /** 题库里的题：判读走 /api/library/puzzles/:id/ask */
  libraryId?: string
  /** 官方每日汤：记下日期，用来判断当天是否还锁着汤底 */
  dailyDate?: string
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
  /** 玩家这句话有没有解释掉汤面里那个反常（通关判定用的就是它） */
  explainsSurface: number
  closeness: ScoreDebug
  metaRequest: {
    choice: string
    confidence: number
  }
  /** 三个独立的推理维度（替掉原来单一的接近度） */
  dimensions?: { motive: number; method: number; twist: number }
  /** 玩家这条消息用的语言 */
  messageLanguage?: { choice: string; confidence: number }
  /** 一致性自查：本次回答是否与已确立的结论矛盾、是否与某条重复 */
  contradictsEarlier?: { noul: number }
  matchesEarlier?: { choice: string; confidence: number }
  /** 问的是某条结论的反面时，复用并取反的那条 */
  oppositeOf?: { choice: string; confidence: number }
}

export interface HostTurn {
  intent: string
  verdict: string
  solved: boolean
  revealed: boolean
  /** 主持人这次用的语言（跟随玩家提问的语言，可能与界面语言不同）。 */
  replyLocale?: 'zh-CN' | 'en' | 'ja'
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

/**
 * 今日人品由前端算，但只把号码交给服务端：档位用 key、宜忌用槽位下标。
 * 用词由服务端按**回复语言**决定，否则中文词会漏进英文或日文的回答。
 */
export interface LuckPayload {
  date: string
  score: number
  tierKey: string
  goodIndex: number
  badIndex: number
}

export interface AskContext {
  locale: string
  playerKey: string
  seq: number
  luck?: LuckPayload
  /** 已经确立的结论，用来保证重复提问得到一致的回答。 */
  established?: { question: string; verdict: string }[]
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

export interface ChatMessage {
  id: string
  role: 'host' | 'player'
  text: string
  tone?: 'normal' | 'verdict' | 'celebrate' | 'error'
  verdict?: string
  /** 判定徽章按这个语言渲染 */
  replyLocale?: 'zh-CN' | 'en' | 'ja'
  closeness?: number | null
  debug?: DebugInfo
  model?: string
}
