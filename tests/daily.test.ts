import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { database } from './sqlite'
import { composeDaily } from '../shared/daily'
import worker, { generateTodayDaily } from '../worker/index'

vi.mock('../shared/daily', async (original) => ({
  ...(await original<typeof import('../shared/daily')>()),
  composeDaily: vi.fn(),
}))

let data: ReturnType<typeof database>
const dailyDraft = {
  title: '新题',
  surface: '汤面',
  truth: '汤底',
  hint: '提示',
  story: '故事',
  tags: [],
  difficulty: '中等',
  locale: 'zh-CN' as const,
  genreTarget: 20,
  genreScore: 15,
  tag: '推理',
  attempts: 1,
  relaxed: false,
  review: { passed: true, score: 1, issues: [], checks: {}, thresholds: {} },
}
beforeEach(() => {
  data = database()
  vi.mocked(composeDaily).mockReset().mockResolvedValue(dailyDraft)
})
afterEach(() => data.sqlite.close())

function seed(date: string, index: number) {
  data.sqlite
    .prepare(
      `INSERT INTO puzzles (id, owner_id, title, surface, truth, created_at)
    VALUES (?, '', ?, ?, 'truth', ?)`,
    )
    .run(date, `title-${index}`, `surface-${index}`, 100 - index)
  data.sqlite
    .prepare(
      `INSERT INTO dailies (date, puzzle_id, story, created_at)
    VALUES (?, ?, 'story', ?)`,
    )
    .run(date, date, index)
}

describe('daily generation against the current schema', () => {
  it.each([0, 1, 12])(
    'publishes with %i previous dailies, using the last ten joined puzzles',
    async (count) => {
      for (let i = 1; i <= count; i++) seed(`2020-01-${String(i).padStart(2, '0')}`, i)
      await generateTodayDaily({ DB: data.db })
      expect(composeDaily).toHaveBeenCalledOnce()
      expect(vi.mocked(composeDaily).mock.calls[0][1].avoid).toEqual(
        Array.from(
          { length: Math.min(count, 10) },
          (_, i) => `title-${count - i}｜surface-${count - i}`,
        ),
      )
      const row = data.sqlite
        .prepare(
          `SELECT p.title, p.genre_score FROM dailies d
      JOIN puzzles p ON p.id = d.puzzle_id WHERE d.date = ?`,
        )
        .get(new Date().toISOString().slice(0, 10))
      expect(row).toEqual({ title: '新题', genre_score: 15 })
    },
  )
  it('skips an existing day without calling the model', async () => {
    seed(new Date().toISOString().slice(0, 10), 1)
    await generateTodayDaily({ DB: data.db })
    expect(composeDaily).not.toHaveBeenCalled()
    expect(data.sqlite.prepare('SELECT COUNT(*) AS n FROM dailies').get()).toEqual({ n: 1 })
  })

  it('keeps the scheduled invocation open until generation has published', async () => {
    let release!: () => void
    const hold = new Promise<void>((resolve) => {
      release = resolve
    })
    vi.mocked(composeDaily).mockImplementationOnce(async () => {
      await hold
      return dailyDraft
    })
    const waitUntil = vi.fn()
    const scheduled = worker.scheduled(
      { cron: '0 */6 * * *', scheduledTime: Date.now() },
      { DB: data.db },
      { waitUntil },
    )
    await vi.waitFor(() => expect(composeDaily).toHaveBeenCalledOnce())
    let finished = false
    void scheduled.then(() => {
      finished = true
    })
    await Promise.resolve()
    expect(finished).toBe(false)
    release()
    await scheduled
    expect(waitUntil).not.toHaveBeenCalled()
    expect(data.sqlite.prepare('SELECT COUNT(*) AS n FROM dailies').get()).toEqual({ n: 1 })
  })

  it('reports a failed scheduled generation as a failed invocation', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(composeDaily).mockRejectedValueOnce(new Error('model unavailable'))
    await expect(
      worker.scheduled(
        { cron: '0 */6 * * *', scheduledTime: Date.now() },
        { DB: data.db },
        { waitUntil: vi.fn() },
      ),
    ).rejects.toThrow('model unavailable')
  })
})
