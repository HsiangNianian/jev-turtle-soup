/** 官方每日汤：每天 UTC 零点换新，当天的汤不许提前揭晓。 */

export interface DailySummary {
  date: string
  title: string
  difficulty: string
  tags: string[]
  relaxed: boolean
}

export interface DailyDetail extends DailySummary {
  puzzleId: string
  surface: string
  /** 当天未揭晓：服务端不会下发 truth / story / hint */
  locked: boolean
  truth?: string
  story?: string
  hint?: string
  review?: unknown
}

async function request<T>(path: string): Promise<T> {
  const response = await fetch(path, { headers: { Accept: 'application/json' } })
  const data = (await response.json().catch(() => ({}))) as { error?: string }
  if (!response.ok) throw new Error(data.error || `请求失败（${response.status}）`)
  return data as T
}

export function listDailies() {
  return request<{ today: DailyDetail | null; history: DailySummary[] }>('/api/daily')
}

export function getDaily(date: string) {
  return request<{ daily: DailyDetail }>(`/api/daily/${encodeURIComponent(date)}`).then(
    (data) => data.daily,
  )
}

/** 服务端的「今天」按 UTC 算，前端要判断今天是否仍锁着，也用同一个口径。 */
export function utcToday(): string {
  return new Date().toISOString().slice(0, 10)
}
