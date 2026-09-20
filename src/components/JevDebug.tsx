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
        <div key={label} className="flex items-center gap-2">
          <div className="w-20 shrink-0 truncate text-muted-foreground">
            {labels[label] ?? label}
          </div>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className={cn('h-full rounded-full', label === highlight ? 'bg-primary' : 'bg-primary/35')}
              style={{ width: `${Math.max(2, Math.round(value * 100))}%` }}
            />
          </div>
          <div className="w-9 shrink-0 text-right tabular-nums text-muted-foreground">
            {Math.round(value * 100)}%
          </div>
        </div>
      ))}
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="font-medium text-foreground/80">{title}</div>
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
    <details className="group mt-1 text-xs">
      <summary className="flex cursor-pointer list-none items-center gap-1 text-muted-foreground/80 transition-colors hover:text-foreground">
        <ChevronDown className="size-3 transition-transform group-open:rotate-180" />
        Jev 判读 · {intent} · {tag}
      </summary>
      <div className="mt-3 space-y-4 rounded-lg border bg-background/70 p-3">
        <Section title={`意图 intent · 置信度 ${debug.intent.confidence.toFixed(2)}`}>
          <Bars probabilities={debug.intent.probabilities} labels={INTENT_LABEL} highlight={debug.intent.choice} />
        </Section>
        <Section title={`回答 verdict · 置信度 ${debug.verdict.confidence.toFixed(2)}`}>
          <Bars probabilities={debug.verdict.probabilities} labels={VERDICT_LABEL} highlight={debug.verdict.choice} />
        </Section>
        <Section title="推理接近度 guess_closeness">
          <div className="flex items-center gap-3 text-muted-foreground">
            <span className="tabular-nums text-foreground">{debug.closeness.score.toFixed(2)} / 3</span>
            <span className="tabular-nums">solved {debug.solved.toFixed(2)}</span>
            <span className="tabular-nums">
              {META_LABEL[debug.metaRequest.choice] ?? debug.metaRequest.choice}
            </span>
          </div>
        </Section>
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
          TypeSafe · {model ?? 'jev'}
        </div>
      </div>
    </details>
  )
}
