import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import worker from '../worker/index'
import { dailyLanguageLabel, type DailyDetail, type DailyIndex } from '../src/lib/daily-client'
import { database } from './sqlite'

let data: ReturnType<typeof database>

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-24T12:00:00Z'))
  data = database()
})

afterEach(() => {
  data.sqlite.close()
  vi.useRealTimers()
})

function seed(date: string, title: string, locale?: string, genreScore: number | null = null) {
  data.sqlite
    .prepare(
      `INSERT INTO puzzles
         (id, owner_id, title, surface, truth, genre_score, visibility, created_at)
       VALUES (?, '', ?, 'surface', 'truth', ?, 'daily', ?)`,
    )
    .run(date, title, genreScore, Date.parse(`${date}T00:00:00Z`))
  data.sqlite
    .prepare(
      `INSERT INTO dailies (date, puzzle_id, story, created_at)
       VALUES (?, ?, 'story', ?)`,
    )
    .run(date, date, Date.parse(`${date}T00:00:00Z`))
  if (locale !== undefined) {
    data.sqlite.prepare('UPDATE dailies SET locale = ? WHERE date = ?').run(locale, date)
  }
}

async function get<T>(path: string): Promise<T> {
  const response = await worker.fetch(new Request(`http://localhost${path}`), { DB: data.db })
  expect(response.status).toBe(200)
  return response.json() as Promise<T>
}

describe('daily API metadata against the current schema', () => {
  it.each([
    { storedLocale: 'en', locale: 'en', title: 'Signed Rose', label: '英文', genreScore: 20 },
    { storedLocale: 'ja', locale: 'ja', title: '署名のある薔薇', label: '日文', genreScore: 0 },
    { storedLocale: 'zh-CN', locale: 'zh-CN', title: '署名玫瑰', label: '中文', genreScore: 90 },
    { storedLocale: undefined, locale: 'zh-CN', title: '旧汤', label: '中文', genreScore: null },
  ])(
    'keeps $locale metadata consistent between history and detail ($title)',
    async ({ storedLocale, locale, title, label, genreScore }) => {
      seed('2026-09-23', title, storedLocale, genreScore)

      const index = await get<DailyIndex>('/api/daily')
      const { daily } = await get<{ daily: DailyDetail }>('/api/daily/2026-09-23')

      expect(index.today).toBeNull()
      expect(index.history).toHaveLength(1)
      const summary = index.history[0]
      expect(summary).toMatchObject({ date: daily.date, title, locale, genreScore })
      expect(daily).toMatchObject({ locale, genreScore, locked: false })
      expect(dailyLanguageLabel(summary.locale, (key) => key)).toBe(label)
      expect(summary).not.toHaveProperty('truth')
      expect(summary).not.toHaveProperty('story')
    },
  )

  it('keeps an English daily labelled English when it moves into history at UTC midnight', async () => {
    vi.setSystemTime(new Date('2026-09-23T23:59:59Z'))
    seed('2026-09-23', 'Signed Rose', 'en', 20)

    const before = await get<DailyIndex>('/api/daily')
    expect(before.today).toMatchObject({ title: 'Signed Rose', locale: 'en', locked: true })
    expect(before.today).not.toHaveProperty('truth')

    vi.setSystemTime(new Date('2026-09-24T00:00:00Z'))
    seed('2026-09-24', '八点半的电梯', 'zh-CN', 10)
    const after = await get<DailyIndex>('/api/daily')
    const past = after.history.filter((item) => item.date !== after.today?.date)

    expect(after.today).toMatchObject({ locale: 'zh-CN', locked: true })
    expect(past).toHaveLength(1)
    expect(past[0]).toMatchObject({ title: 'Signed Rose', locale: 'en', genreScore: 20 })
    expect(dailyLanguageLabel(past[0].locale, (key) => key)).toBe('英文')
  })
})
