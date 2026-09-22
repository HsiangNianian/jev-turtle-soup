import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { database, kvStore } from './sqlite'
import worker, { type Env } from '../worker/index'
import { requestCode } from '../shared/auth'
import { listSaves, putSave, deleteSave, SaveRequestError } from '../src/lib/save-client'

let data: ReturnType<typeof database>
let env: Env
let cookie: string
let uid: string
const game = { id: 'one', title: 'title', surface: 'surface', messages: [], updatedAt: 10 }
async function request(path: string, init: RequestInit = {}) {
  return worker.fetch(new Request(`http://localhost${path}`, init), env, { waitUntil() {} })
}
beforeEach(async () => {
  data = database()
  env = {
    DB: data.db,
    AUTH_KV: kvStore(),
    AUTH_SECRET: 'test-only-secret',
    AUTH_EXPOSE_CODE: '1',
    EMAIL: { send: vi.fn().mockRejectedValue(new Error('must not send mail')) },
  }
  const response = await request('/api/auth/request', {
    method: 'POST',
    body: JSON.stringify({ email: 'test@example.com' }),
  })
  const otp = (await response.json()) as { code: string; sent: boolean }
  expect(otp.sent).toBe(false)
  expect(otp.code).toMatch(/^\d{6}$/)
  expect(env.EMAIL!.send).not.toHaveBeenCalled()
  const verified = await request('/api/auth/verify', {
    method: 'POST',
    body: JSON.stringify({ email: 'test@example.com', code: otp.code }),
  })
  expect(verified.status).toBe(200)
  uid = ((await verified.json()) as { user: { uid: string } }).user.uid
  cookie = verified.headers.get('set-cookie')!.split(';')[0]
})
afterEach(() => {
  data.sqlite.close()
  vi.unstubAllGlobals()
})

it('checks the expected owner on list, PUT, DELETE and legacy import before any writes', async () => {
  for (const [path, method] of [
    ['/api/me/saves', 'GET'],
    ['/api/me/saves/one', 'PUT'],
    ['/api/me/saves/one', 'DELETE'],
    ['/api/me/saves', 'POST'],
  ]) {
    const response = await request(path, {
      method,
      headers: { cookie, 'X-Save-Owner': 'another-account' },
      ...(method === 'PUT' || method === 'POST'
        ? { body: JSON.stringify({ game, games: [game] }) }
        : {}),
    })
    expect(response.status).toBe(409)
  }
  expect(data.sqlite.prepare('SELECT COUNT(*) AS n FROM saves').get()).toEqual({ n: 0 })
})

it('round trips through client, Worker routes and SQLite, preserving equal timestamps and old-client compatibility', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn((path: string, init: RequestInit) =>
      request(path, {
        ...init,
        headers: { ...init.headers, cookie },
      }),
    ),
  )
  const options = { owner: uid, signal: new AbortController().signal }
  await putSave(game as Parameters<typeof putSave>[0], options)
  await putSave({ ...game, title: 'equal' } as Parameters<typeof putSave>[0], options)
  expect((await listSaves(options))[0].title).toBe('title')
  const old = await request('/api/me/saves', {
    method: 'POST',
    headers: { cookie },
    body: JSON.stringify({ games: [{ ...game, title: 'new', updatedAt: 11 }] }),
  })
  expect(old.status).toBe(200)
  expect((await listSaves(options))[0].title).toBe('new')
  await deleteSave('one', options)
  expect(await listSaves(options)).toEqual([])
  await expect(listSaves({ ...options, owner: 'wrong' })).rejects.toMatchObject({ status: 409 })
  expect(vi.mocked(fetch).mock.calls[0][1]?.signal).toBe(options.signal)
})

it('rejects mismatched URL ids and requires a session', async () => {
  expect((await request('/api/me/saves')).status).toBe(401)
  const response = await request('/api/me/saves/different', {
    method: 'PUT',
    headers: { cookie },
    body: JSON.stringify({ game }),
  })
  expect(response.status).toBe(400)
})

it('does not expose a code by default in production', async () => {
  const email = { send: vi.fn().mockResolvedValue(undefined) }
  const result = await requestCode(
    { db: data.db, kv: kvStore(), secret: 'test', email, fromEmail: 'test@example.com' },
    'person@example.com',
  )
  expect(result.code).toBeUndefined()
  expect(email.send).toHaveBeenCalledOnce()
})

it('retains HTTP status in the client error', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 429 })))
  await expect(
    listSaves({ owner: uid, signal: new AbortController().signal }),
  ).rejects.toBeInstanceOf(SaveRequestError)
})
