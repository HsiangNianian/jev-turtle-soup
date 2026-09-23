import type { ArchivedGame } from './archive'
import type { AskContext, ChatMessage, GameSession, HostTurn, RevealResult } from './types'
import type {
  AuthUser,
  DailyDetail,
  DailyIndex,
  LibraryPuzzle,
  LibraryQuery,
  ReportPayload,
  TokenSession,
} from './public-types'

export class SaveRequestError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}
export interface SaveRequestOptions {
  owner: string
  signal: AbortSignal
}
export interface SaveTransport {
  listSaves(options: SaveRequestOptions): Promise<ArchivedGame[]>
  putSave(game: ArchivedGame, options: SaveRequestOptions): Promise<unknown>
  deleteSave(id: string, options: SaveRequestOptions): Promise<unknown>
}
export interface ClientOptions {
  baseUrl: string
  fetch?: typeof fetch
  getToken?: () => string | null
  timeoutMs?: number
}

/** Only accepts this API's relative paths; credentials never follow arbitrary URLs. */
export function createClient(options: ClientOptions) {
  const base = options.baseUrl.replace(/\/$/, '')
  if (base && !/^https?:\/\/[^/]+$/.test(base))
    throw new Error('API baseUrl must be an HTTP(S) origin')
  const send = options.fetch ?? globalThis.fetch
  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    if (!path.startsWith('/api/') || path.includes('://') || path.includes('\\'))
      throw new Error('Invalid API path')
    const controller = new AbortController()
    const abort = () => controller.abort()
    if (init.signal?.aborted) abort()
    init.signal?.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(abort, options.timeoutMs ?? 45000)
    try {
      const headers = new Headers(init.headers)
      headers.set('Accept', 'application/json')
      if (init.body !== undefined) headers.set('Content-Type', 'application/json')
      const token = options.getToken?.()
      if (token) headers.set('Authorization', `Bearer ${token}`)
      const response = await send(`${base}${path}`, {
        ...init,
        headers,
        signal: controller.signal,
        redirect: 'error',
        credentials: options.getToken ? 'omit' : 'same-origin',
      })
      const data = (await response.json().catch(() => null)) as ({ error?: string } & T) | null
      if (!response.ok)
        throw new SaveRequestError(response.status, data?.error || `HTTP ${response.status}`)
      if (data === null) throw new Error('Invalid API response')
      return data
    } finally {
      clearTimeout(timer)
      init.signal?.removeEventListener('abort', abort)
    }
  }
  const post = <T>(path: string, body: unknown, signal?: AbortSignal) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body), signal })
  const saveInit = (opts: SaveRequestOptions): RequestInit => ({
    signal: opts.signal,
    headers: { 'X-Save-Owner': opts.owner },
  })
  return {
    requestCode: (email: string, locale: string) =>
      post<{ sent: boolean; code?: string }>('/api/auth/request', { email, locale }),
    verifyCode: (email: string, code: string, locale: string) =>
      post<TokenSession>('/api/auth/verify', { email, code, locale, sessionMode: 'token' }),
    me: (signal?: AbortSignal) =>
      request<{ user: AuthUser }>('/api/auth/me', { signal }).then((r) => r.user),
    logout: () => post<{ ok: boolean }>('/api/auth/logout', {}),
    dailies: (signal?: AbortSignal) => request<DailyIndex>('/api/daily', { signal }),
    daily: (date: string, signal?: AbortSignal) =>
      request<{ daily: DailyDetail }>(`/api/daily/${encodeURIComponent(date)}`, { signal }).then(
        (r) => r.daily,
      ),
    puzzles: (query: LibraryQuery = {}, signal?: AbortSignal) => {
      const params = new URLSearchParams()
      for (const [key, value] of Object.entries(query))
        if (value !== undefined) params.set(key, String(value))
      return request<{ items: LibraryPuzzle[] }>(`/api/library/puzzles?${params}`, { signal }).then(
        (r) => r.items,
      )
    },
    puzzle: (id: string, signal?: AbortSignal) =>
      request<LibraryPuzzle>(`/api/library/puzzles/${encodeURIComponent(id)}`, { signal }),
    ask: (
      session: GameSession,
      message: string,
      history: ChatMessage[],
      context: AskContext,
      signal?: AbortSignal,
    ) => {
      if (session.source === 'library' && !session.libraryId)
        return Promise.reject(new Error('Missing library puzzle id'))
      return post<HostTurn>(
        session.libraryId
          ? `/api/library/puzzles/${encodeURIComponent(session.libraryId)}/ask`
          : '/api/game/ask',
        {
          ...(session.libraryId ? {} : { puzzleId: session.sessionId }),
          message,
          history: history.map(({ role, text }) => ({ role, text })),
          ...context,
        },
        signal,
      )
    },
    reveal: (session: GameSession, locale: string, signal?: AbortSignal) => {
      if (session.source === 'library' && !session.libraryId)
        return Promise.reject(new Error('Missing library puzzle id'))
      return post<RevealResult>(
        session.libraryId
          ? `/api/library/puzzles/${encodeURIComponent(session.libraryId)}/reveal`
          : '/api/game/reveal',
        { puzzleId: session.sessionId, locale },
        signal,
      )
    },
    report: (payload: ReportPayload) => post<{ id: string }>('/api/reports', payload),
    listSaves: (opts: SaveRequestOptions) =>
      request<{ items: ArchivedGame[] }>('/api/me/saves', saveInit(opts)).then((r) => r.items),
    putSave: (game: ArchivedGame, opts: SaveRequestOptions) =>
      request<{ ok: boolean }>(`/api/me/saves/${encodeURIComponent(game.id)}`, {
        ...saveInit(opts),
        method: 'PUT',
        body: JSON.stringify({ game }),
      }),
    deleteSave: (id: string, opts: SaveRequestOptions) =>
      request<{ ok: boolean }>(`/api/me/saves/${encodeURIComponent(id)}`, {
        ...saveInit(opts),
        method: 'DELETE',
      }),
  }
}
export type ApiClient = ReturnType<typeof createClient>
