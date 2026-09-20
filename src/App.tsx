import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Loader2, RotateCcw, TriangleAlert } from 'lucide-react'

import { ArchiveView } from '@/components/ArchiveView'
import { CaseDrawer } from '@/components/CaseDrawer'
import { ChatPanel } from '@/components/ChatPanel'
import { Landing } from '@/components/Landing'
import { PuzzlePanel } from '@/components/PuzzlePanel'
import {
  askHost,
  createGame,
  fetchHealth,
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
import { cn } from '@/lib/utils'

const VERDICTS = ['yes', 'no', 'partly', 'irrelevant']

type View = 'landing' | 'game' | 'archive'

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
  const [health, setHealth] = useState<HealthInfo | null>(null)
  const [games, setGames] = useState<ArchivedGame[]>(initialGames)
  const [view, setView] = useState<View>('landing')
  const [viewingId, setViewingId] = useState<string | null>(null)

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
  const [theme, setTheme] = useState('')
  const [landingError, setLandingError] = useState<string | null>(null)

  useEffect(() => {
    fetchHealth()
      .then(setHealth)
      .catch(() => setHealth(null))
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
        hint: session.hint,
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

  const activeGame = useMemo(
    () => allGames.find((game) => game.status === 'active') ?? null,
    [allGames],
  )
  const archives = useMemo(
    () => allGames.filter((game) => game.status !== 'active'),
    [allGames],
  )
  const viewing = viewingId ? (allGames.find((game) => game.id === viewingId) ?? null) : null
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
    if (activeGame) {
      setLandingError('还有一桩在办案件，先结案才能立案新的。')
      return
    }
    setGenerating(true)
    setLandingError(null)
    // 立案前先把上一局结案存档写回档案室
    if (liveEntry) {
      const merged = upsertGame(games, liveEntry)
      setGames(merged)
      saveGames(merged)
    }
    try {
      const created = await createGame(difficulty, theme)
      setSession(created)
      setMessages([
        {
          id: crypto.randomUUID(),
          role: 'host',
          text: created.hostGreeting,
        },
      ])
      setRevealed(false)
      setTruth(created.truth)
      setSolved(false)
      setCloseness(null)
      setTurnCount(0)
      setStartedAt(Date.now())
      setView('game')
    } catch (error) {
      setLandingError(error instanceof Error ? error.message : '生成失败，请重试')
    } finally {
      setGenerating(false)
    }
  }, [activeGame, difficulty, theme, games, liveEntry])

  const handleSend = useCallback(
    async (text: string) => {
      if (!session) return
      const history = messages
      setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: 'player', text }])
      setAsking(true)
      setTurnCount((count) => count + 1)
      try {
        const turn = await askHost(session, text, history)
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
        } else if (turn.revealed) {
          setRevealed(true)
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

  const handleReveal = useCallback(() => {
    if (!session || revealed) return
    setTruth(session.truth)
    setRevealed(true)
    setMessages((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        role: 'host',
        text: '（主持人把碗底翻了过来，汤底就在案卷里。）',
      },
    ])
  }, [revealed, session])

  const handleQuick = useCallback(
    (kind: 'hint' | 'reveal' | 'how_to_play') => {
      if (kind === 'reveal') {
        handleReveal()
        return
      }
      void handleSend(kind === 'hint' ? '给我一点提示吧。' : '这个游戏怎么玩？')
    },
    [handleReveal, handleSend],
  )

  const handleContinue = useCallback(
    (id: string) => {
      const game = games.find((item) => item.id === id)
      if (!game) return
      if (session?.sessionId !== id) hydrate(game)
      setView('game')
    },
    [games, hydrate, session],
  )

  const handleView = useCallback((id: string) => {
    setViewingId(id)
    setView('archive')
  }, [])

  const handleBack = useCallback(() => {
    setViewingId(null)
    setView('landing')
  }, [])

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
      setViewingId(null)
      setView('landing')
    },
    [buildEntry, session],
  )

  const llmMissing = health !== null && health.llm === null
  const typesafeMissing = health !== null && !health.typesafeConfigured

  const casePanel = session ? (
    <PuzzlePanel
      session={session}
      revealed={revealed}
      truth={truth}
      solved={solved}
      closeness={closeness}
      turnCount={turnCount}
      ledger={ledger}
      onReveal={handleReveal}
    />
  ) : null

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <header className="z-20 shrink-0 bg-foreground text-background">
        <div className="mx-auto flex h-12 w-full items-center gap-3 px-4 sm:px-6">
          {view !== 'landing' ? (
            <button
              type="button"
              onClick={handleBack}
              aria-label="返回档案室"
              className="-ml-1.5 flex size-7 shrink-0 items-center justify-center transition-opacity hover:opacity-60"
            >
              <ArrowLeft className="size-4" />
            </button>
          ) : null}
          <span className="font-mono text-[12px] font-bold tracking-[0.24em]">海龟汤调查局</span>
          <span className="hidden font-mono text-[10px] tracking-[0.24em] opacity-55 sm:inline">
            / TURTLE SOUP BUREAU
          </span>

          <div className="ml-auto flex shrink-0 items-center gap-4 font-mono text-[10px] tracking-[0.2em]">
            <span className="hidden items-center gap-2 opacity-70 md:inline-flex">
              <span className="size-1.5 rounded-full bg-[var(--v-yes)]" />
              JEV × SYSTEM ONE
            </span>
            {view === 'game' && gameOver ? (
              <button
                type="button"
                onClick={handleNew}
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
            ) : (
              <span className="hidden opacity-55 sm:inline">
                {activeGame ? '在办 1 件' : 'FORM 0-01'}
              </span>
            )}
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
              <>未检测到 TYPESAFE_API_KEY，主持人 Jev 无法工作。请配置后重启。</>
            ) : (
              <>
                未配置 LLM API Key（DEEPSEEK_API_KEY / OPENAI_API_KEY），当前使用内置题库。配置后可生成全新海龟汤。
              </>
            )}
          </span>
        </div>
      ) : null}

      {view === 'archive' && viewing ? (
        <ArchiveView game={viewing} onContinue={() => handleContinue(viewing.id)} />
      ) : view === 'game' && session ? (
        <main className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <section className="chat-scroll hidden min-h-0 overflow-y-auto lg:block lg:h-full lg:w-[42%] lg:border-r lg:border-foreground/25">
            {casePanel}
          </section>

          <section className="flex min-h-0 flex-1 flex-col">
            <CaseDrawer
              title={session.title}
              meta={`等级 ${session.difficulty} · 已问 ${turnCount} 轮`}
            >
              {casePanel}
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
      ) : (
        <main className="chat-scroll flex-1 overflow-y-auto">
          <Landing
            difficulty={difficulty}
            theme={theme}
            generating={generating}
            error={landingError}
            activeGame={activeGame}
            archives={archives}
            onDifficultyChange={setDifficulty}
            onThemeChange={setTheme}
            onGenerate={handleNew}
            onContinue={handleContinue}
            onView={handleView}
            onAbandon={handleAbandon}
          />
        </main>
      )}
    </div>
  )
}
