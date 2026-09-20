import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Loader2, RotateCcw, TriangleAlert } from 'lucide-react'

import { AboutPage } from '@/components/AboutPage'
import { ArchiveView } from '@/components/ArchiveView'
import { CaseDrawer } from '@/components/CaseDrawer'
import { ChatPanel } from '@/components/ChatPanel'
import { Footer } from '@/components/Footer'
import { Landing } from '@/components/Landing'
import { LibraryPage } from '@/components/LibraryPage'
import { LoginPage } from '@/components/LoginPage'
import { MePage } from '@/components/MePage'
import { ProfileEditPage } from '@/components/ProfileEditPage'
import { ProfilePage } from '@/components/ProfilePage'
import { PuzzleDetailPage } from '@/components/PuzzleDetailPage'
import { PuzzlePanel } from '@/components/PuzzlePanel'
import { UploadPage } from '@/components/UploadPage'
import {
  askHost,
  createGame,
  fetchHealth,
  revealGame,
  type ChatMessage,
  type GameSession,
  type HealthInfo,
} from '@/lib/api'
import {
  buildLedger,
  loadGames,
  saveGames,
  toSession,
  upsertGame,
  type ArchivedGame,
  type GameStatus,
} from '@/lib/archive'
import { fetchMe, logout as logoutRequest, type AuthUser } from '@/lib/auth-client'
import {
  askLibraryPuzzle,
  revealLibraryPuzzle,
  type LibraryPuzzleDetail,
} from '@/lib/library-client'
import { navigate, matchPath, usePath } from '@/lib/router'
import { getDeviceId } from '@/lib/luck'
import { cn } from '@/lib/utils'
import { Link } from '@/components/Link'

const VERDICTS = ['yes', 'no', 'partly', 'irrelevant']

const initialGames = loadGames()

function toneFor(turn: { solved: boolean; verdict: string }): ChatMessage['tone'] {
  if (turn.solved) return 'celebrate'
  if (VERDICTS.includes(turn.verdict)) return 'verdict'
  return 'normal'
}

function persist(games: ArchivedGame[]): ArchivedGame[] {
  saveGames(games)
  return games
}

export default function App() {
  const path = usePath()

  const [health, setHealth] = useState<HealthInfo | null>(null)
  const [user, setUser] = useState<AuthUser | null>(null)
  const [games, setGames] = useState<ArchivedGame[]>(initialGames)

  const [session, setSession] = useState<GameSession | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [revealed, setRevealed] = useState(false)
  const [truth, setTruth] = useState<string | null>(null)
  const [solved, setSolved] = useState(false)
  const [closeness, setCloseness] = useState<number | null>(null)
  const [generating, setGenerating] = useState(false)
  const [asking, setAsking] = useState(false)
  const [turnCount, setTurnCount] = useState(0)
  const [startedAt, setStartedAt] = useState<number>(() => Date.now())
  const [difficulty, setDifficulty] = useState('中等')
  const [genre, setGenre] = useState<'realistic' | 'supernatural'>('realistic')
  const [theme, setTheme] = useState('')
  const [landingError, setLandingError] = useState<string | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)

  useEffect(() => {
    fetchHealth()
      .then(setHealth)
      .catch(() => setHealth(null))
    fetchMe()
      .then(setUser)
      .catch(() => setUser(null))
  }, [])

  const gameOver = solved || revealed
  const liveStatus: GameStatus = solved ? 'solved' : revealed ? 'revealed' : 'active'

  const buildEntry = useCallback(
    (status: GameStatus): ArchivedGame | null => {
      if (!session) return null
      return {
        id: session.sessionId,
        title: session.title,
        surface: session.surface,
        difficulty: session.difficulty,
        source: session.source,
        hostGreeting: session.hostGreeting,
        hint: '',
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
    },
    [session, startedAt, messages, revealed, truth, solved, closeness, turnCount],
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
  const canGenerate = !activeGames.some((game) => game.source !== 'library')
  const ledger = useMemo(() => buildLedger(messages), [messages])

  useEffect(() => {
    if (liveEntry) saveGames(allGames)
  }, [liveEntry, allGames])

  const hydrate = useCallback((game: ArchivedGame) => {
    setSession(toSession(game))
    setMessages(game.messages)
    setRevealed(game.revealed)
    setTruth(game.truth)
    setSolved(game.solved)
    setCloseness(game.closeness)
    setTurnCount(game.turnCount)
    setStartedAt(game.createdAt)
    setLandingError(null)
  }, [])

  const handleNew = useCallback(async () => {
    if (!canGenerate) {
      setLandingError('还有一桩在办案件，先结案才能立案新的。')
      return
    }
    setGenerating(true)
    setLandingError(null)
    if (liveEntry) {
      const merged = upsertGame(games, liveEntry)
      setGames(merged)
      saveGames(merged)
    }
    try {
      const created = await createGame(difficulty, theme, genre)
      setSession(created)
      setMessages([{ id: crypto.randomUUID(), role: 'host', text: created.hostGreeting }])
      setRevealed(false)
      setTruth(null)
      setSolved(false)
      setCloseness(null)
      setTurnCount(0)
      setStartedAt(Date.now())
      setDrawerOpen(true)
      navigate('/play')
    } catch (error) {
      setLandingError(error instanceof Error ? error.message : '生成失败，请重试')
    } finally {
      setGenerating(false)
    }
  }, [canGenerate, difficulty, theme, genre, games, liveEntry])

  const startLibraryGame = useCallback((puzzle: LibraryPuzzleDetail) => {
    setSession({
      sessionId: crypto.randomUUID(),
      title: puzzle.title,
      surface: puzzle.surface,
      difficulty: puzzle.difficulty,
      source: 'library',
      hostGreeting: '汤面已经端上来了。开始提问吧，我只回答「是」「不是」「无关」。',
      libraryId: puzzle.id,
    })
    setMessages([
      {
        id: crypto.randomUUID(),
        role: 'host',
        text: '汤面已经端上来了。开始提问吧，我只回答「是」「不是」「无关」。',
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
  }, [])

  const handleSend = useCallback(
    async (text: string) => {
      if (!session) return
      const history = messages
      setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: 'player', text }])
      setAsking(true)
      setTurnCount((count) => count + 1)
      try {
        const turn = session.libraryId
          ? await askLibraryPuzzle(
              session.libraryId,
              text,
              history.map(({ role, text: body }) => ({ role, text: body })),
              getDeviceId(),
            )
          : await askHost(session, text, history)
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: 'host',
            text: turn.reply,
            tone: toneFor(turn),
            verdict: turn.verdict,
            debug: turn.debug,
            model: turn.model,
            closeness: turn.closeness,
          },
        ])
        if (typeof turn.closeness === 'number') {
          setCloseness((prev) => Math.max(prev ?? 0, turn.closeness ?? 0))
        }
        if (turn.solved) {
          setSolved(true)
          setRevealed(true)
          setDrawerOpen(true)
        } else if (turn.revealed) {
          setRevealed(true)
          setDrawerOpen(true)
        }
      } catch (error) {
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: 'host',
            tone: 'error',
            text: error instanceof Error ? error.message : '请求失败，请稍后再试',
          },
        ])
      } finally {
        setAsking(false)
      }
    },
    [messages, session],
  )

  const handleReveal = useCallback(async () => {
    if (!session || revealed) return
    try {
      const result = session.libraryId
        ? await revealLibraryPuzzle(session.libraryId)
        : await revealGame(session.sessionId)
      setTruth(result.truth)
      setRevealed(true)
      setDrawerOpen(true)
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: 'host',
          text: '（主持人把碗底翻了过来，汤底就在案卷里。）',
        },
      ])
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: 'host',
          tone: 'error',
          text: error instanceof Error ? error.message : '揭晓失败',
        },
      ])
    }
  }, [revealed, session])

  const handleQuick = useCallback(
    (kind: 'hint' | 'reveal' | 'how_to_play') => {
      if (kind === 'reveal') {
        void handleReveal()
        return
      }
      void handleSend(kind === 'hint' ? '给我一点提示吧。' : '这个游戏怎么玩？')
    },
    [handleReveal, handleSend],
  )

  const handleContinue = useCallback(
    (id: string) => {
      const game = allGames.find((item) => item.id === id)
      if (!game) return
      if (session?.sessionId !== id) hydrate(game)
      setDrawerOpen(true)
      navigate('/play')
    },
    [allGames, hydrate, session],
  )

  const handleAbandon = useCallback(
    (id: string) => {
      if (!window.confirm('中止本案？记录会留在档案室，但不能再继续讯问。')) return
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
    [buildEntry, session],
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
    [session],
  )

  const handleLogin = useCallback((next: AuthUser) => {
    setUser(next)
    navigate('/', { replace: true })
  }, [])

  const handleLogout = useCallback(async () => {
    await logoutRequest().catch(() => undefined)
    setUser(null)
    navigate('/')
  }, [])

  const llmMissing = health !== null && health.llm === null
  const typesafeMissing = health !== null && !health.typesafeConfigured

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
            <Missing label="案卷 / CASE" message="找不到这一卷。" />
          </ScrollArea>
        )
      }
      return <ArchiveView game={game} onContinue={() => handleContinue(game.id)} />
    }

    if (path === '/play') {
      if (!session) {
        return (
          <ScrollArea>
            <Missing label="对局 / PLAY" message="还没有开案。" />
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
              meta={`等级 ${session.difficulty} · 已问 ${turnCount} 轮`}
              open={drawerOpen}
              onOpenChange={setDrawerOpen}
            >
              {renderCase(() => setDrawerOpen(false))}
            </CaseDrawer>
            <ChatPanel
              messages={messages}
              asking={asking}
              disabled={gameOver}
              onSend={handleSend}
              onQuick={handleQuick}
            />
          </section>
        </main>
      )
    }

    if (path === '/login') {
      return (
        <ScrollArea>
          {user ? (
            <Missing label="登录 / SIGN IN" message="你已经登录了。" />
          ) : (
            <LoginPage onDone={handleLogin} />
          )}
        </ScrollArea>
      )
    }
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
          {user ? <UploadPage /> : <Missing label="上传 / NEW PUZZLE" message="请先登录。" />}
        </ScrollArea>
      )
    }
    if (path === '/me/profile') {
      return (
        <ScrollArea>
          {user ? <ProfileEditPage /> : <Missing label="编辑资料 / PROFILE" message="请先登录。" />}
        </ScrollArea>
      )
    }
    if (path === '/me') {
      return (
        <ScrollArea>
          {user ? (
            <MePage handle={user.handle ?? user.name ?? user.email} />
          ) : (
            <Missing label="我的题库 / MY PUZZLES" message="请先登录。" />
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
          <Missing label="404" message="这里什么都没有。" />
        </ScrollArea>
      )
    }

    return (
      <ScrollArea>
        <Landing
          difficulty={difficulty}
          genre={genre}
          theme={theme}
          generating={generating}
          error={landingError}
          activeGames={activeGames}
          canGenerate={canGenerate}
          archives={archives}
          onDifficultyChange={setDifficulty}
          onGenreChange={setGenre}
          onThemeChange={setTheme}
          onGenerate={handleNew}
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
      <header className="z-20 shrink-0 bg-foreground text-background">
        <div className="mx-auto flex h-12 w-full items-center gap-3 px-4 sm:px-6">
          {path !== '/' ? (
            <button
              type="button"
              onClick={() => navigate('/')}
              aria-label="返回首页"
              className="-ml-1.5 flex size-7 shrink-0 items-center justify-center transition-opacity hover:opacity-60"
            >
              <ArrowLeft className="size-4" />
            </button>
          ) : null}
          <Link to="/" className="shrink-0 font-mono text-[12px] font-bold tracking-[0.24em]">
            海龟汤调查局
          </Link>
          <span className="hidden font-mono text-[10px] tracking-[0.24em] opacity-55 sm:inline">
            / TURTLE SOUP BUREAU
          </span>

          <div className="ml-auto flex shrink-0 items-center gap-4 font-mono text-[10px] tracking-[0.2em]">
            <Link
              to="/library"
              className={cn(
                'transition-opacity hover:opacity-60',
                path.startsWith('/library') ? 'opacity-100' : 'opacity-70',
              )}
            >
              题库
            </Link>
            {path === '/play' && gameOver ? (
              <button
                type="button"
                onClick={() => void handleNew()}
                disabled={generating}
                className="flex items-center gap-1.5 tracking-[0.2em] transition-opacity hover:opacity-60 disabled:opacity-40"
              >
                {generating ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <RotateCcw className="size-3.5" />
                )}
                重新立案
              </button>
            ) : null}
            {user ? (
              <button
                type="button"
                onClick={() => navigate('/me')}
                className="max-w-[10rem] truncate tracking-[0.16em] opacity-80 transition-opacity hover:opacity-60"
              >
                {user.name || user.email}
              </button>
            ) : (
              <Link to="/login" className="opacity-80 transition-opacity hover:opacity-60">
                登录
              </Link>
            )}
            {user ? (
              <button
                type="button"
                onClick={() => void handleLogout()}
                className="opacity-50 transition-opacity hover:opacity-80"
              >
                退出
              </button>
            ) : null}
          </div>
        </div>
      </header>

      {typesafeMissing || llmMissing ? (
        <div
          className={cn(
            'flex shrink-0 items-center gap-2 border-b-2 bg-card px-4 py-2 font-mono text-[11px] tracking-wide sm:px-6',
            typesafeMissing
              ? 'border-l-2 border-l-stamp text-stamp'
              : 'border-l-2 border-l-[var(--v-partly)] text-[var(--v-partly)]',
          )}
        >
          <TriangleAlert className="size-3.5 shrink-0" />
          <span className="min-w-0">
            {typesafeMissing ? (
              <>未检测到主持人密钥（TYPESAFE_API_KEY），砚无法工作。请配置后重启。</>
            ) : (
              <>
                未配置 LLM API Key（DEEPSEEK_API_KEY /
                OPENAI_API_KEY），当前使用内置题库。配置后可生成全新海龟汤。
              </>
            )}
          </span>
        </div>
      ) : null}

      {renderBody()}
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

function Missing({ label, message }: { label: string; message: string }) {
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
        回首页
      </button>
    </div>
  )
}
