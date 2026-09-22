import { dropCache, readCache, writeCache } from '@/lib/cache'

export interface AuthUser {
  uid: string
  email: string
  name?: string | null
  handle?: string
  /** 是否管理员：有它才给「管理后台」入口 */
  isAdmin?: boolean
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  })
  const data = (await response.json().catch(() => ({}))) as { error?: string }
  if (!response.ok) {
    throw new Error(data.error || `请求失败（${response.status}）`)
  }
  return data as T
}

const ME_KEY = 'me'
/** 登录态缓存 24 小时。会话可能被吊销，所以只用来撑首屏，随后一定会去核对。 */
const ME_TTL_MS = 24 * 60 * 60 * 1000

/** 上次拿到的登录用户；没有就返回 null。用来让首屏直接按「已登录」渲染，不等网络。 */
export function cachedUser(): AuthUser | null {
  return readCache<AuthUser>(ME_KEY, ME_TTL_MS)
}

export function forgetUser(): void {
  dropCache(ME_KEY)
}

/** 拿到用户后记下来，下次打开就不用先问服务器了。 */
export function rememberUser(user: AuthUser | null): void {
  if (user) writeCache(ME_KEY, user)
  else dropCache(ME_KEY)
}

export async function fetchMe(): Promise<AuthUser | null> {
  const response = await fetch('/api/auth/me')
  // 401 是明确的「没登录」：把缓存清掉，免得一直显示成已登录
  if (response.status === 401) {
    forgetUser()
    return null
  }
  if (!response.ok) return null
  const data = (await response.json()) as { user: AuthUser | null }
  rememberUser(data.user)
  return data.user
}

export function requestLoginCode(email: string, locale: string) {
  return request<{ ok: boolean; sent: boolean; code?: string }>('/api/auth/request', {
    method: 'POST',
    body: JSON.stringify({ email, locale }),
  })
}

export function verifyLoginCode(email: string, code: string) {
  return request<{ user: AuthUser }>('/api/auth/verify', {
    method: 'POST',
    body: JSON.stringify({ email, code }),
  })
    .then((data) => data.user)
    .then((user) => {
      rememberUser(user)
      return user
    })
}

export function logout() {
  return request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' })
}
