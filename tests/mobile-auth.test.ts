import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import worker, { type Env } from '../worker/index'
import { createSession, SESSION_COOKIE } from '../shared/auth'
import { database, kvStore } from './sqlite'

let data: ReturnType<typeof database>
let env: Env
const call = (path: string, init: RequestInit = {}) =>
  worker.fetch(new Request(`https://api.test${path}`, init), env, { waitUntil() {} })
beforeEach(() => {
  data = database()
  env = {
    DB: data.db,
    AUTH_KV: kvStore(),
    AUTH_SECRET: 'test',
    AUTH_EXPOSE_CODE: '1',
    EMAIL: { send: vi.fn() },
  }
})
afterEach(() => data.sqlite.close())
async function login(email: string, mode?: string) {
  const code = (await call('/api/auth/request', {
    method: 'POST',
    body: JSON.stringify({ email }),
  }).then((r) => r.json())) as { code: string }
  return call('/api/auth/verify', {
    method: 'POST',
    body: JSON.stringify({ email, code: code.code, sessionMode: mode }),
  })
}
it('issues a revocable bearer session without changing the default cookie contract', async () => {
  const native = await login('mobile@example.com', 'token')
  expect(native.status).toBe(200)
  expect(native.headers.get('set-cookie')).toBeNull()
  expect(native.headers.get('cache-control')).toBe('no-store')
  const session = (await native.json()) as {
    token: string
    user: { uid: string }
    expiresAt: number
  }
  expect(session.expiresAt).toBeGreaterThan(Date.now())
  const headers = { Authorization: `Bearer ${session.token}`, 'X-Save-Owner': session.user.uid }
  expect((await call('/api/auth/me', { headers })).status).toBe(200)
  expect((await call('/api/me/saves', { headers })).status).toBe(200)
  expect((await call('/api/auth/logout', { method: 'POST', headers })).status).toBe(200)
  expect((await call('/api/auth/me', { headers })).status).toBe(401)
  const web = await login('web@example.com')
  expect(web.headers.get('set-cookie')).toContain(SESSION_COOKIE)
  expect(await web.json()).not.toHaveProperty('token')
})
it('never falls back to a different cookie identity for a malformed or expired bearer', async () => {
  const web = await login('cookie@example.com')
  const cookie = web.headers.get('set-cookie')!.split(';')[0]
  const user = ((await web.json()) as { user: { uid: string } }).user
  const expired = await createSession(
    env.AUTH_KV!,
    env.AUTH_SECRET!,
    { id: user.uid, email: 'cookie@example.com' },
    -1,
  )
  for (const value of [
    'Bearer invalid',
    'Basic abc',
    '',
    `Bearer ${expired}`,
    'Bearer two tokens',
  ]) {
    expect((await call('/api/auth/me', { headers: { cookie, Authorization: value } })).status).toBe(
      401,
    )
  }
  const native = (await login('native@example.com', 'token').then((r) => r.json())) as {
    token: string
    user: { uid: string }
  }
  const response = await call('/api/auth/me', {
    headers: { cookie, Authorization: `Bearer ${native.token}` },
  })
  expect(((await response.json()) as { user: { uid: string } }).user.uid).toBe(native.user.uid)
  expect(
    (
      await call('/api/me/saves', {
        headers: { cookie, Authorization: `Bearer ${native.token}`, 'X-Save-Owner': user.uid },
      })
    ).status,
  ).toBe(409)
})
