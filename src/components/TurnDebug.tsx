import type { ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'

import type { DebugInfo } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useI18n } from '@/lib/i18n'

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
  jrrp: '问人品',
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
  const { t } = useI18n()
  const entries = Object.entries(probabilities).sort((a, b) => b[1] - a[1])
  return (
    <div className="space-y-1">
      {entries.map(([label, value]) => (
        <div key={label} className="flex items-center gap-2 font-mono">
          <div className="w-16 shrink-0 truncate text-[10px] text-muted-foreground/70">
            {t(labels[label] ?? label)}
          </div>
          <div className="h-1 flex-1 bg-foreground/[0.07]">
            <div
              className={cn('h-full', label === highlight ? 'bg-stamp/50' : 'bg-foreground/20')}
              style={{ width: `${Math.max(2, Math.round(value * 100))}%` }}
            />
          </div>
          <div className="w-8 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground/60">
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
      <div className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground/55">
        {title}
      </div>
      {children}
    </div>
  )
}

export function TurnDebug({ debug }: { debug: DebugInfo }) {
  const { t } = useI18n()
  const intent = t(INTENT_LABEL[debug.intent.choice] ?? debug.intent.choice)
  const tag =
    debug.intent.choice === 'meta'
      ? t(META_LABEL[debug.metaRequest.choice] ?? debug.metaRequest.choice)
      : debug.intent.choice === 'guess'
        ? `${Math.round((debug.closeness.score / 3) * 100)}%`
        : t(VERDICT_LABEL[debug.verdict.choice] ?? debug.verdict.choice)

  return (
    <details className="group mt-2.5">
      <summary className="flex w-fit cursor-pointer list-none items-center gap-1 py-0.5 font-mono text-[10px] tracking-[0.14em] text-muted-foreground/55 transition-colors hover:text-muted-foreground">
        <ChevronDown className="size-3 transition-transform group-open:rotate-180" />
        {t('判读明细 · {intent} · {tag}', { intent, tag })}
      </summary>
      <div className="mt-2.5 space-y-3.5 border-l border-dashed border-foreground/15 pl-3.5">
        <Section
          title={t('意图 INTENT · 置信度 {value}', { value: debug.intent.confidence.toFixed(2) })}
        >
          <Bars
            probabilities={debug.intent.probabilities}
            labels={INTENT_LABEL}
            highlight={debug.intent.choice}
          />
        </Section>
        <Section
          title={t('回答 VERDICT · 置信度 {value}', { value: debug.verdict.confidence.toFixed(2) })}
        >
          <Bars
            probabilities={debug.verdict.probabilities}
            labels={VERDICT_LABEL}
            highlight={debug.verdict.choice}
          />
        </Section>
        {debug.contradictsEarlier || debug.matchesEarlier ? (
          <Section title={t('一致性 CONSISTENCY')}>
            <div className="flex flex-wrap items-center gap-3 font-mono text-[10px] text-muted-foreground/70">
              {debug.contradictsEarlier ? (
                <span className="tabular-nums">
                  {t('与既往矛盾')} {debug.contradictsEarlier.noul.toFixed(2)}
                </span>
              ) : null}
              {debug.matchesEarlier ? (
                <span className="tabular-nums">
                  {t('复问')} {debug.matchesEarlier.choice}
                  {debug.matchesEarlier.choice === 'none'
                    ? ''
                    : ` (${debug.matchesEarlier.confidence.toFixed(2)})`}
                </span>
              ) : null}
            </div>
          </Section>
        ) : null}
        <Section title={t('推理接近度 GUESS_CLOSENESS')}>
          <div className="flex items-center gap-3 font-mono text-[10px] text-muted-foreground/70">
            <span className="tabular-nums text-foreground/75">
              {debug.closeness.score.toFixed(2)} / 3
            </span>
            <span className="tabular-nums">solved {debug.solved.toFixed(2)}</span>
            <span className="tabular-nums">
              {t(META_LABEL[debug.metaRequest.choice] ?? debug.metaRequest.choice)}
            </span>
          </div>
        </Section>
      </div>
    </details>
  )
}
