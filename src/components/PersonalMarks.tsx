import { MarksContext, usePersonalMarks } from '@/lib/personal-marks-context'
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { Bookmark, ChevronDown, Minus, MoreHorizontal, X } from 'lucide-react'
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
  children,
}: {
  questionId: string
  compact?: boolean
  children?: ReactNode
}) {
  const marks = usePersonalMarks()
  const { t } = useI18n()
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  if (!marks) return null
  const current = markFor(marks.marks, questionId)
  return (
    <div
      data-personal-mark={questionId}
      data-mark={current ?? ''}
      role="group"
      aria-label={t('这组问答对我')}
      className={cn('play-mark-actions', compact && 'is-compact')}
    >
      <button
        type="button"
        aria-label={t('有用')}
        aria-pressed={current === 'useful'}
        title={t('有用')}
        className={cn('play-mark-button', current && 'is-marked')}
        onClick={() => marks.toggle(questionId, 'useful')}
      >
        {current === 'not-useful' ? (
          <Minus aria-hidden />
        ) : (
          <Bookmark aria-hidden className={current === 'useful' ? 'fill-current/20' : ''} />
        )}
      </button>
      <button
        type="button"
        className="play-more-button"
        aria-label={t('更多操作')}
        aria-haspopup="dialog"
        onClick={() => dialog.current?.showModal()}
      >
        <MoreHorizontal aria-hidden />
      </button>
      <dialog ref={dialog} className="play-actions-dialog" aria-labelledby={titleId}>
        <div className="play-actions-heading">
          <h2 id={titleId}>{t('这组问答对我')}</h2>
          <button type="button" aria-label={t('关闭')} onClick={() => dialog.current?.close()}>
            <X />
          </button>
        </div>
        <div className="play-actions-options">
          {(['useful', 'not-useful'] as const).map((value) => {
            const Icon = value === 'useful' ? Bookmark : Minus
            return (
              <button
                key={value}
                type="button"
                aria-pressed={current === value}
                onClick={() => {
                  dialog.current?.close()
                  marks.toggle(questionId, value)
                }}
              >
                <Icon aria-hidden />
                {t(value === 'useful' ? '有用' : '暂时无用')}
              </button>
            )
          })}
        </div>
        <p className="play-private-note">{t('仅保存在当前浏览器，再次点击可取消')}</p>
        {children ? <div className="play-actions-extra">{children}</div> : null}
      </dialog>
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
        compact ? 'play-mark-filter' : 'border-b border-foreground/15 px-4 sm:px-6',
      )}
    >
      <div className="flex min-h-10 items-center justify-between gap-x-1">
        <label
          htmlFor={id}
          title={t('仅保存在当前浏览器，再次点击可取消')}
          className="flex items-center gap-1.5"
        >
          <Bookmark aria-hidden className="size-3" />
          <span className={compact ? 'sr-only' : ''}>{t('我的标记')}</span>
        </label>
        <div className="relative">
          <select
            id={id}
            aria-label={t('筛选我的标记')}
            value={marks.filter}
            onChange={(e) => marks.setFilter(e.target.value as MarkFilter)}
            className={cn(
              'min-h-10 max-w-full appearance-none bg-transparent pr-4 pl-1 outline-offset-2',
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
      {marks.filter !== 'all' && (!compact || hasEarlier) ? (
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

export function PersonalMarkEmpty({ onReset }: { onReset?: () => void } = {}) {
  const { t } = useI18n()
  const marks = usePersonalMarks()
  return (
    <div role="status" className="px-4 py-6 font-mono text-[11px] leading-6 text-muted-foreground">
      <p>{t('当前记录中没有符合筛选的问答。')}</p>
      <button
        type="button"
        onClick={() => {
          marks?.setFilter('all')
          onReset?.()
        }}
        className="mt-1 min-h-9 underline underline-offset-4"
      >
        {t('查看全部记录')}
      </button>
    </div>
  )
}
