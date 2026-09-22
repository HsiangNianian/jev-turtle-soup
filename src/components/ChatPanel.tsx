import { useEffect, useRef, useState } from 'react'
import { ArrowRight, Eye, Flag, Lightbulb, Lock, Wand2 } from 'lucide-react'

import { ExternalLink } from '@/components/Link'
import { TurnDebug } from '@/components/TurnDebug'
import { QQ_GROUP, showsGroupInvite } from '@/lib/community'
import type { ChatMessage } from '@/lib/api'
import { cn } from '@/lib/utils'
import { translateFor, useI18n } from '@/lib/i18n'

/**
 * 输入框上方的小按钮：小屏只显示图标，`sm` 以上才带文字。
 * 只留图标时必须给 aria-label，否则读屏用户只听到一个图标。
 */
function QuickAction({
  icon,
  label,
  onClick,
  disabled = false,
  active = false,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
  active?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        'flex items-center gap-1.5 p-1 transition-colors hover:text-foreground disabled:opacity-40',
        active && 'text-foreground',
      )}
    >
      <span className="[&>svg]:size-4 sm:[&>svg]:size-3">{icon}</span>
      <span className="hidden sm:inline">{label}</span>
    </button>
  )
}

interface ChatPanelProps {
  messages: ChatMessage[]
  asking: boolean
  disabled: boolean
  /** 今日官方汤：当天没有「揭晓」可点 */
  locked?: boolean
  onSend: (text: string) => void
  onQuick: (kind: 'hint' | 'reveal' | 'how_to_play') => void
  onReport: (note: string) => Promise<void>
}

const VERDICT_TEXT: Record<string, string> = {
  yes: '是',
  no: '不是',
  partly: '是，也不是',
  irrelevant: '无关',
}

function Row({
  index,
  speaker,
  tint,
  children,
  debug,
}: {
  index: number
  speaker: string
  tint?: 'player' | 'host'
  children: React.ReactNode
  debug?: React.ReactNode
}) {
  return (
    <div className="rule-dashed grid grid-cols-[1.75rem_2.5rem_1fr] items-baseline gap-x-2.5 px-4 py-3.5 last:border-b-0 sm:grid-cols-[2.25rem_3rem_1fr] sm:gap-x-3 sm:px-6 sm:py-4 lg:px-8">
      <span className="font-mono text-[11px] text-muted-foreground">
        {String(index).padStart(2, '0')}
      </span>
      <span
        className={cn(
          'font-mono text-[11px] font-bold tracking-[0.12em]',
          tint === 'player' ? 'text-foreground/60' : 'text-stamp',
        )}
      >
        {speaker}
      </span>
      <div className="min-w-0">
        {children}
        {debug}
      </div>
    </div>
  )
}

export function Transcript({ messages, asking }: { messages: ChatMessage[]; asking?: boolean }) {
  const { t, locale } = useI18n()
  return (
    <>
      {messages.map((message, messageIndex) => {
        const isPlayer = message.role === 'player'
        const verdictWord =
          message.tone === 'verdict' && message.verdict ? VERDICT_TEXT[message.verdict] : null
        // 玩家用日文问、界面是中文时，徽章也要跟回复语言一致
        const verdictText = verdictWord
          ? translateFor(message.replyLocale ?? locale, verdictWord)
          : null

        return (
          <Row
            key={message.id}
            index={messageIndex + 1}
            speaker={isPlayer ? t('你') : t('砚')}
            tint={isPlayer ? 'player' : 'host'}
            debug={message.debug ? <TurnDebug debug={message.debug} /> : null}
          >
            <div className="animate-rise-in">
              {verdictText ? (
                <span
                  className={cn(
                    'verdict-token inline-flex items-center border px-2.5 py-0.5 font-mono text-[13px] font-bold tracking-[0.16em]',
                    message.verdict === 'yes' && 'verdict-yes',
                    message.verdict === 'no' && 'verdict-no',
                    message.verdict === 'partly' && 'verdict-partly',
                    message.verdict === 'irrelevant' && 'verdict-irrelevant',
                  )}
                >
                  {verdictText}
                </span>
              ) : message.tone === 'celebrate' ? (
                <span className="inline-flex border-2 border-[var(--v-yes)] px-3 py-1.5 font-serif text-[14px] text-[var(--v-yes)]">
                  {message.text}
                </span>
              ) : message.tone === 'error' ? (
                <span className="font-mono text-[12px] leading-6 text-stamp">{message.text}</span>
              ) : (
                <span
                  className={cn(
                    'font-serif text-[14px] leading-7',
                    isPlayer ? 'text-foreground/70' : 'text-foreground/90',
                  )}
                >
                  {message.text}
                </span>
              )}
            </div>
          </Row>
        )
      })}

      {asking ? (
        <Row index={messages.length + 1} speaker={t('砚')} tint="host">
          <span className="flex items-center gap-1.5 py-1">
            {[0, 1, 2].map((dot) => (
              <span
                key={dot}
                className="size-1.5 animate-bounce rounded-full bg-stamp"
                style={{ animationDelay: `${dot * 130}ms` }}
              />
            ))}
          </span>
        </Row>
      ) : null}
    </>
  )
}

export function ChatPanel({
  messages,
  asking,
  disabled,
  locked = false,
  onSend,
  onQuick,
  onReport,
}: ChatPanelProps) {
  const { t, locale } = useI18n()
  const [input, setInput] = useState('')
  const [reporting, setReporting] = useState(false)
  const [note, setNote] = useState('')
  const [reportState, setReportState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle')
  const [reportError, setReportError] = useState('')

  async function sendReport() {
    setReportState('sending')
    setReportError('')
    try {
      await onReport(note.trim())
      setReportState('done')
      setNote('')
      setReporting(false)
    } catch (error) {
      setReportState('error')
      setReportError(error instanceof Error ? error.message : t('提交失败'))
    }
  }
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const node = scrollRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [messages, asking])

  function submit() {
    const text = input.trim()
    if (!text || asking || disabled) return
    setInput('')
    onSend(text)
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-foreground px-4 py-2.5 sm:px-6 sm:py-3.5 lg:px-8">
        <span className="font-mono text-[10px] font-bold tracking-[0.2em] sm:text-[11px] sm:tracking-[0.22em]">
          {t('讯问记录')}
        </span>
        <span className="flex items-center gap-2 font-mono text-[10px] tracking-[0.2em] text-muted-foreground">
          <span className="animate-soft-pulse size-1.5 rounded-full bg-[var(--v-yes)]" />
          {t('砚')}
        </span>
      </div>

      <div ref={scrollRef} className="chat-scroll min-h-0 flex-1 overflow-y-auto">
        <Transcript messages={messages} asking={asking} />
      </div>

      <div className="shrink-0 border-t border-foreground px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-4 lg:px-8">
        <div className="flex items-center gap-5 font-mono text-[10px] tracking-[0.18em] text-muted-foreground">
          <QuickAction
            icon={<Lightbulb />}
            label={t('求提示')}
            disabled={asking || disabled}
            onClick={() => onQuick('hint')}
          />
          <QuickAction
            icon={<Wand2 />}
            label={t('玩法')}
            disabled={asking || disabled}
            onClick={() => onQuick('how_to_play')}
          />
          <QuickAction
            icon={<Flag />}
            label={t('反馈')}
            active={reporting}
            onClick={() => {
              setReporting((value) => !value)
              setReportState('idle')
            }}
          />
          {locked ? (
            <span className="ml-auto flex items-center gap-1.5 text-muted-foreground/70">
              <Lock className="size-3" />
              {t('官方每日汤 · 明日解锁')}
            </span>
          ) : (
            <button
              type="button"
              onClick={() => onQuick('reveal')}
              disabled={asking || disabled}
              className="ml-auto flex items-center gap-1.5 transition-colors hover:text-foreground disabled:opacity-40"
            >
              <Eye className="size-3" />
              {t('揭晓')}
            </button>
          )}
        </div>

        {reporting ? (
          <div className="mt-3 border border-foreground/30 bg-card p-3">
            <textarea
              value={note}
              rows={2}
              maxLength={500}
              onChange={(event) => setNote(event.target.value)}
              placeholder={t('哪里不对？比如主持人前后矛盾、判读明显错了……')}
              className="chat-scroll w-full resize-none bg-transparent font-serif text-sm leading-7 outline-none placeholder:text-muted-foreground/60"
            />
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void sendReport()}
                disabled={reportState === 'sending' || note.trim().length < 2}
                className="bg-foreground px-3.5 py-1.5 font-mono text-[10px] font-bold tracking-[0.16em] text-background transition-opacity hover:opacity-85 disabled:opacity-40"
              >
                {reportState === 'sending' ? t('提交中……') : t('提交反馈')}
              </button>
              <button
                type="button"
                onClick={() => setReporting(false)}
                className="font-mono text-[10px] tracking-[0.16em] text-muted-foreground transition-colors hover:text-foreground"
              >
                {t('取消')}
              </button>
            </div>
            {reportState === 'error' && reportError ? (
              <p className="mt-2 font-mono text-[10px] text-stamp">{reportError}</p>
            ) : null}
            {/* 玩家本来就在找我们说话，群是最快的渠道 */}
            {showsGroupInvite(locale) ? (
              <p className="mt-3 font-mono text-[10px] leading-6 tracking-[0.12em] text-muted-foreground/70">
                {t('想直接说？进编辑部群：')}
                <ExternalLink
                  href={QQ_GROUP.href}
                  className="text-muted-foreground underline decoration-foreground/30 underline-offset-4 transition-colors hover:text-foreground"
                >
                  {QQ_GROUP.number}
                </ExternalLink>
              </p>
            ) : null}
          </div>
        ) : null}

        {reportState === 'done' ? (
          <p className="mt-3 border-l-2 border-l-[var(--v-yes)] bg-card px-3 py-2 font-mono text-[10px] tracking-[0.14em] text-[var(--v-yes)]">
            {t('反馈已收到，谢谢。')}
          </p>
        ) : null}

        <div className="mt-3 flex items-center gap-3 border border-foreground bg-card px-4 py-2.5">
          <span aria-hidden className="shrink-0 font-mono text-sm leading-6 font-bold text-stamp">
            &gt;
          </span>
          <textarea
            value={input}
            disabled={disabled}
            rows={1}
            placeholder={disabled ? t('本案已结案 · 回到档案室可再立案') : t('提出你的问题……')}
            className="chat-scroll h-6 flex-1 resize-none bg-transparent font-serif text-sm leading-6 outline-none placeholder:text-muted-foreground/70 disabled:opacity-50"
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                submit()
              }
            }}
          />
          <button
            type="button"
            onClick={submit}
            disabled={asking || disabled || !input.trim()}
            aria-label={t('发送')}
            className="flex size-8 shrink-0 items-center justify-center bg-foreground text-background transition-opacity hover:opacity-85 disabled:opacity-25"
          >
            <ArrowRight className="size-4" />
          </button>
        </div>
        <p className="mt-2 hidden font-mono text-[10px] tracking-[0.16em] text-muted-foreground/70 sm:block">
          {t('回车提交 · Shift + 回车换行')}
        </p>
      </div>
    </div>
  )
}
