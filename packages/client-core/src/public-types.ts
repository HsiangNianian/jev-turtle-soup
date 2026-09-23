export type Locale = 'zh-CN' | 'en' | 'ja'
export interface AuthUser {
  uid: string
  email: string
  name?: string | null
  handle?: string
  isAdmin?: boolean
}
export interface TokenSession {
  user: AuthUser
  token: string
  expiresAt: number
}
export interface DailySummary {
  date: string
  title: string
  difficulty: string
  tags: string[]
  locale: Locale
  genreScore: number | null
  plays: number
  solves: number | null
  relaxed: boolean
}
export interface DailyDetail extends DailySummary {
  puzzleId: string
  surface: string
  locked: boolean
  truth?: string
  story?: string
  hint?: string
  review?: unknown
}
export interface DailyIndex {
  today: DailyDetail | null
  history: DailySummary[]
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
  genreScore: number | null
  owner: { handle: string; displayName: string }
  ownerBio?: string
  official: boolean
  featured: boolean
}
export interface LibraryQuery {
  q?: string
  sort?: 'new' | 'hot' | 'featured'
  genre?: number
  limit?: number
  offset?: number
}
export interface ReportPayload {
  puzzleId: string
  kind: 'session' | 'library'
  note: string
  playerKey: string
  locale: string
  snapshot: unknown
}
