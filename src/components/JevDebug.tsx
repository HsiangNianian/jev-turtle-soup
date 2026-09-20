import type { ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'

import type { DebugInfo } from '@/lib/api'
import { cn } from '@/lib/utils'

const INTENT_LABEL: Record<string, string> = {
  yes_no_question: '是非提问',
  guess: '推理猜测',
  meta: '游戏请求',
  unclear: '无法理解',
}

const VERDICT_LABEL: Record<string, string> = {
  yes: '是',
  no: '不是',
  partly: '是，也不是',
  irrelevant: '无关',
  cannot_answer: '无法回答',
}

const META_LABEL: Record<string, string> = {
  hint: '要提示',
  full_answer: '要答案',
  how_to_play: '问玩法',
  none: '—',
}

function Bars({
  probabilities,
  labels,
  highlight,
}: {
  probabilities: Record<string, number>
  labels: Record<string, string>
  highlight?: string
}) {
  const entries = Object.entries(probabilities).sort((a, b) => b[1] - a[1])
  return (
    <div className="space-y-1.5">
      {entries.map(([label, value]) => (
        <div key={label} className="flex items-center gap-2 font-mono">
          <div className="w-20 shrink-0 truncate text-[11px] text-muted-foreground">
            {labels[label] ?? label}
          </div>
          <div className="h-1.5 flex-1 bg-foreground/10">
            <div
              className={cn('h-full', label === highlight ? 'bg-stamp' : 'bg-foreground/30')}
              style={{ width: `${Math.max(2, Math.round(value * 100))}%` }}
            />
          </div>
          <div className="w-9 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
            {Math.round(value * 100)}%
          </div>
        </div>
      ))}
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground">{title}</div>
      {children}
    </div>
  )
}

export function TurnDebug({ debug, model }: { debug: DebugInfo; model?: string }) {
  const intent = INTENT_LABEL[debug.intent.choice] ?? debug.intent.choice
  const tag =
    debug.intent.choice === 'meta'
      ? (META_LABEL[debug.metaRequest.choice] ?? debug.metaRequest.choice)
      : debug.intent.choice === 'guess'
        ? `${Math.round((debug.closeness.score / 3) * 100)}%`
        : (VERDICT_LABEL[debug.verdict.choice] ?? debug.verdict.choice)

  return (
    <details className="group mt-2">
      <summary className="flex cursor-pointer list-none items-center gap-1 font-mono text-[10px] tracking-[0.16em] text-muted-foreground transition-colors hover:text-foreground">
        <ChevronDown className="size-3 transition-transform group-open:rotate-180" />
        JEV 判读 · {intent} · {tag}
      </summary>
      <div className="mt-3 space-y-4 border border-foreground/20 bg-card p-3">
        <Section title={`意图 INTENT · 置信度 ${debug.intent.confidence.toFixed(2)}`}>
          <Bars
            probabilities={debug.intent.probabilities}
            labels={INTENT_LABEL}
            highlight={debug.intent.choice}
          />
        </Section>
        <Section title={`回答 VERDICT · 置信度 ${debug.verdict.confidence.toFixed(2)}`}>
          <Bars
            probabilities={debug.verdict.probabilities}
            labels={VERDICT_LABEL}
            highlight={debug.verdict.choice}
          />
        </Section>
        <Section title="推理接近度 GUESS_CLOSENESS">
          <div className="flex items-center gap-3 font-mono text-[11px] text-muted-foreground">
            <span className="tabular-nums text-foreground">
              {debug.closeness.score.toFixed(2)} / 3
            </span>
            <span className="tabular-nums">solved {debug.solved.toFixed(2)}</span>
            <span className="tabular-nums">
              {META_LABEL[debug.metaRequest.choice] ?? debug.metaRequest.choice}
            </span>
          </div>
        </Section>
        <div className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground/70">
          TYPESAFE · {model ?? 'jev'}
        </div>
      </div>
    </details>
  )
}
