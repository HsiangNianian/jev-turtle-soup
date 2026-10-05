import { usePlayViewport } from '@/lib/play-navigation'
import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { ArrowLeft, Cloud, Loader2, TriangleAlert } from 'lucide-react'

import { CaseDrawer } from '@/components/CaseDrawer'
import { LocaleMenu, ThemeToggle } from '@/components/Controls'
import { Footer } from '@/components/Footer'
import { Landing } from '@/components/Landing'
import { SyncNotice } from '@/components/SyncNotice'
import { PersonalMarksProvider } from '@/components/PersonalMarks'

/**
 * 首屏只留「打开首页真正需要的东西」：外壳、首页、页脚。
 * 其余按路由拆开，谁用到谁再下 —— 手机上首屏省下的每一 KB 都是实打实的。
 *
 * 逐个手写而不是套一个泛型助手：助手会把组件的 props 类型抹成 any，
 * 那样传错参数也不会报错了。
 */
const AboutPage = lazy(() =>
  import('@/components/AboutPage').then((m) => ({ default: m.AboutPage })),
)
const ArchiveView = lazy(() =>
  import('@/components/ArchiveView').then((m) => ({ default: m.ArchiveView })),
)
const ChatPanel = lazy(() =>
  import('@/components/ChatPanel').then((m) => ({ default: m.ChatPanel })),
)
const ClozePage = lazy(() =>
  import('@/components/ClozePage').then((m) => ({ default: m.ClozePage })),
)
const DailyIndexPage = lazy(() =>
  import('@/components/DailyPage').then((m) => ({ default: m.DailyIndexPage })),
)
const DailyDetailPage = lazy(() =>
  import('@/components/DailyPage').then((m) => ({ default: m.DailyDetailPage })),
)
const LeavingPage = lazy(() =>
  import('@/components/LeavingPage').then((m) => ({ default: m.LeavingPage })),
)
const LibraryPage = lazy(() =>
  import('@/components/LibraryPage').then((m) => ({ default: m.LibraryPage })),
)
const LoginPage = lazy(() =>
  import('@/components/LoginPage').then((m) => ({ default: m.LoginPage })),
)
const MePage = lazy(() => import('@/components/MePage').then((m) => ({ default: m.MePage })))
const ProfileEditPage = lazy(() =>
  import('@/components/ProfileEditPage').then((m) => ({ default: m.ProfileEditPage })),
)
const ProfilePage = lazy(() =>
  import('@/components/ProfilePage').then((m) => ({ default: m.ProfilePage })),
)
const PuzzleDetailPage = lazy(() =>
  import('@/components/PuzzleDetailPage').then((m) => ({ default: m.PuzzleDetailPage })),
)
const PuzzlePanel = lazy(() =>
  import('@/components/PuzzlePanel').then((m) => ({ default: m.PuzzlePanel })),
)
const UploadPage = lazy(() =>
  import('@/components/UploadPage').then((m) => ({ default: m.UploadPage })),
)
const AdminPage = lazy(() =>
  import('@/components/AdminPage').then((m) => ({ default: m.AdminPage })),
)
const GuidePage = lazy(() =>
  import('@/components/GuidePage').then((m) => ({ default: m.GuidePage })),
)
const RoomPage = lazy(() => import('@/components/RoomPage').then((m) => ({ default: m.RoomPage })))
const RoomLobby = lazy(() =>
  import('@/components/RoomPage').then((m) => ({ default: m.RoomLobby })),
)
import {
  askHost,
  fetchHealth,
  type HostTurn,
  type ChatMessage,
  type GameSession,
  type HealthInfo,
} from '@/lib/api'
import {
  buildLedger,
  loadGames,
  saveGames,
  shareTarget,
  toSession,
  upsertGame,
  winningConclusion,
  type ArchivedGame,
  type GameStatus,
} from '@/lib/archive'
import { saveSync, type SyncState } from '@/lib/save-sync'
import { archiveStore } from '@/lib/archive-store'
import {
  cachedUser,
  fetchMe,
  forgetUser,
  rememberUser,
  logout as logoutRequest,
  type AuthUser,
} from '@/lib/auth-client'
import { submitReport } from '@/lib/report-client'
import {
  askLibraryPuzzle,
  fetchUnread,
  listPuzzles,
  type LibraryPuzzleDetail,
} from '@/lib/library-client'
import { navigate, matchPath, usePath } from '@/lib/router'
import { revealSession } from '@/lib/reveal-client'
import { useReportStory } from '@/lib/use-report-story'
import { utcToday, type DailyDetail } from '@/lib/daily-client'
import { dailyLuck, getDeviceId, todayKey } from '@/lib/luck'
import { cn, uid } from '@/lib/utils'
import { trackWebEngagement } from '@/lib/engagement-client'
import { Link } from '@/components/Link'
import { MobileNavigation } from '@/components/MobileNavigation'
import { useI18n } from '@/lib/i18n'

const VERDICTS = ['yes', 'no', 'partly', 'irrelevant']

function toneFor(turn: { solved: boolean; verdict: string }): ChatMessage['tone'] {
  if (turn.solved) return 'celebrate'
  if (VERDICTS.includes(turn.verdict)) return 'verdict'
  return 'normal'
}

/** Cached identity is display-only until /me confirms it. Account keys remount all play state. */
export default function App() {
  const [user, setUser] = useState<AuthUser | null>(() => cachedUser())
  const sync = saveSync()
  const syncState = useSyncExternalStore(sync.subscribe, sync.getSnapshot)
  const authRequest = useRef<AbortController | null>(null)
  const authGeneration = useRef(0)
  const confirmed = useRef(false)
  const currentUser = useRef(user)

  const applyUser = useCallback(
    (next: AuthUser | null) => {
      currentUser.current = next
      confirmed.current = true
      rememberUser(next)
      sync.setUser(next?.uid ?? null, true)
      setUser(next)
    },
    [sync],
  )

  const verifyAccount = useCallback(async () => {
    authRequest.current?.abort()
    const controller = new AbortController()
    authRequest.current = controller
    const generation = ++authGeneration.current
    try {
      const next = await fetchMe(controller.signal)
      if (generation !== authGeneration.current) return
      applyUser(next)
      sync.retry()
    } catch {
      // A network failure must not move cached account progress into the guest space.
      if (generation !== authGeneration.current) return
      confirmed.current = false
      sync.setUser(currentUser.current?.uid ?? null, false)
    }
  }, [applyUser, sync])

  useEffect(() => {
    sync.setUser(currentUser.current?.uid ?? null, false)
    // Start authentication outside the synchronous effect; cached identity only paints the shell.
    void Promise.resolve().then(verifyAccount)
    const resume = () => {
      if (document.visibilityState === 'hidden') return
      if (!confirmed.current || sync.getSnapshot().status === 'auth') void verifyAccount()
      else {
        const state = sync.getSnapshot()
        if (state.status !== 'error' || state.httpStatus === 429 || (state.httpStatus ?? 0) >= 500)
          sync.retry()
      }
    }
    window.addEventListener('online', resume)
    window.addEventListener('turtle-soup:auth-check', verifyAccount)
    document.addEventListener('visibilitychange', resume)
    return () => {
      // Invalidate the latest request, not only the one present at mount.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      ++authGeneration.current
      // This intentionally aborts the latest request, including retries started after mount.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      authRequest.current?.abort()
      sync.stop()
      window.removeEventListener('online', resume)
      window.removeEventListener('turtle-soup:auth-check', verifyAccount)
      document.removeEventListener('visibilitychange', resume)
    }
  }, [sync, verifyAccount])

  const handleLogin = useCallback(
    (next: AuthUser) => {
      ++authGeneration.current
      authRequest.current?.abort()
      applyUser(next)
      const returnTo = new URLSearchParams(window.location.search).get('next')
      const safeReturn =
        returnTo?.startsWith('/') && !returnTo.startsWith('//') && !returnTo.includes('\\')
          ? returnTo
          : '/'
      navigate(safeReturn, { replace: true })
    },
    [applyUser],
  )

  const handleLogout = useCallback(async () => {
    ++authGeneration.current
    authRequest.current?.abort()
    sync.stop()
    confirmed.current = false
    currentUser.current = null
    setUser(null)
    forgetUser()
    sync.setUser(null, false)
    navigate('/')
    // A failed logout cannot authorize cached queues; they remain paused until a later /me.
    await logoutRequest().catch(() => undefined)
  }, [sync])

  const retry = useCallback(() => {
    if (
      archiveStore().storageError &&
      !archiveStore().retryStorage(currentUser.current?.uid ?? null)
    )
      return
    if (!confirmed.current || sync.getSnapshot().status === 'auth') void verifyAccount()
    else sync.retry()
  }, [sync, verifyAccount])

  return (
    <GameApp
      key={user ? `user:${user.uid}` : 'guest'}
      user={user}
      syncState={syncState}
      onLogin={handleLogin}
      onLogout={handleLogout}
      onRetry={retry}
    />
  )
}

function GameApp({
  user,
  syncState,
  onLogin,
  onLogout,
  onRetry,
}: {
  user: AuthUser | null
  syncState: SyncState
  onLogin: (user: AuthUser) => void
  onLogout: () => Promise<void>
  onRetry: () => void
}) {
  const { t, locale } = useI18n()
  const path = usePath()
  const playing =
    path === '/play' || path.startsWith('/cloze/') || /^\/rooms\/(?!new$|join$)/.test(path)
  usePlayViewport(playing)
  const owner = user?.uid ?? null
  const [initialGames] = useState(() => loadGames(owner))
  const [bootGame] = useState(() =>
    window.location.pathname === '/play'
      ? (initialGames.find((game) => game.status === 'active') ?? initialGames[0] ?? null)
      : null,
  )
  const persist = useCallback(
    (next: ArchivedGame[]) => {
      saveGames(next, owner)
      return next
    },
    [owner],
  )
  const [health, setHealth] = useState<HealthInfo | null>(null)
  const [unread, setUnread] = useState(0)
  const [dismissedImports, setDismissedImports] = useState(0)
  const synced = Math.max(0, syncState.imported - dismissedImports)
  const [games, setGames] = useState<ArchivedGame[]>(initialGames)
  const [session, setSession] = useState<GameSession | null>(() =>
    bootGame ? toSession(bootGame) : null,
  )
  const [messages, setMessages] = useState<ChatMessage[]>(() => bootGame?.messages ?? [])
  const [revealed, setRevealed] = useState(() => bootGame?.revealed ?? false)
  const [truth, setTruth] = useState<string | null>(() => bootGame?.truth ?? null)
  const [story, setStory] = useState<string | null | undefined>(() => bootGame?.story)
  const [solved, setSolved] = useState(() => bootGame?.solved ?? false)
  const [closeness, setCloseness] = useState<number | null>(() => bootGame?.closeness ?? null)
  const [asking, setAsking] = useState(false)
  const [turnCount, setTurnCount] = useState(() => bootGame?.turnCount ?? 0)
  const [startedAt, setStartedAt] = useState<number>(() => bootGame?.createdAt ?? Date.now())
  const [drawerOpen, setDrawerOpen] = useState(false)

  useEffect(() => {
    fetchHealth()
      .then(setHealth)
      .catch(() => setHealth(null))
  }, [])

  useEffect(() => {
    trackWebEngagement('entry_view')
  }, [])

  // 未读动态：登录后拉一次；进「我的题库」时会清零。
  // 登出时不必手动清零 —— 红点只在 user 存在时渲染，状态留着也无妨。
  useEffect(() => {
    if (!user) return
    let alive = true
    fetchUnread()
      .then((count) => {
        if (alive) setUnread(count)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [user])

  const todayLuck = useMemo(() => {
    const luck = dailyLuck(todayKey(), window.location.host, getDeviceId())
    return {
      date: luck.date,
      score: luck.score,
      tierKey: luck.tier.key,
      goodIndex: luck.goodIndex,
      badIndex: luck.badIndex,
    }
  }, [])

  const gameOver = solved || revealed
  /** 当天生成的官方汤：汤底要到第二天才许揭开。 */
  const lockedDaily = session?.source === 'daily' && session.dailyDate === utcToday()
  const liveStatus: GameStatus = solved ? 'solved' : revealed ? 'revealed' : 'active'

  const buildEntry = useCallback(
    (status: GameStatus): ArchivedGame | null => {
      if (!session) return null
      const previous = games.find((game) => game.id === session.sessionId)
      const entry: ArchivedGame = {
        id: session.sessionId,
        title: session.title,
        surface: session.surface,
        difficulty: session.difficulty,
        source: session.source,
        hostGreeting: session.hostGreeting,
        hint: previous?.hint ?? '',
        libraryId: session.libraryId,
        dailyDate: session.dailyDate,
        createdAt: startedAt,
        updatedAt: Date.now(),
        messages,
        revealed,
        truth,
        story,
        solved,
        closeness,
        turnCount,
        status,
      }
      if (
        previous &&
        Object.keys(entry).every(
          (key) =>
            key === 'updatedAt' ||
            JSON.stringify(previous[key as keyof ArchivedGame]) ===
              JSON.stringify(entry[key as keyof ArchivedGame]),
        )
      ) {
        entry.updatedAt = previous.updatedAt
      } else {
        entry.updatedAt = Math.max(Date.now(), (previous?.updatedAt ?? 0) + 1)
      }
      return entry
    },
    [session, startedAt, messages, revealed, truth, story, solved, closeness, turnCount, games],
  )

  const liveEntry = useMemo(() => buildEntry(liveStatus), [buildEntry, liveStatus])
  const allGames = useMemo(
    () => (liveEntry ? upsertGame(games, liveEntry) : games),
    [games, liveEntry],
  )

  const activeGames = useMemo(
    () =>
      allGames.filter((game) => game.status === 'active').sort((a, b) => b.updatedAt - a.updatedAt),
    [allGames],
  )
  const archives = useMemo(() => allGames.filter((game) => game.status !== 'active'), [allGames])
  const ledger = useMemo(() => buildLedger(messages), [messages])

  useEffect(() => {
    if (liveEntry) saveGames(allGames, owner)
  }, [liveEntry, allGames, owner])

  const hydrate = useCallback((game: ArchivedGame) => {
    setSession(toSession(game))
    setMessages(game.messages)
    setRevealed(game.revealed)
    setTruth(game.truth)
    setStory(game.story)
    setSolved(game.solved)
    setCloseness(game.closeness)
    setTurnCount(game.turnCount)
    setStartedAt(game.createdAt)
  }, [])

  useEffect(
    () =>
      archiveStore().subscribe((event) => {
        if (event.owner !== owner || event.kind !== 'remote') return
        const next = loadGames(owner)
        const current = liveEntry
        const remote = current && next.find((game) => game.id === current.id)
        if (remote && remote.updatedAt > current!.updatedAt) hydrate(remote)
        setGames(next)
      }),
    [owner, hydrate, liveEntry],
  )

  const acceptReportStory = useCallback(
    (id: string, loaded: string | null) => {
      if (session?.sessionId === id) setStory(loaded)
      setGames((previous) => {
        const game = previous.find((item) => item.id === id)
        if (!game || game.story !== undefined) return previous
        return persist(
          upsertGame(previous, {
            ...game,
            story: loaded,
            updatedAt: Math.max(Date.now(), game.updatedAt + 1),
          }),
        )
      })
    },
    [session?.sessionId, persist],
  )
  const storyRecovery = useReportStory(
    session,
    path === '/play' && revealed && Boolean(truth),
    story,
    acceptReportStory,
  )

  /** 从服务端取回汤底和原始故事（会话题与题库题走同一个出口）。 */
  const fetchTruth = useCallback(
    async (manual = false) => {
      if (!session) return null
      const result = await revealSession(session, locale, manual)
      setTruth(result.truth)
      setStory(result.story ?? null)
      return result.truth
    },
    [session, locale],
  )

  const startLibraryGame = useCallback(
    (puzzle: LibraryPuzzleDetail) => {
      if (puzzle.mode === 'cloze') {
        navigate(`/cloze/${puzzle.id}`)
        return
      }
      setSession({
        sessionId: uid(),
        title: puzzle.title,
        surface: puzzle.surface,
        difficulty: puzzle.difficulty,
        source: 'library',
        hostGreeting: t('汤面已经端上来了。开始提问吧，我只回答「是」「不是」「无关」。'),
        libraryId: puzzle.id,
      })
      setMessages([
        {
          id: uid(),
          role: 'host',
          text: t('汤面已经端上来了。开始提问吧，我只回答「是」「不是」「无关」。'),
        },
      ])
      setRevealed(false)
      setTruth(null)
      setStory(undefined)
      setSolved(false)
      setCloseness(null)
      setTurnCount(0)
      setStartedAt(Date.now())
      setDrawerOpen(true)
      trackWebEngagement('puzzle_open', puzzle.id)
      navigate('/play')
    },
    [t],
  )

  /** 官方每日汤：题号就是当天的那道题，判读走 /api/game/ask。 */
  const startDailyGame = useCallback(
    (daily: DailyDetail) => {
      // 同一天再次点进来是「续摊」：题号相同，直接恢复那份案卷，别把问答清空
      const existing = allGames.find((game) => game.id === daily.puzzleId)
      if (existing) {
        if (session?.sessionId !== existing.id) hydrate(existing)
        setDrawerOpen(true)
        navigate('/play')
        return
      }
      const greeting = t('汤面已经端上来了。开始提问吧，我只回答「是」「不是」「无关」。')
      setSession({
        sessionId: daily.puzzleId,
        title: daily.title,
        surface: daily.surface,
        difficulty: daily.difficulty,
        source: 'daily',
        hostGreeting: greeting,
        dailyDate: daily.date,
      })
      setMessages([{ id: uid(), role: 'host', text: greeting }])
      setRevealed(false)
      setTruth(null)
      setStory(undefined)
      setSolved(false)
      setCloseness(null)
      setTurnCount(0)
      setStartedAt(Date.now())
      setDrawerOpen(true)
      trackWebEngagement('puzzle_open', daily.puzzleId)
      navigate('/play')
    },
    [allGames, hydrate, session, t],
  )

  /** 早期存档没存题库题号，恢复后会一直「过期」——按标题回查一次补上。 */
  const repairLibraryId = useCallback(
    async (game: ArchivedGame) => {
      try {
        const items = await listPuzzles({ q: game.title })
        const hits = items.filter((item) => item.title === game.title)
        if (hits.length !== 1) return null
        const libraryId = hits[0].id
        setGames((prev) =>
          persist(prev.map((item) => (item.id === game.id ? { ...item, libraryId } : item))),
        )
        setSession((prev) => (prev && prev.sessionId === game.id ? { ...prev, libraryId } : prev))
        return libraryId
      } catch {
        return null
      }
    },
    [persist],
  )

  /** 把一次判读结果落进界面状态（正常路径与修复后的重试共用）。 */
  const applyTurn = useCallback(
    (turn: HostTurn) => {
      setMessages((prev) => [
        ...prev,
        {
          id: uid(),
          role: 'host',
          text: turn.reply,
          tone: toneFor(turn),
          verdict: turn.verdict,
          replyLocale: turn.replyLocale,
          debug: turn.debug,
          model: turn.model,
          closeness: turn.closeness,
        },
      ])
      if (typeof turn.closeness === 'number') {
        setCloseness((prev) => Math.max(prev ?? 0, turn.closeness ?? 0))
      }
      if (turn.revealed) {
        if (turn.truth) setTruth(turn.truth)
        setStory(turn.story ?? null)
      }
      if (turn.solved) {
        setSolved(true)
        setRevealed(true)
        setDrawerOpen(true)
      } else if (turn.revealed) {
        setRevealed(true)
        setDrawerOpen(true)
        // 老服务端或题库题可能没带汤底，兜底再取一次
        if (!turn.truth) void fetchTruth()
      }
    },
    [fetchTruth],
  )

  const handleSend = useCallback(
    async (text: string) => {
      if (!session) return
      const history = messages
      setMessages((prev) => [...prev, { id: uid(), role: 'player', text }])
      setAsking(true)
      setTurnCount((count) => count + 1)
      const context = {
        locale,
        playerKey: getDeviceId(),
        seq: turnCount + 1,
        luck: todayLuck,
      }
      const turns = history.map(({ role, text: body }) => ({ role, text: body }))

      try {
        const turn = session.libraryId
          ? await askLibraryPuzzle(session.libraryId, text, turns, context)
          : await askHost(session, text, history, context)
        if (turnCount === 0 && (session.libraryId || session.source === 'daily')) {
          trackWebEngagement('first_question', session.libraryId ?? session.sessionId)
        }
        applyTurn(turn)
      } catch (error) {
        // 旧的题库存档丢了题号：回查一次再试，别让玩家看到「已过期」
        const archived = allGames.find((item) => item.id === session.sessionId)
        if (!session.libraryId && session.source === 'library' && archived) {
          const libraryId = await repairLibraryId(archived)
          if (libraryId) {
            try {
              applyTurn(await askLibraryPuzzle(libraryId, text, turns, context))
              return
            } catch {
              /* 还是不行，走下面的报错 */
            }
          }
        }
        setMessages((prev) => [
          ...prev,
          {
            id: uid(),
            role: 'host',
            tone: 'error',
            text: error instanceof Error ? error.message : t('请求失败，请稍后再试'),
          },
        ])
      } finally {
        setAsking(false)
      }
    },
    [messages, session, todayLuck, locale, turnCount, applyTurn, allGames, repairLibraryId, t],
  )

  const handleReveal = useCallback(async () => {
    if (!session || revealed) return
    if (lockedDaily) {
      setMessages((prev) => [
        ...prev,
        {
          id: uid(),
          role: 'host',
          text: t('今天的官方汤不能提前揭晓——明天它就会解锁，到时候你随时可以翻看。'),
        },
      ])
      return
    }
    try {
      await fetchTruth(true)
      setRevealed(true)
      setDrawerOpen(true)
      setMessages((prev) => [
        ...prev,
        {
          id: uid(),
          role: 'host',
          text: t('（主持人把碗底翻了过来，汤底就在案卷里。）'),
        },
      ])
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          id: uid(),
          role: 'host',
          tone: 'error',
          text: error instanceof Error ? error.message : t('揭晓失败'),
        },
      ])
    }
  }, [revealed, lockedDaily, session, fetchTruth, t])

  const handleQuick = useCallback(
    (kind: 'hint' | 'reveal' | 'how_to_play') => {
      if (kind === 'reveal') {
        void handleReveal()
        return
      }
      void handleSend(kind === 'hint' ? t('给我一点提示吧。') : t('这个游戏怎么玩？'))
    },
    [handleReveal, handleSend, t],
  )

  const handleContinue = useCallback(
    (id: string) => {
      const game = allGames.find((item) => item.id === id)
      if (!game) return
      if (game.source === 'library' && !game.libraryId) void repairLibraryId(game)
      if (session?.sessionId !== id) hydrate(game)
      setDrawerOpen(true)
      navigate('/play')
    },
    [allGames, hydrate, session, repairLibraryId],
  )

  const handleAbandon = useCallback(
    (id: string) => {
      if (!window.confirm(t('中止本案？记录会留在档案室，但不能再继续讯问。'))) return
      const abandoned = session?.sessionId === id ? buildEntry('abandoned') : null
      setGames((prev) => {
        const merged = abandoned ? upsertGame(prev, abandoned) : prev
        return persist(
          merged.map((game) =>
            game.id === id
              ? { ...game, status: 'abandoned' as GameStatus, updatedAt: Date.now() }
              : game,
          ),
        )
      })
      if (session?.sessionId === id) {
        setSession(null)
        setMessages([])
        setTurnCount(0)
        setRevealed(false)
        setTruth(null)
        setStory(undefined)
        setSolved(false)
        setCloseness(null)
      }
      navigate('/')
    },
    [buildEntry, session, t, persist],
  )

  const handleDeleteArchive = useCallback(
    (id: string) => {
      // 删除的是当前正开着的那一局时，先把会话清掉，否则它会被实时存档重新写回
      if (session?.sessionId === id) {
        setSession(null)
        setMessages([])
        setTurnCount(0)
        setRevealed(false)
        setTruth(null)
        setStory(undefined)
        setSolved(false)
        setCloseness(null)
      }
      setGames((prev) => persist(prev.filter((game) => game.id !== id)))
    },
    [session, persist],
  )

  const handleReport = useCallback(
    async (note: string) => {
      if (!session) return
      await submitReport({
        puzzleId: session.libraryId ?? session.sessionId,
        kind: session.libraryId ? 'library' : 'session',
        note,
        playerKey: getDeviceId(),
        locale,
        snapshot: {
          title: session.title,
          surface: session.surface,
          difficulty: session.difficulty,
          source: session.source,
          turnCount,
          closeness,
          solved,
          revealed,
          url: window.location.href,
          messages: messages.map(({ role, text, verdict, tone, debug, model }) => ({
            role,
            text,
            verdict,
            tone,
            model,
            debug,
          })),
        },
      })
    },
    [session, locale, turnCount, closeness, solved, revealed, messages],
  )

  const clearUnread = useCallback(() => setUnread(0), [])

  const typesafeMissing = health !== null && !health.typesafeConfigured

  /** 对局里的分享入口：分享的正是正在玩的这碗汤的公开链接。 */
  const share = session ? shareTarget(session) : undefined

  const renderCase = (onStart?: () => void) =>
    session ? (
      <PuzzlePanel
        session={session}
        revealed={revealed}
        truth={truth}
        story={story}
        storyRecovery={storyRecovery}
        solved={solved}
        closeness={closeness}
        turnCount={turnCount}
        ledger={ledger}
        conclusion={solved ? winningConclusion(messages) : null}
        locked={lockedDaily}
        onReveal={handleReveal}
        onStart={onStart}
      />
    ) : null

  function renderBody() {
    const archiveMatch = matchPath(path, '/archive/:id')
    if (archiveMatch) {
      const game = allGames.find((item) => item.id === archiveMatch.id)
      if (!game) {
        return (
          <ScrollArea>
            <Missing label={t('案卷')} message={t('找不到这一卷。')} />
          </ScrollArea>
        )
      }
      return (
        <PersonalMarksProvider key={game.id} owner={owner} kind="solo" id={game.id}>
          <ArchiveView
            game={game}
            onContinue={() => handleContinue(game.id)}
            onStoryLoaded={acceptReportStory}
          />
        </PersonalMarksProvider>
      )
    }

    if (path === '/cloze')
      return (
        <ScrollArea>
          <LibraryPage key="cloze" mode="cloze" />
        </ScrollArea>
      )
    const clozeMatch = matchPath(path, '/cloze/:id')
    if (clozeMatch) return <ClozePage key={clozeMatch.id} id={clozeMatch.id} />

    if (path === '/play') {
      if (!session) {
        return (
          <ScrollArea>
            <Missing label={t('对局')} message={t('还没有开案。')} />
          </ScrollArea>
        )
      }
      return (
        <PersonalMarksProvider
          key={session.sessionId}
          owner={owner}
          kind="solo"
          id={session.sessionId}
        >
          <main className="play-layout flex min-h-0 flex-1 flex-col lg:flex-row">
            <section className="play-case-rail chat-scroll hidden min-h-0 overflow-y-auto lg:block lg:h-full lg:border-r lg:border-foreground/25">
              {renderCase()}
            </section>
            <section className="flex min-h-0 flex-1 flex-col">
              <CaseDrawer
                title={session.title}
                meta={t('等级 {level} · 已问 {turns} 轮', {
                  level: t(session.difficulty),
                  turns: turnCount,
                })}
                open={drawerOpen}
                onOpenChange={setDrawerOpen}
                share={share}
              >
                {renderCase(() => setDrawerOpen(false))}
              </CaseDrawer>
              <ChatPanel
                messages={messages}
                asking={asking}
                disabled={gameOver}
                locked={lockedDaily}
                onSend={handleSend}
                onQuick={handleQuick}
                onReport={handleReport}
              />
            </section>
          </main>
        </PersonalMarksProvider>
      )
    }

    if (path === '/rooms/new' || path === '/rooms/join' || path === '/me/rooms') {
      return (
        <ScrollArea>
          <RoomLobby
            key={`${path}:${owner}`}
            owner={owner}
            mode={path === '/rooms/new' ? 'new' : path === '/rooms/join' ? 'join' : 'list'}
          />
        </ScrollArea>
      )
    }
    const roomMatch = matchPath(path, '/rooms/:id')
    if (roomMatch) return <RoomPage id={roomMatch.id} owner={owner} />

    if (path === '/login') {
      return (
        <ScrollArea>
          {user ? (
            <Missing label={t('登录')} message={t('你已经登录了。')} />
          ) : (
            <LoginPage onDone={onLogin} />
          )}
        </ScrollArea>
      )
    }
    if (path === '/admin') {
      return (
        <ScrollArea>
          {user?.isAdmin ? (
            <AdminPage />
          ) : (
            <Missing label={t('管理后台')} message={t('无权访问。')} />
          )}
        </ScrollArea>
      )
    }
    if (path === '/guide') {
      return (
        <ScrollArea>
          <GuidePage />
        </ScrollArea>
      )
    }
    if (path === '/leaving') return <LeavingPage />
    if (path === '/about') {
      return (
        <ScrollArea>
          <AboutPage />
        </ScrollArea>
      )
    }
    if (path === '/library') {
      return (
        <ScrollArea>
          <LibraryPage />
        </ScrollArea>
      )
    }
    if (path === '/daily') {
      return (
        <ScrollArea>
          <DailyIndexPage
            activeGames={activeGames}
            onStart={startDailyGame}
            onContinue={handleContinue}
          />
        </ScrollArea>
      )
    }
    const dailyMatch = matchPath(path, '/daily/:date')
    if (dailyMatch) {
      return (
        <ScrollArea>
          <DailyDetailPage
            date={dailyMatch.date}
            activeGames={activeGames}
            games={allGames}
            onStart={startDailyGame}
            onContinue={handleContinue}
          />
        </ScrollArea>
      )
    }
    const puzzleMatch = matchPath(path, '/library/:id')
    if (puzzleMatch) {
      return (
        <ScrollArea>
          <PuzzleDetailPage key={puzzleMatch.id} id={puzzleMatch.id} onStart={startLibraryGame} />
        </ScrollArea>
      )
    }
    if (path === '/upload') {
      return (
        <ScrollArea>
          {user ? <UploadPage /> : <Missing label={t('上传')} message={t('请先登录。')} />}
        </ScrollArea>
      )
    }
    if (path === '/me/profile') {
      return (
        <ScrollArea>
          {user ? <ProfileEditPage /> : <Missing label={t('编辑资料')} message={t('请先登录。')} />}
        </ScrollArea>
      )
    }
    if (path === '/me') {
      return (
        <ScrollArea>
          {user ? (
            <MePage
              handle={user.handle ?? user.name ?? user.email}
              isAdmin={Boolean(user.isAdmin)}
              onSeen={clearUnread}
              onLogout={() => void onLogout()}
            />
          ) : (
            <Missing label={t('我的题库')} message={t('请先登录。')} />
          )}
        </ScrollArea>
      )
    }
    const profileMatch = matchPath(path, '/u/:handle')
    if (profileMatch) {
      return (
        <ScrollArea>
          <ProfilePage handle={profileMatch.handle} isSelf={user?.handle === profileMatch.handle} />
        </ScrollArea>
      )
    }

    if (path !== '/') {
      return (
        <ScrollArea>
          <Missing label="404" message={t('这里什么都没有。')} />
        </ScrollArea>
      )
    }

    return (
      <ScrollArea>
        <Landing
          activeGames={activeGames}
          archives={archives}
          signedIn={Boolean(user)}
          onStartDaily={startDailyGame}
          onContinue={handleContinue}
          onView={(id) => navigate(`/archive/${id}`)}
          onAbandon={handleAbandon}
          onDelete={handleDeleteArchive}
        />
      </ScrollArea>
    )
  }

  return (
    <div
      className="flex h-dvh flex-col overflow-hidden"
      style={playing ? { height: 'var(--play-viewport-height, 100dvh)' } : undefined}
    >
      <header className="z-20 shrink-0 border-b border-black/40 bg-bar text-bar-foreground shadow-[0_1px_0_rgba(255,255,255,0.04)_inset]">
        <div className="mx-auto flex h-12 w-full min-w-0 items-center gap-2 px-4 sm:h-14 sm:gap-4 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-2">
            {path !== '/' ? (
              <button
                type="button"
                onClick={() => navigate('/')}
                aria-label={t('返回首页')}
                className={cn(
                  '-ml-1.5 size-8 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-bar-foreground/10',
                  playing ? 'flex' : 'hidden sm:flex',
                )}
              >
                <ArrowLeft className="size-4" />
              </button>
            ) : null}
            <Link to="/" className="group flex min-w-0 items-center gap-2.5">
              <span
                aria-hidden
                className="seal size-7 shrink-0 text-[15px] transition-transform duration-300 group-hover:-rotate-6"
              >
                汤
              </span>
              <span className="min-w-0 truncate font-serif text-[14px] font-semibold tracking-[0.14em] sm:text-[15px]">
                {t('海龟汤调查局')}
              </span>
            </Link>
          </div>

          <nav
            aria-label={t('主要导航')}
            className="ml-auto hidden shrink-0 items-center gap-1 font-mono text-[11px] tracking-[0.18em] sm:flex"
          >
            {[
              { to: '/daily', label: t('每日') },
              { to: '/library', label: t('题库') },
            ].map((item) => {
              const active = path.startsWith(item.to)
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'relative rounded-full px-3.5 py-1.5 transition-colors',
                    active
                      ? 'bg-bar-foreground/12 text-bar-foreground'
                      : 'text-bar-foreground/65 hover:bg-bar-foreground/8 hover:text-bar-foreground',
                  )}
                >
                  {item.label}
                  {active ? (
                    <span
                      aria-hidden
                      className="absolute -bottom-[11px] left-1/2 h-0.5 w-5 -translate-x-1/2 bg-stamp"
                    />
                  ) : null}
                </Link>
              )
            })}
          </nav>

          <div className="ml-auto flex shrink-0 items-center gap-1 sm:ml-0 sm:gap-1.5 sm:border-l sm:border-bar-foreground/15 sm:pl-3">
            <ThemeToggle className="size-9 rounded-full hover:bg-bar-foreground/10 hover:opacity-100 sm:size-8" />
            <LocaleMenu />
          </div>

          <div className="hidden shrink-0 items-center font-mono text-[11px] sm:flex">
            {user ? (
              <button
                type="button"
                onClick={() => navigate('/me')}
                className="group inline-flex min-w-0 items-center gap-2 rounded-full py-1 pr-3 pl-1 transition-colors hover:bg-bar-foreground/10"
              >
                <span className="relative flex size-7 shrink-0 items-center justify-center rounded-full border border-bar-foreground/25 bg-bar-foreground/10 font-serif text-[13px]">
                  {(user.name || user.email).slice(0, 1).toUpperCase()}
                  {unread > 0 ? (
                    <span
                      aria-label={t('有新动态')}
                      title={t('有新动态')}
                      className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-stamp ring-2 ring-bar"
                    />
                  ) : null}
                </span>
                <span className="max-w-40 truncate tracking-[0.12em] text-bar-foreground/80 group-hover:text-bar-foreground">
                  {user.name || user.email}
                </span>
              </button>
            ) : (
              <Link
                to="/login"
                className="rounded-full border border-bar-foreground/30 px-4 py-1.5 tracking-[0.18em] transition-colors hover:border-bar-foreground hover:bg-bar-foreground hover:text-bar"
              >
                {t('登录')}
              </Link>
            )}
          </div>
        </div>
      </header>

      {typesafeMissing ? (
        <div className="flex shrink-0 items-center gap-2 border-b-2 border-l-2 border-l-stamp bg-card px-4 py-2 font-mono text-[11px] tracking-wide text-stamp sm:px-6">
          <TriangleAlert className="size-3.5 shrink-0" />
          <span className="min-w-0">
            {t('未检测到主持人密钥（TYPESAFE_API_KEY），砚无法工作。请配置后重启。')}
          </span>
        </div>
      ) : null}

      {user || syncState.status === 'storage' ? (
        <SyncNotice state={syncState} onRetry={onRetry} />
      ) : null}

      {synced > 0 && syncState.status !== 'storage' ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-foreground/20 bg-card px-4 py-2 font-mono text-[11px] tracking-wide sm:px-6">
          <Cloud className="size-3.5 shrink-0 text-[var(--v-yes)]" />
          <span className="min-w-0 flex-1">
            {t('本机的 {count} 局进度已并入账号，换设备也能接着玩。', { count: synced })}
          </span>
          <button
            type="button"
            onClick={() => setDismissedImports(syncState.imported)}
            className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
          >
            {t('知道了')}
          </button>
        </div>
      ) : null}

      <Suspense fallback={<PageFallback />}>{renderBody()}</Suspense>
      {!playing ? <MobileNavigation path={path} signedIn={Boolean(user)} unread={unread} /> : null}
    </div>
  )
}

/** Document-style pages (library, profile, forms) scroll inside the fixed app shell. */
function ScrollArea({ children }: { children: React.ReactNode }) {
  return (
    <main className="desk chat-scroll min-h-0 flex-1 overflow-y-auto">
      {children}
      <Footer />
    </main>
  )
}

/** 拆出去的页面还在下载时的占位：和别处一样的细转圈，不跳动。 */
function PageFallback() {
  return (
    <div className="flex flex-1 items-center justify-center py-24 text-muted-foreground">
      <Loader2 className="size-4 animate-spin" />
    </div>
  )
}

function Missing({ label, message }: { label: string; message: string }) {
  const { t } = useI18n()
  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-12">
      <span className="font-mono text-[10px] tracking-[0.28em] text-muted-foreground">{label}</span>
      <p className="mt-4 border border-dashed border-foreground/25 px-4 py-8 text-center font-mono text-[11px] tracking-[0.16em] text-muted-foreground">
        {message}
      </p>
      <button
        type="button"
        onClick={() => navigate('/')}
        className="mt-6 border border-foreground px-5 py-2.5 font-mono text-[11px] tracking-[0.18em] transition-colors hover:bg-foreground hover:text-background"
      >
        {t('回首页')}
      </button>
    </div>
  )
}
