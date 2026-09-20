import type { CSSProperties } from 'react'
import { Compass, Loader2, Sparkles } from 'lucide-react'

import { BowlMark } from '@/components/BowlMark'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const DIFFICULTIES = [
  { value: '简单', hint: '线索直给' },
  { value: '中等', hint: '需要联想' },
  { value: '困难', hint: '反转刁钻' },
] as const

const STEPS = [
  { title: '点单', body: 'AI 出题人生成一碗完整海龟汤。' },
  { title: '盘问', body: '向主持人 Jev 提是非问题，逼近真相。' },
  { title: '揭底', body: '猜中即通关，或直接翻出汤底。' },
]

interface LandingProps {
  difficulty: string
  theme: string
  generating: boolean
  error: string | null
  onDifficultyChange: (value: string) => void
  onThemeChange: (value: string) => void
  onGenerate: () => void
}

function delay(ms: number): CSSProperties {
  return { animationDelay: `${ms}ms` }
}

export function Landing({
  difficulty,
  theme,
  generating,
  error,
  onDifficultyChange,
  onThemeChange,
  onGenerate,
}: LandingProps) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col items-center px-5 py-14 text-center sm:py-20">
      <div className="animate-fade-in" style={delay(60)}>
        <BowlMark className="aspect-[15/8] w-28 sm:w-32" />
      </div>

      <p
        className="animate-fade-in mt-8 text-[11px] font-medium uppercase tracking-wordmark text-primary/70 sm:mt-10"
        style={delay(140)}
      >
        Turtle Soup
      </p>
      <h1
        className="animate-rise-in font-serif text-5xl font-semibold tracking-[0.12em] text-shadow-warm sm:text-7xl"
        style={delay(200)}
      >
        海龟汤
      </h1>
      <p
        className="animate-rise-in mt-5 max-w-md text-balance text-sm leading-relaxed text-muted-foreground sm:text-base"
        style={delay(300)}
      >
        深夜的汤屋已经开张。让 AI 熬一碗完整的汤，再向主持人 Jev 提问——他只会回答「是」「不是」「无关」。
      </p>

      <div
        className="animate-rise-in card-ornament mt-10 w-full rounded-3xl border border-border/70 bg-card/70 p-6 text-left shadow-[0_30px_80px_-40px_oklch(0.81_0.125_78/0.35)] backdrop-blur sm:p-7"
        style={delay(400)}
      >
        <div className="space-y-2.5">
          <div className="flex items-baseline justify-between">
            <label className="font-serif text-sm tracking-[0.2em] text-foreground/80">难度</label>
            <span className="text-xs text-muted-foreground">
              {DIFFICULTIES.find((item) => item.value === difficulty)?.hint}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-1.5 rounded-2xl border border-border/70 bg-background/50 p-1.5">
            {DIFFICULTIES.map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => onDifficultyChange(item.value)}
                className={cn(
                  'rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-300',
                  difficulty === item.value
                    ? 'bg-gradient-to-b from-primary to-primary/80 text-primary-foreground shadow-[0_8px_24px_-10px_oklch(0.81_0.125_78/0.9)]'
                    : 'text-muted-foreground hover:bg-card hover:text-foreground',
                )}
              >
                {item.value}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-5 space-y-2.5">
          <label htmlFor="theme" className="font-serif text-sm tracking-[0.2em] text-foreground/80">
            口味 <span className="tracking-normal text-muted-foreground">（可选）</span>
          </label>
          <div className="relative">
            <Compass className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              id="theme"
              value={theme}
              placeholder="医院、密室、雨夜、老房子……"
              onChange={(event) => onThemeChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !generating) onGenerate()
              }}
              className="h-11 w-full rounded-2xl border border-border/70 bg-background/50 pl-10 pr-4 text-sm outline-none transition-all placeholder:text-muted-foreground/70 focus:border-primary/50 focus:ring-[3px] focus:ring-ring/40"
            />
          </div>
        </div>

        {error ? (
          <p className="mt-4 rounded-xl border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-sm text-destructive-foreground">
            {error}
          </p>
        ) : null}

        <Button
          size="lg"
          onClick={onGenerate}
          disabled={generating}
          className="group relative mt-6 h-12 w-full overflow-hidden rounded-2xl bg-gradient-to-b from-primary to-primary/85 text-[15px] font-semibold text-primary-foreground shadow-[0_16px_40px_-16px_oklch(0.81_0.125_78/0.9)] transition-transform hover:-translate-y-0.5"
        >
          <span
            aria-hidden
            className="animate-shimmer absolute inset-0 bg-[linear-gradient(110deg,transparent_25%,oklch(1_0_0/35%)_50%,transparent_75%)]"
          />
          {generating ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Sparkles className="size-4 transition-transform group-hover:rotate-12" />
          )}
          {generating ? '正在熬制这一碗……' : '端上一碗海龟汤'}
        </Button>
      </div>

      <div className="mt-10 grid w-full gap-3 sm:grid-cols-3">
        {STEPS.map((step, index) => (
          <div
            key={step.title}
            className="animate-rise-in rounded-2xl border border-border/60 bg-card/40 p-4 text-left backdrop-blur-sm"
            style={delay(520 + index * 90)}
          >
            <div className="font-serif text-xs tracking-[0.3em] text-primary/70">
              {String(index + 1).padStart(2, '0')}
            </div>
            <div className="mt-2 font-serif text-base tracking-wide">{step.title}</div>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{step.body}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
