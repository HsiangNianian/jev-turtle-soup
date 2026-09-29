import './RoomPage.css'
import {
  type ReactNode,
  useId,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import {
  ArrowLeft,
  ArrowUp,
  Check,
  ChevronRight,
  Copy,
  Flag,
  Loader2,
  MessageSquare,
  UsersRound,
  X,
} from 'lucide-react'
import { Button, Empty, Notice, PageShell, inputClass } from './Bits'
import { Link } from './Link'
import { RoomEntry } from './RoomEntry'
import { VerdictToken } from './VerdictToken'
import { buildRoomLedger, roomVerdict } from '../../shared/room-ledger'
import { RoomConnection, roomAPI, roomRequest, type RoomAction } from '@/lib/room-client'
import { useI18n } from '@/lib/i18n'
import { navigate } from '@/lib/router'
import { cn } from '@/lib/utils'
import type { RoomSnapshot, RoomSummary } from '../../shared/room-protocol'

const phases = {
  waiting: '等待入座',
  playing: '推理中',
  solved: '共同解开',
  revealed: '共同揭晓',
  abandoned: '已中止',
} as const
const errorText = (e: unknown) => (e instanceof Error ? e.message : '同桌暂时无法连接，请稍后重试')
function LoginGate() {
  const { t } = useI18n()
  return (
    <PageShell label={t('同桌')} title={t('和朋友一起，把这碗汤解开')}>
      <p className="my-6 font-serif text-sm leading-7 text-muted-foreground">
        {t('登录后入座，提问和讨论都会留在你们共同的案卷里。')}
      </p>
      <Link
        className="inline-flex min-h-11 items-center bg-foreground px-5 font-mono text-xs text-background"
        to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`}
      >
        {t('登录后入座')} →
      </Link>
    </PageShell>
  )
}

export function RoomLobby({
  owner,
  mode,
}: {
  owner: string | null
  mode: 'new' | 'join' | 'list'
}) {
  const { t } = useI18n()
  const params = new URLSearchParams(location.search)
  const [code, setCode] = useState(params.get('code') ?? '')
  const puzzle = params.get('puzzle') ?? ''
  const [requestId] = useState(() => crypto.randomUUID())
  const [items, setItems] = useState<RoomSummary[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [enabled, setEnabled] = useState<boolean | null>(null)
  useEffect(() => {
    let alive = true
    if (mode === 'new')
      void roomRequest<{ enabled: boolean }>('/api/rooms/config')
        .then((v) => {
          if (alive) setEnabled(v.enabled)
        })
        .catch((e) => {
          if (alive) setError(errorText(e))
        })
    if (mode === 'list' && owner) {
      void roomAPI
        .list()
        .then((v) => {
          if (alive) setItems(v.items)
        })
        .catch((e) => {
          if (alive) setError(errorText(e))
        })
    }
    return () => {
      alive = false
    }
  }, [mode, owner])
  if (!owner) return <LoginGate />
  async function enter() {
    setLoading(true)
    setError(null)
    try {
      const room =
        mode === 'new' ? await roomAPI.create(puzzle, requestId) : await roomAPI.join(code)
      navigate(`/rooms/${room.roomId}`)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setLoading(false)
    }
  }
  return (
    <PageShell
      label={t('同桌')}
      title={t(
        mode === 'list' ? '我的同桌' : mode === 'new' ? '为这碗汤，留几个座位' : '朋友留了一桌给你',
      )}
    >
      {mode === 'list' ? (
        <>
          <div className="my-6 flex flex-wrap items-center gap-4">
            <RoomEntry />
            <Link to="/library" className="font-mono text-xs text-muted-foreground">
              {t('去题库选一碗汤')} →
            </Link>
          </div>
          {items.length ? (
            <div className="border-t border-foreground/25">
              {items.map((room) => (
                <article
                  key={room.roomId}
                  className="flex items-center gap-4 border-b border-dashed border-foreground/25 py-5"
                >
                  <Link to={`/rooms/${room.roomId}`} className="min-w-0 flex-1">
                    <p className="mb-2 font-mono text-[10px] tracking-wider text-muted-foreground">
                      {t(phases[room.phase])} · {t('{turns} 轮', { turns: room.turns })}
                    </p>
                    <h2 className="font-serif text-xl">{room.title}</h2>
                  </Link>
                  <button
                    className="min-h-11 px-2 font-mono text-[11px] text-muted-foreground"
                    onClick={() => {
                      if (confirm(t('仅从我的列表隐藏，其他同桌仍能看见记录。')))
                        void roomAPI
                          .hide(room.roomId)
                          .then(() =>
                            setItems((prev) => prev.filter((r) => r.roomId !== room.roomId)),
                          )
                          .catch((e) => setError(errorText(e)))
                    }}
                  >
                    {t('隐藏')}
                  </button>
                </article>
              ))}
            </div>
          ) : (
            <Empty>{t('还没有同桌案卷。选一碗汤邀请朋友，或凭邀请码入座。')}</Empty>
          )}
        </>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void enter()
          }}
          className="mt-7 space-y-6"
        >
          <p className="max-w-lg font-serif text-sm leading-7 text-muted-foreground">
            {t('2—6 人围坐一桌。各自提问，一起讨论，由砚主持；想提前看答案，需要全体同意。')}
          </p>
          {mode === 'join' ? (
            <label className="block">
              <span className="mb-2 block font-mono text-[11px] tracking-wider">
                {t('邀请码或邀请链接')}
              </span>
              <input
                autoFocus
                className={inputClass}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                autoComplete="off"
                maxLength={512}
                placeholder="ABCD EFGH 2345"
                required
              />
            </label>
          ) : null}
          {mode === 'new' && enabled === false ? (
            <Notice>{t('同桌正在准备，暂时不能开新桌。')}</Notice>
          ) : (
            <Button
              type="submit"
              disabled={loading || (mode === 'new' && (!puzzle || enabled !== true))}
            >
              {loading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <UsersRound className="size-4" />
              )}
              {t(mode === 'new' ? '开一桌，邀请朋友' : '入座')}
            </Button>
          )}
        </form>
      )}
      {error ? (
        <div role="alert" className="mt-5">
          <Notice tone="stamp">{error}</Notice>
        </div>
      ) : null}
    </PageShell>
  )
}

export function RoomPage({ id, owner }: { id: string; owner: string | null }) {
  if (!owner)
    return (
      <main className="min-h-0 flex-1 overflow-y-auto">
        <LoginGate />
      </main>
    )
  return <ConnectedRoom key={`${owner}:${id}`} id={id} owner={owner} />
}
function ConnectedRoom({ id, owner }: { id: string; owner: string }) {
  const { t, locale } = useI18n()
  const connection = useMemo(() => new RoomConnection(owner, id), [owner, id])
  const state = useSyncExternalStore(connection.subscribe, connection.getSnapshot)
  const [chosenMode, setTab] = useState<'ask' | 'discuss' | null>(null)
  const media = useMemo(() => window.matchMedia('(min-width: 1024px)'), [])
  const desktop = useSyncExternalStore(
    (notify) => {
      media.addEventListener('change', notify)
      return () => media.removeEventListener('change', notify)
    },
    () => media.matches,
  )
  const draftKey = `soup:room-draft:v1:${owner}:${id}`
  const [drafts, setDrafts] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(draftKey) ?? '{}')
      return {
        ask: typeof saved.ask === 'string' ? saved.ask.slice(0, 600) : '',
        discuss: typeof saved.discuss === 'string' ? saved.discuss.slice(0, 600) : '',
      }
    } catch {
      return { ask: '', discuss: '' }
    }
  })
  const [reference, setReference] = useState<{ id: string; text: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [showReport, setShowReport] = useState(false)
  const [reportNote, setReportNote] = useState('')
  const [reported, setReported] = useState(false)
  const [membersOpen, setMembersOpen] = useState(false)
  const [loadingEarlier, setLoadingEarlier] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const [surfaceOpen, setSurfaceOpen] = useState(false)
  const [ledgerOpen, setLedgerOpen] = useState(false)
  const ledger = useMemo(() => buildRoomLedger(state.events), [state.events])
  const discussionScroller = useRef<HTMLDivElement>(null)
  const discussionNearBottom = useRef(true)
  const scroller = useRef<HTMLDivElement>(null)
  const nearBottom = useRef(true)
  const s = state.snapshot
  const tab = chosenMode ?? (s?.phase === 'waiting' ? 'discuss' : 'ask')
  const member = s?.members.find((m) => m.uid === owner)
  const seats = s?.members.filter((m) => m.seat === 'seated') ?? []
  const mine = s?.queue.find((q) => q.uid === owner)
  const failed = s?.failed.find((q) => q.uid === owner)
  const available = state.status === 'online' && !s?.readOnly
  const chatTotal = state.events.filter((e) => e.type === 'discussion').length
  useEffect(() => {
    // Safari resizes the visual viewport, rather than dvh, when the keyboard opens.
    const viewport = window.visualViewport
    const root = document.documentElement
    const resize = () => {
      if (!desktop && viewport?.scale === 1)
        root.style.setProperty('--room-viewport-height', `${viewport.height}px`)
      else root.style.removeProperty('--room-viewport-height')
    }
    resize()
    viewport?.addEventListener('resize', resize)
    return () => {
      viewport?.removeEventListener('resize', resize)
      root.style.removeProperty('--room-viewport-height')
    }
  }, [desktop])
  useEffect(() => {
    try {
      localStorage.setItem(draftKey, JSON.stringify(drafts))
    } catch {
      /* Pending commands have their own checked persistence. */
    }
  }, [draftKey, drafts])
  useEffect(() => {
    const cmd = state.rejected
    if (cmd?.type === 'ask' || cmd?.type === 'discuss')
      // oxlint-disable-next-line react/set-state-in-effect -- Restore a rejected server command into the local editor.
      setDrafts((prev) => ({ ...prev, [cmd.type]: prev[cmd.type] || cmd.text }))
  }, [state.rejected])
  useEffect(() => {
    connection.start()
    return () => connection.stop()
  }, [connection])
  const voteActive = Boolean(s?.vote)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), voteActive ? 1000 : 60_000)
    return () => clearInterval(timer)
  }, [voteActive])
  useEffect(() => {
    const node = scroller.current
    if (node && nearBottom.current) node.scrollTop = node.scrollHeight
    const discussion = discussionScroller.current
    if (discussion && discussionNearBottom.current) discussion.scrollTop = discussion.scrollHeight
  }, [state.events, desktop, s?.report])
  const send = (action: RoomAction) => {
    try {
      connection.send(action)
      setError(null)
      return true
    } catch (e) {
      setError(errorText(e))
      return false
    }
  }
  const leave = () => {
    if (
      confirm(t('离开后不再接收本桌新消息，共同案卷会保留；有空位时可以再次入座。')) &&
      send({ type: 'leave' })
    )
      setMembersOpen(false)
  }
  async function copyInvite() {
    if (!s?.inviteCode) return
    const url = `https://hgt.mmstudio.games/rooms/join?code=${s.inviteCode}`
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setError(t('无法复制，请长按邀请码复制'))
    }
  }
  function submit(mode: 'ask' | 'discuss') {
    if (
      !available ||
      (mode === 'ask' &&
        (s?.phase !== 'playing' ||
          mine ||
          s.processing?.uid === owner ||
          s.vote ||
          s.revealPending ||
          seats.length < 2))
    )
      return
    const text = drafts[mode].trim()
    if (!text) return
    const ok = send(
      mode === 'ask'
        ? { type: 'ask', text, locale, ...(reference ? { referenceId: reference.id } : {}) }
        : { type: 'discuss', text },
    )
    if (ok) {
      setDrafts((prev) => ({ ...prev, [mode]: '' }))
      if (mode === 'ask') setReference(null)
      if (mode === 'discuss' && desktop) discussionNearBottom.current = true
      else nearBottom.current = true
    }
  }
  const title = s?.puzzle.title ?? t('同桌')
  const statusLabel = {
    connecting: '正在连接',
    online: '实时连接',
    offline: '正在重连，记录会自动补齐',
    archive: '只读案卷',
    auth: '需要重新登录',
    removed: '已离开同桌',
    error: '暂时无法连接',
  }[state.status]

  const renderEvents = (channel: 'all' | 'ask' | 'discuss') => (
    <>
      {state.events
        .filter(
          (e) =>
            channel === 'all' ||
            (channel === 'ask' ? e.type !== 'discussion' : e.type === 'discussion'),
        )
        .map((e) =>
          e.type === 'system' ? (
            <p
              key={e.id}
              data-event-type={e.type}
              className="my-4 text-center font-mono text-[10px] leading-5 text-muted-foreground"
            >
              {e.text}
            </p>
          ) : (
            <article
              key={e.id}
              data-event-type={e.type}
              className={cn('room-event', `room-event-${e.type}`)}
            >
              <div className="mb-1.5 flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
                <span className={e.type === 'answer' ? 'text-stamp' : ''}>
                  {e.type === 'answer'
                    ? t('砚')
                    : (s?.members.find((m) => m.uid === e.actorId)?.name ?? t('汤友'))}
                </span>
                {e.type !== 'answer' && e.actorId === owner ? <span>· {t('你')}</span> : null}
                <span className="room-event-kind">
                  {t(
                    e.type === 'question'
                      ? '问砚'
                      : e.type === 'discussion'
                        ? '桌内讨论'
                        : '主持人',
                  )}
                </span>
                <time className="ml-auto tabular-nums">
                  {new Date(e.at).toLocaleTimeString(locale, {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </time>
              </div>
              {e.referenceId ? (
                <p className="mb-2 border-l border-foreground/30 pl-2 font-mono text-[10px] text-muted-foreground">
                  {t('接着这个问题')} ·{' '}
                  {state.events.find((q) => q.questionId === e.referenceId && q.type === 'question')
                    ?.text ?? t('查看更早的记录')}
                </p>
              ) : null}
              {e.type === 'answer' && roomVerdict(e.turn) ? (
                <div className="mb-2">
                  <VerdictToken verdict={roomVerdict(e.turn)!} />
                </div>
              ) : null}
              <p
                className={cn(
                  'whitespace-pre-wrap break-words font-serif text-[15px] leading-7 sm:text-base',
                  e.type === 'answer' && e.turn?.verdict === 'no' && 'text-stamp',
                )}
              >
                {e.text}
              </p>
              {e.type === 'question' && available ? (
                <button
                  className="mt-2 min-h-8 font-mono text-[10px] text-muted-foreground"
                  onClick={() => {
                    setReference({ id: e.questionId!, text: e.text })
                    setTab('ask')
                  }}
                >
                  {t('引用提问')} ↳
                </button>
              ) : null}
            </article>
          ),
        )}

      {channel === 'discuss' && chatTotal === 0 ? (
        <div className="py-10 text-center text-muted-foreground">
          <MessageSquare className="mx-auto mb-3 size-5" />
          <p className="font-serif text-sm">{t('把你的猜想说给同桌听。')}</p>
          <p className="mt-2 font-mono text-[10px]">
            {t('讨论不计轮数，砚也不会把它当成正式提问。')}
          </p>
        </div>
      ) : null}
    </>
  )
  const renderEarlier = () => (
    <>
      {state.hasEarlier ? (
        <button
          disabled={loadingEarlier}
          className="mb-5 min-h-10 w-full font-mono text-[11px] text-muted-foreground"
          onClick={() => {
            setLoadingEarlier(true)
            nearBottom.current = false
            discussionNearBottom.current = false
            void connection
              .earlier()
              .catch((e) => setError(errorText(e)))
              .finally(() => setLoadingEarlier(false))
          }}
        >
          {t(loadingEarlier ? '正在加载' : '查看更早的记录')} ↑
        </button>
      ) : null}
    </>
  )
  const renderLedger = (showHeading = true) => (
    <section
      data-room-ledger
      aria-label={t('问答记录')}
      className={showHeading ? 'mt-6 border-t border-foreground/25 pt-4' : ''}
    >
      {showHeading ? (
        <div className="mb-3 flex items-center justify-between font-mono text-[10px] text-muted-foreground">
          <h3>{t('问答记录')}</h3>
          <span>{String(ledger.length).padStart(2, '0')}</span>
        </div>
      ) : null}
      {state.hasEarlier ? (
        <p className="mb-2 font-mono text-[10px] leading-5 text-muted-foreground">
          {t('当前为已加载的问答，可加载更早的记录。')}
        </p>
      ) : null}
      {renderEarlier()}
      {error || state.error ? (
        <p role="alert" className="mb-3 font-mono text-xs text-stamp">
          {t(error || state.error!)}
        </p>
      ) : null}
      {ledger.length ? (
        <ul>
          {ledger.map((item) => (
            <li key={item.id} className="rule-dashed flex items-start gap-3 py-3 last:border-b-0">
              <VerdictToken verdict={item.verdict} />
              <div className="min-w-0">
                <p className="mb-1 font-mono text-[10px] text-muted-foreground">
                  {s?.members.find((m) => m.uid === item.actorId)?.name ?? t('汤友')}
                </p>
                <p className="whitespace-pre-wrap break-words font-serif text-sm leading-6">
                  {item.question}
                </p>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="font-serif text-sm leading-7 text-muted-foreground">
          {t('向砚提问后，判断会自动记在这里。')}
        </p>
      )}
    </section>
  )
  const renderComposer = (mode: 'ask' | 'discuss') => (
    <>
      {s && !s.readOnly ? (
        <footer className="room-composer shrink-0 border-t border-foreground/25 bg-background px-4 pt-2 pb-[max(.5rem,env(safe-area-inset-bottom))]">
          <div className="mx-auto max-w-3xl">
            {!desktop ? (
              <div className="room-send-mode" role="group" aria-label={t('发送给')}>
                {(['ask', 'discuss'] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={mode === value}
                    onClick={() => setTab(value)}
                  >
                    {t(value === 'ask' ? '问砚' : '和大家聊')}
                  </button>
                ))}
              </div>
            ) : null}
            {(!desktop || mode === 'ask') && (s.processing || mine || failed || s.revealPending) ? (
              <div
                aria-live="polite"
                className="mb-2 flex flex-wrap items-center gap-2 font-mono text-[10px] leading-5 text-muted-foreground"
              >
                {s.revealPending ? (
                  t('当前问题答完后，发起揭晓投票。')
                ) : s.processing ? (
                  <span>
                    {t('砚正在回答')} · {s.members.find((m) => m.uid === s.processing!.uid)?.name}
                  </span>
                ) : null}
                {mine ? (
                  <>
                    <span>
                      ·{' '}
                      {t('你的问题排在第 {n} 位', {
                        n: s.queue.findIndex((q) => q.id === mine.id) + 1,
                      })}
                    </span>
                    <button
                      className="px-2 underline underline-offset-4"
                      onClick={() => send({ type: 'cancel', questionId: mine.id })}
                    >
                      {t('撤回')}
                    </button>
                  </>
                ) : null}
                {failed ? (
                  <>
                    <span>{failed.error}</span>
                    <button
                      className="px-2 text-stamp underline underline-offset-4"
                      onClick={() => send({ type: 'retry', questionId: failed.id })}
                    >
                      {t('重试问题')}
                    </button>
                  </>
                ) : null}
              </div>
            ) : null}
            {reference && mode === 'ask' ? (
              <div className="mb-2 flex items-center gap-2 border-l-2 border-stamp pl-2 font-mono text-[10px] text-muted-foreground">
                <span className="truncate">{reference.text}</span>
                <button
                  className="ml-auto p-2"
                  aria-label={t('取消引用')}
                  onClick={() => setReference(null)}
                >
                  <X className="size-3" />
                </button>
              </div>
            ) : null}
            <form
              onSubmit={(e) => {
                e.preventDefault()
                submit(mode)
              }}
              className="flex items-end gap-2 border border-foreground/45 bg-card p-2 focus-within:border-foreground"
            >
              <textarea
                value={drafts[mode]}
                onChange={(e) => setDrafts((prev) => ({ ...prev, [mode]: e.target.value }))}
                rows={1}
                data-room-editor={mode}
                ref={(node) => {
                  if (node) {
                    node.style.height = 'auto'
                    node.style.height = `${Math.min(128, node.scrollHeight)}px`
                  }
                }}
                maxLength={600}
                aria-label={t(mode === 'ask' ? '向砚提问' : '桌内讨论')}
                placeholder={t(mode === 'ask' ? '把你的问题交给砚……' : '和同桌说说你的猜想……')}
                className="min-h-10 max-h-32 min-w-0 flex-1 resize-none bg-transparent px-2 py-1 font-serif text-base leading-6 outline-none placeholder:text-muted-foreground/60"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault()
                    submit(mode)
                  }
                }}
              />
              <button
                type="submit"
                aria-label={t(desktop && mode === 'discuss' ? '发送讨论' : '发送')}
                disabled={
                  !available ||
                  !drafts[mode].trim() ||
                  (mode === 'ask' &&
                    (s.phase !== 'playing' ||
                      Boolean(mine) ||
                      s.processing?.uid === owner ||
                      Boolean(s.vote) ||
                      s.revealPending ||
                      seats.length < 2))
                }
                className="flex size-10 shrink-0 items-center justify-center bg-foreground text-background disabled:opacity-25"
              >
                <ArrowUp className="size-5" />
              </button>
            </form>
            <div className="mt-1 flex min-h-7 items-center justify-between gap-3 font-mono text-[10px] text-muted-foreground">
              <span>
                {state.pending > 0
                  ? t('等待服务器确认')
                  : t(
                      mode === 'ask'
                        ? s.phase === 'waiting'
                          ? '开汤后，就可以向砚提问'
                          : '正式提问按顺序回答'
                        : '讨论仅在这一桌可见',
                    )}
              </span>
              {mode === 'ask' && s.phase === 'playing' ? (
                <button
                  disabled={
                    !available ||
                    !!s.vote ||
                    s.revealPending ||
                    s.puzzle.dailyDate === new Date(now).toISOString().slice(0, 10)
                  }
                  className="py-1 disabled:opacity-35"
                  onClick={() => send({ type: 'reveal' })}
                >
                  {t('提议揭晓')}
                </button>
              ) : null}
            </div>
          </div>
        </footer>
      ) : null}
    </>
  )
  return (
    <main
      className="room-screen flex min-h-0 flex-1 flex-col"
      data-layout={desktop ? 'workbench' : 'conversation'}
    >
      <header className="room-header shrink-0 border-b border-foreground/25 px-4 py-2">
        <Link to="/me/rooms" aria-label={t('我的同桌')} className="room-icon-button">
          <ArrowLeft className="size-4" />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-serif text-base sm:text-lg">{title}</h1>
          <p className="mt-1 flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
            <span
              className={cn(
                'size-1.5 rounded-full',
                available ? 'bg-[var(--v-yes)]' : 'bg-muted-foreground/40',
              )}
            />
            {s ? t(phases[s.phase]) : t(statusLabel)}
            {s ? ` · ${t('{turns} 轮', { turns: s.turns })}` : ''}
          </p>
        </div>
        <button
          onClick={() => setMembersOpen(true)}
          aria-label={t('同桌成员')}
          className="flex min-h-11 items-center gap-2 px-1 font-mono text-xs"
        >
          <UsersRound className="size-4" />
          {seats.length}/6
        </button>
        {s && !s.readOnly ? (
          <button
            onClick={leave}
            disabled={!available}
            aria-label={t('离开同桌')}
            className="min-h-11 px-2 font-mono text-xs text-muted-foreground disabled:opacity-40"
          >
            {t('离开')}
          </button>
        ) : null}
      </header>
      {!desktop && s ? (
        <div className="room-tools">
          <button
            className="room-surface-peek min-w-0 flex-1"
            onClick={() => setSurfaceOpen(true)}
            aria-label={t('查看汤面')}
          >
            <span className="shrink-0 font-mono text-[10px] text-stamp">{t('汤面')}</span>
            <span className="truncate text-xs text-muted-foreground">{s.puzzle.surface}</span>
            <ChevronRight className="size-3.5 shrink-0" />
          </button>
          <button
            className="shrink-0 px-4 font-mono text-[11px]"
            onClick={() => setLedgerOpen(true)}
          >
            {t('问答记录')}
          </button>
        </div>
      ) : null}
      {ledgerOpen ? (
        <RoomDialog title={t('问答记录')} onClose={() => setLedgerOpen(false)}>
          {renderLedger(false)}
        </RoomDialog>
      ) : null}
      {state.status === 'auth' ? (
        <div className="p-5">
          <Notice>
            <Link to={`/login?next=${encodeURIComponent(`/rooms/${id}`)}`}>
              {t('登录后继续')} →
            </Link>
          </Notice>
        </div>
      ) : null}
      {state.status === 'offline' || state.status === 'connecting' ? (
        <p
          role="status"
          className="flex items-center gap-2 border-b border-foreground/15 px-5 py-2 font-mono text-[10px] text-muted-foreground"
        >
          <Loader2 className="size-3 animate-spin" />
          {t(statusLabel)}
        </p>
      ) : null}
      {state.status === 'archive' ? (
        <div
          role="status"
          className="flex items-center justify-between border-b border-foreground/15 px-5 py-2 font-mono text-[10px] text-muted-foreground"
        >
          <span>{t(member?.seat === 'left' ? '已离开同桌' : '共同案卷已保存')}</span>
          {s?.phase === 'waiting' || s?.phase === 'playing' ? (
            <button onClick={connection.refresh} className="min-h-9 px-2">
              {t('刷新记录')}
            </button>
          ) : null}
        </div>
      ) : null}

      {membersOpen && s ? (
        <RoomDialog title={t('同桌成员')} onClose={() => setMembersOpen(false)}>
          <div className="mx-auto max-w-5xl">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {s.members
                .filter((m) => m.seat === 'seated')
                .map((m) => (
                  <div
                    key={m.uid}
                    className="flex min-w-0 items-center gap-3 border-b border-foreground/15 py-2"
                  >
                    <span
                      className={cn(
                        'size-1.5 shrink-0 rounded-full',
                        m.disconnectedAt === null ? 'bg-[var(--v-yes)]' : 'bg-muted-foreground/40',
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-serif text-sm">
                        {m.name}
                        {m.uid === owner ? ` · ${t('你')}` : ''}
                      </p>
                      <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                        {t(
                          m.uid === s.hostId
                            ? '房主'
                            : m.disconnectedAt === null
                              ? '在座'
                              : '暂时离线',
                        )}{' '}
                        · {t('{turns} 轮', { turns: m.questions })}
                      </p>
                    </div>
                    {s.hostId === owner && m.uid !== owner && available ? (
                      <details className="font-mono text-[10px]">
                        <summary className="cursor-pointer py-2">{t('管理')}</summary>
                        <button
                          className="block py-2"
                          onClick={() => {
                            if (confirm(t('把房主交给这位汤友？')))
                              send({ type: 'transfer', uid: m.uid })
                          }}
                        >
                          {t('转交房主')}
                        </button>
                        <button
                          className="block py-2 text-stamp"
                          onClick={() => {
                            if (confirm(t('移出后，这位汤友不能重新进入这一桌。')))
                              send({ type: 'kick', uid: m.uid })
                          }}
                        >
                          {t('移出同桌')}
                        </button>
                      </details>
                    ) : null}
                  </div>
                ))}
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
              {s.inviteCode ? (
                <>
                  <span className="select-all font-mono text-xs tracking-widest">
                    {s.inviteCode.match(/.{1,4}/g)?.join(' ')}
                  </span>
                  <Button variant="ghost" size="sm" onClick={() => void copyInvite()}>
                    {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                    {t(copied ? '已复制' : '复制邀请')}
                  </Button>
                </>
              ) : null}
              {available && s.hostId === owner ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => send({ type: 'invitations', open: !s.invitationsOpen })}
                >
                  {t(s.invitationsOpen ? '停止新成员入座' : '开放新成员入座')}
                </Button>
              ) : null}
              {available ? (
                <Button variant="ghost" size="sm" onClick={leave}>
                  {t('离开同桌')}
                </Button>
              ) : null}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setMembersOpen(false)
                  setShowReport(true)
                }}
              >
                <Flag className="size-4" /> {t('反馈')}
              </Button>
            </div>
          </div>
        </RoomDialog>
      ) : null}

      {surfaceOpen && s ? (
        <RoomDialog title={t('汤面')} onClose={() => setSurfaceOpen(false)}>
          <h2 className="mb-5 font-serif text-2xl">{s.puzzle.title}</h2>
          <p className="whitespace-pre-wrap font-serif text-base leading-8">{s.puzzle.surface}</p>
        </RoomDialog>
      ) : null}
      {s?.vote ? (
        <section aria-live="polite" className="shrink-0 border-b border-stamp/35 bg-card px-5 py-3">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-5 gap-y-2">
            <div className="flex-1">
              <p className="font-serif text-sm">{t('这碗汤，一起揭晓吗？')}</p>
              <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                {t('需全员同意')} · {s.vote.agreed.length}/{s.vote.members.length} ·{' '}
                {Math.max(0, Math.ceil((s.vote.expiresAt - now) / 1000))}s
              </p>
            </div>
            {available && s.vote.members.includes(owner) ? (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => send({ type: 'vote', voteId: s.vote!.id, agree: false })}
                >
                  {t('继续推理')}
                </Button>
                <Button
                  size="sm"
                  disabled={s.vote.agreed.includes(owner)}
                  onClick={() => send({ type: 'vote', voteId: s.vote!.id, agree: true })}
                >
                  {t(s.vote.agreed.includes(owner) ? '已同意' : '同意揭晓')}
                </Button>
              </>
            ) : null}
          </div>
        </section>
      ) : null}

      <div className="room-workspace">
        {desktop && s ? (
          <aside className="room-case-rail" aria-label={t('案卷')}>
            <p className="font-mono text-[10px] tracking-widest text-stamp">{t('案卷')}</p>
            <h2 className="mt-3 font-serif text-xl leading-relaxed">{s.puzzle.title}</h2>
            <p className="mt-4 line-clamp-6 font-serif text-sm leading-7 text-muted-foreground">
              {s.puzzle.surface}
            </p>
            <button
              className="mt-2 min-h-11 font-mono text-xs underline underline-offset-4"
              onClick={() => setSurfaceOpen(true)}
            >
              {t('查看汤面')} ↗
            </button>
            <div className="mt-6 flex items-center justify-between border-t border-foreground/25 pt-4">
              <span className="font-mono text-[10px] text-muted-foreground">
                {t('在座成员')} · {seats.length}/6
              </span>
              <button
                className="min-h-10 font-mono text-[10px]"
                onClick={() => setMembersOpen(true)}
              >
                {t('管理')}
              </button>
            </div>
            {seats.map((m) => (
              <div key={m.uid} className="flex items-center gap-2 py-2">
                <span className="flex size-7 items-center justify-center bg-foreground/5 font-serif text-sm">
                  {m.name.slice(0, 1)}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs">{m.name}</span>
                <span
                  className={cn(
                    'size-1.5 rounded-full',
                    m.disconnectedAt === null ? 'bg-[var(--v-yes)]' : 'bg-muted-foreground/40',
                  )}
                />
              </div>
            ))}
            {s.inviteCode ? (
              <button
                className="mt-4 flex min-h-11 items-center gap-2 font-mono text-xs"
                onClick={() => void copyInvite()}
              >
                <Copy className="size-3.5" />
                {t(copied ? '已复制' : '复制邀请')}
              </button>
            ) : null}
            {renderLedger()}
          </aside>
        ) : null}
        <section className="room-main-column" aria-label={t(desktop ? '问砚' : '同桌记录')}>
          {desktop ? (
            <div className="room-column-title">
              <h2>{t('问砚')}</h2>
              <span>{t('正式提问按顺序回答')}</span>
            </div>
          ) : null}
          <div
            ref={scroller}
            onScroll={() => {
              const n = scroller.current
              if (n) nearBottom.current = n.scrollHeight - n.scrollTop - n.clientHeight < 90
            }}
            className="room-timeline chat-scroll"
            data-testid="room-timeline"
          >
            <div className="mx-auto w-full max-w-3xl">
              {s?.phase === 'waiting' ? (
                <div className="room-waiting mb-4 border border-foreground/25 bg-card p-4">
                  <p className="font-mono text-[10px] tracking-[.2em] text-stamp">
                    {t('入座后就开汤')}
                  </p>
                  <h2 className="mt-1 font-serif text-lg">{t('空着的座位，留给朋友')}</h2>
                  <div className="my-3 grid grid-cols-6 gap-2">
                    {Array.from({ length: 6 }, (_, i) => {
                      const m = seats[i]
                      return (
                        <div
                          key={i}
                          className={cn(
                            'flex min-w-0 flex-col items-center border-b-2 pb-2',
                            m ? 'border-foreground/60' : 'border-dashed border-foreground/15',
                          )}
                        >
                          <span
                            className={cn(
                              'mb-2 flex size-8 items-center justify-center font-serif text-sm',
                              m ? 'bg-foreground text-background' : 'text-muted-foreground/35',
                            )}
                          >
                            {m ? m.name.slice(0, 1) : '＋'}
                          </span>
                          <span className="max-w-full truncate font-mono text-[9px] text-muted-foreground">
                            {m?.name ?? t('空位')}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                  <p className="mb-3 font-mono text-[10px] leading-5 text-muted-foreground">
                    {t('把邀请发给朋友。至少两人在线，房主就可以开始。')}
                  </p>
                  <div className="flex flex-wrap items-center gap-3">
                    <Button size="sm" variant="outline" onClick={() => void copyInvite()}>
                      <Copy className="size-3.5" />
                      {t(copied ? '已复制' : '复制邀请')}
                    </Button>
                    {s.hostId === owner ? (
                      <Button
                        size="sm"
                        disabled={
                          !available || seats.filter((m) => m.disconnectedAt === null).length < 2
                        }
                        onClick={() => send({ type: 'start' })}
                      >
                        {t('开始同桌')}
                      </Button>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {renderEarlier()}
              {renderEvents(desktop ? 'ask' : 'all')}
              {s?.report ? <RoomReportView snapshot={s} /> : null}
            </div>
          </div>
          {error || state.error ? (
            <div
              role="alert"
              className="flex shrink-0 items-center gap-3 border-t border-stamp/20 bg-card px-5 py-2 font-mono text-[11px] text-stamp"
            >
              <p className="flex-1">{error ?? state.error}</p>
              <button
                aria-label={t('关闭')}
                className="p-2"
                onClick={() => {
                  setError(null)
                  connection.clearError()
                }}
              >
                <X className="size-3.5" />
              </button>
            </div>
          ) : null}
          {showReport ? (
            <RoomDialog title={t('反馈')} onClose={() => setShowReport(false)}>
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  void roomAPI
                    .report(id, reportNote)
                    .then(() => {
                      setReported(true)
                      setShowReport(false)
                      setReportNote('')
                    })
                    .catch((e) => setError(errorText(e)))
                }}
                className="shrink-0 border-t border-foreground/20 p-4"
              >
                <label className="mb-2 block font-mono text-[11px]">
                  {t('这桌遇到了什么问题？')}
                </label>
                <div className="flex gap-2">
                  <input
                    className={inputClass}
                    value={reportNote}
                    maxLength={1000}
                    onChange={(e) => setReportNote(e.target.value)}
                    required
                  />
                  <Button type="submit">{t('提交反馈')}</Button>
                </div>
              </form>
            </RoomDialog>
          ) : null}
          {reported ? (
            <p
              role="status"
              className="shrink-0 px-5 py-2 font-mono text-[10px] text-[var(--v-yes)]"
            >
              {t('反馈已收到，谢谢。')}
            </p>
          ) : null}

          {renderComposer(desktop ? 'ask' : tab)}
          {member?.seat === 'left' &&
          s?.inviteCode &&
          (s.phase === 'waiting' || s.phase === 'playing') ? (
            <div className="shrink-0 border-t border-foreground/25 p-4 text-center">
              <Button
                onClick={() =>
                  void roomAPI
                    .join(s.inviteCode!)
                    .then(() => {
                      connection.refresh()
                    })
                    .catch((e) => setError(errorText(e)))
                }
              >
                {t('再次入座')}
              </Button>
            </div>
          ) : null}
        </section>
        {desktop ? (
          <aside className="room-discussion-column" aria-label={t('桌内讨论')}>
            <div className="room-column-title">
              <h2>{t('桌内讨论')}</h2>
              <MessageSquare className="size-3.5 text-muted-foreground" />
            </div>
            <div
              ref={discussionScroller}
              onScroll={() => {
                const n = discussionScroller.current
                if (n)
                  discussionNearBottom.current = n.scrollHeight - n.scrollTop - n.clientHeight < 90
              }}
              className="room-timeline chat-scroll"
            >
              {renderEarlier()}
              {renderEvents('discuss')}
            </div>
            {renderComposer('discuss')}
          </aside>
        ) : null}
      </div>
    </main>
  )
}

function RoomReportView({ snapshot: s }: { snapshot: RoomSnapshot }) {
  const { t } = useI18n()
  if (!s.report) return null
  return (
    <section className="mt-8 border-t-2 border-foreground pt-6 pb-8">
      <p className="font-mono text-[10px] tracking-[.2em] text-stamp">{t('共同结案报告')}</p>
      <h2 className="mt-3 font-serif text-2xl">{t(phases[s.report.outcome])}</h2>
      <p className="mt-3 font-mono text-[11px] text-muted-foreground">
        {t('{turns} 轮', { turns: s.report.turns })} ·{' '}
        {s.members
          .filter((m) => m.seat !== 'removed')
          .map((m) => m.name)
          .join('、')}
      </p>
      {s.report.truth ? (
        <>
          <h3 className="mt-6 font-mono text-[11px] tracking-wider text-muted-foreground">
            {t('汤底')}
          </h3>
          <p className="mt-3 whitespace-pre-wrap font-serif text-[15px] leading-8">
            {s.report.truth}
          </p>
        </>
      ) : null}
      {s.report.story ? (
        <>
          <h3 className="mt-6 font-mono text-[11px] tracking-wider text-muted-foreground">
            {t('完整背景故事')}
          </h3>
          <p className="mt-3 whitespace-pre-wrap font-serif text-[15px] leading-8">
            {s.report.story}
          </p>
        </>
      ) : null}
      <p className="mt-6 font-mono text-[10px] leading-5 text-muted-foreground">
        {t(
          s.report.authorParticipated
            ? '作者参与过这一桌，不计入同桌轮数纪录。'
            : '同桌轮数单独记录，不影响单人纪录。',
        )}
      </p>
      <div className="mt-5 flex gap-4">
        <Link to="/me/rooms" className="font-mono text-xs underline underline-offset-4">
          {t('我的同桌')}
        </Link>
        <Link to={`/library/${s.puzzle.id}`} className="font-mono text-xs text-muted-foreground">
          {t('查看案卷')} →
        </Link>
      </div>
    </section>
  )
}

function RoomDialog({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: ReactNode
}) {
  const { t } = useI18n()
  const ref = useRef<HTMLDialogElement>(null)
  const label = useId()
  useEffect(() => {
    const dialog = ref.current
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialog?.showModal()
    return () => {
      dialog?.close()
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
    }
  }, [])
  return (
    <dialog
      ref={ref}
      aria-labelledby={label}
      className="room-dialog"
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="room-dialog-body">
        <header className="mb-5 flex items-center justify-between gap-4 border-b border-foreground/25 pb-3">
          <h2 id={label} className="font-mono text-xs tracking-widest">
            {title}
          </h2>
          <button className="room-icon-button" onClick={onClose} aria-label={t('关闭')}>
            <X className="size-4" />
          </button>
        </header>
        {children}
      </div>
    </dialog>
  )
}
