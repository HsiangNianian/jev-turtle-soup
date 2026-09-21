/**
 * Auth primitives shared by the Vite dev middleware and the Cloudflare Worker.
 * WebCrypto only, so the same code runs in Node 20+ and the Workers runtime.
 */
import { ApiError } from './errors.ts'

export interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike
  first<T = unknown>(): Promise<T | null>
  all<T = unknown>(): Promise<{ results?: T[]; success: boolean }>
  run(): Promise<unknown>
}

export interface D1Like {
  prepare(query: string): D1PreparedStatementLike
}

export interface KVLike {
  get(key: string): Promise<string | null>
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>
  delete(key: string): Promise<void>
}

export interface EmailLike {
  send(message: {
    to: string
    from: { email: string; name: string }
    subject: string
    html?: string
    text?: string
  }): Promise<unknown>
}

export const SESSION_COOKIE = 'ts_session'
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30
const OTP_TTL_SECONDS = 60 * 10
const OTP_MAX_ATTEMPTS = 5
const OTP_MAX_REQUESTS = 3

const encoder = new TextEncoder()

function base64url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64urlFromJson(value: unknown): string {
  return base64url(encoder.encode(JSON.stringify(value)))
}

function jsonFromBase64url<T>(value: string): T | null {
  try {
    const normalised = value.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalised + '='.repeat((4 - (normalised.length % 4)) % 4)
    const binary = atob(padded)
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
    return JSON.parse(new TextDecoder().decode(bytes)) as T
  } catch {
    return null
  }
}

export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let index = 0; index < a.length; index += 1) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index)
  }
  return diff === 0
}

async function hmac(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload))
  return base64url(new Uint8Array(signature))
}

/** Hash an OTP for storage. Exported so tooling/tests can seed a code without sending mail. */
export function hashOtp(secret: string, email: string, code: string): Promise<string> {
  return hmac(secret, `${email}:${code}`)
}

export interface SessionUser {
  uid: string
  email: string
  exp: number
}

interface SessionPayload {
  sid: string
  exp: number
}

function sessionKey(sid: string): string {
  return `sess:${sid}`
}

async function signPayload(payload: SessionPayload, secret: string): Promise<string> {
  const body = base64urlFromJson(payload)
  return `${body}.${await hmac(secret, body)}`
}

async function verifySignedToken(
  token: string | null | undefined,
  secret: string,
): Promise<SessionPayload | null> {
  if (!token) return null
  const [body, signature] = token.split('.')
  if (!body || !signature) return null
  if (!safeEqual(signature, await hmac(secret, body))) return null
  const payload = jsonFromBase64url<SessionPayload>(body)
  if (!payload || typeof payload.exp !== 'number' || typeof payload.sid !== 'string') return null
  if (payload.exp * 1000 <= Date.now()) return null
  return payload
}

/**
 * Sessions are signed cookies backed by a KV record, so signing out (or
 * revoking a session) actually invalidates the token server-side.
 */
export async function createSession(
  kv: KVLike,
  secret: string,
  user: { id: string; email: string },
  ttlSeconds = SESSION_TTL_SECONDS,
): Promise<string> {
  const sid = crypto.randomUUID()
  await kv.put(sessionKey(sid), JSON.stringify({ uid: user.id, email: user.email }), {
    expirationTtl: ttlSeconds,
  })
  return signPayload({ sid, exp: Math.floor(Date.now() / 1000) + ttlSeconds }, secret)
}

export async function readSession(
  kv: KVLike,
  secret: string,
  token: string | null | undefined,
): Promise<SessionUser | null> {
  const payload = await verifySignedToken(token, secret)
  if (!payload) return null
  const raw = await kv.get(sessionKey(payload.sid))
  if (!raw) return null
  try {
    const record = JSON.parse(raw) as { uid: string; email: string }
    if (!record?.uid || !record.email) return null
    return { uid: record.uid, email: record.email, exp: payload.exp }
  } catch {
    return null
  }
}

export async function destroySession(
  kv: KVLike,
  secret: string,
  token: string | null | undefined,
): Promise<void> {
  const payload = await verifySignedToken(token, secret)
  if (payload) await kv.delete(sessionKey(payload.sid))
}

export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null
  for (const part of header.split(';')) {
    const index = part.indexOf('=')
    if (index === -1) continue
    if (part.slice(0, index).trim() === name)
      return decodeURIComponent(part.slice(index + 1).trim())
  }
  return null
}

export function sessionCookie(token: string, maxAge = SESSION_TTL_SECONDS): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`
}

export function clearedCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`
}

export function randomCode(): string {
  const bytes = new Uint32Array(1)
  crypto.getRandomValues(bytes)
  return String(bytes[0] % 1_000_000).padStart(6, '0')
}

export function normaliseEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const email = value.trim().toLowerCase()
  if (email.length < 5 || email.length > 254) return null
  if (!/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(email)) return null
  return email
}

export interface AuthUser {
  id: string
  email: string
  displayName: string | null
}

export async function upsertUser(db: D1Like, email: string): Promise<AuthUser> {
  const existing = await db
    .prepare('SELECT id, email, display_name FROM users WHERE email = ?')
    .bind(email)
    .first<{ id: string; email: string; display_name: string | null }>()
  if (existing) {
    return { id: existing.id, email: existing.email, displayName: existing.display_name }
  }
  const id = crypto.randomUUID()
  await db
    .prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)')
    .bind(id, email, Date.now())
    .run()
  return { id, email, displayName: null }
}

export interface AuthDeps {
  db: D1Like
  kv: KVLike
  email?: EmailLike
  secret: string
  fromEmail: string
  fromName?: string
  /** When true, `requestCode` returns the code so a deployment can be tested before DNS is wired. */
  exposeCode?: boolean
}

function otpKey(email: string): string {
  return `otp:${email}`
}

function rateKey(email: string): string {
  return `otp:rate:${email}`
}

async function sendCodeEmail(deps: AuthDeps, email: string, code: string): Promise<boolean> {
  if (!deps.email) return false
  const fromName = deps.fromName ?? '海龟汤调查局'
  const text = `你的登录验证码是 ${code}，10 分钟内有效。如果不是你本人操作，请忽略这封邮件。`
  try {
    await deps.email.send({
      to: email,
      from: { email: deps.fromEmail, name: fromName },
      subject: `【海龟汤调查局】登录验证码 ${code}`,
      text,
      html: `<div style="font-family:ui-monospace,Menlo,monospace;line-height:1.9;color:#17150f">
      <p>你的登录验证码是：</p>
      <p style="font-size:28px;font-weight:700;letter-spacing:.3em">${code}</p>
      <p style="color:#8c8677">10 分钟内有效。如果不是你本人操作，请忽略这封邮件。</p>
    </div>`,
    })
    return true
  } catch (error) {
    throw new ApiError(
      502,
      `验证码邮件发送失败：${error instanceof Error ? error.message : '未知错误'}`,
    )
  }
}

export async function requestCode(
  deps: AuthDeps,
  email: string,
): Promise<{ ok: true; sent: boolean; code?: string }> {
  const attempts = Number((await deps.kv.get(rateKey(email))) ?? '0')
  if (attempts >= OTP_MAX_REQUESTS) {
    throw new ApiError(429, '验证码请求过于频繁，请稍后再试')
  }

  const code = randomCode()
  const hashed = await hmac(deps.secret, `${email}:${code}`)
  await deps.kv.put(otpKey(email), JSON.stringify({ h: hashed, tries: 0 }), {
    expirationTtl: OTP_TTL_SECONDS,
  })
  await deps.kv.put(rateKey(email), String(attempts + 1), { expirationTtl: OTP_TTL_SECONDS })

  const sent = await sendCodeEmail(deps, email, code)
  if (!sent && !deps.exposeCode) {
    throw new ApiError(503, '邮件服务尚未配置，请联系管理员')
  }
  return { ok: true, sent, code: deps.exposeCode ? code : undefined }
}

export async function verifyCode(
  deps: AuthDeps,
  email: string,
  code: string,
): Promise<{ token: string; user: AuthUser }> {
  const raw = await deps.kv.get(otpKey(email))
  if (!raw) throw new ApiError(400, '验证码已过期，请重新获取')

  let record: { h: string; tries: number }
  try {
    record = JSON.parse(raw) as { h: string; tries: number }
  } catch {
    throw new ApiError(400, '验证码已过期，请重新获取')
  }
  if (record.tries >= OTP_MAX_ATTEMPTS) {
    await deps.kv.delete(otpKey(email))
    throw new ApiError(429, '尝试次数过多，请重新获取验证码')
  }

  const expected = await hmac(deps.secret, `${email}:${code}`)
  if (!safeEqual(record.h, expected)) {
    await deps.kv.put(otpKey(email), JSON.stringify({ h: record.h, tries: record.tries + 1 }), {
      expirationTtl: OTP_TTL_SECONDS,
    })
    throw new ApiError(400, '验证码不正确')
  }

  await deps.kv.delete(otpKey(email))
  const user = await upsertUser(deps.db, email)
  const token = await createSession(deps.kv, deps.secret, user)
  return { token, user }
}
