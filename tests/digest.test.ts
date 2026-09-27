import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import worker, { type Env } from '../worker/index'
import { createSession, type EmailLike } from '../shared/auth'
import {
  DIGEST_CRON,
  DIGEST_WINDOW_MS,
  digestPeriod,
  listDigestRecipients,
  recentCounts,
  renderDigest,
  unsubscribeByToken,
} from '../shared/digest'
import { deliverDigest, digestOverview } from '../shared/digest-delivery'
import { database, kvStore } from './sqlite'

const until = Date.parse('2026-09-28T12:00:00Z')
const since = until - DIGEST_WINDOW_MS
let data: ReturnType<typeof database>
beforeEach(() => {
  data = database()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(until + 1000)
})
afterEach(() => {
  data.sqlite.close()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function seed(id = 'author', active = true, locale = 'zh-CN') {
  data.sqlite
    .prepare('INSERT INTO users(id,email,display_name,locale,created_at) VALUES(?,?,?,?,1)')
    .run(id, `${id}@example.test`, '作者 <script>alert(1)</script>', locale)
  data.sqlite
    .prepare(
      "INSERT INTO puzzles(id,owner_id,title,surface,truth,visibility,created_at) VALUES(?,?,?,'表面','秘密','public',1)",
    )
    .run(id, id, id)
  if (active) play(id, `${id}-player`, since + 10)
}
function play(puzzle: string, player: string, at: number, solved = 0) {
  data.sqlite
    .prepare(
      'INSERT INTO attempts(id,puzzle_id,player_key,created_at,updated_at,solved) VALUES(?,?,?,?,?,?)',
    )
    .run(crypto.randomUUID(), puzzle, player, at, at, solved)
}
function mailer() {
  return { send: vi.fn<EmailLike['send']>().mockResolvedValue({ messageId: 'provider-message' }) }
}

describe('weekly author digest', () => {
  it('applies the additive migration safely to the previous schema and on reapplication', () => {
    data.sqlite.exec('DROP TABLE digest_deliveries; DROP TABLE digest_runs')
    const migration = readFileSync('db/migrations/021-weekly-digest.sql', 'utf8')
    data.sqlite.exec(migration)
    data.sqlite.exec(migration)
    expect(data.sqlite.prepare('SELECT COUNT(*) AS n FROM digest_runs').get()).toEqual({ n: 0 })
  })

  it('sends the next issue once with the same unsubscribe token and stops rejected retries after three attempts', async () => {
    seed()
    const email = mailer()
    await deliverDigest(data.db, { EMAIL: email }, until, 'cron')
    const first = email.send.mock.calls[0][0].text!
    play('author', 'next-week-player', until + 100)
    vi.setSystemTime(until + DIGEST_WINDOW_MS)
    await deliverDigest(data.db, { EMAIL: email }, until + DIGEST_WINDOW_MS, 'cron')
    expect(email.send).toHaveBeenCalledTimes(2)
    expect(email.send.mock.calls[1][0].text).toBe(first)
    expect(data.sqlite.prepare('SELECT COUNT(*) AS n FROM digest_deliveries').get()).toEqual({
      n: 2,
    })
    seed('rejected')
    email.send.mockRejectedValue(
      Object.assign(new Error('quota'), { code: 'E_DAILY_LIMIT_EXCEEDED' }),
    )
    for (let i = 0; i < 5; i++) await deliverDigest(data.db, { EMAIL: email }, until, 'manual')
    expect(email.send).toHaveBeenCalledTimes(5)
    expect(
      data.sqlite.prepare("SELECT attempts FROM digest_deliveries WHERE uid = 'rejected'").get(),
    ).toEqual({ attempts: 3 })
  })

  it('keeps a reservation after mail acceptance if recording the receipt fails', async () => {
    seed()
    const email = mailer()
    data.sqlite.exec(
      "CREATE TRIGGER fail_receipt BEFORE UPDATE OF status ON digest_deliveries WHEN NEW.status = 'sent' BEGIN SELECT RAISE(ABORT, 'receipt unavailable'); END",
    )
    await expect(deliverDigest(data.db, { EMAIL: email }, until, 'cron')).rejects.toThrow(
      'receipt unavailable',
    )
    data.sqlite.exec('DROP TRIGGER fail_receipt')
    await deliverDigest(data.db, { EMAIL: email }, until, 'manual')
    expect(email.send).toHaveBeenCalledTimes(1)
    expect(data.sqlite.prepare('SELECT status FROM digest_deliveries').get()).toEqual({
      status: 'sending',
    })
  })

  it('honors an opt-out that occurs after the recipient list is built', async () => {
    seed('alice')
    seed('bob')
    const email = mailer()
    email.send.mockImplementation(async () => {
      data.sqlite.exec("UPDATE users SET digest_opt_out = 1 WHERE id = 'bob'")
      return { messageId: 'accepted' }
    })
    await deliverDigest(data.db, { EMAIL: email }, until, 'cron')
    expect(email.send).toHaveBeenCalledTimes(1)
    expect(email.send.mock.calls[0][0].to).toBe('alice@example.test')
  })

  it('uses fixed Monday 20:00 Beijing windows and the configured Cron', () => {
    expect(digestPeriod(until - 1)).toEqual({
      since: since - DIGEST_WINDOW_MS,
      until: since,
      nextSendAt: until,
    })
    expect(digestPeriod(until)).toEqual({ since, until, nextSendAt: until + DIGEST_WINDOW_MS })
    expect(digestPeriod(until + 6 * 86_400_000).until).toBe(until)
    expect(readFileSync('wrangler.jsonc', 'utf8')).toContain(`"${DIGEST_CRON}"`)
  })

  it('counts a bounded week, excludes author actions, and respects consent and public authorship', async () => {
    seed()
    play('author', 'author', since + 20, 1)
    play('author', 'outside', since - 1, 1)
    play('author', 'next-week', until, 1)
    play('author', 'boundary', since, 1)
    seed('quiet', false)
    seed('opted-out')
    seed('private')
    data.sqlite.exec(
      "UPDATE users SET digest_opt_out = 1 WHERE id = 'opted-out'; UPDATE puzzles SET visibility = 'private' WHERE id = 'private'",
    )
    const comment = data.sqlite.prepare(
      "INSERT INTO comments(id,target_type,target_id,author_id,body,created_at) VALUES(?,?,?,?, '好汤',?)",
    )
    comment.run('one', 'puzzle', 'author', 'reader', since)
    comment.run('two', 'profile', 'author', 'reader', until - 1)
    comment.run('self', 'profile', 'author', 'author', since)
    comment.run('future', 'puzzle', 'author', 'reader', until)
    data.sqlite
      .prepare(
        "INSERT INTO likes(id,target_type,target_id,player_key,created_at) VALUES('like','profile','author','reader',?)",
      )
      .run(since)
    expect(await recentCounts(data.db, 'author', since, until)).toEqual({
      plays: 2,
      solves: 1,
      comments: 2,
      likes: 1,
    })
    expect((await listDigestRecipients(data.db, since, until)).map((r) => r.uid)).toEqual([
      'author',
    ])
  })

  it('does not drop authors after the first page and preview does not mutate tokens or send', async () => {
    for (let i = 0; i < 201; i++) seed(`author${String(i).padStart(3, '0')}`, i === 200)
    const email = mailer()
    const view = await digestOverview(data.db, { EMAIL: email })
    expect(view.recipients.map((r) => r.uid)).toEqual(['author200'])
    expect(view.preview?.html).not.toContain('<script>')
    expect(view.preview?.html).toContain('&lt;script&gt;')
    expect(JSON.stringify(view)).not.toContain('digest_token')
    expect(
      data.sqlite.prepare('SELECT COUNT(*) AS n FROM users WHERE digest_token IS NOT NULL').get(),
    ).toEqual({ n: 0 })
    expect(email.send).not.toHaveBeenCalled()
  })

  it('deduplicates simultaneous Cron/manual sends, persists provider acceptance and unsubscribes', async () => {
    seed()
    let resolve!: (value: unknown) => void
    const email = {
      send: vi.fn<EmailLike['send']>(
        () =>
          new Promise((r) => {
            resolve = r
          }),
      ),
    }
    const first = deliverDigest(data.db, { EMAIL: email }, until, 'cron')
    await vi.waitFor(() => expect(email.send).toHaveBeenCalledTimes(1))
    expect((await deliverDigest(data.db, { EMAIL: email }, until, 'manual')).sent).toBe(0)
    resolve({ messageId: 'accepted-1' })
    expect((await first).sent).toBe(1)
    await deliverDigest(data.db, { EMAIL: email }, until, 'cron')
    expect(email.send).toHaveBeenCalledTimes(1)
    expect(data.sqlite.prepare('SELECT status, message_id FROM digest_deliveries').get()).toEqual({
      status: 'sent',
      message_id: 'accepted-1',
    })
    const token = (
      data.sqlite.prepare('SELECT digest_token FROM users').get() as { digest_token: string }
    ).digest_token
    expect(token).toHaveLength(32)
    expect(email.send.mock.calls[0][0].text).toContain(token)
    expect(await unsubscribeByToken(data.db, token)).toBe(true)
    play('author', 'new-player', until + 100)
    await deliverDigest(data.db, { EMAIL: email }, until + DIGEST_WINDOW_MS, 'cron')
    expect(email.send).toHaveBeenCalledTimes(1)
  })

  it('continues after a rejected email and manual retries send only failures with frozen counts', async () => {
    seed('alice')
    seed('bob')
    const email = mailer()
    email.send.mockRejectedValueOnce(
      Object.assign(new Error('rate limit'), { code: 'E_RATE_LIMIT_EXCEEDED' }),
    )
    expect(await deliverDigest(data.db, { EMAIL: email }, until, 'cron')).toMatchObject({
      sent: 1,
      failed: 1,
    })
    await deliverDigest(data.db, { EMAIL: email }, until, 'cron')
    expect(email.send).toHaveBeenCalledTimes(2)
    play('alice', 'late-import', since + 25)
    expect((await deliverDigest(data.db, { EMAIL: email }, until, 'manual')).sent).toBe(1)
    expect(email.send).toHaveBeenCalledTimes(3)
    expect(email.send.mock.calls[2][0].text).toContain('· 1 人问过')
    expect((await digestOverview(data.db, { EMAIL: email })).history[0]).toMatchObject({
      sent: 2,
      failed: 0,
    })
  })

  it('never repeats ambiguous sends or reservations left by interrupted executions', async () => {
    seed()
    const email = mailer()
    email.send.mockRejectedValueOnce(new Error('connection lost after submission'))
    expect((await deliverDigest(data.db, { EMAIL: email }, until, 'cron')).uncertain).toBe(1)
    await deliverDigest(data.db, { EMAIL: email }, until, 'manual')
    expect(email.send).toHaveBeenCalledTimes(1)
    data.sqlite.exec("UPDATE digest_deliveries SET status = 'sending'")
    vi.setSystemTime(until + 20 * 60_000)
    const view = await digestOverview(data.db, { EMAIL: email })
    expect(view.recipients[0].status).toBe('uncertain')
    expect(view.history[0].uncertain).toBe(1)
    expect(view.sendable).toBe(0)
    await deliverDigest(data.db, { EMAIL: email }, until, 'manual')
    expect(email.send).toHaveBeenCalledTimes(1)
  })

  it('does not reserve deliveries when the email binding is missing and records quiet weeks', async () => {
    seed('quiet', false)
    await expect(deliverDigest(data.db, {}, until, 'cron')).rejects.toMatchObject({ status: 503 })
    expect(data.sqlite.prepare('SELECT COUNT(*) AS n FROM digest_runs').get()).toEqual({ n: 0 })
    const email = mailer()
    await deliverDigest(data.db, { EMAIL: email }, until, 'cron')
    expect((await digestOverview(data.db, { EMAIL: email })).history).toHaveLength(1)
    expect(email.send).not.toHaveBeenCalled()
  })

  it('uses each author locale and keeps real unsubscribe links out of preview', async () => {
    seed('en-author', true, 'en')
    seed('ja-author', true, 'ja')
    const email = mailer()
    await deliverDigest(data.db, { EMAIL: email }, until, 'cron')
    expect(email.send.mock.calls[0][0].subject).toContain('Turtle Soup Bureau')
    expect(email.send.mock.calls[1][0].subject).toContain('海亀スープ調査局')
    expect(email.send.mock.calls[0][0].text).toMatch(
      /https:\/\/hgt.mmstudio.games\/api\/digest\/unsubscribe\?t=[a-f0-9]{32}/,
    )
    const [recipient] = await listDigestRecipients(data.db, since, until)
    expect(
      renderDigest({ ...recipient, locale: 'unknown' }, 'https://hgt.mmstudio.games').subject,
    ).toContain('海龟汤调查局')
  })
})

describe('digest Worker entry points', () => {
  async function environment() {
    seed()
    const env: Env = {
      DB: data.db,
      AUTH_KV: kvStore(),
      AUTH_SECRET: 'test-only-secret',
      EMAIL: mailer(),
    }
    const token = await createSession(env.AUTH_KV!, env.AUTH_SECRET!, {
      id: 'author',
      email: 'author@example.test',
    })
    const headers = {
      cookie: `ts_session=${token}`,
      origin: 'http://localhost',
      'content-type': 'application/json',
    }
    const request = (path: string, init: RequestInit = {}) =>
      worker.fetch(new Request(`http://localhost${path}`, init), env)
    return { env, headers, request }
  }

  it('rejects nonadmins, cross-origin posts and stale previews before any send', async () => {
    const { env, headers, request } = await environment()
    expect((await request('/api/admin/digest', { headers })).status).toBe(403)
    data.sqlite.prepare("INSERT INTO admins(uid,created_at) VALUES('author',1)").run()
    expect((await request('/api/admin/digest', { headers })).status).toBe(200)
    expect(
      (
        await request('/api/admin/digest/send', {
          method: 'POST',
          headers: { ...headers, origin: 'https://evil.test' },
          body: JSON.stringify({ periodEnd: until }),
        })
      ).status,
    ).toBe(403)
    expect(
      (
        await request('/api/admin/digest/send', {
          method: 'POST',
          headers,
          body: JSON.stringify({ periodEnd: since }),
        })
      ).status,
    ).toBe(409)
    expect(env.EMAIL!.send).not.toHaveBeenCalled()
    expect(
      (
        await request('/api/admin/digest/send', {
          method: 'POST',
          headers,
          body: JSON.stringify({ periodEnd: until }),
        })
      ).status,
    ).toBe(200)
    expect(env.EMAIL!.send).toHaveBeenCalledTimes(1)
    expect((await request('/api/admin/digest/send', { method: 'GET', headers })).status).toBe(405)
  })

  it('routes the weekly Cron separately and awaits sending using scheduled time, even if delayed', async () => {
    const { env } = await environment()
    vi.setSystemTime(until + DIGEST_WINDOW_MS + 1000)
    await worker.scheduled({ cron: DIGEST_CRON, scheduledTime: until }, env, { waitUntil() {} })
    expect(env.EMAIL!.send).toHaveBeenCalledTimes(1)
    expect(data.sqlite.prepare('SELECT period_end FROM digest_deliveries').get()).toEqual({
      period_end: until,
    })
    expect(data.sqlite.prepare('SELECT COUNT(*) AS n FROM dailies').get()).toEqual({ n: 0 })
  })

  it('reports scheduled mail failures as failed invocations', async () => {
    const { env } = await environment()
    vi.mocked(env.EMAIL!.send).mockRejectedValueOnce(
      Object.assign(new Error('quota'), { code: 'E_DAILY_LIMIT_EXCEEDED' }),
    )
    await expect(
      worker.scheduled({ cron: DIGEST_CRON, scheduledTime: until }, env, { waitUntil() {} }),
    ).rejects.toThrow('作者周报')
    expect(data.sqlite.prepare('SELECT status FROM digest_deliveries').get()).toEqual({
      status: 'failed',
    })
    await expect(
      worker.scheduled({ cron: DIGEST_CRON, scheduledTime: until }, env, { waitUntil() {} }),
    ).rejects.toThrow('作者周报')
    expect(env.EMAIL!.send).toHaveBeenCalledTimes(1)
  })
})
