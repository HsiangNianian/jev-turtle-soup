import type { AskContext, HostTurn } from '@/lib/api'
import { staleWhileRevalidate } from '@/lib/cache'

/**
 * 题材坐标的读数：0 本格 · 100 变格。
 * 题库和每日汤共用同一把尺子，所以读数也共用同一处，免得两边措辞不一样。
 */
export function genreLabel(
  score: number | null | undefined,
  t: (key: string) => string,
): string | null {
  if (typeof score !== 'number') return null
  return score >= 50 ? `${t('变格度')} ${score}` : `${t('本格度')} ${100 - score}`
}

/** 怪力乱神：出题时的一个预设标签（题库不再按标签筛选，搜索框直接搜标签）。 */
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
  /** 过期的官方每日汤：和用户上传的题一样能玩，只是多一枚标识 */
  official: boolean
  /** 管理员打的精选标 */
  featured: boolean
  featuredNote?: string | null
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
  reveals: number
  /** 最近 7 天新增的问过 / 解开人数 */
  playsThisWeek: number
  solvesThisWeek: number
  /** 最近一次有人问过的时间；从没人玩过就是 null */
  lastActivityAt: number | null
  createdAt: number
}

export interface AuthorSummary {
  total: number
  public: number
  plays: number
  solves: number
  reveals: number
  playsThisWeek: number
  solvesThisWeek: number
}

export type AuthorEventKind = 'play' | 'solve' | 'comment' | 'like'

export interface AuthorEvent {
  kind: AuthorEventKind
  target: 'puzzle' | 'profile'
  at: number
  puzzleId: string | null
  puzzleTitle: string
  /** 留言正文（仅 comment） */
  body: string
  /** 留言者公开昵称（仅 comment） */
  actor: string
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

export interface Recognition {
  /** 公开的题数 */
  puzzles: number
  plays: number
  solves: number
  likes: number
  comments: number
  /** 已获得的徽章 key（中文文案，用 t() 翻） */
  badges: string[]
}

export interface PublicProfile {
  handle: string
  displayName: string
  bio: string
  profilePublic: boolean
  createdAt: number
  puzzles: LibraryPuzzle[]
  /** 私密主页为 null：徽章会泄露活跃度，不该在锁着的主页上出现 */
  recognition: Recognition | null
}

export interface PuzzleInput {
  title: string
  surface: string
  truth: string
  hint: string
  difficulty: string
  tags: string[]
  visibility: 'public' | 'private'
  /** 上传体检按这个语言回话 */
  locale?: string
}

export interface PuzzleIssue {
  kind: 'spoiler' | 'unexplained' | 'unsolvable' | 'no_unique'
  detail: string
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

/** 题库列表缓存 10 分钟；同一组筛选条件再进来就直接先渲染上次那份。 */
const PUZZLE_TTL_MS = 10 * 60 * 1000

/**
 * 列表里已经拿到的题，按 id 记一份。
 * 详情页要的字段（标题/汤面/难度/标签/游玩数/作者）列表里全都有，只差作者简介，
 * 所以点进详情不该先白屏等一次接口——直接把已知的那份摆上去，再补简介。
 */
const knownPuzzles = new Map<string, LibraryPuzzle>()

function rememberPuzzles(items: LibraryPuzzle[]): void {
  for (const item of items) knownPuzzles.set(item.id, item)
}

function puzzleCacheKey(options: { sort?: string; q?: string; genre?: number }): string {
  return `puzzles:${options.sort ?? 'new'}:${options.q ?? ''}:${
    typeof options.genre === 'number' ? Math.round(options.genre) : ''
  }`
}

export function listPuzzles(
  options: { sort?: 'new' | 'hot' | 'featured'; q?: string; genre?: number } = {},
  hooks: { onStale?: (items: LibraryPuzzle[]) => void } = {},
) {
  const params = new URLSearchParams()
  if (options.sort) params.set('sort', options.sort)
  if (options.q) params.set('q', options.q)
  if (typeof options.genre === 'number') params.set('genre', String(Math.round(options.genre)))
  const suffix = params.toString()
  return staleWhileRevalidate(
    puzzleCacheKey(options),
    PUZZLE_TTL_MS,
    () =>
      request<{ items: LibraryPuzzle[] }>(`/api/library/puzzles${suffix ? `?${suffix}` : ''}`).then(
        (data) => {
          rememberPuzzles(data.items)
          return data.items
        },
      ),
    hooks,
  )
}

export function listCuratedPuzzles() {
  return staleWhileRevalidate('puzzles:community-curated', PUZZLE_TTL_MS, () =>
    request<{ items: LibraryPuzzle[] }>(
      '/api/library/puzzles?scope=community&featuredOnly=1&limit=3',
    ).then((data) => {
      rememberPuzzles(data.items)
      return data.items
    }),
  )
}

/**
 * 语义重排：关键字检索的结果先照常显示，这一步再让 Jev 把候选按「是不是要找的那道」重排。
 * 单独一次请求（一次模型调用），失败就保持关键字顺序。
 */
/**
 * 语义重排是整页最慢的一步（一次模型调用），所以结果也缓存 10 分钟：
 * 反复改同一个搜索词不该反复花钱。
 */
export function rerankPuzzles(
  options: { sort?: 'new' | 'hot' | 'featured'; q: string; genre?: number },
  hooks: { onStale?: (items: LibraryPuzzle[]) => void } = {},
) {
  const key = `rerank:${options.sort ?? 'new'}:${options.q}:${
    typeof options.genre === 'number' ? Math.round(options.genre) : ''
  }`
  return staleWhileRevalidate(key, 10 * 60 * 1000, () => rerankRequest(options), hooks)
}

function rerankRequest(options: { sort?: 'new' | 'hot' | 'featured'; q: string; genre?: number }) {
  return request<{ items: LibraryPuzzle[] }>('/api/library/search/rerank', {
    method: 'POST',
    body: JSON.stringify({
      sort: options.sort,
      q: options.q,
      genre: typeof options.genre === 'number' ? Math.round(options.genre) : undefined,
    }),
  }).then((data) => data.items)
}

export function getPuzzle(
  id: string,
  hooks: { onStale?: (value: LibraryPuzzleDetail) => void } = {},
) {
  const known = knownPuzzles.get(id)
  if (known) hooks.onStale?.({ ...known, ownerBio: '' })
  return request<LibraryPuzzleDetail>(`/api/library/puzzles/${encodeURIComponent(id)}`).then(
    (detail) => {
      rememberPuzzles([detail])
      return detail
    },
  )
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

export function revealLibraryPuzzle(
  id: string,
  locale: string,
  manual = false,
  playerKey?: string,
) {
  return request<{ title: string; truth: string; hint: string }>(
    `/api/library/puzzles/${encodeURIComponent(id)}/reveal`,
    { method: 'POST', body: JSON.stringify({ locale, manual, playerKey }) },
  )
}

export function createPuzzle(input: PuzzleInput) {
  return request<{ id: string; review: PuzzleIssue[] | null }>('/api/library/puzzles', {
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
  return request<{ items: OwnPuzzle[]; summary: AuthorSummary; recognition: Recognition }>(
    '/api/me/puzzles',
  )
}

export function fetchAuthorActivity() {
  return request<{ items: AuthorEvent[] }>('/api/me/activity?limit=30').then((data) => data.items)
}

/** 未读动态数：页头红点用。 */
export function fetchUnread() {
  return request<{ unread: number }>('/api/me/notifications').then((data) => data.unread)
}

/** 进入「我的题库」时把动态标记为已读。 */
export function markActivitySeen() {
  return request<{ ok: boolean }>('/api/me/notifications/seen', { method: 'POST' })
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

/** 作者主页缓存 10 分钟：从别人的主页退回来、或者同一个人出现两次，都不该重新拉。 */
export function getPublicProfile(
  handle: string,
  hooks: { onStale?: (value: PublicProfile) => void } = {},
) {
  return staleWhileRevalidate<PublicProfile>(
    `profile:${handle.toLowerCase()}`,
    PUZZLE_TTL_MS,
    () =>
      request<{ profile: PublicProfile }>(`/api/u/${encodeURIComponent(handle)}`).then(
        (data) => data.profile,
      ),
    hooks,
  )
}
