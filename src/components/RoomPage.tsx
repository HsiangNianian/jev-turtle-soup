import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import {
  ArrowLeft,
  ArrowUp,
  Check,
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
  const [tab, setTab] = useState<'ask' | 'discuss'>('ask')
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
  const [chatSeen, setChatSeen] = useState(0)
  const scroller = useRef<HTMLDivElement>(null)
  const nearBottom = useRef(true)
  const s = state.snapshot
  const member = s?.members.find((m) => m.uid === owner)
  const seats = s?.members.filter((m) => m.seat === 'seated') ?? []
  const mine = s?.queue.find((q) => q.uid === owner)
  const failed = s?.failed.find((q) => q.uid === owner)
  const available = state.status === 'online' && !s?.readOnly
  const chatTotal = state.events.filter((e) => e.type === 'discussion').length
  const chatUnread = Math.max(0, chatTotal - chatSeen)
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
  }, [state.events, tab, s?.report])
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
  function submit() {
    const text = drafts[tab].trim()
    if (!text) return
    const ok = send(
      tab === 'ask'
        ? { type: 'ask', text, locale, ...(reference ? { referenceId: reference.id } : {}) }
        : { type: 'discuss', text },
    )
    if (ok) {
      setDrafts((prev) => ({ ...prev, [tab]: '' }))
      setReference(null)
      nearBottom.current = true
    }
  }
  const title = s?.puzzle.title ?? t('同桌')
  const statusLabel = {
    connecting: '正在连接',
    online: '实时连接',
    offline: '正在重连，记录会自动补齐',
    auth: '需要重新登录',
    removed: '已离开同桌',
    error: '暂时无法连接',
  }[state.status]
  return (
    <main className="room-screen flex min-h-0 flex-1 flex-col">
      <header className="shrink-0 border-b border-foreground/30 px-4 py-3 sm:px-6">
        <div className="mx-auto flex max-w-5xl items-center gap-3">
          <Link
            to="/me/rooms"
            className="-ml-2 flex size-10 shrink-0 items-center justify-center"
            aria-label={t('我的同桌')}
          >
            <ArrowLeft className="size-4" />
          </Link>
          <div className="min-w-0 flex-1">
            <p className="mb-1 font-mono text-[10px] tracking-wider text-muted-foreground">
              {t('同桌')} · {s ? t(phases[s.phase]) : t(statusLabel)}
              {s ? ` · ${t('{turns} 轮', { turns: s.turns })}` : ''}
            </p>
            <h1 className="truncate font-serif text-lg sm:text-xl">{title}</h1>
          </div>
          <button
            onClick={() => setMembersOpen(!membersOpen)}
            aria-expanded={membersOpen}
            className="flex min-h-10 items-center gap-1.5 px-2 font-mono text-xs"
          >
            <UsersRound className="size-4" />
            {seats.length}/6
          </button>
        </div>
        {s ? (
          <details
            className="mx-auto max-w-5xl pl-11"
            open={s.phase === 'waiting' ? true : undefined}
          >
            <summary className="cursor-pointer py-1 font-mono text-[10px] text-muted-foreground">
              {t('汤面')}
            </summary>
            <p className="max-h-44 overflow-auto pt-2 pb-3 font-serif text-sm leading-7">
              {s.puzzle.surface}
            </p>
          </details>
        ) : null}
      </header>
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
      {membersOpen && s ? (
        <section className="max-h-[45dvh] shrink-0 overflow-y-auto border-b border-foreground/30 bg-card px-5 py-4">
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
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    if (confirm(t('离座后保留共同案卷；有空位时可以再次入座。')))
                      send({ type: 'leave' })
                  }}
                >
                  {t('离座')}
                </Button>
              ) : null}
            </div>
          </div>
        </section>
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
      <div
        className="mx-auto flex w-full max-w-3xl shrink-0 items-center border-b border-foreground/20 px-4 sm:px-0"
        role="tablist"
        aria-label={t('同桌记录')}
      >
        {(['ask', 'discuss'] as const).map((value) => (
          <button
            role="tab"
            aria-selected={tab === value}
            key={value}
            onClick={() => {
              setTab(value)
              nearBottom.current = true
              if (value === 'discuss') setChatSeen(chatTotal)
            }}
            className={cn(
              'relative min-h-11 px-3 font-mono text-[11px] tracking-wider',
              tab === value
                ? 'text-foreground after:absolute after:right-3 after:bottom-0 after:left-3 after:h-0.5 after:bg-stamp'
                : 'text-muted-foreground',
            )}
          >
            {t(value === 'ask' ? '问砚' : '桌内讨论')}
            {value === 'discuss' && tab !== 'discuss' && chatUnread > 0 ? (
              <span className="ml-1.5 text-stamp">{chatUnread}</span>
            ) : null}
          </button>
        ))}
        <button
          onClick={() => setShowReport(!showReport)}
          className="ml-auto flex min-h-11 items-center px-2 text-muted-foreground"
          aria-label={t('反馈')}
        >
          <Flag className="size-3.5" />
        </button>
      </div>
      <div
        ref={scroller}
        onScroll={() => {
          const n = scroller.current
          if (n) nearBottom.current = n.scrollHeight - n.scrollTop - n.clientHeight < 90
        }}
        className="chat-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 sm:px-8"
      >
        <div className="mx-auto max-w-3xl py-5">
          {s?.phase === 'waiting' ? (
            <div className="mb-6 border border-foreground/30 bg-card px-5 py-6 sm:px-7">
              <p className="font-mono text-[10px] tracking-[.2em] text-stamp">
                {t('入座后就开汤')}
              </p>
              <h2 className="mt-3 font-serif text-2xl">{t('空着的座位，留给朋友')}</h2>
              <div className="my-6 grid grid-cols-6 gap-2">
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
              <p className="mb-4 font-serif text-sm leading-7 text-muted-foreground">
                {t('把邀请发给朋友。至少两人在线，房主就可以开始。')}
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="outline" onClick={() => void copyInvite()}>
                  <Copy className="size-3.5" />
                  {t(copied ? '已复制' : '复制邀请')}
                </Button>
                {s.hostId === owner ? (
                  <Button
                    disabled={
                      !available || seats.filter((m) => m.disconnectedAt === null).length < 2
                    }
                    onClick={() => send({ type: 'start' })}
                  >
                    {t('开始同桌')}
                  </Button>
                ) : null}
              </div>
              <p className="mt-4 select-all font-mono text-xs tracking-widest text-muted-foreground">
                {s.inviteCode?.match(/.{1,4}/g)?.join(' ')}
              </p>
            </div>
          ) : null}
          {state.hasEarlier ? (
            <button
              disabled={loadingEarlier}
              className="mb-5 min-h-10 w-full font-mono text-[11px] text-muted-foreground"
              onClick={() => {
                setLoadingEarlier(true)
                nearBottom.current = false
                void connection
                  .earlier()
                  .catch((e) => setError(errorText(e)))
                  .finally(() => setLoadingEarlier(false))
              }}
            >
              {t(loadingEarlier ? '正在加载' : '查看更早的记录')} ↑
            </button>
          ) : null}
          {state.events
            .filter(
              (e) =>
                e.type === 'system' ||
                (tab === 'ask' ? e.type !== 'discussion' : e.type === 'discussion'),
            )
            .map((e) =>
              e.type === 'system' ? (
                <p
                  key={e.id}
                  className="my-4 text-center font-mono text-[10px] leading-5 text-muted-foreground"
                >
                  {e.text}
                </p>
              ) : (
                <article
                  key={e.id}
                  className={cn(
                    'border-b border-dashed border-foreground/20 py-5',
                    e.type === 'answer' && 'pl-5',
                  )}
                >
                  <div className="mb-2 flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
                    <span className={e.type === 'answer' ? 'text-stamp' : ''}>
                      {e.type === 'answer'
                        ? t('砚')
                        : (s?.members.find((m) => m.uid === e.actorId)?.name ?? t('汤友'))}
                    </span>
                    {e.type !== 'answer' && e.actorId === owner ? <span>· {t('你')}</span> : null}
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
                      {state.events.find(
                        (q) => q.questionId === e.referenceId && q.type === 'question',
                      )?.text ?? t('查看更早的记录')}
                    </p>
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
          {tab === 'discuss' && chatTotal === 0 ? (
            <div className="py-10 text-center text-muted-foreground">
              <MessageSquare className="mx-auto mb-3 size-5" />
              <p className="font-serif text-sm">{t('把你的猜想说给同桌听。')}</p>
              <p className="mt-2 font-mono text-[10px]">
                {t('讨论不计轮数，砚也不会把它当成正式提问。')}
              </p>
            </div>
          ) : null}
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
          <label className="mb-2 block font-mono text-[11px]">{t('这桌遇到了什么问题？')}</label>
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
      ) : null}
      {reported ? (
        <p role="status" className="shrink-0 px-5 py-2 font-mono text-[10px] text-[var(--v-yes)]">
          {t('反馈已收到，谢谢。')}
        </p>
      ) : null}
      {s && !s.readOnly ? (
        <footer className="shrink-0 border-t border-foreground/30 bg-background px-4 pt-3 pb-[max(.75rem,env(safe-area-inset-bottom))] sm:px-6">
          <div className="mx-auto max-w-3xl">
            {s.processing || mine || failed || s.revealPending ? (
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
            {reference && tab === 'ask' ? (
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
                submit()
              }}
              className="flex items-end gap-2 border border-foreground/45 bg-card p-2 focus-within:border-foreground"
            >
              <textarea
                value={drafts[tab]}
                onChange={(e) => setDrafts((prev) => ({ ...prev, [tab]: e.target.value }))}
                rows={2}
                maxLength={600}
                aria-label={t(tab === 'ask' ? '向砚提问' : '桌内讨论')}
                placeholder={t(tab === 'ask' ? '把你的问题交给砚……' : '和同桌说说你的猜想……')}
                className="min-h-12 min-w-0 flex-1 resize-none bg-transparent px-2 py-1 font-serif text-base leading-6 outline-none placeholder:text-muted-foreground/60"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault()
                    submit()
                  }
                }}
              />
              <button
                type="submit"
                aria-label={t('发送')}
                disabled={
                  !available ||
                  !drafts[tab].trim() ||
                  (tab === 'ask' &&
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
                  : t(tab === 'ask' ? '正式提问按顺序回答' : '讨论仅在这一桌可见')}
              </span>
              {s.phase === 'playing' ? (
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
      ) : member?.seat === 'left' && s?.inviteCode ? (
        <div className="shrink-0 border-t border-foreground/25 p-4 text-center">
          <Button
            onClick={() =>
              void roomAPI
                .join(s.inviteCode!)
                .then(() => {
                  connection.stop()
                  location.reload()
                })
                .catch((e) => setError(errorText(e)))
            }
          >
            {t('再次入座')}
          </Button>
        </div>
      ) : null}
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
