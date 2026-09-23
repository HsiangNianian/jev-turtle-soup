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
import {
  askHost,
  fetchHealth,
  revealGame,
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
  revealLibraryPuzzle,
  type LibraryPuzzleDetail,
} from '@/lib/library-client'
import { navigate, matchPath, usePath } from '@/lib/router'
import { utcToday, type DailyDetail } from '@/lib/daily-client'
import { dailyLuck, getDeviceId, todayKey } from '@/lib/luck'
import { cn, uid } from '@/lib/utils'
import { Link } from '@/components/Link'
import { useI18n } from '@/lib/i18n'

import { toneFor } from '@turtle-soup/client-core/game'

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
      document.removeEventListener('visibilitychange', resume)
    }
  }, [sync, verifyAccount])

  const handleLogin = useCallback(
    (next: AuthUser) => {
      ++authGeneration.current
      authRequest.current?.abort()
      applyUser(next)
      navigate('/', { replace: true })
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
    [session, startedAt, messages, revealed, truth, solved, closeness, turnCount, games],
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

  /** 从服务端取回汤底（会话题与题库题走同一个出口）。 */
  const fetchTruth = useCallback(async () => {
    if (!session) return null
    const result = session.libraryId
      ? await revealLibraryPuzzle(session.libraryId, locale)
      : await revealGame(session.sessionId, locale)
    setTruth(result.truth)
    return result.truth
  }, [session, locale])

  const startLibraryGame = useCallback(
    (puzzle: LibraryPuzzleDetail) => {
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
      setSolved(false)
      setCloseness(null)
      setTurnCount(0)
      setStartedAt(Date.now())
      setDrawerOpen(true)
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
      setSolved(false)
      setCloseness(null)
      setTurnCount(0)
      setStartedAt(Date.now())
      setDrawerOpen(true)
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
      if (turn.revealed && turn.truth) setTruth(turn.truth)
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
      await fetchTruth()
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
      return <ArchiveView game={game} onContinue={() => handleContinue(game.id)} />
    }

    if (path === '/play') {
      if (!session) {
        return (
          <ScrollArea>
            <Missing label={t('对局')} message={t('还没有开案。')} />
          </ScrollArea>
        )
      }
      return (
        <main className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <section className="chat-scroll hidden min-h-0 overflow-y-auto lg:block lg:h-full lg:w-[42%] lg:border-r lg:border-foreground/25">
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
      )
    }

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
          <PuzzleDetailPage id={puzzleMatch.id} onStart={startLibraryGame} />
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
    <div className="flex h-dvh flex-col overflow-hidden">
      <header className="z-20 shrink-0 bg-bar text-bar-foreground">
        <div className="mx-auto flex h-12 w-full min-w-0 items-center gap-2 px-4 sm:gap-3 sm:px-6">
          {path !== '/' ? (
            <button
              type="button"
              onClick={() => navigate('/')}
              aria-label={t('返回首页')}
              className="-ml-1.5 flex size-7 shrink-0 items-center justify-center transition-opacity hover:opacity-60"
            >
              <ArrowLeft className="size-4" />
            </button>
          ) : null}
          <Link
            to="/"
            className="min-w-0 truncate font-mono text-[11px] font-bold tracking-[0.18em] sm:text-[12px] sm:tracking-[0.24em]"
          >
            {t('海龟汤调查局')}
          </Link>

          <div className="ml-auto flex shrink-0 items-center gap-2 font-mono text-[10px] tracking-[0.16em] sm:gap-4 sm:tracking-[0.2em]">
            <Link
              to="/daily"
              className={cn(
                'transition-opacity hover:opacity-60',
                path.startsWith('/daily') ? 'opacity-100' : 'opacity-70',
              )}
            >
              {t('每日')}
            </Link>
            <Link
              to="/library"
              className={cn(
                'transition-opacity hover:opacity-60',
                path.startsWith('/library') ? 'opacity-100' : 'opacity-70',
              )}
            >
              {t('题库')}
            </Link>
            <ThemeToggle />
            <LocaleMenu />
            {user ? (
              /* 红点放在按钮**外面**：按钮有 truncate（overflow:hidden），
                 点挂在按钮内会被裁掉，等于永远不显示。 */
              <span className="relative inline-flex shrink-0">
                <button
                  type="button"
                  onClick={() => navigate('/me')}
                  className="max-w-[4.5rem] truncate tracking-[0.14em] opacity-80 transition-opacity hover:opacity-60 sm:max-w-[10rem] sm:tracking-[0.16em]"
                >
                  {user.name || user.email}
                </button>
                {unread > 0 ? (
                  <span
                    aria-label={t('有新动态')}
                    title={t('有新动态')}
                    className="pointer-events-none absolute -top-1 -right-1.5 size-2 rounded-full bg-stamp ring-2 ring-background"
                  />
                ) : null}
              </span>
            ) : (
              <Link to="/login" className="opacity-80 transition-opacity hover:opacity-60">
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
    </div>
  )
}

/** Document-style pages (library, profile, forms) scroll inside the fixed app shell. */
function ScrollArea({ children }: { children: React.ReactNode }) {
  return (
    <main className="chat-scroll min-h-0 flex-1 overflow-y-auto">
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
