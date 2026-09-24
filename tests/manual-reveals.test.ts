import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import worker, { type Env } from '../worker/index'
import { database, kvStore } from './sqlite'

let data: ReturnType<typeof database>
let env: Env

async function request(path: string, init: RequestInit = {}) {
  return worker.fetch(new Request(`http://localhost${path}`, init), env)
}

async function signIn(email: string) {
  const codeResponse = await request('/api/auth/request', {
    method: 'POST',
    body: JSON.stringify({ email }),
  })
  const { code } = (await codeResponse.json()) as { code: string }
  const result = await request('/api/auth/verify', {
    method: 'POST',
    body: JSON.stringify({ email, code }),
  })
  expect(result.status).toBe(200)
  const { user } = (await result.clone().json()) as { user: { uid: string } }
  return { uid: user.uid, cookie: result.headers.get('set-cookie')!.split(';')[0] }
}

function addPuzzle(id: string, uid: string, visibility = 'public') {
  data.sqlite
    .prepare(
      `INSERT INTO puzzles (id, owner_id, title, surface, truth, visibility, created_at)
     VALUES (?, ?, '一碗汤', '奇怪的事', '完整答案', ?, 1)`,
    )
    .run(id, uid, visibility)
}

function reveal(id: string, body: Record<string, unknown>, cookie?: string) {
  return request(`/api/library/puzzles/${id}/reveal`, {
    method: 'POST',
    headers: cookie ? { cookie } : undefined,
    body: JSON.stringify({ locale: 'zh-CN', ...body }),
  })
}

beforeEach(() => {
  data = database()
  env = {
    DB: data.db,
    AUTH_KV: kvStore(),
    AUTH_SECRET: 'test-only-secret',
    AUTH_EXPOSE_CODE: '1',
    EMAIL: { send: vi.fn().mockRejectedValue(new Error('must not send mail')) },
  }
})
afterEach(() => data.sqlite.close())

describe('author-only manual reveal count', () => {
  it('counts explicit reveals once per player and puzzle, never solved fallback or owner reads', async () => {
    const author = await signIn('author@example.test')
    const reader = await signIn('reader@example.test')
    addPuzzle('public-puzzle', author.uid)
    addPuzzle('private-puzzle', author.uid, 'private')

    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await reveal('public-puzzle', {
        manual: true,
        playerKey: 'device-random-uuid-1',
      })
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ truth: '完整答案' })
    }
    // The endpoint is also used to fill in a missing answer after a player solves.
    expect((await reveal('public-puzzle', { playerKey: 'another-device-key' })).status).toBe(200)
    expect(
      (await reveal('public-puzzle', { manual: true, playerKey: 'anonymous-device' })).status,
    ).toBe(200)
    expect((await reveal('public-puzzle', { manual: true })).status).toBe(200)
    expect((await reveal('public-puzzle', { manual: true }, reader.cookie)).status).toBe(200)
    expect((await reveal('public-puzzle', { manual: true }, reader.cookie)).status).toBe(200)
    expect((await reveal('public-puzzle', { manual: true }, author.cookie)).status).toBe(200)
    expect((await reveal('private-puzzle', { manual: true }, author.cookie)).status).toBe(200)
    expect(
      (await reveal('private-puzzle', { manual: true, playerKey: 'device-random-uuid-1' })).status,
    ).not.toBe(200)

    const rows = data.sqlite
      .prepare('SELECT actor_hash FROM manual_reveals ORDER BY actor_hash')
      .all() as {
      actor_hash: string
    }[]
    expect(rows).toHaveLength(2)
    expect(rows.every((row) => /^[0-9a-f]{64}$/.test(row.actor_hash))).toBe(true)
    expect(JSON.stringify(rows)).not.toContain('device-random-uuid-1')
    expect(data.sqlite.prepare('SELECT COUNT(*) AS n FROM attempts').get()).toEqual({ n: 0 })

    expect((await request('/api/me/puzzles')).status).toBe(401)
    const authorResponse = await request('/api/me/puzzles', { headers: { cookie: author.cookie } })
    const authorData = (await authorResponse.json()) as {
      summary: { plays: number; solves: number; reveals: number }
      items: { id: string; reveals: number }[]
    }
    expect(authorData.summary).toMatchObject({ plays: 0, solves: 0, reveals: 2 })
    expect(authorData.items.find((item) => item.id === 'public-puzzle')?.reveals).toBe(2)
    expect(authorData.items.find((item) => item.id === 'private-puzzle')?.reveals).toBe(0)
    const readerData = (await (
      await request('/api/me/puzzles', {
        headers: { cookie: reader.cookie },
      })
    ).json()) as { summary: { reveals: number }; items: unknown[] }
    expect(readerData).toMatchObject({ summary: { reveals: 0 }, items: [] })
    const publicData = (await (await request('/api/library/puzzles')).json()) as {
      items: Record<string, unknown>[]
    }
    expect(publicData.items.find((item) => item.id === 'public-puzzle')).not.toHaveProperty(
      'reveals',
    )

    expect(
      (
        await request('/api/library/puzzles/public-puzzle', {
          method: 'DELETE',
          headers: { cookie: author.cookie },
        })
      ).status,
    ).toBe(200)
    expect(data.sqlite.prepare('SELECT COUNT(*) AS n FROM manual_reveals').get()).toEqual({ n: 0 })
  })
})
