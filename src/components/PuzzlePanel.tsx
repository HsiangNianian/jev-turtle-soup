import type { ReactNode } from 'react'
import { Eye, Loader2, Sparkles } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { GameSession } from '@/lib/api'
import { cn } from '@/lib/utils'

interface PuzzlePanelProps {
  session: GameSession
  revealed: boolean
  truth: string | null
  solved: boolean
  closeness: number | null
  revealing: boolean
  turnCount: number
  ledger: LedgerItem[]
  onReveal: () => void
}

export interface LedgerItem {
  id: string
  question: string
  verdict: string
}

const LEDGER: Record<string, { glyph: string; cls: string }> = {
  yes: { glyph: '是', cls: 'verdict-yes' },
  no: { glyph: '否', cls: 'verdict-no' },
  partly: { glyph: '半', cls: 'verdict-partly' },
  irrelevant: { glyph: '—', cls: 'verdict-irrelevant' },
  solved: { glyph: '中', cls: 'verdict-yes' },
}

function Label({ children, amber = false }: { children: ReactNode; amber?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        className="size-1.5 rounded-full"
        style={{ background: amber ? 'var(--v-partly)' : 'var(--primary)' }}
      />
      <span className="font-serif text-xs tracking-[0.4em] text-muted-foreground">{children}</span>
    </div>
  )
}

export function PuzzlePanel({
  session,
  revealed,
  truth,
  solved,
  closeness,
  revealing,
  turnCount,
  ledger,
  onReveal,
}: PuzzlePanelProps) {
  const progress = typeof closeness === 'number' ? Math.round(closeness * 100) : null

  return (
    <div className="flex flex-col gap-4">
      <article className="card-ornament relative overflow-hidden rounded-3xl border border-border/70 bg-card/70 p-5 shadow-[0_30px_80px_-50px_oklch(0_0_0/0.9)] backdrop-blur sm:p-7">
        <div className="pointer-events-none absolute -right-16 -top-20 size-48 rounded-full bg-primary/10 blur-3xl" />

        <div className="relative flex flex-wrap items-center gap-2">
          <Badge
            variant="outline"
            className="border-primary/30 bg-primary/10 font-serif tracking-widest text-primary"
          >
            {session.difficulty}
          </Badge>
          <Badge variant="outline" className="text-muted-foreground">
            {session.source === 'llm' ? 'AI 现熬' : '经典存档'}
          </Badge>
          {solved ? (
            <Badge className="border-transparent bg-[var(--v-yes)]/20 text-[var(--v-yes)]">
              <Sparkles className="size-3" /> 已猜中
            </Badge>
          ) : null}
          <span className="ml-auto font-serif text-xs tracking-widest text-muted-foreground">
            {turnCount} 问
          </span>
        </div>

        <h2 className="relative mt-4 font-serif text-2xl font-semibold tracking-wide text-shadow-warm sm:text-3xl">
          {session.title}
        </h2>

        <div className="relative mt-5">
          <Label>汤面</Label>
          <div className="mt-3 rounded-2xl border border-border/60 bg-background/40 p-4 sm:p-5">
            <p className="surface-prose font-serif text-[16px] text-foreground/90 sm:text-[17px]">
              {session.surface}
            </p>
          </div>
        </div>

        {progress !== null && !revealed ? (
          <div className="relative mt-5 space-y-2.5">
            <div className="flex items-baseline justify-between">
              <span className="font-serif text-xs tracking-[0.3em] text-muted-foreground">
                接近汤底
              </span>
              <span className="font-serif text-lg tabular-nums text-foreground">{progress}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className={cn(
                  'h-full rounded-full transition-all duration-700 ease-out',
                  progress >= 90
                    ? 'bg-[var(--v-yes)] shadow-[0_0_18px_var(--v-yes)]'
                    : 'bg-gradient-to-r from-primary/60 to-primary',
                )}
                style={{ width: `${Math.max(4, progress)}%` }}
              />
            </div>
          </div>
        ) : null}
      </article>

      {revealed && truth ? (
        <article className="card-ornament animate-pop relative overflow-hidden rounded-3xl border border-primary/30 bg-[linear-gradient(160deg,oklch(0.81_0.125_78/0.14),oklch(0.81_0.125_78/0.03))] p-5 backdrop-blur sm:p-7">
          <div className="pointer-events-none absolute -left-10 -top-16 size-40 rounded-full bg-primary/20 blur-3xl" />
          <div className="relative">
            <Label amber>汤底</Label>
            <p className="surface-prose mt-4 font-serif text-[16px] text-foreground/95 sm:text-[17px]">
              {truth}
            </p>
          </div>
        </article>
      ) : (
        <Button
          variant="outline"
          className="group h-11 w-full rounded-2xl border-border/70 bg-card/40 font-serif tracking-widest text-muted-foreground hover:border-primary/40 hover:text-primary"
          onClick={onReveal}
          disabled={revealing}
        >
          {revealing ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Eye className="size-4 transition-transform group-hover:scale-110" />
          )}
          翻碗 · 直接揭晓汤底
        </Button>
      )}

      {ledger.length ? (
        <div className="hidden rounded-3xl border border-border/60 bg-card/40 p-5 backdrop-blur lg:block">
          <div className="flex items-center justify-between">
            <Label>问答记录</Label>
            <span className="font-serif text-xs tracking-widest text-muted-foreground/70">
              {String(ledger.length).padStart(2, '0')}
            </span>
          </div>
          <ul className="mt-4 space-y-2.5">
            {ledger.map((item) => {
              const tone = LEDGER[item.verdict] ?? LEDGER.irrelevant
              return (
                <li key={item.id} className="flex items-center gap-3">
                  <span
                    className={cn(
                      'verdict-token flex size-6 shrink-0 items-center justify-center rounded-md border font-serif text-[11px]',
                      tone.cls,
                    )}
                  >
                    {tone.glyph}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">{item.question}</span>
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
