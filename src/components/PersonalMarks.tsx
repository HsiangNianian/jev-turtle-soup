import { MarksContext, usePersonalMarks } from '@/lib/personal-marks-context'
import { useEffect, useId, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Bookmark, ChevronDown, Minus } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import {
  PersonalMarksStore,
  personalMarksKey,
  markFor,
  matchesMark,
  type MarkFilter,
} from '@/lib/personal-marks'

function useMarks(store: PersonalMarksStore) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const [filter, setFilter] = useState<MarkFilter>('all')
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === store.key || event.key === null) store.refresh()
    }
    window.addEventListener('storage', sync)
    store.refresh()
    return () => window.removeEventListener('storage', sync)
  }, [store])
  return {
    ...snapshot,
    filter,
    setFilter,
    toggle: store.toggle,
    includes: (id?: string) => matchesMark(snapshot.marks, filter, id),
  }
}

export function PersonalMarksProvider({
  owner,
  kind,
  id,
  children,
}: {
  owner: string | null
  kind: 'solo' | 'room'
  id: string
  children: ReactNode
}) {
  const key = personalMarksKey(owner, kind, id)
  const store = useMemo(() => new PersonalMarksStore(key, () => localStorage), [key])
  const value = useMarks(store)
  return <MarksContext value={value}>{children}</MarksContext>
}

/** These are personal notes, not votes on the host or another player's question. */
export function PersonalMarkActions({
  questionId,
  compact = false,
}: {
  questionId: string
  compact?: boolean
}) {
  const marks = usePersonalMarks()
  const { t } = useI18n()
  if (!marks) return null
  const current = markFor(marks.marks, questionId)
  return (
    <div
      data-personal-mark={questionId}
      role="group"
      aria-label={t('这组问答对我')}
      className={cn('flex shrink-0 items-center gap-1 font-mono text-[10px]', !compact && 'mt-1')}
    >
      {(['useful', 'not-useful'] as const).map((value) => {
        const active = current === value
        const label = t(value === 'useful' ? '有用' : '暂时无用')
        const Icon = value === 'useful' ? Bookmark : Minus
        return (
          <button
            key={value}
            type="button"
            aria-label={label}
            aria-pressed={active}
            title={`${label} · ${t('仅保存在当前浏览器，再次点击可取消')}`}
            onClick={() => marks.toggle(questionId, value)}
            className={cn(
              'inline-flex min-h-9 min-w-9 items-center justify-center gap-1.5 px-1.5 transition-colors hover:text-foreground focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-current',
              active ? 'text-stamp' : 'text-muted-foreground',
              active && 'bg-foreground/5',
            )}
          >
            <Icon
              aria-hidden
              className={cn('size-3', active && value === 'useful' && 'fill-current/20')}
            />
            {!compact && label}
          </button>
        )
      })}
    </div>
  )
}

export function PersonalMarkFilter({
  compact = false,
  hasEarlier = false,
}: {
  compact?: boolean
  hasEarlier?: boolean
}) {
  const marks = usePersonalMarks()
  const { t } = useI18n()
  const id = useId()
  if (!marks) return null
  return (
    <div
      className={cn(
        'shrink-0 font-mono text-[10px] text-muted-foreground',
        compact ? 'mb-2' : 'border-b border-foreground/15 px-4 sm:px-6 lg:px-8',
      )}
    >
      <div className="flex min-h-10 flex-wrap items-center justify-between gap-x-3">
        <label
          htmlFor={id}
          title={t('仅保存在当前浏览器，再次点击可取消')}
          className="flex items-center gap-1.5"
        >
          <Bookmark aria-hidden className="size-3" /> {t('我的标记')}
        </label>
        <div className="relative">
          <select
            id={id}
            aria-label={t('筛选我的标记')}
            value={marks.filter}
            onChange={(e) => marks.setFilter(e.target.value as MarkFilter)}
            className={cn(
              'min-h-10 max-w-full appearance-none bg-background pr-5 pl-2 outline-offset-2',
              marks.filter !== 'all' && 'text-stamp',
            )}
          >
            <option value="all">{t('全部记录')}</option>
            <option value="marked">{t('只看已标记')}</option>
            <option value="useful">{t('只看有用')}</option>
            <option value="not-useful">{t('只看暂时无用')}</option>
          </select>
          <ChevronDown
            aria-hidden
            className="pointer-events-none absolute top-1/2 right-0 size-3 -translate-y-1/2"
          />
        </div>
      </div>
      {marks.filter !== 'all' ? (
        <p className="pb-2 leading-5">
          {t(
            hasEarlier
              ? '仅筛选已加载的问答，可加载更早的记录。'
              : '提问与回答一起显示 · 仅保存在当前浏览器',
          )}
        </p>
      ) : null}
      {marks.error ? (
        <p role="alert" className="pb-2 leading-5 text-stamp">
          {t('标记未能读取或保存，请检查浏览器本地存储后重试。')}
        </p>
      ) : null}
    </div>
  )
}

export function PersonalMarkEmpty() {
  const { t } = useI18n()
  const marks = usePersonalMarks()
  return (
    <div role="status" className="px-4 py-6 font-mono text-[11px] leading-6 text-muted-foreground">
      <p>{t('当前记录中没有符合筛选的问答。')}</p>
      <button
        type="button"
        onClick={() => marks?.setFilter('all')}
        className="mt-1 min-h-9 underline underline-offset-4"
      >
        {t('查看全部记录')}
      </button>
    </div>
  )
}
