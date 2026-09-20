import { useEffect, useRef, useState } from 'react'
import { ArrowRight, Eye, Lightbulb, Wand2 } from 'lucide-react'

import { TurnDebug } from '@/components/JevDebug'
import type { ChatMessage } from '@/lib/api'
import { cn } from '@/lib/utils'

interface ChatPanelProps {
  messages: ChatMessage[]
  asking: boolean
  disabled: boolean
  onSend: (text: string) => void
  onQuick: (kind: 'hint' | 'reveal' | 'how_to_play') => void
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
  return (
    <>
      {messages.map((message, messageIndex) => {
        const isPlayer = message.role === 'player'
        const verdictText =
          message.tone === 'verdict' && message.verdict
            ? (VERDICT_TEXT[message.verdict] ?? null)
            : null

        return (
          <Row
            key={message.id}
            index={messageIndex + 1}
            speaker={isPlayer ? '你' : 'JEV'}
            tint={isPlayer ? 'player' : 'host'}
            debug={message.debug ? <TurnDebug debug={message.debug} model={message.model} /> : null}
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
        <Row index={messages.length + 1} speaker="JEV" tint="host">
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

export function ChatPanel({ messages, asking, disabled, onSend, onQuick }: ChatPanelProps) {
  const [input, setInput] = useState('')
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
      <div className="flex shrink-0 items-center justify-between border-b border-foreground px-4 py-3 sm:px-6 sm:py-3.5 lg:px-8">
        <span className="font-mono text-[10px] font-bold tracking-[0.2em] sm:text-[11px] sm:tracking-[0.22em]">
          讯问记录 / TRANSCRIPT
        </span>
        <span className="flex items-center gap-2 font-mono text-[10px] tracking-[0.2em] text-muted-foreground">
          <span className="animate-soft-pulse size-1.5 rounded-full bg-[var(--v-yes)]" />
          主持人 JEV
        </span>
      </div>

      <div ref={scrollRef} className="chat-scroll min-h-0 flex-1 overflow-y-auto">
        <Transcript messages={messages} asking={asking} />
      </div>

      <div className="shrink-0 border-t border-foreground px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-4 lg:px-8">
        <div className="flex items-center gap-5 font-mono text-[10px] tracking-[0.18em] text-muted-foreground">
          <button
            type="button"
            onClick={() => onQuick('hint')}
            disabled={asking || disabled}
            className="flex items-center gap-1.5 transition-colors hover:text-foreground disabled:opacity-40"
          >
            <Lightbulb className="size-3" />
            求提示
          </button>
          <button
            type="button"
            onClick={() => onQuick('how_to_play')}
            disabled={asking || disabled}
            className="flex items-center gap-1.5 transition-colors hover:text-foreground disabled:opacity-40"
          >
            <Wand2 className="size-3" />
            玩法
          </button>
          <button
            type="button"
            onClick={() => onQuick('reveal')}
            disabled={asking || disabled}
            className="ml-auto flex items-center gap-1.5 transition-colors hover:text-foreground disabled:opacity-40"
          >
            <Eye className="size-3" />
            揭晓
          </button>
        </div>

        <div className="mt-3 flex items-center gap-3 border border-foreground bg-card px-4 py-2.5">
          <span aria-hidden className="shrink-0 font-mono text-sm leading-6 font-bold text-stamp">
            &gt;
          </span>
          <textarea
            value={input}
            disabled={disabled}
            rows={1}
            placeholder={disabled ? '本案已结案 · 回到档案室可再立案' : '提出你的问题……'}
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
            aria-label="发送"
            className="flex size-8 shrink-0 items-center justify-center bg-foreground text-background transition-opacity hover:opacity-85 disabled:opacity-25"
          >
            <ArrowRight className="size-4" />
          </button>
        </div>
        <p className="mt-2 hidden font-mono text-[10px] tracking-[0.16em] text-muted-foreground/70 sm:block">
          回车提交 · SHIFT + 回车换行
        </p>
      </div>
    </div>
  )
}
