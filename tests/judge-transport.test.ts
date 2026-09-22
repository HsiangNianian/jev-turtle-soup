import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { judge } from '../shared/game'
import worker from '../worker/index'
import { database } from './sqlite'

const answers = {
  intent: { choice: 'meta', confidence: 1, probabilities: { meta: 1 } },
  meta_request: { choice: 'hint', confidence: 1, probabilities: { hint: 1 } },
  verdict: { choice: 'irrelevant', confidence: 1, probabilities: { irrelevant: 1 } },
  motive_correct: { noul: 0 },
  method_correct: { noul: 0 },
  twist_correct: { noul: 0 },
  solved: { noul: 0 },
}
const puzzle = { title: 'test', surface: 'surface', truth: 'truth', hint: 'hint' }
const result = () =>
  new Response(JSON.stringify({ answers, model: 'test' }), {
    headers: { 'content-type': 'application/json' },
  })
const ask = (locale = 'zh-CN') =>
  judge({ TYPESAFE_API_KEY: 'local-test-only' }, puzzle, { message: '提示', locale })
function delayed(delay: number) {
  return (_url: unknown, init?: RequestInit) =>
    new Promise<Response>((resolve, reject) => {
      const timer = setTimeout(() => resolve(result()), delay)
      init?.signal?.addEventListener(
        'abort',
        () => {
          clearTimeout(timer)
          reject(init.signal!.reason)
        },
        { once: true },
      )
    })
}
beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('judge transport through the real TypeSafe SDK', () => {
  it('returns a gateway timeout through the real Worker route and retains an error record', async () => {
    const data = database()
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn(delayed(60000)))
    try {
      data.sqlite
        .prepare(
          `INSERT INTO puzzles (id, owner_id, title, surface, truth, visibility, created_at)
        VALUES ('test', '', 'title', 'surface', 'truth', 'session', 1)`,
        )
        .run()
      const pending = worker.fetch(
        new Request('http://localhost/api/game/ask', {
          method: 'POST',
          body: JSON.stringify({ puzzleId: 'test', message: '提示', locale: 'zh-CN' }),
        }),
        { DB: data.db, TYPESAFE_API_KEY: 'local-test-only' },
      )
      await vi.advanceTimersByTimeAsync(42000)
      const response = await pending
      expect(response.status).toBe(504)
      expect(await response.json()).toMatchObject({ error: expect.stringContaining('超时') })
      expect(data.sqlite.prepare('SELECT source, count FROM client_errors').get()).toEqual({
        source: 'worker:route',
        count: 1,
      })
    } finally {
      data.sqlite.close()
      log.mockRestore()
    }
  })
  it('accepts a valid response taking more than ten seconds without cancelling and retrying it', async () => {
    const fetch = vi.fn(delayed(12000))
    vi.stubGlobal('fetch', fetch)
    let completed: unknown
    const pending = ask()
      .then((turn) => {
        completed = turn
      })
      .catch((error) => {
        completed = error
      })
    await vi.advanceTimersByTimeAsync(12500)
    expect(completed).toMatchObject({ verdict: 'hint', reply: expect.stringContaining('hint') })
    expect(fetch).toHaveBeenCalledOnce()
    await pending
  })
  it('retries one transient connection failure with the same judgment request', async () => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('network down'))
      .mockResolvedValueOnce(result())
    vi.stubGlobal('fetch', fetch)
    const pending = ask()
    await vi.advanceTimersByTimeAsync(1100)
    expect(await pending).toMatchObject({ verdict: 'hint' })
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(fetch.mock.calls[1][1].body).toBe(fetch.mock.calls[0][1].body)
  })
  it.each([
    ['zh-CN', '超时'],
    ['en', 'timed out'],
    ['ja', 'タイムアウト'],
  ])('bounds sustained timeouts and returns a useful %s error', async (locale, message) => {
    const fetch = vi.fn(delayed(60000))
    vi.stubGlobal('fetch', fetch)
    const pending = ask(locale).catch((error) => error)
    await vi.advanceTimersByTimeAsync(42000)
    expect(await pending).toMatchObject({ status: 504, message: expect.stringContaining(message) })
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})
