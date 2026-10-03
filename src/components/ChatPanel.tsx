import { useQuestionJump } from '@/lib/play-navigation'
import { usePersonalMarks } from '@/lib/personal-marks-context'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUp, Eye, Flag, Lightbulb, Lock, Wand2 } from 'lucide-react'

import { ExternalLink } from '@/components/Link'
import { TurnDebug } from '@/components/TurnDebug'
import { PersonalMarkEmpty } from './PersonalMarks'
import { soloTranscript, messageVerdict } from '@/lib/play-transcript'
import { PlayPair, PlayTranscriptBar } from './PlayPair'
import { VerdictToken } from './VerdictToken'
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
  disabledLabel?: string
  /** 今日官方汤：当天没有「揭晓」可点 */
  locked?: boolean
  onSend: (text: string) => void
  onQuick: (kind: 'hint' | 'reveal' | 'how_to_play') => void
  onReport?: (note: string) => Promise<void>
}

const VERDICT_TEXT: Record<string, string> = {
  yes: '是',
  no: '不是',
  partly: '是，也不是',
  irrelevant: '无关',
}

function HostAnswer({ message }: { message: ChatMessage }) {
  const { t, locale } = useI18n()
  const verdict = messageVerdict(message)
  const word = verdict && VERDICT_TEXT[verdict]
  const bare =
    word &&
    message.text.replace(/[。.!！\s]/g, '') ===
      translateFor(message.replyLocale ?? locale, word).replace(/[。.!！\s]/g, '')
  return (
    <div className="play-answer">
      <div className="play-answer-line">
        {verdict ? <VerdictToken verdict={verdict} /> : null}
        {!bare ? (
          <p
            className={cn(
              'whitespace-pre-wrap break-words',
              message.tone === 'error' && 'text-stamp',
            )}
          >
            {message.text}
          </p>
        ) : null}
      </div>
      {message.verdict === 'contact' ? (
        <p className="mt-2 font-mono text-[10px]">
          {t('编辑部群')} ·{' '}
          <ExternalLink href={QQ_GROUP.href} className="underline underline-offset-4">
            {QQ_GROUP.number}
          </ExternalLink>
        </p>
      ) : null}
    </div>
  )
}

export function Transcript({
  messages,
  asking,
  verdictFilter = null,
  onClear,
}: {
  messages: ChatMessage[]
  asking?: boolean
  verdictFilter?: string | null
  onClear?: () => void
}) {
  const { t } = useI18n()
  const marks = usePersonalMarks()
  const groups = useMemo(() => soloTranscript(messages), [messages])
  const visible = groups.filter(
    ({ message, answer }) =>
      (!marks || marks.includes(message.role === 'player' ? message.id : undefined)) &&
      (!verdictFilter || messageVerdict(answer) === verdictFilter),
  )
  return (
    <>
      {!visible.length && (marks?.filter !== 'all' || verdictFilter) ? (
        <PersonalMarkEmpty onReset={onClear} />
      ) : null}
      {visible.map(({ message, answer, number }) =>
        message.role === 'player' ? (
          <PlayPair
            key={message.id}
            id={message.id}
            number={number}
            speaker={t('你')}
            question={<p className="whitespace-pre-wrap">{message.text}</p>}
            actions={answer?.debug ? <TurnDebug debug={answer.debug} /> : null}
          >
            {answer ? (
              <HostAnswer message={answer} />
            ) : asking ? (
              <p role="status" className="play-thinking">
                {t('砚正在核对线索…')}
              </p>
            ) : null}
          </PlayPair>
        ) : (
          <div key={message.id} className="play-host-note">
            <span className="font-mono text-[10px] text-stamp">{t('砚')}</span>
            <HostAnswer message={message} />
            {message.debug ? <TurnDebug debug={message.debug} /> : null}
          </div>
        ),
      )}
    </>
  )
}

export function ChatPanel({
  messages,
  asking,
  disabled,
  disabledLabel,
  locked = false,
  onSend,
  onQuick,
  onReport,
}: ChatPanelProps) {
  const { t, locale } = useI18n()
  const marks = usePersonalMarks()
  const [input, setInput] = useState('')
  const [verdictFilter, setVerdictFilter] = useState<string | null>(null)
  useQuestionJump(() => {
    marks?.setFilter('all')
    setVerdictFilter(null)
  })
  const verdicts = messages.flatMap((m) => (messageVerdict(m) ? [messageVerdict(m)!] : []))
  const [reporting, setReporting] = useState(false)
  const [note, setNote] = useState('')
  const [reportState, setReportState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle')
  const [reportError, setReportError] = useState('')

  async function sendReport() {
    if (!onReport) return
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
  const inputRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const input = inputRef.current
    if (!input) return
    input.style.height = 'auto'
    input.style.height = `${Math.min(104, input.scrollHeight)}px`
  }, [input])
  const scrollRef = useRef<HTMLDivElement>(null)
  const lastFilter = useRef(marks?.filter)

  useEffect(() => {
    const node = scrollRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [messages, asking])

  useEffect(() => {
    const node = scrollRef.current
    if (node && marks?.filter !== lastFilter.current) {
      node.scrollTop = marks?.filter === 'all' ? node.scrollHeight : 0
      lastFilter.current = marks?.filter
    }
  }, [marks?.filter])

  function submit() {
    const text = input.trim()
    if (!text || asking || disabled) return
    setInput('')
    marks?.setFilter('all')
    setVerdictFilter(null)
    onSend(text)
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <div className="play-transcript-title">
        <span>{t('讯问记录')}</span>
        <span>{t('砚')}</span>
      </div>
      <PlayTranscriptBar
        verdicts={verdicts}
        selected={verdictFilter}
        onSelect={(v) => {
          setVerdictFilter(v)
          if (scrollRef.current) scrollRef.current.scrollTop = 0
        }}
      />

      <div ref={scrollRef} className="chat-scroll min-h-0 flex-1 overflow-y-auto">
        <Transcript
          messages={messages}
          asking={asking}
          verdictFilter={verdictFilter}
          onClear={() => setVerdictFilter(null)}
        />
      </div>

      <div className="play-solo-composer shrink-0">
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

        <div className="play-input">
          <span aria-hidden className="shrink-0 font-mono text-sm leading-6 font-bold text-stamp">
            &gt;
          </span>
          <textarea
            ref={inputRef}
            aria-label={t('向砚提问')}
            value={input}
            disabled={disabled}
            rows={1}
            placeholder={
              disabled
                ? (disabledLabel ?? t('本案已结案 · 回到档案室可再立案'))
                : t('提出你的问题……')
            }
            className="chat-scroll min-w-0 flex-1 resize-none bg-transparent font-serif text-base leading-6 outline-none placeholder:text-muted-foreground/70 disabled:opacity-50"
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
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
            className="play-send-button"
          >
            <ArrowUp className="size-4" />
          </button>
        </div>
        <div className="play-quick-actions">
          <QuickAction
            icon={<Lightbulb />}
            label={t('求提示')}
            disabled={asking || disabled}
            onClick={() => {
              marks?.setFilter('all')
              setVerdictFilter(null)
              onQuick('hint')
            }}
          />
          <QuickAction
            icon={<Wand2 />}
            label={t('玩法')}
            disabled={asking || disabled}
            onClick={() => {
              marks?.setFilter('all')
              setVerdictFilter(null)
              onQuick('how_to_play')
            }}
          />
          {onReport ? (
            <QuickAction
              icon={<Flag />}
              label={t('反馈')}
              active={reporting}
              onClick={() => {
                setReporting((value) => !value)
                setReportState('idle')
              }}
            />
          ) : null}
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

        <p className="mt-1 hidden font-mono text-[10px] tracking-[0.16em] text-muted-foreground/70 sm:block">
          {t('回车提交 · Shift + 回车换行')}
        </p>
      </div>
    </div>
  )
}
