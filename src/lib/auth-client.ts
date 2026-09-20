export interface AuthUser {
  uid: string
  email: string
  name?: string | null
  handle?: string
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

export async function fetchMe(): Promise<AuthUser | null> {
  const response = await fetch('/api/auth/me')
  if (response.status === 401) return null
  if (!response.ok) return null
  const data = (await response.json()) as { user: AuthUser | null }
  return data.user
}

export function requestLoginCode(email: string) {
  return request<{ ok: boolean; sent: boolean; code?: string }>('/api/auth/request', {
    method: 'POST',
    body: JSON.stringify({ email }),
  })
}

export function verifyLoginCode(email: string, code: string) {
  return request<{ user: AuthUser }>('/api/auth/verify', {
    method: 'POST',
    body: JSON.stringify({ email, code }),
  }).then((data) => data.user)
}

export function logout() {
  return request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' })
}
