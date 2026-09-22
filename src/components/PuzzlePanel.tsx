import { Lock, Unlock } from 'lucide-react'

import type { GameSession } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useI18n, type Locale } from '@/lib/i18n'

interface PuzzlePanelProps {
  session: GameSession
  revealed: boolean
  truth: string | null
  solved: boolean
  closeness: number | null
  turnCount: number
  ledger: LedgerItem[]
  /** 猜中时玩家最后说的那句 —— 结案报告里和汤底并排对照 */
  conclusion?: string | null
  /** 今日官方汤：当天不许拆封汤底 */
  locked?: boolean
  onReveal: () => void
  /** 移动端案卷简报里的「开始游戏」，用于收起抽屉。 */
  onStart?: () => void
  readOnly?: boolean
}

export interface LedgerItem {
  id: string
  question: string
  verdict: string
}

/**
 * 台账左边那枚小戳：**一个字的记号，不是词**。
 *
 * 这里刻意不走翻译字典 ——「是」「否」在字典里是 yes / はい 这类**词**，
 * 塞进 24px 的方框里会溢出来糊成一团（切到日文最明显：いいえ 三个字挤在一格里）。
 * 所以每种语言单独给一个长度可控的记号：中日用汉字（是/否/半 在日文里也读得通），
 * 英文用字母。
 */
const LEDGER: Record<string, { glyph: Record<Locale, string>; cls: string }> = {
  yes: { glyph: { 'zh-CN': '是', en: 'Y', ja: '是' }, cls: 'verdict-yes' },
  no: { glyph: { 'zh-CN': '否', en: 'N', ja: '否' }, cls: 'verdict-no' },
  partly: { glyph: { 'zh-CN': '半', en: '~', ja: '半' }, cls: 'verdict-partly' },
  irrelevant: { glyph: { 'zh-CN': '—', en: '—', ja: '—' }, cls: 'verdict-irrelevant' },
  solved: { glyph: { 'zh-CN': '中', en: '✓', ja: '中' }, cls: 'verdict-yes' },
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground">{label}</span>
      <span className="font-mono text-[11px] tracking-[0.1em]">{value}</span>
    </div>
  )
}

export function PuzzlePanel({
  session,
  revealed,
  truth,
  solved,
  closeness,
  turnCount,
  ledger,
  conclusion = null,
  locked = false,
  onReveal,
  onStart,
  readOnly = false,
}: PuzzlePanelProps) {
  const { t, locale } = useI18n()
  const caseNo = (session.sessionId.replace(/\D/g, '').slice(-3) || '000').padStart(3, '0')
  const progress = typeof closeness === 'number' ? Math.round(closeness * 100) : null

  return (
    <div className="flex min-h-full flex-col px-6 py-7 lg:px-8">
      <div className="flex items-start justify-between gap-4">
        <div className="font-mono text-[10px] tracking-[0.26em] text-muted-foreground">
          {t('案卷 NO.{no}', { no: caseNo })}
        </div>
        <div className="flex items-center gap-2">
          {solved ? (
            <span
              className="stamp px-2.5 py-1 font-mono text-[11px] font-bold tracking-[0.2em] text-[var(--v-yes)]"
              style={{ borderColor: 'var(--v-yes)', color: 'var(--v-yes)' }}
            >
              {t('已结案')}
            </span>
          ) : null}
          <span className="stamp animate-pop px-2.5 py-1 font-mono text-[11px] font-bold tracking-[0.2em]">
            {t('机密')}
          </span>
        </div>
      </div>

      <h2 className="mt-4 font-serif text-3xl leading-tight font-semibold">{session.title}</h2>

      <div className="mt-6 h-px w-full bg-foreground/25" />

      <div className="mt-6 font-mono text-[10px] tracking-[0.26em] text-muted-foreground">
        {t('汤面')}
      </div>
      <p className="mt-3 font-serif text-[15px] leading-8 text-foreground/90">{session.surface}</p>

      <div className="mt-7 flex flex-wrap gap-x-6 gap-y-2 border-t border-dashed border-foreground/25 pt-4">
        <Field label={t('等级')} value={t(session.difficulty)} />
        <Field
          label={t('来源')}
          value={
            session.source === 'llm'
              ? t('AI 现熬')
              : session.source === 'daily'
                ? t('官方每日')
                : session.source === 'library'
                  ? t('题库')
                  : t('经典存档')
          }
        />
        <Field label={t('已问')} value={t('{turns} 轮', { turns: turnCount })} />
        {/*
          猜中之后不显示接近度：赢了还挂着「70%」是矛盾的，
          而且那条反馈说的「结束得有点突然」有一半来自这个数字。
          直接揭晓（没猜中）时它仍然有意义 —— 能看出自己差多远。
        */}
        {progress !== null && !solved ? <Field label={t('接近度')} value={`${progress}%`} /> : null}
      </div>

      {progress !== null && !revealed ? (
        <div className="mt-3 h-1 w-full bg-foreground/10">
          <div
            className="h-1 bg-stamp transition-all duration-700 ease-out"
            style={{ width: `${Math.max(3, progress)}%` }}
          />
        </div>
      ) : null}

      {revealed && truth ? (
        /*
         * 结案报告：把玩家的结论和汤底并排摆出来让他自己对照。
         * 刻意**不打分** —— 给「推理有多接近」打分这件事我们试过，
         * 无论是看完整度还是看解释力都不稳，最后退回了原来的判准。
         * 摆出来让人自己看，比给一个不准的分数诚实。
         */
        <div className="animate-pop mt-8 border-t-2 border-foreground pt-5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span className="font-mono text-[10px] tracking-[0.26em] text-muted-foreground">
              {t('结案报告')}
            </span>
            <span className="font-mono text-[10px] tracking-[0.18em] text-stamp">
              {t(solved ? '已结案' : '已揭晓')}
            </span>
          </div>

          {solved && conclusion ? (
            <>
              <div className="mt-4 font-mono text-[10px] tracking-[0.2em] text-muted-foreground">
                {t('你的结论')}
              </div>
              <p className="mt-2 border-l-2 border-foreground/30 pl-3 font-serif text-[14px] leading-7 text-foreground/80">
                {conclusion}
              </p>
            </>
          ) : null}

          <div className="mt-5 flex items-center gap-2 font-mono text-[10px] tracking-[0.26em] text-stamp">
            <Unlock className="size-3.5" /> {t('汤底')}
          </div>
          <p className="mt-3 font-serif text-[15px] leading-8 text-foreground/90">{truth}</p>
        </div>
      ) : null}

      <div className="mt-8 flex flex-wrap items-center gap-3">
        {!revealed && !readOnly && !locked ? (
          <button
            type="button"
            onClick={onReveal}
            className="flex items-center gap-2 border border-foreground px-4 py-2.5 font-mono text-[11px] tracking-[0.18em] transition-colors hover:bg-foreground hover:text-background"
          >
            <Lock className="size-3.5" />
            {t('拆封汤底')}
          </button>
        ) : null}

        {!revealed && locked ? (
          <div className="flex items-center gap-2 border border-dashed border-stamp/60 px-4 py-2.5 font-mono text-[11px] tracking-[0.18em] text-stamp">
            <Lock className="size-3.5" />
            {t('官方每日汤 · 明日解锁')}
          </div>
        ) : null}

        {!revealed && readOnly ? (
          <div className="flex items-center gap-2 border border-dashed border-foreground/30 px-4 py-2.5 font-mono text-[11px] tracking-[0.18em] text-muted-foreground">
            <Lock className="size-3.5" />
            {t('本卷汤底未拆封')}
          </div>
        ) : null}

        {onStart ? (
          <button
            type="button"
            onClick={onStart}
            className="flex items-center gap-2 bg-foreground px-5 py-2.5 font-mono text-[11px] font-bold tracking-[0.18em] text-background transition-opacity hover:opacity-85"
          >
            {t('开始游戏')}
          </button>
        ) : null}
      </div>

      {ledger.length ? (
        <div className="mt-9">
          <div className="flex items-baseline justify-between">
            <div className="font-mono text-[10px] tracking-[0.26em] text-muted-foreground">
              {t('问答记录')}
            </div>
            <span className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground/70">
              {String(ledger.length).padStart(2, '0')}
            </span>
          </div>
          <ul className="mt-3">
            {ledger.map((item) => {
              const tone = LEDGER[item.verdict] ?? LEDGER.irrelevant
              return (
                <li
                  key={item.id}
                  className="rule-dashed flex items-center gap-3 py-2 last:border-b-0"
                >
                  <span
                    className={cn(
                      // min-w 而不是固定宽度：记号万一变长也只是变宽，不会溢出来
                      'verdict-token flex h-6 min-w-6 shrink-0 items-center justify-center border px-1 font-mono text-[11px] font-bold',
                      tone.cls,
                    )}
                  >
                    {tone.glyph[locale]}
                  </span>
                  <span className="truncate font-serif text-[13px] text-foreground/75">
                    {item.question}
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
