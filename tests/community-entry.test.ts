import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import worker, { type Env } from '../worker/index'
import { setPuzzleFeatured } from '../shared/admin'
import { engagementMetrics, purgeEngagement, recordEngagement } from '../shared/engagement'
import { database, kvStore } from './sqlite'

let data: ReturnType<typeof database>
beforeEach(() => {
  data = database()
})
afterEach(() => data.sqlite.close())

function puzzle(id: string, visibility: string, note: string | null, featured = 1) {
  data.sqlite
    .prepare(
      `INSERT INTO puzzles
      (id, owner_id, title, surface, truth, visibility, featured, featured_note, created_at)
     VALUES (?, 'author', ?, '有一件怪事。', '秘密真相', ?, ?, ?, 1)`,
    )
    .run(id, id, visibility, featured, note)
}

describe('community curation', () => {
  it('returns only selected user-authored public puzzles with notes', async () => {
    data.sqlite
      .prepare(
        "INSERT INTO users (id, email, display_name, handle, created_at) VALUES ('author', 'a@example.com', '阿汤', 'a', 1)",
      )
      .run()
    puzzle('selected', 'public', '一个不剧透的推荐理由')
    puzzle('no-note', 'public', null)
    puzzle('private', 'private', '不能公开')
    puzzle('official', 'daily', '官汤不属于汤友原创')
    puzzle('unselected', 'public', '没有精选', 0)

    const response = await worker.fetch(
      new Request('http://localhost/api/library/puzzles?scope=community&featuredOnly=1'),
      { DB: data.db },
    )
    expect(response.status).toBe(200)
    const body = (await response.json()) as { items: Record<string, unknown>[] }
    expect(body.items).toHaveLength(1)
    expect(body.items[0]).toMatchObject({
      id: 'selected',
      featuredNote: '一个不剧透的推荐理由',
      owner: { displayName: '阿汤' },
    })
    expect(body.items[0]).not.toHaveProperty('truth')

    const legacy = await worker.fetch(
      new Request('http://localhost/api/library/puzzles?sort=new'),
      { DB: data.db },
    )
    const oldBody = (await legacy.json()) as { items: { id: string }[] }
    expect(oldBody.items.map((item) => item.id)).toEqual(
      expect.arrayContaining(['selected', 'no-note', 'unselected']),
    )
  })

  it('requires a recommendation before selecting and allows updating it', async () => {
    puzzle('one', 'public', null, 0)
    await expect(setPuzzleFeatured(data.db, 'one', true, '')).rejects.toMatchObject({ status: 400 })
    await setPuzzleFeatured(data.db, 'one', true, '第一句就让人想追问。')
    expect(
      data.sqlite.prepare('SELECT featured, featured_note FROM puzzles WHERE id = ?').get('one'),
    ).toEqual({ featured: 1, featured_note: '第一句就让人想追问。' })
    await setPuzzleFeatured(data.db, 'one', false)
    expect(data.sqlite.prepare('SELECT featured FROM puzzles WHERE id = ?').get('one')).toEqual({
      featured: 0,
    })
  })
})

describe('first-party engagement', () => {
  const now = Date.parse('2026-09-24T12:00:00Z')
  const base = { event: 'first_question', actorKey: 'device-random-uuid-1', platform: 'web' }

  it('deduplicates daily actions, hashes device keys, and counts second puzzles', async () => {
    await recordEngagement(data.db, { ...base, puzzleId: 'p1' }, false, now)
    await recordEngagement(data.db, { ...base, puzzleId: 'p1' }, false, now)
    await recordEngagement(data.db, { ...base, puzzleId: 'p2' }, false, now)
    await recordEngagement(data.db, { ...base, event: 'entry_view', source: 'QQ' }, false, now)
    await recordEngagement(data.db, { ...base, puzzleId: 'p3' }, true, now)
    const rows = data.sqlite.prepare('SELECT actor_hash FROM engagement_events').all() as {
      actor_hash: string
    }[]
    expect(rows).toHaveLength(3)
    expect(rows[0].actor_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(rows[0].actor_hash).not.toBe(base.actorKey)
    const metrics = await engagementMetrics(data.db, 28, now)
    expect(metrics.secondPuzzlePlayers).toBe(1)
    expect(metrics.sources).toEqual([{ source: 'qq', platform: 'web', entries: 1 }])
  })

  it('rejects malformed actions and removes rows older than 30 days', async () => {
    await expect(
      recordEngagement(data.db, { ...base, event: 'custom', puzzleId: 'p1' }),
    ).rejects.toMatchObject({ status: 400 })
    await recordEngagement(data.db, { ...base, puzzleId: 'old' }, false, now - 31 * 86_400_000)
    await recordEngagement(data.db, { ...base, puzzleId: 'new' }, false, now)
    await purgeEngagement(data.db, now)
    expect(data.sqlite.prepare('SELECT puzzle_id FROM engagement_events').all()).toEqual([
      { puzzle_id: 'new' },
    ])
  })

  it('counts outside feedback only for newly published soups and recent comments', async () => {
    data.sqlite
      .prepare(
        `INSERT INTO users (id, email, display_name, handle, created_at) VALUES
          ('author', 'author@example.com', '作者', 'author', 1),
          ('reader', 'reader@example.com', '读者', 'reader', 1)`,
      )
      .run()
    puzzle('fresh', 'public', null, 0)
    puzzle('old', 'public', null, 0)
    data.sqlite
      .prepare('UPDATE puzzles SET created_at = ? WHERE id = ?')
      .run(now - 86_400_000, 'fresh')
    data.sqlite
      .prepare('UPDATE puzzles SET created_at = ? WHERE id = ?')
      .run(now - 40 * 86_400_000, 'old')
    const comment = data.sqlite.prepare(
      `INSERT INTO comments (id, target_type, target_id, author_id, body, created_at)
       VALUES (?, 'puzzle', ?, 'reader', '好汤', ?)`,
    )
    comment.run('old-soup-new-comment', 'old', now - 86_400_000)
    comment.run('new-soup-old-comment', 'fresh', now - 40 * 86_400_000)
    expect((await engagementMetrics(data.db, 28, now)).outsideFeedback).toEqual({
      soups: 1,
      withFeedback: 0,
    })
    comment.run('new-soup-new-comment', 'fresh', now - 86_400_000)
    expect((await engagementMetrics(data.db, 28, now)).outsideFeedback).toEqual({
      soups: 1,
      withFeedback: 1,
    })
  })
})

it('keeps metrics admin-only and disables both digest endpoints', async () => {
  const email = { send: vi.fn().mockResolvedValue(undefined) }
  const env: Env = {
    DB: data.db,
    AUTH_KV: kvStore(),
    AUTH_SECRET: 'test-secret',
    AUTH_EXPOSE_CODE: '1',
    EMAIL: email,
  }
  const request = (path: string, init: RequestInit = {}) =>
    worker.fetch(new Request(`http://localhost${path}`, init), env)
  expect((await request('/api/admin/metrics')).status).toBe(401)
  const codeResponse = await request('/api/auth/request', {
    method: 'POST',
    body: JSON.stringify({ email: 'admin@example.com' }),
  })
  const { code } = (await codeResponse.json()) as { code: string }
  const login = await request('/api/auth/verify', {
    method: 'POST',
    body: JSON.stringify({ email: 'admin@example.com', code }),
  })
  const { user } = (await login.clone().json()) as { user: { uid: string } }
  data.sqlite.prepare('INSERT INTO admins (uid, created_at) VALUES (?, 1)').run(user.uid)
  const cookie = login.headers.get('set-cookie')!.split(';')[0]
  email.send.mockClear()
  const read = await request('/api/admin/digest', { headers: { cookie } })
  const send = await request('/api/admin/digest/send', { method: 'POST', headers: { cookie } })
  expect(read.status).toBe(410)
  expect(send.status).toBe(410)
  expect(email.send).not.toHaveBeenCalled()
  const metrics = await request('/api/admin/metrics', { headers: { cookie } })
  expect(metrics.status).toBe(200)
})
