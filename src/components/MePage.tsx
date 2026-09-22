import { useEffect, useState } from 'react'
import { Loader2, Plus, Trash2 } from 'lucide-react'

import { Button, Empty, Notice, PageShell } from '@/components/Bits'
import { navigate } from '@/lib/router'
import { Link } from '@/components/Link'
import {
  deletePuzzle,
  fetchAuthorActivity,
  listMyPuzzles,
  updatePuzzle,
  type AuthorEvent,
  type AuthorSummary,
  type OwnPuzzle,
} from '@/lib/library-client'
import { formatWhen } from '@/lib/archive'
import { cn } from '@/lib/utils'
import { useI18n } from '@/lib/i18n'

function solveRate(puzzle: OwnPuzzle): number {
  if (!puzzle.plays) return 0
  return Math.round((puzzle.solves / puzzle.plays) * 100)
}

/** 动态流的一行：把事件翻成一句人话。 */
function describe(event: AuthorEvent, t: (key: string, params?: Record<string, string | number>) => string): string {
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

function StatCell({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="border border-foreground/20 px-4 py-3">
      <div className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground">{label}</div>
      <div className="mt-1.5 font-serif text-2xl leading-none tabular-nums">{value}</div>
    </div>
  )
}

export function MePage({
  handle,
  isAdmin = false,
  onLogout,
}: {
  handle: string
  isAdmin?: boolean
  onLogout: () => void
}) {
  const { t } = useI18n()
  const [items, setItems] = useState<OwnPuzzle[] | null>(null)
  const [summary, setSummary] = useState<AuthorSummary | null>(null)
  const [activity, setActivity] = useState<AuthorEvent[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  useEffect(() => {
    listMyPuzzles()
      .then((data) => {
        setItems(data.items)
        setSummary(data.summary)
      })
      .catch((caught: unknown) =>
        setError(caught instanceof Error ? caught.message : t('加载失败')),
      )
    // 动态流是次要信息，失败就当空的，不打断看板
    fetchAuthorActivity()
      .then(setActivity)
      .catch(() => setActivity([]))
  }, [t])

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
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Button onClick={() => navigate('/upload')}>
          <Plus className="size-3.5" /> {t('上传新汤')}
        </Button>
        <Button variant="outline" onClick={() => navigate('/me/profile')}>
          {t('编辑资料')}
        </Button>
        {isAdmin ? (
          <Button variant="outline" onClick={() => navigate('/admin')}>
            {t('管理后台')}
          </Button>
        ) : null}
        <Button variant="ghost" onClick={onLogout}>
          {t('退出')}
        </Button>
      </div>

      {summary && summary.total ? (
        <div className="mt-7 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCell label={t('公开的汤')} value={summary.public} />
          <StatCell label={t('累计问过')} value={summary.plays} />
          <StatCell label={t('累计解开')} value={summary.solves} />
          <StatCell label={t('本周问过')} value={summary.playsThisWeek} />
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
            <li key={puzzle.id} className="rule-dashed flex flex-wrap items-center gap-3 py-4">
              <span
                className={cn(
                  'shrink-0 border px-1.5 py-0.5 font-mono text-[10px] font-bold tracking-[0.14em]',
                  puzzle.visibility === 'public'
                    ? 'border-[var(--v-yes)] text-[var(--v-yes)]'
                    : 'border-foreground/30 text-muted-foreground',
                )}
              >
                {puzzle.visibility === 'public' ? t('公开') : t('私密')}
              </span>

              <span className="min-w-0 flex-1">
                <span className="block truncate font-serif text-[15px]">{puzzle.title}</span>
                <span className="mt-0.5 block truncate font-serif text-[12px] text-muted-foreground">
                  {puzzle.surface}
                </span>
              </span>

              <span className="shrink-0 text-right font-mono text-[10px] leading-5 tabular-nums text-muted-foreground">
                <span className="block">
                  {t('{plays} 人问过 · {solves} 人解开', {
                    plays: puzzle.plays,
                    solves: puzzle.solves,
                  })}
                </span>
                <span className="block">
                  {puzzle.plays ? t('解开率 {rate}%', { rate: solveRate(puzzle) }) : t('还没有人玩过。')}
                  {puzzle.playsThisWeek > 0 ? ` · ${t('本周 +{count}', { count: puzzle.playsThisWeek })}` : ''}
                </span>
              </span>

              <span className="flex shrink-0 items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
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
                  className="flex size-8 items-center justify-center border border-foreground/30 text-muted-foreground transition-colors hover:border-stamp hover:text-stamp disabled:opacity-40"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </span>
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
                  className="rule-dashed flex items-baseline gap-x-3 gap-y-1 py-3"
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
                  <span className="min-w-0 flex-1 font-serif text-[13px] leading-6 break-words">
                    {describe(event, t)}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground/60">
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
