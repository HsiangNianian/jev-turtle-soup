import { staleWhileRevalidate } from '@/lib/cache'

/** 官方每日汤：每天 UTC 零点换新，当天的汤不许提前揭晓。 */

/** 每日汤原生用什么语言写的；读者界面语言可能是另一种。 */
export type DailyLocale = 'zh-CN' | 'en' | 'ja'

export interface DailyIndex {
  today: DailyDetail | null
  history: DailySummary[]
}

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

/**
 * 今天的汤一整天都是同一碗，历史也不会变。除了进程内记住，还写进 localStorage：
 * 刷新页面之后也能直接渲染，不用再等一次接口。
 * 键里带上 UTC 日期：跨过午夜自动失效，不会把「今天」当成昨天。
 */
const DAILY_TTL_MS = 12 * 60 * 60 * 1000

let indexCache: {
  key: string
  value: { today: DailyDetail | null; history: DailySummary[] }
} | null = null
const dailyCache = new Map<string, DailyDetail>()

async function request<T>(path: string): Promise<T> {
  const response = await fetch(path, { headers: { Accept: 'application/json' } })
  const data = (await response.json().catch(() => ({}))) as { error?: string }
  if (!response.ok) throw new Error(data.error || `请求失败（${response.status}）`)
  return data as T
}

export function listDailies(hooks: { onStale?: (value: DailyIndex) => void } = {}) {
  const key = utcToday()
  if (indexCache?.key === key) return Promise.resolve(indexCache.value)
  return staleWhileRevalidate<DailyIndex>(`daily:${key}`, DAILY_TTL_MS, () =>
    request<DailyIndex>('/api/daily'),
    hooks,
  ).then((value) => {
    indexCache = { key, value }
    return value
  })
}

export function getDaily(date: string, hooks: { onStale?: (value: DailyDetail) => void } = {}) {
  // 今天这一页在午夜之后会从「锁定」变成「已解锁」，所以今天的不跨会话缓存
  if (date === utcToday()) {
    const hot = dailyCache.get(date)
    if (hot) return Promise.resolve(hot)
    return request<{ daily: DailyDetail }>(`/api/daily/${encodeURIComponent(date)}`).then(
      (data) => data.daily,
    )
  }
  return staleWhileRevalidate<DailyDetail>(`daily:${date}`, DAILY_TTL_MS, () =>
    request<{ daily: DailyDetail }>(`/api/daily/${encodeURIComponent(date)}`).then(
      (data) => data.daily,
    ),
    hooks,
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
