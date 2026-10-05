import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ChatPanel } from './ChatPanel'
import { CaseDrawer } from './CaseDrawer'
import { postJson, type ChatMessage, type HostTurn } from '@/lib/api'
import { cn, uid } from '@/lib/utils'
import { getDeviceId } from '@/lib/luck'
import type { ClozeView } from '../../shared/cloze'

const rules =
  '每格一个字，按原文位置填写。填对的字会自动留下；没对上的可以继续修改。你也可以随时向砚提问。'
const greeting: ChatMessage = { id: 'cloze-greeting', role: 'host', text: rules }

export function ClozePage({ id }: { id: string }) {
  const endpoint = `/api/library/puzzles/${encodeURIComponent(id)}/cloze`
  const [puzzle, setPuzzle] = useState<ClozeView>()
  const [drafts, setDrafts] = useState<string[][]>([])
  const [messages, setMessages] = useState<ChatMessage[]>([greeting])
  const [busy, setBusy] = useState<'ask' | 'reveal' | null>(null)
  const [error, setError] = useState('')
  // Cells whose current draft the server already rejected, keyed `${gap}:${position}`.
  const [rejected, setRejected] = useState<Record<string, string>>({})
  const [revealed, setRevealed] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(true)
  const composing = useRef<HTMLInputElement | null>(null)
  const run = useRef(0)

  useEffect(() => {
    let alive = true
    postJson<ClozeView>(endpoint, { action: 'open' })
      .then((data) => {
        if (alive) setPuzzle(data)
      })
      .catch((cause) => {
        if (alive) setError(cause.message)
      })
    return () => {
      alive = false
    }
  }, [endpoint])

  const gaps = useMemo(
    () => puzzle?.parts.filter((part) => typeof part !== 'string') ?? [],
    [puzzle],
  )
  const total = gaps.reduce((sum, gap) => sum + gap.letters.length, 0)
  const found = gaps.reduce((sum, gap) => sum + gap.letters.filter(Boolean).length, 0)
  const done = puzzle?.complete || revealed

  function write(id: number, position: number, value: string, input?: HTMLInputElement) {
    // Keep IME candidates in their active cell until the user commits the word.
    const chars = input && value ? [...value].slice(0, gaps[id].letters.length - position) : [value]
    setDrafts((previous) => {
      const next = previous.map((word) => [...word])
      next[id] ??= []
      chars.forEach((char, offset) => {
        if (!gaps[id].letters[position + offset]) next[id][position + offset] = char
      })
      return next
    })
    if (input && value) {
      const cells = [
        ...input.closest('[data-cloze-inputs]')!.querySelectorAll<HTMLInputElement>('input'),
      ]
      const next = cells.slice(cells.indexOf(input) + chars.length).find((cell) => !cell.disabled)
      next?.focus()
      next?.select()
    }
  }

  // Check drafts as the player types: right letters lock in, wrong ones are flagged.
  useEffect(() => {
    if (!puzzle || done || busy === 'reveal') return
    const sent = gaps.map(({ id, letters }) =>
      letters.map((char, position) => char || drafts[id]?.[position] || ''),
    )
    const pending = gaps.some(({ id, letters }) =>
      letters.some(
        (char, position) =>
          !char && sent[id][position] && rejected[`${id}:${position}`] !== sent[id][position],
      ),
    )
    if (!pending) return
    const timer = window.setTimeout(async () => {
      // The composition-end event writes the draft again, which re-runs this effect.
      if (composing.current) return
      const current = ++run.current
      try {
        const data = await postJson<ClozeView>(endpoint, {
          action: 'check',
          guesses: sent,
          playerKey: getDeviceId(),
        })
        if (current !== run.current) return
        setPuzzle(data)
        setError('')
        setRejected((previous) => {
          const next = { ...previous }
          data.parts.forEach((part) => {
            if (typeof part === 'string') return
            part.letters.forEach((char, position) => {
              const key = `${part.id}:${position}`
              if (char) delete next[key]
              else if (sent[part.id][position]) next[key] = sent[part.id][position]
            })
          })
          return next
        })
      } catch (cause) {
        if (current === run.current)
          setError(cause instanceof Error ? cause.message : '核对失败，请继续输入重试')
      }
    }, 250)
    return () => {
      window.clearTimeout(timer)
      run.current += 1
    }
  }, [drafts, puzzle, gaps, rejected, done, busy, endpoint])

  async function reveal() {
    if (busy || !puzzle) return
    setBusy('reveal')
    run.current += 1
    setError('')
    try {
      setPuzzle(await postJson<ClozeView>(endpoint, { action: 'reveal', playerKey: getDeviceId() }))
      setRevealed(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '揭晓失败，请重试')
    } finally {
      setBusy(null)
    }
  }

  async function ask(text: string) {
    if (busy || done) return
    setBusy('ask')
    setMessages((previous) => [...previous, { id: uid(), role: 'player', text }])
    try {
      const turn = await postJson<HostTurn>(endpoint, {
        playerKey: getDeviceId(),
        action: 'ask',
        message: text,
        locale: 'zh-CN',
        history: messages.slice(-20),
      })
      setMessages((previous) => [
        ...previous,
        {
          id: uid(),
          role: 'host',
          text: turn.reply,
          verdict: turn.verdict,
          replyLocale: turn.replyLocale,
        },
      ])
    } catch (cause) {
      setMessages((previous) => [
        ...previous,
        {
          id: uid(),
          role: 'host',
          tone: 'error',
          text: cause instanceof Error ? cause.message : '提问失败，请重试',
        },
      ])
    } finally {
      setBusy(null)
    }
  }

  if (!puzzle)
    return (
      <main
        className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center"
        role="status"
      >
        <span aria-hidden className="seal size-10 text-lg">
          填
        </span>
        <p
          className={cn(
            'font-serif text-lg',
            !error && puzzle === undefined && 'animate-soft-pulse',
          )}
        >
          {error || '正在翻开缺字案卷…'}
        </p>
        {error ? (
          <button
            className="mt-2 border border-foreground/80 px-5 py-2.5 font-mono text-[11px] tracking-[0.18em] transition-colors hover:bg-foreground hover:text-background"
            onClick={() => window.location.reload()}
          >
            重试
          </button>
        ) : null}
      </main>
    )

  const paragraphs: ReactNode[][] = [[]]
  puzzle.parts.forEach((part, index) => {
    if (typeof part === 'string') {
      part.split(/\n{2,}/).forEach((text, i) => {
        if (i) paragraphs.push([])
        const nodes = paragraphs[paragraphs.length - 1]
        // 紧跟在空格后面的标点不能单独折到下一行：把它和前一个空格包在一起
        const lead = i === 0 ? /^[，。、！？；：,.!?;:”’」』）)…]+/.exec(text)?.[0] : undefined
        const previous = nodes[nodes.length - 1]
        if (lead && previous && typeof previous !== 'string') {
          nodes[nodes.length - 1] = (
            <span key={`gap-${index}`} className="whitespace-nowrap">
              {previous}
              {lead}
            </span>
          )
          text = text.slice(lead.length)
        }
        if (text) nodes.push(text)
      })
      return
    }
    const solved = part.letters.every(Boolean)
    paragraphs[paragraphs.length - 1].push(
      <span
        key={index}
        role="group"
        aria-label={`第 ${part.id + 1} 处，共 ${part.letters.length} 字`}
        className={cn(
          'cloze-gap relative mx-1.5 inline-flex max-w-full items-stretch align-middle leading-normal',
          solved && 'is-solved',
        )}
      >
        <span aria-hidden="true" className="cloze-gap-no">
          {part.id + 1}
        </span>
        {part.letters.map((char, position) => {
          const draft = drafts[part.id]?.[position]
          const wrong = !char && Boolean(draft) && rejected[`${part.id}:${position}`] === draft
          return (
            <input
              key={position}
              aria-label={`第 ${part.id + 1} 处第 ${position + 1} 字`}
              value={char || draft || ''}
              disabled={Boolean(char) || done}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={wrong}
              className={cn('cloze-cell', char && 'is-right', wrong && 'is-wrong')}
              onFocus={(event) => event.currentTarget.select()}
              onCompositionStart={(event) => {
                composing.current = event.currentTarget
              }}
              onChange={(event) => {
                const input = event.currentTarget
                const native = event.nativeEvent as InputEvent
                if (composing.current === input || native.isComposing) {
                  write(part.id, position, input.value)
                } else if (document.activeElement === input) {
                  // A trailing IME input event belongs to the old cell after focus advances.
                  write(
                    part.id,
                    position,
                    native.inputType === 'insertText' && typeof native.data === 'string'
                      ? native.data
                      : input.value,
                    input,
                  )
                }
              }}
              onCompositionEnd={(event) => {
                composing.current = null
                write(
                  part.id,
                  position,
                  event.data || event.currentTarget.value,
                  event.currentTarget,
                )
              }}
              onPaste={(event) => {
                event.preventDefault()
                write(
                  part.id,
                  position,
                  event.clipboardData.getData('text').trim(),
                  event.currentTarget,
                )
              }}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing || composing.current === event.currentTarget)
                  return
                if (event.key === 'Backspace' && !event.currentTarget.value) {
                  const cells = [
                    ...event.currentTarget
                      .closest('[data-cloze-inputs]')!
                      .querySelectorAll<HTMLInputElement>('input'),
                  ]
                  const previous = cells
                    .slice(0, cells.indexOf(event.currentTarget))
                    .reverse()
                    .find((cell) => !cell.disabled)
                  if (previous) {
                    event.preventDefault()
                    previous.focus()
                    previous.select()
                  }
                }
              }}
            />
          )
        })}
      </span>,
    )
  })

  const story = (
    <div data-cloze-inputs className="px-5 pt-6 pb-10 sm:px-8 sm:pt-8">
      <header className="relative">
        <div className="flex items-center gap-3">
          <span className="eyebrow text-[10px]">案卷 · 汤底填空</span>
          <span className="rounded-full bg-stamp-soft px-2 py-0.5 font-mono text-[9px] tracking-[0.16em] text-stamp">
            体验版
          </span>
        </div>
        <h1 className="mt-4 pr-24 font-serif text-[clamp(1.75rem,3vw,2.25rem)] leading-tight font-semibold">
          {puzzle.title}
        </h1>
        {done ? (
          <div className="stamp animate-pop absolute top-1 right-0 px-2.5 py-1 font-mono text-xs tracking-[0.2em]">
            {revealed ? '已揭晓' : '已还原'}
          </div>
        ) : null}
      </header>

      <section aria-label="汤面" className="sheet mt-6 border-l-2 border-l-stamp px-5 py-4">
        <h2 className="font-mono text-[10px] tracking-[0.24em] text-stamp">汤面</h2>
        <div className="mt-2 space-y-3 font-serif text-[15px] leading-8">
          {puzzle.surface.split(/\n{2,}/).map((text, index) => (
            <p key={index}>{text}</p>
          ))}
        </div>
      </section>

      <div className="sticky top-0 z-10 -mx-5 mt-6 border-b border-foreground/15 bg-background/90 px-5 py-3 backdrop-blur sm:-mx-8 sm:px-8">
        <div className="flex items-center gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <span className="font-serif text-3xl leading-none font-semibold tabular-nums">
                {found}
              </span>
              <span className="font-mono text-[11px] text-muted-foreground">/ {total} 字</span>
              <span className="ml-1 font-mono text-[10px] tracking-[0.16em] text-muted-foreground">
                {revealed ? '已揭晓' : done ? '已还原' : '已找回'}
              </span>
            </div>
            <div
              role="progressbar"
              aria-label="故事还原进度"
              aria-valuemin={0}
              aria-valuemax={total}
              aria-valuenow={found}
              className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-foreground/10"
            >
              <div
                className="h-full rounded-full bg-[var(--v-yes)] transition-[width] duration-500"
                style={{ width: `${total ? (found / total) * 100 : 0}%` }}
              />
            </div>
          </div>
          {/* 每一处空的完成情况：一枚小方格，补齐了就填实 */}
          <ol className="flex shrink-0 flex-wrap justify-end gap-1.5" aria-hidden>
            {gaps.map((gap) => {
              const filled = gap.letters.filter(Boolean).length
              return (
                <li
                  key={gap.id}
                  className={cn(
                    'flex size-6 items-center justify-center font-mono text-[10px] tabular-nums transition-colors',
                    filled === gap.letters.length
                      ? 'bg-[var(--v-yes)] text-background'
                      : filled
                        ? 'border border-[var(--v-yes)] text-[var(--v-yes)]'
                        : 'border border-stamp/35 text-stamp',
                  )}
                >
                  {gap.id + 1}
                </li>
              )
            })}
          </ol>
        </div>
        <p role="status" className="sr-only">
          已找回 {found} / {total} 字
        </p>
        {error ? (
          <p role="alert" className="mt-2 text-xs leading-4 text-stamp">
            {error}
          </p>
        ) : null}
      </div>

      {done ? (
        <div className="animate-pop mt-8 flex items-center gap-4 border-l-4 border-[var(--v-yes)] bg-[color-mix(in_srgb,var(--v-yes)_10%,transparent)] px-5 py-4">
          <span aria-hidden className="seal size-10 shrink-0 bg-[var(--v-yes)] text-lg">
            {revealed ? '揭' : '全'}
          </span>
          <div>
            <p className="font-serif text-lg font-semibold">
              {revealed ? '汤底已经揭晓' : '全部补齐，真相还原！'}
            </p>
            <p className="mt-0.5 font-mono text-[10px] tracking-[0.14em] text-muted-foreground">
              {revealed ? '下方是完整的汤底原文' : `${total} 个字一个不差`}
            </p>
          </div>
        </div>
      ) : null}

      <div className="sheet mt-8 px-5 pt-6 pb-8 sm:px-8">
        <h2 className="font-mono text-[10px] tracking-[0.24em] text-stamp">
          汤底 · {done ? '原文' : '待补全'}
        </h2>
        {done ? null : (
          <p className="mt-2 font-serif text-[13px] leading-6 text-muted-foreground">
            一边提问，一边补齐故事。每格一字，填对的字会自动留下，也可以在第一格粘贴整段答案。进度仅在本页保留。
          </p>
        )}
        <div className="cloze-story mt-6 space-y-5 font-serif text-[17px] leading-[2.6]">
          {paragraphs.map((nodes, index) => (
            <p key={index}>{nodes}</p>
          ))}
        </div>
      </div>
    </div>
  )

  return (
    <main className="play-layout flex min-h-0 flex-1">
      <section
        aria-label="填空故事"
        className="chat-scroll hidden min-h-0 w-[58%] overflow-y-auto border-r border-foreground/20 bg-[color-mix(in_srgb,var(--sheet)_35%,transparent)] lg:block"
      >
        {story}
      </section>
      <section aria-label="主持人问答" className="flex min-h-0 min-w-0 flex-1 flex-col">
        <CaseDrawer
          title={puzzle.title}
          meta={`汤底填空 · ${found} / ${total} 字 · 点击填写`}
          open={drawerOpen}
          onOpenChange={setDrawerOpen}
        >
          {story}
        </CaseDrawer>
        <ChatPanel
          messages={messages}
          asking={Boolean(busy)}
          disabled={Boolean(done)}
          disabledLabel={revealed ? '故事已揭晓' : '全部补齐，真相还原！'}
          onSend={(text) => void ask(text)}
          onQuick={(kind) => {
            if (kind === 'reveal') void reveal()
            else if (kind === 'hint') void ask('请给我一点提示。')
            else setMessages((previous) => [...previous, { id: uid(), role: 'host', text: rules }])
          }}
        />
      </section>
    </main>
  )
}
