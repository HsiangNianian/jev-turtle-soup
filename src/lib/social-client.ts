import { getDeviceId } from '@/lib/luck'

/** 点赞与留言板，作者主页（profile）与题库的汤（puzzle）共用。 */
export type SocialKind = 'profile' | 'puzzle'

export interface SocialComment {
  id: string
  body: string
  createdAt: number
  author: { handle: string; displayName: string }
  mine: boolean
  canDelete: boolean
}

export interface SocialPayload {
  likes: number
  liked: boolean
  comments: SocialComment[]
  /** 当前登录的人是不是这个对象的主人 */
  canModerate: boolean
  signedIn: boolean
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  })
  const data = (await response.json().catch(() => ({}))) as { error?: string }
  if (!response.ok) throw new Error(data.error || `请求失败（${response.status}）`)
  return data as T
}

function base(kind: SocialKind, id: string): string {
  return `/api/social/${kind}/${encodeURIComponent(id)}`
}

export function fetchSocial(kind: SocialKind, id: string) {
  const key = encodeURIComponent(getDeviceId())
  return request<SocialPayload>(`${base(kind, id)}?playerKey=${key}`)
}

export function setSocialLike(kind: SocialKind, id: string, on: boolean) {
  const key = encodeURIComponent(getDeviceId())
  return request<{ likes: number; liked: boolean }>(`${base(kind, id)}/like?playerKey=${key}`, {
    method: on ? 'POST' : 'DELETE',
  })
}

export function postComment(kind: SocialKind, id: string, body: string) {
  return request<{ comment: SocialComment }>(`${base(kind, id)}/comments`, {
    method: 'POST',
    body: JSON.stringify({ body }),
  })
}

export function removeComment(commentId: string) {
  return request<{ ok: boolean }>(`/api/social/comments/${encodeURIComponent(commentId)}`, {
    method: 'DELETE',
  })
}

export function reportComment(commentId: string, note: string, locale: string) {
  return request<{ id: string }>(`/api/social/comments/${encodeURIComponent(commentId)}/report`, {
    method: 'POST',
    body: JSON.stringify({ note, locale, playerKey: getDeviceId() }),
  })
}
