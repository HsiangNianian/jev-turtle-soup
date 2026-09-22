import { ChevronDown } from 'lucide-react'
import type { ReactNode } from 'react'

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
  contact: '问联系方式',
  none: '—',
}

/**
 * 这个面板读的是**存档里的历史数据**，字段会随版本漂移
 * （`solved` 就改名叫过 `explainsSurface`，后来又改回来）。
 * 所以一律按「可能缺」处理：缺什么画「—」，实在什么都没有就整块不画。
 * 诊断面板把整局游戏崩成白屏是不可接受的。
 */
interface Choiceish {
  choice?: string
  confidence?: number
  probabilities?: Record<string, number>
}

interface Debugish {
  intent?: Choiceish
  verdict?: Choiceish
  metaRequest?: Choiceish
  closeness?: { score?: number }
  dimensions?: { motive?: number; method?: number; twist?: number }
  messageLanguage?: { choice?: string }
  contradictsEarlier?: { noul?: number }
  matchesEarlier?: Choiceish
  oppositeOf?: Choiceish
  /** 通关判定：字段名换过，两个都认 */
  solved?: number
  explainsSurface?: number
}

/** 数字统一在这里格式化：不是有限数就画「—」。 */
function num(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : '—'
}

function Bars({
  probabilities,
  labels,
  highlight,
}: {
  probabilities?: Record<string, number>
  labels: Record<string, string>
  highlight?: string
}) {
  const { t } = useI18n()
  const entries = Object.entries(probabilities ?? {}).sort((a, b) => b[1] - a[1])
  if (!entries.length) return null
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

export function TurnDebug({ debug }: { debug: unknown }) {
  const { t } = useI18n()
  const d = (debug ?? {}) as Debugish
  const intent = d.intent
  // 连意图都没有，就没什么可看的（旧数据可能整个 debug 都是空的）
  if (!intent?.choice) return null

  const metaChoice = d.metaRequest?.choice
  const tag =
    intent.choice === 'meta'
      ? t(META_LABEL[metaChoice ?? 'none'] ?? metaChoice ?? '—')
      : intent.choice === 'guess'
        ? `${Math.round(((d.closeness?.score ?? 0) / 3) * 100)}%`
        : t(VERDICT_LABEL[d.verdict?.choice ?? ''] ?? d.verdict?.choice ?? '—')

  // 通关信号：新字段优先，旧存档里叫 explainsSurface 也认
  const solveSignal =
    typeof d.solved === 'number'
      ? { label: 'solved', value: num(d.solved) }
      : typeof d.explainsSurface === 'number'
        ? { label: 'explains', value: num(d.explainsSurface) }
        : null

  return (
    <details className="group mt-2.5">
      <summary className="flex w-fit cursor-pointer list-none items-center gap-1 py-0.5 font-mono text-[10px] tracking-[0.14em] text-muted-foreground/55 transition-colors hover:text-muted-foreground">
        <ChevronDown className="size-3 transition-transform group-open:rotate-180" />
        {t('判读明细 · {intent} · {tag}', {
          intent: t(INTENT_LABEL[intent.choice] ?? intent.choice),
          tag,
        })}
      </summary>
      <div className="mt-2.5 space-y-3.5 border-l border-dashed border-foreground/15 pl-3.5">
        <Section title={t('意图 · 置信度 {value}', { value: num(intent.confidence) })}>
          <Bars
            probabilities={intent.probabilities}
            labels={INTENT_LABEL}
            highlight={intent.choice}
          />
        </Section>
        {d.verdict?.choice ? (
          <Section title={t('回答 · 置信度 {value}', { value: num(d.verdict.confidence) })}>
            <Bars
              probabilities={d.verdict.probabilities}
              labels={VERDICT_LABEL}
              highlight={d.verdict.choice}
            />
          </Section>
        ) : null}
        {d.contradictsEarlier || d.matchesEarlier || d.messageLanguage || d.oppositeOf ? (
          <Section title={t('一致性')}>
            <div className="flex flex-wrap items-center gap-3 font-mono text-[10px] text-muted-foreground/70">
              {typeof d.contradictsEarlier?.noul === 'number' ? (
                <span className="tabular-nums">
                  {t('与既往矛盾')} {num(d.contradictsEarlier.noul)}
                </span>
              ) : null}
              {d.messageLanguage?.choice ? (
                <span className="tabular-nums">
                  {t('玩家语言')} {d.messageLanguage.choice}
                </span>
              ) : null}
              {d.matchesEarlier?.choice ? (
                <span className="tabular-nums">
                  {t('复问')} {d.matchesEarlier.choice}
                  {d.matchesEarlier.choice === 'none'
                    ? ''
                    : ` (${num(d.matchesEarlier.confidence)})`}
                </span>
              ) : null}
              {d.oppositeOf?.choice ? (
                <span className="tabular-nums">
                  {t('反面复用')} {d.oppositeOf.choice}
                </span>
              ) : null}
            </div>
          </Section>
        ) : null}
        {d.dimensions ? (
          <Section title={t('推理维度')}>
            <div className="flex flex-wrap items-center gap-3 font-mono text-[10px] tabular-nums text-muted-foreground/70">
              <span>
                {t('动机')} {num(d.dimensions.motive)}
              </span>
              <span>
                {t('手法')} {num(d.dimensions.method)}
              </span>
              <span>
                {t('反转')} {num(d.dimensions.twist)}
              </span>
            </div>
          </Section>
        ) : null}
        <Section title={t('推理接近度')}>
          <div className="flex items-center gap-3 font-mono text-[10px] text-muted-foreground/70">
            <span className="tabular-nums text-foreground/75">{num(d.closeness?.score)} / 3</span>
            {solveSignal ? (
              <span className="tabular-nums">
                {solveSignal.label} {solveSignal.value}
              </span>
            ) : null}
            {metaChoice ? (
              <span className="tabular-nums">{t(META_LABEL[metaChoice] ?? metaChoice)}</span>
            ) : null}
          </div>
        </Section>
      </div>
    </details>
  )
}
