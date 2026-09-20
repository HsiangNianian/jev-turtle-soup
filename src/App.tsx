import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, RotateCcw, TriangleAlert } from 'lucide-react'

import { BowlMark } from '@/components/BowlMark'
import { ChatPanel } from '@/components/ChatPanel'
import { Landing } from '@/components/Landing'
import { PuzzlePanel, type LedgerItem } from '@/components/PuzzlePanel'
import { Button } from '@/components/ui/button'
import {
  askHost,
  createGame,
  fetchHealth,
  revealTruth,
  type ChatMessage,
  type GameSession,
  type HealthInfo,
} from '@/lib/api'
import { cn } from '@/lib/utils'

const VERDICTS = ['yes', 'no', 'partly', 'irrelevant']

function toneFor(turn: { solved: boolean; verdict: string }): ChatMessage['tone'] {
  if (turn.solved) return 'celebrate'
  if (VERDICTS.includes(turn.verdict)) return 'verdict'
  return 'normal'
}

export default function App() {
  const [health, setHealth] = useState<HealthInfo | null>(null)
  const [session, setSession] = useState<GameSession | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [revealed, setRevealed] = useState(false)
  const [truth, setTruth] = useState<string | null>(null)
  const [solved, setSolved] = useState(false)
  const [closeness, setCloseness] = useState<number | null>(null)
  const [generating, setGenerating] = useState(false)
  const [asking, setAsking] = useState(false)
  const [revealing, setRevealing] = useState(false)
  const [turnCount, setTurnCount] = useState(0)
  const [difficulty, setDifficulty] = useState('中等')
  const [theme, setTheme] = useState('')
  const [landingError, setLandingError] = useState<string | null>(null)

  useEffect(() => {
    fetchHealth()
      .then(setHealth)
      .catch(() => setHealth(null))
  }, [])

  const handleNew = useCallback(async () => {
    setGenerating(true)
    setLandingError(null)
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
      setTruth(null)
      setSolved(false)
      setCloseness(null)
      setTurnCount(0)
    } catch (error) {
      setLandingError(error instanceof Error ? error.message : '生成失败，请重试')
    } finally {
      setGenerating(false)
    }
  }, [difficulty, theme])

  const handleSend = useCallback(
    async (text: string) => {
      if (!session) return
      const history = messages
      setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: 'player', text }])
      setAsking(true)
      setTurnCount((count) => count + 1)
      try {
        const turn = await askHost(session.sessionId, text, history)
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
        if (turn.solved) setSolved(true)
        if (turn.revealed && turn.truth) {
          setTruth(turn.truth)
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

  const handleReveal = useCallback(async () => {
    if (!session || revealing) return
    setRevealing(true)
    try {
      const result = await revealTruth(session.sessionId)
      setTruth(result.truth)
      setRevealed(true)
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: 'host',
          text: '（主持人把碗底翻了过来，汤底就在左边。）',
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
    } finally {
      setRevealing(false)
    }
  }, [revealing, session])

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

  const llmMissing = health !== null && health.llm === null
  const typesafeMissing = health !== null && !health.typesafeConfigured

  const ledger = useMemo<LedgerItem[]>(() => {
    const items: LedgerItem[] = []
    for (let index = 0; index < messages.length; index += 1) {
      const message = messages[index]
      if (message.role !== 'player') continue
      const next = messages[index + 1]
      if (!next || next.role !== 'host') continue
      if (next.tone === 'celebrate') {
        items.push({ id: message.id, question: message.text, verdict: 'solved' })
      } else if (next.verdict && VERDICTS.includes(next.verdict)) {
        items.push({ id: message.id, question: message.text, verdict: next.verdict })
      }
    }
    return items
  }, [messages])

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <header className="z-20 shrink-0 border-b border-border/60 bg-background/70 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-7xl items-center gap-3 px-4 sm:px-6">
          <BowlMark className="aspect-[15/8] w-11" steam={false} />
          <div className="leading-none">
            <div className="font-serif text-sm tracking-[0.34em] text-foreground">汤屋</div>
            <div className="mt-1 text-[10px] tracking-[0.28em] text-muted-foreground">
              TURTLE SOUP
            </div>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <span className="hidden items-center gap-1.5 rounded-full border border-border/70 px-3 py-1 text-[11px] text-muted-foreground sm:inline-flex">
              <span className="size-1.5 rounded-full bg-primary" />
              Jev × LLM
            </span>
            {session ? (
              <Button
                variant="outline"
                size="sm"
                className="rounded-full border-border/70 bg-card/40"
                onClick={handleNew}
                disabled={generating}
              >
                {generating ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <RotateCcw className="size-3.5" />
                )}
                再熬一碗
              </Button>
            ) : null}
          </div>
        </div>
      </header>

      {typesafeMissing || llmMissing ? (
        <div
          className={cn(
            'flex shrink-0 items-center gap-2 border-b px-4 py-2 text-xs',
            typesafeMissing
              ? 'border-destructive/30 bg-destructive/10 text-destructive-foreground'
              : 'border-[var(--v-partly)]/30 bg-[var(--v-partly)]/10 text-[var(--v-partly)]',
          )}
        >
          <TriangleAlert className="size-3.5 shrink-0" />
          <span className="mx-auto max-w-7xl">
            {typesafeMissing ? (
              <>未检测到 TYPESAFE_API_KEY，主持人 Jev 无法工作。请在 .env 中配置后重启。</>
            ) : (
              <>
                未配置 LLM API Key（DEEPSEEK_API_KEY / OPENAI_API_KEY），当前使用内置题库。配置后可生成全新海龟汤。
              </>
            )}
          </span>
        </div>
      ) : null}

      {session ? (
        <main className="mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col gap-3 px-3 py-3 sm:px-4 lg:flex-row lg:gap-6 lg:p-6">
          <section className="chat-scroll max-h-[46dvh] min-h-0 shrink-0 overflow-y-auto lg:h-full lg:max-h-none lg:w-[40%]">
            <PuzzlePanel
              session={session}
              revealed={revealed}
              truth={truth}
              solved={solved}
              closeness={closeness}
              revealing={revealing}
              turnCount={turnCount}
              ledger={ledger}
              onReveal={handleReveal}
            />
          </section>
          <section className="min-h-0 flex-1 lg:h-full">
            <ChatPanel
              messages={messages}
              asking={asking}
              disabled={revealed}
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
            onDifficultyChange={setDifficulty}
            onThemeChange={setTheme}
            onGenerate={handleNew}
          />
        </main>
      )}
    </div>
  )
}
