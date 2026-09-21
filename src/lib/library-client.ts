import type { AskContext, HostTurn } from '@/lib/api'

/** 怪力乱神：既是出题题材，也是一个可筛选的标签。 */
export const SUPERNATURAL_TAG = '怪力乱神'

export interface OwnerInfo {
  handle: string
  displayName: string
}

export interface LibraryPuzzle {
  id: string
  title: string
  surface: string
  difficulty: string
  tags: string[]
  plays: number
  solves: number
  createdAt: number
  owner: OwnerInfo
  /** 0 = 本格·逻辑推理，100 = 变格·怪力乱神；没打过分为 null */
  genreScore: number | null
}

export interface LibraryPuzzleDetail extends LibraryPuzzle {
  ownerBio: string
}

export interface OwnPuzzle {
  id: string
  title: string
  surface: string
  truth: string
  hint: string
  difficulty: string
  tags: string[]
  visibility: 'public' | 'private'
  plays: number
  solves: number
  createdAt: number
}

export interface Profile {
  uid: string
  email?: string
  handle: string
  displayName: string
  bio: string
  profilePublic: boolean
  createdAt: number
  /** 最后一次「真的改了」的时间；null 表示还没改过，随时可改 */
  handleChangedAt: number | null
  displayNameChangedAt: number | null
  bioChangedAt: number | null
}

/** 和服务端一致：主页地址一年一次，昵称与简介 30 天一次。 */
export const HANDLE_COOLDOWN_MS = 1000 * 60 * 60 * 24 * 365
export const PROFILE_FIELD_COOLDOWN_MS = 1000 * 60 * 60 * 24 * 30

export function cooldownReadyAt(changedAt: number | null, windowMs: number): number | null {
  if (typeof changedAt !== 'number') return null
  return changedAt + windowMs
}

export function isCoolingDown(changedAt: number | null, windowMs: number): boolean {
  const readyAt = cooldownReadyAt(changedAt, windowMs)
  return readyAt !== null && Date.now() < readyAt
}

export interface PublicProfile {
  handle: string
  displayName: string
  bio: string
  profilePublic: boolean
  createdAt: number
  puzzles: LibraryPuzzle[]
}

export interface PuzzleInput {
  title: string
  surface: string
  truth: string
  hint: string
  difficulty: string
  tags: string[]
  visibility: 'public' | 'private'
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

export function listTags() {
  return request<{ items: { tag: string; count: number }[] }>('/api/library/tags').then(
    (data) => data.items,
  )
}

export function listPuzzles(
  options: { sort?: 'new' | 'hot'; q?: string; tag?: string; genre?: number } = {},
) {
  const params = new URLSearchParams()
  if (options.sort) params.set('sort', options.sort)
  if (options.q) params.set('q', options.q)
  if (options.tag) params.set('tag', options.tag)
  if (typeof options.genre === 'number') params.set('genre', String(Math.round(options.genre)))
  const suffix = params.toString()
  return request<{ items: LibraryPuzzle[] }>(
    `/api/library/puzzles${suffix ? `?${suffix}` : ''}`,
  ).then((data) => data.items)
}

export function getPuzzle(id: string) {
  return request<LibraryPuzzleDetail>(`/api/library/puzzles/${encodeURIComponent(id)}`)
}

export function askLibraryPuzzle(
  id: string,
  message: string,
  history: { role: string; text: string }[],
  context: AskContext,
) {
  return request<HostTurn>(`/api/library/puzzles/${encodeURIComponent(id)}/ask`, {
    method: 'POST',
    body: JSON.stringify({ message, history, ...context }),
  })
}

export function revealLibraryPuzzle(id: string, locale: string) {
  return request<{ title: string; truth: string; hint: string }>(
    `/api/library/puzzles/${encodeURIComponent(id)}/reveal`,
    { method: 'POST', body: JSON.stringify({ locale }) },
  )
}

export function createPuzzle(input: PuzzleInput) {
  return request<{ id: string }>('/api/library/puzzles', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function updatePuzzle(id: string, patch: Partial<PuzzleInput>) {
  return request<{ ok: boolean }>(`/api/library/puzzles/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
}

export function deletePuzzle(id: string) {
  return request<{ ok: boolean }>(`/api/library/puzzles/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}

export function listMyPuzzles() {
  return request<{ items: OwnPuzzle[] }>('/api/me/puzzles').then((data) => data.items)
}

export function getMyProfile() {
  return request<{ profile: Profile }>('/api/me/profile').then((data) => data.profile)
}

export function updateMyProfile(
  patch: Partial<Pick<Profile, 'handle' | 'displayName' | 'bio' | 'profilePublic'>>,
) {
  return request<{ profile: Profile }>('/api/me/profile', {
    method: 'PATCH',
    body: JSON.stringify(patch),
  }).then((data) => data.profile)
}

export function getPublicProfile(handle: string) {
  return request<{ profile: PublicProfile }>(`/api/u/${encodeURIComponent(handle)}`).then(
    (data) => data.profile,
  )
}
