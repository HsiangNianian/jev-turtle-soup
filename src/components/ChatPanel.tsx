import { useEffect, useRef, useState } from 'react'
import { Eye, Lightbulb, Send, Sparkles, Wand2 } from 'lucide-react'

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

const VERDICT: Record<string, { word: string; cls: string }> = {
  yes: { word: '是', cls: 'verdict-yes' },
  no: { word: '不是', cls: 'verdict-no' },
  partly: { word: '是，也不是', cls: 'verdict-partly' },
  irrelevant: { word: '无关', cls: 'verdict-irrelevant' },
}

function HostAvatar() {
  return (
    <div className="relative flex size-8 shrink-0 items-center justify-center rounded-full border border-primary/25 bg-primary/10 font-serif text-xs text-primary">
      主
    </div>
  )
}

function PlayerAvatar() {
  return (
    <div className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-secondary font-serif text-xs text-secondary-foreground">
      你
    </div>
  )
}

function TypingBubble() {
  return (
    <div className="flex items-end gap-3">
      <HostAvatar />
      <div className="flex h-10 items-center gap-1.5 rounded-2xl rounded-bl-sm border border-border bg-background/60 px-4">
        {[0, 1, 2].map((index) => (
          <span
            key={index}
            className="size-1.5 animate-bounce rounded-full bg-primary/70"
            style={{ animationDelay: `${index * 130}ms` }}
          />
        ))}
      </div>
    </div>
  )
}

function HostMessage({ message }: { message: ChatMessage }) {
  const isCelebrate = message.tone === 'celebrate'
  const isError = message.tone === 'error'
  const verdict = message.verdict ? VERDICT[message.verdict] : undefined

  return (
    <div className="animate-rise-in flex items-start gap-3">
      <HostAvatar />
      <div className="max-w-[84%] space-y-1">
        {verdict ? (
          <div
            className={cn(
              'verdict-token inline-flex items-center rounded-2xl rounded-bl-sm border px-5 py-3',
              verdict.cls,
            )}
          >
            <span className="font-serif text-xl font-semibold tracking-widest">{verdict.word}</span>
          </div>
        ) : (
          <div
            className={cn(
              'rounded-2xl rounded-bl-sm border px-4 py-3 text-sm leading-relaxed shadow-sm',
              isCelebrate
                ? 'border-[var(--v-yes)]/40 bg-[var(--v-yes)]/12 text-foreground shadow-[0_0_40px_-12px_var(--v-yes)]'
                : isError
                  ? 'border-destructive/40 bg-destructive/10 text-destructive-foreground'
                  : 'border-border bg-background/55 text-foreground/90',
            )}
          >
            <p className="surface-prose flex items-start gap-2">
              {isCelebrate ? (
                <Sparkles className="mt-0.5 size-4 shrink-0 text-[var(--v-yes)]" />
              ) : null}
              <span>{message.text}</span>
            </p>
          </div>
        )}
        {message.debug ? <TurnDebug debug={message.debug} model={message.model} /> : null}
      </div>
    </div>
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
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-3xl border border-border/70 bg-card/60 shadow-[0_30px_80px_-50px_oklch(0_0_0/0.9)] backdrop-blur">
      <div className="flex shrink-0 items-center gap-3 border-b border-border/60 bg-background/30 px-4 py-3">
        <HostAvatar />
        <div className="min-w-0">
          <div className="font-serif text-sm tracking-widest">主持人 · Jev</div>
          <div className="truncate text-[11px] text-muted-foreground">
            只答「是 / 不是 / 无关」
          </div>
        </div>
        <span className="ml-auto flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="animate-soft-pulse size-1.5 rounded-full bg-[var(--v-yes)]" />
          Jev 在线
        </span>
      </div>

      <div ref={scrollRef} className="chat-scroll flex-1 space-y-5 overflow-y-auto px-4 py-5">
        {messages.map((message) =>
          message.role === 'player' ? (
            <div key={message.id} className="animate-rise-in flex items-end justify-end gap-3">
              <div className="max-w-[84%] rounded-2xl rounded-br-sm bg-gradient-to-br from-primary to-primary/80 px-4 py-3 text-sm leading-relaxed text-primary-foreground shadow-[0_12px_30px_-18px_oklch(0.81_0.125_78/0.9)]">
                <p className="surface-prose">{message.text}</p>
              </div>
              <PlayerAvatar />
            </div>
          ) : (
            <HostMessage key={message.id} message={message} />
          ),
        )}
        {asking ? <TypingBubble /> : null}
      </div>

      <div className="shrink-0 border-t border-border/60 bg-background/30 px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-4">
        <div className="mb-2.5 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onQuick('hint')}
            disabled={asking || disabled}
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background/40 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary disabled:opacity-50"
          >
            <Lightbulb className="size-3.5" />
            求提示
          </button>
          <button
            type="button"
            onClick={() => onQuick('how_to_play')}
            disabled={asking || disabled}
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background/40 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary disabled:opacity-50"
          >
            <Wand2 className="size-3.5" />
            玩法
          </button>
          <button
            type="button"
            onClick={() => onQuick('reveal')}
            disabled={asking || disabled}
            className="ml-auto inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
          >
            <Eye className="size-3.5" />
            揭晓
          </button>
        </div>

        <div className="flex items-end gap-2 rounded-2xl border border-border/70 bg-background/50 p-1.5 transition-all focus-within:border-primary/40 focus-within:ring-[3px] focus-within:ring-ring/30">
          <textarea
            value={input}
            disabled={disabled}
            rows={1}
            placeholder="问一个是非题，或说出你的推理……"
            className="chat-scroll max-h-32 min-h-9 flex-1 resize-none bg-transparent px-2.5 py-2 text-sm outline-none placeholder:text-muted-foreground/70 disabled:opacity-50"
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
            className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-b from-primary to-primary/85 text-primary-foreground shadow-[0_10px_24px_-12px_oklch(0.81_0.125_78/0.9)] transition-all hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-40"
          >
            <Send className="size-4" />
          </button>
        </div>
        <p className="mt-2 hidden text-center text-[10px] text-muted-foreground/60 sm:block">
          Enter 发送 · Shift + Enter 换行
        </p>
      </div>
    </div>
  )
}
