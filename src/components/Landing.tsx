import { useState } from 'react'
import { ArrowRight, Loader2, Lock } from 'lucide-react'

import { DailyLuck } from '@/components/DailyLuck'
import { STATUS_LABEL, formatWhen, type ArchivedGame, type GameStatus } from '@/lib/archive'
import { cn } from '@/lib/utils'

const DIFFICULTIES = [
  { value: '简单', hint: '线索直给' },
  { value: '中等', hint: '需要联想' },
  { value: '困难', hint: '反转刁钻' },
] as const

const STAMP_TONE: Record<GameStatus, string> = {
  active: 'border-stamp text-stamp',
  solved: 'border-[var(--v-yes)] text-[var(--v-yes)]',
  revealed: 'border-stamp text-stamp',
  abandoned: 'border-muted-foreground/60 text-muted-foreground',
}

function StatusStamp({ status }: { status: GameStatus }) {
  return (
    <span
      className={cn(
        'shrink-0 border px-2 py-0.5 font-mono text-[10px] font-bold tracking-[0.16em]',
        STAMP_TONE[status],
      )}
    >
      {STATUS_LABEL[status]}
    </span>
  )
}

interface LandingProps {
  difficulty: string
  theme: string
  generating: boolean
  error: string | null
  activeGame: ArchivedGame | null
  archives: ArchivedGame[]
  onDifficultyChange: (value: string) => void
  onThemeChange: (value: string) => void
  onGenerate: () => void
  onContinue: (id: string) => void
  onView: (id: string) => void
  onAbandon: (id: string) => void
}

export function Landing({
  difficulty,
  theme,
  generating,
  error,
  activeGame,
  archives,
  onDifficultyChange,
  onThemeChange,
  onGenerate,
  onContinue,
  onView,
  onAbandon,
}: LandingProps) {
  const [focused, setFocused] = useState(false)

  return (
    <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col justify-center px-5 py-12 sm:px-6 sm:py-16">
      <div className="font-mono text-[10px] tracking-[0.3em] text-muted-foreground sm:text-[11px]">
        案件受理 · CASE INTAKE
      </div>
      <div className="mt-5 flex items-start justify-between gap-5">
        <h1 className="font-serif text-[clamp(2.75rem,9vw,4.5rem)] leading-none font-semibold">
          海龟汤
        </h1>
        <DailyLuck />
      </div>
      <div className="mt-6 h-px w-full bg-foreground/80" />
      <p className="mt-6 max-w-xl font-serif text-[15px] leading-8 text-foreground/80">
        每一碗汤都是一桩悬案。向主持人砚（Ellis）提出「是 / 不是」的问题，逐步还原被隐去的真相。
      </p>

      {activeGame ? (
        <div className="mt-9 border border-foreground bg-card">
          <div className="flex items-center justify-between gap-3 border-b border-foreground px-4 py-3 sm:px-5">
            <span className="font-mono text-[10px] tracking-[0.24em] text-muted-foreground">
              在办案件 / OPEN CASE
            </span>
            <span className="stamp px-2 py-0.5 font-mono text-[10px] font-bold tracking-[0.2em]">
              机密
            </span>
          </div>
          <div className="px-4 py-5 sm:px-5">
            <h2 className="font-serif text-2xl leading-snug font-semibold">{activeGame.title}</h2>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 font-mono text-[10px] tracking-[0.18em] text-muted-foreground">
              <span>等级 {activeGame.difficulty}</span>
              <span>已问 {activeGame.turnCount} 轮</span>
              <span>更新 {formatWhen(activeGame.updatedAt)}</span>
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => onContinue(activeGame.id)}
                className="flex items-center gap-2.5 bg-foreground px-6 py-3 font-mono text-[12px] font-bold tracking-[0.22em] text-background transition-opacity hover:opacity-85"
              >
                继续调查 <ArrowRight className="size-4" />
              </button>
              <button
                type="button"
                onClick={() => onAbandon(activeGame.id)}
                className="border border-foreground/30 px-5 py-3 font-mono text-[11px] tracking-[0.18em] text-muted-foreground transition-colors hover:border-foreground hover:text-foreground"
              >
                中止本案
              </button>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="mt-9">
            <div className="font-mono text-[10px] tracking-[0.26em] text-muted-foreground">
              等级 / LEVEL
            </div>
            <div className="mt-3 grid grid-cols-3 border border-foreground">
              {DIFFICULTIES.map((item, index) => (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => onDifficultyChange(item.value)}
                  className={cn(
                    'border-foreground px-3 py-3.5 text-left transition-colors sm:px-4 sm:py-4 [&:not(:last-child)]:border-r',
                    difficulty === item.value ? 'bg-foreground text-background' : 'hover:bg-foreground/5',
                  )}
                >
                  <div className="font-mono text-[10px] tracking-[0.2em] opacity-60">
                    等级 0{index + 1}
                  </div>
                  <div className="mt-1.5 font-serif text-base">{item.value}</div>
                  <div className="mt-0.5 font-mono text-[10px] opacity-55">{item.hint}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="mt-7">
            <label
              htmlFor="theme"
              className="font-mono text-[10px] tracking-[0.26em] text-muted-foreground"
            >
              口味 / THEME <span className="opacity-60">（可选）</span>
            </label>
            <div
              className={cn(
                'mt-3 flex items-center gap-3 border bg-card px-4',
                focused ? 'border-foreground' : 'border-foreground/30',
              )}
            >
              <input
                id="theme"
                value={theme}
                placeholder="医院、密室、雨夜、老房子……"
                onChange={(event) => onThemeChange(event.target.value)}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !generating) onGenerate()
                }}
                className="h-12 flex-1 bg-transparent font-serif text-sm outline-none placeholder:text-muted-foreground/70"
              />
              <span aria-hidden className="font-mono text-[11px] text-muted-foreground">
                ↵
              </span>
            </div>
          </div>

          {error ? (
            <p className="mt-5 border-l-2 border-stamp bg-stamp/[0.06] px-4 py-3 font-mono text-[11px] text-stamp">
              {error}
            </p>
          ) : null}

          <button
            type="button"
            onClick={onGenerate}
            disabled={generating}
            className="mt-8 flex w-fit items-center gap-3 bg-foreground px-7 py-4 font-mono text-[12px] font-bold tracking-[0.24em] text-background transition-opacity hover:opacity-85 disabled:opacity-50"
          >
            {generating ? (
              <>
                <Loader2 className="size-4 animate-spin" /> 正在熬制……
              </>
            ) : (
              <>
                立案并熬一碗 <ArrowRight className="size-4" />
              </>
            )}
          </button>
        </>
      )}

      {archives.length ? (
        <div className="mt-12">
          <div className="flex items-baseline justify-between">
            <span className="font-mono text-[10px] tracking-[0.26em] text-muted-foreground">
              档案室 / ARCHIVE
            </span>
            <span className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground/70">
              {String(archives.length).padStart(2, '0')} 卷
            </span>
          </div>
          <ul className="mt-3 border-t border-foreground/25">
            {archives.map((game) => (
              <li key={game.id}>
                <button
                  type="button"
                  onClick={() => onView(game.id)}
                  className="rule-dashed flex w-full items-center gap-3 py-3.5 text-left transition-colors hover:bg-foreground/[0.03]"
                >
                  <StatusStamp status={game.status} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-serif text-[15px]">{game.title}</span>
                    <span className="mt-0.5 block font-mono text-[10px] tracking-[0.14em] text-muted-foreground">
                      {formatWhen(game.updatedAt)} · 已问 {game.turnCount} 轮
                    </span>
                  </span>
                  <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-14 flex items-center gap-2 font-mono text-[10px] tracking-[0.3em] text-muted-foreground/70">
        <Lock className="size-3" />
        存档保存在本机 · 数据不会离开这台设备
      </div>
    </div>
  )
}
