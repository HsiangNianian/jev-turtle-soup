import { useEffect, useState } from 'react'
import { ArrowRight, Lock, Trash2 } from 'lucide-react'

import { Link } from '@/components/Link'
import { DailyLuck } from '@/components/DailyLuck'
import { STATUS_LABEL, formatWhen, type ArchivedGame, type GameStatus } from '@/lib/archive'
import { dailyLanguageLabel, listDailies, type DailyDetail } from '@/lib/daily-client'
import { cn } from '@/lib/utils'
import { useI18n } from '@/lib/i18n'

const SKIP_DELETE_CONFIRM_KEY = 'turtle-soup.archive.skip-delete-confirm'

function readSkipDeleteConfirm(): boolean {
  try {
    return localStorage.getItem(SKIP_DELETE_CONFIRM_KEY) === '1'
  } catch {
    return false
  }
}

const STAMP_TONE: Record<GameStatus, string> = {
  active: 'border-stamp text-stamp',
  solved: 'border-[var(--v-yes)] text-[var(--v-yes)]',
  revealed: 'border-stamp text-stamp',
  abandoned: 'border-muted-foreground/60 text-muted-foreground',
}

function StatusStamp({ status }: { status: GameStatus }) {
  const { t } = useI18n()
  return (
    <span
      className={cn(
        'shrink-0 border px-2 py-0.5 font-mono text-[10px] font-bold tracking-[0.16em]',
        STAMP_TONE[status],
      )}
    >
      {t(STATUS_LABEL[status])}
    </span>
  )
}

/** 台账的分节头：左边一句说明，右边一点注记，底下一条实线。 */
function SectionHead({
  label,
  aside,
  className,
}: {
  label: React.ReactNode
  aside?: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-foreground/25 py-3',
        className,
      )}
    >
      <span className="font-mono text-[10px] tracking-[0.24em] text-muted-foreground">{label}</span>
      {aside ? <span className="ml-auto">{aside}</span> : null}
    </div>
  )
}

interface LandingProps {
  activeGames: ArchivedGame[]
  archives: ArchivedGame[]
  onStartDaily: (daily: DailyDetail) => void
  onContinue: (id: string) => void
  onView: (id: string) => void
  onAbandon: (id: string) => void
  onDelete: (id: string) => void
}

/**
 * 首页是一张连续的台账：今日 / 在办 / 档案室三段，用横线和间距分节，没有卡片边框。
 * 分节的依据是「这件事跟你的关系有多近」——今天的新案、你手上的案子、已经结掉的。
 */
export function Landing({
  activeGames,
  archives,
  onStartDaily,
  onContinue,
  onView,
  onAbandon,
  onDelete,
}: LandingProps) {
  const { t } = useI18n()
  const [todayDaily, setTodayDaily] = useState<DailyDetail | null>(null)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [dontAskAgain, setDontAskAgain] = useState(false)
  const [skipConfirm, setSkipConfirm] = useState(readSkipDeleteConfirm)

  useEffect(() => {
    let alive = true
    listDailies()
      .then((data) => {
        if (alive) setTodayDaily(data.today)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])

  // 今天官方汤已经在办的话，它由上面「今日」那一段负责，
  // 不能再出现在「在办」里，否则同一个案子会摆两次。
  const todayDailyGame = todayDaily
    ? activeGames.find((game) => game.source === 'daily' && game.dailyDate === todayDaily.date)
    : undefined
  const openCases = todayDailyGame
    ? activeGames.filter((game) => game.id !== todayDailyGame.id)
    : activeGames

  function requestDelete(id: string) {
    if (skipConfirm) {
      onDelete(id)
      return
    }
    setDontAskAgain(false)
    setConfirmingId(id)
  }

  function confirmDelete(id: string) {
    if (dontAskAgain) {
      try {
        localStorage.setItem(SKIP_DELETE_CONFIRM_KEY, '1')
      } catch {
        /* 隐私模式下忽略 */
      }
      setSkipConfirm(true)
    }
    setConfirmingId(null)
    onDelete(id)
  }

  return (
    <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col justify-center px-5 py-12 sm:px-6 sm:py-16">
      <div className="font-mono text-[10px] tracking-[0.3em] text-muted-foreground sm:text-[11px]">
        {t('案件受理')}
      </div>
      <div className="mt-5 flex items-start justify-between gap-5">
        <h1 className="font-serif text-[clamp(2.75rem,9vw,4.5rem)] leading-none font-semibold">
          {t('海龟汤')}
        </h1>
        <DailyLuck />
      </div>
      <p className="mt-6 max-w-xl font-serif text-[15px] leading-8 text-foreground/80">
        {t(
          '每一碗汤都是一桩悬案。向主持人砚（Ellis）提出「是 / 不是」的问题，逐步还原被隐去的真相。',
        )}
      </p>

      <div className="mt-10 border-t-2 border-foreground">
        {todayDaily ? (
          <>
            <SectionHead
              label={`${t('今日官方汤')} · ${todayDaily.date} · ${dailyLanguageLabel(todayDaily.locale, t)}`}
              aside={
                todayDaily.locked ? (
                  <span className="stamp flex items-center gap-1.5 px-2 py-0.5 font-mono text-[10px] font-bold tracking-[0.2em]">
                    <Lock className="size-3" /> {t('明日解锁')}
                  </span>
                ) : null
              }
            />
            <div className="pt-4">
              <h2 className="font-serif text-3xl leading-tight font-semibold">
                {todayDaily.title}
              </h2>
              <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[10px] tracking-[0.18em] text-muted-foreground">
                <span className="border border-foreground/25 px-1.5 py-0.5">
                  {t(todayDaily.difficulty)}
                </span>
                {todayDaily.tags.map((tag) => (
                  <span key={tag}>#{tag}</span>
                ))}
              </div>
              <p className="surface-prose mt-4 max-w-2xl border-l-2 border-brand/50 pl-4 font-serif text-[15px] leading-8 text-foreground/90">
                {todayDaily.surface}
              </p>
              <div className="flex flex-wrap items-center gap-4 pt-5">
                {todayDailyGame ? (
                  <button
                    type="button"
                    onClick={() => onContinue(todayDailyGame.id)}
                    className="flex items-center gap-2.5 bg-foreground px-6 py-3 font-mono text-[12px] font-bold tracking-[0.22em] text-background transition-opacity hover:opacity-85"
                  >
                    {t('继续调查')} <ArrowRight className="size-4" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => onStartDaily(todayDaily)}
                    className="flex items-center gap-2.5 bg-foreground px-6 py-3 font-mono text-[12px] font-bold tracking-[0.22em] text-background transition-opacity hover:opacity-85"
                  >
                    {t('开始推理')} <ArrowRight className="size-4" />
                  </button>
                )}
                <Link
                  to="/daily"
                  className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground transition-colors hover:text-foreground"
                >
                  {t('往期与汤底')}
                </Link>
              </div>
            </div>
          </>
        ) : null}

        {openCases.length ? (
          <>
            <SectionHead
              label={t('在办案件')}
              className={todayDaily ? 'mt-10' : 'border-t-0'}
              aside={
                <span className="flex items-center gap-3">
                  <span className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground/70">
                    {t('{count} 桩', { count: openCases.length })}
                  </span>
                  <span className="stamp px-2 py-0.5 font-mono text-[10px] font-bold tracking-[0.2em]">
                    {t('机密')}
                  </span>
                </span>
              }
            />
            {openCases.map((game) => (
              <div
                key={game.id}
                className="flex flex-wrap items-baseline gap-x-4 gap-y-2 border-b border-dashed border-foreground/20 py-4 last:border-b-0"
              >
                <h3 className="font-serif text-2xl leading-tight">{game.title}</h3>
                <span className="font-mono text-[10px] tracking-[0.16em] text-muted-foreground">
                  {game.source === 'library'
                    ? t('题库里的汤')
                    : game.source === 'daily'
                      ? t('今日官方汤')
                      : t('在办案件')}
                  {' · '}
                  {t(game.difficulty)}
                  {' · '}
                  {t('已问 {turns} 轮', { turns: game.turnCount })}
                  {' · '}
                  {t('更新 {when}', { when: formatWhen(game.updatedAt) })}
                </span>
                <span className="ml-auto flex items-center gap-4">
                  <button
                    type="button"
                    onClick={() => onContinue(game.id)}
                    className="font-mono text-[11px] font-bold tracking-[0.18em] text-stamp transition-opacity hover:opacity-70"
                  >
                    {t('继续调查')} →
                  </button>
                  <button
                    type="button"
                    onClick={() => onAbandon(game.id)}
                    className="font-mono text-[11px] tracking-[0.18em] text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {t('中止本案')}
                  </button>
                </span>
              </div>
            ))}
          </>
        ) : null}

        {archives.length ? (
          <>
            <SectionHead
              label={t('档案室')}
              className={todayDaily || openCases.length ? 'mt-10' : 'border-t-0'}
              aside={
                <span className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground/70">
                  {t('{count} 卷', { count: String(archives.length).padStart(2, '0') })}
                  {archives.length > 5 ? t(' · 可上下滑动') : ''}
                </span>
              }
            />
            {/* 每行 4.5rem，5 行再加上边框，正好露出 5 卷 */}
            <ul className="chat-scroll max-h-[22.75rem] overflow-y-auto">
              {archives.map((game) => (
                <li
                  key={game.id}
                  className="rule-dashed flex h-[4.5rem] items-center gap-2 last:border-b-0"
                >
                  {confirmingId === game.id ? (
                    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-2 py-2">
                      <span className="font-serif text-[13px] text-muted-foreground">
                        {t('删除《{title}》？删除后无法恢复。', { title: game.title })}
                      </span>
                      <button
                        type="button"
                        onClick={() => confirmDelete(game.id)}
                        className="border border-stamp bg-stamp px-3 py-1.5 font-mono text-[10px] font-bold tracking-[0.16em] text-background transition-opacity hover:opacity-85"
                      >
                        {t('确认删除')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmingId(null)}
                        className="border border-foreground/30 px-3 py-1.5 font-mono text-[10px] tracking-[0.16em] text-muted-foreground transition-colors hover:text-foreground"
                      >
                        {t('取消')}
                      </button>
                      <label className="flex cursor-pointer items-center gap-2 font-mono text-[10px] tracking-[0.14em] text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={dontAskAgain}
                          onChange={(event) => setDontAskAgain(event.target.checked)}
                          className="size-3.5 accent-[var(--stamp)]"
                        />
                        {t('以后不再提示')}
                      </label>
                    </div>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => onView(game.id)}
                        className="flex min-w-0 flex-1 items-center gap-3 py-2 text-left"
                      >
                        <StatusStamp status={game.status} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-serif text-[15px]">
                            {game.title}
                          </span>
                          <span className="mt-0.5 block font-mono text-[10px] tracking-[0.14em] text-muted-foreground">
                            {t('{when} · 已问 {turns} 轮', {
                              when: formatWhen(game.updatedAt),
                              turns: game.turnCount,
                            })}
                          </span>
                        </span>
                        <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                      </button>
                      <button
                        type="button"
                        aria-label={t('删除《{title}》', { title: game.title })}
                        onClick={() => requestDelete(game.id)}
                        className="flex size-8 shrink-0 items-center justify-center border border-transparent text-muted-foreground/50 transition-colors hover:border-stamp hover:text-stamp"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </div>

      <div className="mt-8 flex flex-wrap items-center gap-3">
        <Link
          to="/library"
          className="flex items-center gap-3 bg-foreground px-6 py-3.5 font-mono text-[12px] font-bold tracking-[0.22em] text-background transition-opacity hover:opacity-85"
        >
          {t('去题库挑一碗')} <ArrowRight className="size-4" />
        </Link>
        <Link
          to="/daily"
          className="flex items-center gap-3 border border-foreground px-6 py-3.5 font-mono text-[12px] font-bold tracking-[0.22em] transition-colors hover:bg-foreground hover:text-background"
        >
          {t('玩今日官方汤')} <ArrowRight className="size-4" />
        </Link>
      </div>

      <div className="mt-10 flex items-center gap-2 font-mono text-[10px] tracking-[0.3em] text-muted-foreground/70">
        <Lock className="size-3" />
        {t('中途离开也没关系，进度会自动留在本机')}
      </div>
    </div>
  )
}
