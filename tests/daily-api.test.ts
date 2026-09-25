import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import worker from '../worker/index'
import { recordPlay } from '../shared/library'
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
  vi.unstubAllGlobals()
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
    ['2026-09-24', '/api/game/ask'],
    ['2026-09-23', '/api/library/puzzles/2026-09-23/ask'],
  ])(
    'passes the original story for daily %s without replaying old verdicts',
    async (date, path) => {
      seed(date, '官汤')
      data.sqlite
        .prepare('UPDATE dailies SET story = ? WHERE date = ?')
        .run('哥哥在十九岁时死了。', date)
      const modelFetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            model: 'test',
            answers: {
              intent: {
                choice: 'yes_no_question',
                confidence: 1,
                probabilities: { yes_no_question: 1 },
              },
              verdict: { choice: 'yes', confidence: 1, probabilities: { yes: 1 } },
              motive_correct: { noul: 0 },
              method_correct: { noul: 0 },
              twist_correct: { noul: 0 },
              solved: { noul: 0 },
              meta_request: { choice: 'none', confidence: 1, probabilities: { none: 1 } },
            },
          }),
          { headers: { 'content-type': 'application/json' } },
        ),
      )
      vi.stubGlobal('fetch', modelFetch)
      const response = await worker.fetch(
        new Request(`http://localhost${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            puzzleId: date,
            message: '哥哥十九岁死的吗？',
            locale: 'zh-CN',
            playerKey: 'daily-test',
            history: [
              { role: 'player', text: '哥哥十九岁死了吗？' },
              { role: 'host', text: '不是。' },
            ],
          }),
        }),
        { DB: data.db, TYPESAFE_API_KEY: 'local-test-only' },
      )
      expect(response.status).toBe(200)
      const request = JSON.parse(modelFetch.mock.calls[0][1].body)
      expect(request.state.puzzle.story).toBe('哥哥在十九岁时死了。')
      expect(request.state.recent_player_messages).toEqual([
        { role: 'player', text: '哥哥十九岁死了吗？' },
      ])
    },
  )

  it('shows solve-turn records after unlock but keeps them hidden on the current day', async () => {
    seed('2026-09-23', '昨日的官汤')
    seed('2026-09-24', '今天的官汤')
    for (let turn = 1; turn <= 4; turn++) {
      await recordPlay(data.db, '2026-09-23', 'past-reader', turn === 4)
    }
    await recordPlay(data.db, '2026-09-24', 'today-reader', true)

    const past = await get<{ daily: DailyDetail }>('/api/daily/2026-09-23')
    expect(past.daily).toMatchObject({
      shortestSolveTurns: 4,
      longestSolveTurns: 4,
    })
    const today = await get<{ daily: DailyDetail }>('/api/daily/2026-09-24')
    expect(today.daily).not.toHaveProperty('shortestSolveTurns')
    expect(today.daily).not.toHaveProperty('longestSolveTurns')
  })

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
