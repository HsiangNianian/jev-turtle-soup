/** 官方每日汤：每天 UTC 零点换新，当天的汤不许提前揭晓。 */

/** 每日汤原生用什么语言写的；读者界面语言可能是另一种。 */
export type DailyLocale = 'zh-CN' | 'en' | 'ja'

export interface DailySummary {
  date: string
  title: string
  difficulty: string
  tags: string[]
  locale: DailyLocale
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

/**
 * 今天这碗是什么语言，用**读者当前界面语言**说 —— 三种语言各有自己的说法，
 * 所以名字也走翻译字典，而不是写死「中文 / English / 日本語」。
 */
export function dailyLanguageLabel(locale: DailyLocale, t: (key: string) => string): string {
  if (locale === 'en') return t('英文')
  if (locale === 'ja') return t('日文')
  return t('中文')
}

/** 服务端的「今天」按 UTC 算，前端要判断今天是否仍锁着，也用同一个口径。 */
export function utcToday(): string {
  return new Date().toISOString().slice(0, 10)
}
