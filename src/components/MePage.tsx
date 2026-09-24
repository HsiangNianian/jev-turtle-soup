import { useEffect, useState } from 'react'
import { Loader2, Plus, Trash2 } from 'lucide-react'

import { Badges, Button, Empty, Notice, PageShell } from '@/components/Bits'
import { navigate } from '@/lib/router'
import { Link } from '@/components/Link'
import {
  deletePuzzle,
  fetchAuthorActivity,
  listMyPuzzles,
  markActivitySeen,
  updatePuzzle,
  type AuthorEvent,
  type AuthorSummary,
  type OwnPuzzle,
  type Recognition,
} from '@/lib/library-client'
import { formatWhen } from '@/lib/archive'
import { cn } from '@/lib/utils'
import { useI18n } from '@/lib/i18n'

function solveRate(puzzle: OwnPuzzle): number {
  if (!puzzle.plays) return 0
  return Math.round((puzzle.solves / puzzle.plays) * 100)
}

/** 动态流的一行：把事件翻成一句人话。 */
function describe(
  event: AuthorEvent,
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  if (event.target === 'profile') {
    return event.kind === 'comment'
      ? t('{actor} 在你的主页留言：{body}', { actor: event.actor || '匿名', body: event.body })
      : t('有人赞了你的主页')
  }
  if (event.kind === 'play') return t('有人开始挑战《{title}》', { title: event.puzzleTitle })
  if (event.kind === 'solve') return t('有人解开了《{title}》', { title: event.puzzleTitle })
  if (event.kind === 'like') return t('有人赞了《{title}》', { title: event.puzzleTitle })
  return t('{actor} 在《{title}》留言：{body}', {
    actor: event.actor || '匿名',
    title: event.puzzleTitle,
    body: event.body,
  })
}

function StatCell({
  label,
  value,
  className,
}: {
  label: string
  value: string | number
  className?: string
}) {
  return (
    <div className={cn('border border-foreground/20 px-4 py-3', className)}>
      <div className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground">{label}</div>
      <div className="mt-1.5 font-serif text-2xl leading-none tabular-nums">{value}</div>
    </div>
  )
}

function PuzzleStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-0 px-2 first:pl-0 last:pr-0 sm:px-4">
      <div className="font-serif text-xl leading-none tabular-nums">{value}</div>
      <div className="mt-1.5 font-mono text-[10px] leading-4 text-muted-foreground">{label}</div>
    </div>
  )
}

export function MePage({
  handle,
  isAdmin = false,
  onSeen,
  onLogout,
}: {
  handle: string
  isAdmin?: boolean
  /** 进到这一页就算把动态看过了：清掉页头红点 */
  onSeen?: () => void
  onLogout: () => void
}) {
  const { t } = useI18n()
  const [items, setItems] = useState<OwnPuzzle[] | null>(null)
  const [summary, setSummary] = useState<AuthorSummary | null>(null)
  const [recognition, setRecognition] = useState<Recognition | null>(null)
  const [activity, setActivity] = useState<AuthorEvent[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  useEffect(() => {
    listMyPuzzles()
      .then((data) => {
        setItems(data.items)
        setSummary(data.summary)
        setRecognition(data.recognition)
      })
      .catch((caught: unknown) =>
        setError(caught instanceof Error ? caught.message : t('加载失败')),
      )
    // 动态流是次要信息，失败就当空的，不打断看板
    fetchAuthorActivity()
      .then(setActivity)
      .catch(() => setActivity([]))
    // 打开这一页就算看过动态了
    markActivitySeen()
      .then(() => onSeen?.())
      .catch(() => undefined)
  }, [t, onSeen])

  async function toggle(puzzle: OwnPuzzle) {
    setBusyId(puzzle.id)
    try {
      const visibility = puzzle.visibility === 'public' ? 'private' : 'public'
      await updatePuzzle(puzzle.id, { visibility })
      setItems((prev) =>
        (prev ?? []).map((item) => (item.id === puzzle.id ? { ...item, visibility } : item)),
      )
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('修改失败'))
    } finally {
      setBusyId(null)
    }
  }

  async function remove(puzzle: OwnPuzzle) {
    if (!window.confirm(t('删除《{title}》？删除后无法恢复。', { title: puzzle.title }))) return
    setBusyId(puzzle.id)
    try {
      await deletePuzzle(puzzle.id)
      setItems((prev) => (prev ?? []).filter((item) => item.id !== puzzle.id))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('删除失败'))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <PageShell
      label={t('我的题库')}
      title={t('我的海龟汤')}
      meta={
        <Link
          to={`/u/${handle}`}
          className="font-mono text-[10px] tracking-[0.16em] text-muted-foreground transition-colors hover:text-foreground"
        >
          {t('查看我的主页 →')}
        </Link>
      }
    >
      <div className="mt-6 grid grid-cols-1 gap-2 min-[360px]:grid-cols-2 sm:flex sm:flex-wrap sm:items-center sm:gap-3">
        <Button className="min-h-10 px-3 sm:min-h-0 sm:px-5" onClick={() => navigate('/upload')}>
          <Plus className="size-3.5" /> {t('上传新汤')}
        </Button>
        <Button
          variant="outline"
          className="min-h-10 px-3 sm:min-h-0 sm:px-5"
          onClick={() => navigate('/me/profile')}
        >
          {t('编辑资料')}
        </Button>
        {isAdmin ? (
          <Button
            variant="outline"
            className="min-h-10 px-3 min-[360px]:col-span-2 sm:min-h-0 sm:px-5"
            onClick={() => navigate('/admin')}
          >
            {t('管理后台')}
          </Button>
        ) : null}
        <Button
          variant="ghost"
          className="min-h-10 justify-self-end min-[360px]:col-span-2 sm:min-h-0"
          onClick={onLogout}
        >
          {t('退出')}
        </Button>
      </div>

      {summary && summary.total ? (
        <div className="mt-7 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <StatCell label={t('公开的汤')} value={summary.public} />
          <StatCell label={t('累计问过')} value={summary.plays} />
          <StatCell label={t('累计解开')} value={summary.solves} />
          <StatCell label={t('主动揭晓')} value={summary.reveals} />
          <StatCell
            label={t('本周问过')}
            value={summary.playsThisWeek}
            className="col-span-2 sm:col-span-1"
          />
        </div>
      ) : null}

      {summary && summary.total ? (
        <p className="mt-3 font-serif text-[12px] text-muted-foreground">
          {t('主动揭晓从本次更新开始记录；每碗汤按独立玩家计数，推理通关和自动读取汤底不算。')}
        </p>
      ) : null}

      {recognition && recognition.badges.length ? (
        <div className="mt-5">
          <div className="font-mono text-[10px] tracking-[0.24em] text-muted-foreground">
            {t('成就')}
          </div>
          <Badges badges={recognition.badges} className="mt-2" />
        </div>
      ) : null}

      {error ? (
        <div className="mt-6">
          <Notice tone="stamp">{error}</Notice>
        </div>
      ) : null}

      {!items && !error ? (
        <div className="mt-12 flex justify-center text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
        </div>
      ) : null}
      {items && !items.length ? <Empty>{t('还没有上传过。点「上传新汤」写一个吧。')}</Empty> : null}

      {items?.length ? (
        <ul className="mt-7 border-t border-foreground/20">
          {items.map((puzzle) => (
            <li key={puzzle.id} className="rule-dashed py-5 sm:py-6">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <h2 className="break-words font-serif text-lg leading-7">{puzzle.title}</h2>
                  <p className="mt-1 line-clamp-2 break-words font-serif text-[13px] leading-6 text-muted-foreground">
                    {puzzle.surface}
                  </p>
                </div>
                <span
                  className={cn(
                    'mt-0.5 shrink-0 border px-2 py-1 font-mono text-[10px] font-bold tracking-[0.14em]',
                    puzzle.visibility === 'public'
                      ? 'border-[var(--v-yes)] text-[var(--v-yes)]'
                      : 'border-foreground/30 text-muted-foreground',
                  )}
                >
                  {puzzle.visibility === 'public' ? t('公开') : t('私密')}
                </span>
              </div>

              <div className="mt-4 grid grid-cols-3 divide-x divide-foreground/15 border-y border-foreground/15 py-3">
                <PuzzleStat label={t('累计问过')} value={puzzle.plays} />
                <PuzzleStat label={t('累计解开')} value={puzzle.solves} />
                <PuzzleStat label={t('主动揭晓')} value={puzzle.reveals} />
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[10px] leading-5 tabular-nums text-muted-foreground">
                <span>
                  {puzzle.plays
                    ? t('解开率 {rate}%', { rate: solveRate(puzzle) })
                    : t('还没有人提问。')}
                </span>
                {puzzle.playsThisWeek > 0 ? (
                  <span>{t('本周 +{count}', { count: puzzle.playsThisWeek })}</span>
                ) : null}
              </div>

              <div className="mt-4 flex items-center justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="min-h-10"
                  disabled={busyId === puzzle.id}
                  onClick={() => void toggle(puzzle)}
                >
                  {puzzle.visibility === 'public' ? t('转为私密') : t('设为公开')}
                </Button>
                <button
                  type="button"
                  aria-label={t('删除')}
                  disabled={busyId === puzzle.id}
                  onClick={() => void remove(puzzle)}
                  className="flex size-10 items-center justify-center border border-foreground/30 text-muted-foreground transition-colors hover:border-stamp hover:text-stamp disabled:opacity-40"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {items?.length ? (
        <section className="mt-12">
          <div className="font-mono text-[10px] tracking-[0.24em] text-muted-foreground">
            {t('最近动态')}
          </div>
          {!activity ? (
            <div className="mt-6 flex justify-center text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
            </div>
          ) : !activity.length ? (
            <div className="mt-3">
              <Empty>{t('还没有动态。')}</Empty>
            </div>
          ) : (
            <ul className="mt-3 border-t border-foreground/20">
              {activity.map((event, index) => (
                <li
                  key={`${event.kind}-${event.target}-${event.at}-${index}`}
                  className="rule-dashed grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 py-3 sm:flex sm:items-baseline"
                >
                  <span
                    className={cn(
                      'shrink-0 font-mono text-[10px] font-bold tracking-[0.14em]',
                      event.kind === 'solve'
                        ? 'text-[var(--v-yes)]'
                        : event.kind === 'comment' || event.kind === 'like'
                          ? 'text-stamp/80'
                          : 'text-muted-foreground',
                    )}
                  >
                    {t(
                      event.kind === 'play'
                        ? '挑战'
                        : event.kind === 'solve'
                          ? '解开'
                          : event.kind === 'like'
                            ? '点赞'
                            : '留言',
                    )}
                  </span>
                  <span className="col-span-2 row-start-2 min-w-0 font-serif text-[13px] leading-6 break-words sm:flex-1">
                    {describe(event, t)}
                  </span>
                  <span className="col-start-2 row-start-1 shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground/60">
                    {formatWhen(event.at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </PageShell>
  )
}
