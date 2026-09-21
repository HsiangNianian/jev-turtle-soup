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

/** 首页的「今日官方汤」卡片：拿不到今天的汤就由调用方决定不渲染。 */
function DailyCard({
  daily,
  ongoing,
  onStart,
  onContinue,
}: {
  daily: DailyDetail
  /** 今天这碗已经在办了的话，按钮就是「继续调查」 */
  ongoing: ArchivedGame | undefined
  onStart: (daily: DailyDetail) => void
  onContinue: (id: string) => void
}) {
  const { t } = useI18n()

  return (
    <div className="mt-9 border border-foreground bg-card">
      <div className="flex items-center justify-between gap-3 border-b border-foreground px-4 py-3 sm:px-5">
        <span className="font-mono text-[10px] tracking-[0.24em] text-muted-foreground">
          {t('今日官方汤')} · {daily.date}
        </span>
        <span className="stamp flex items-center gap-1.5 px-2 py-0.5 font-mono text-[10px] font-bold tracking-[0.2em]">
          <Lock className="size-3" /> {t('明日解锁')}
        </span>
      </div>
      <div className="px-4 py-5 sm:px-5">
        <h2 className="font-serif text-2xl leading-snug font-semibold">{daily.title}</h2>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[10px] tracking-[0.18em] text-muted-foreground">
          <span className="border border-foreground/25 px-1.5 py-0.5">{t(daily.difficulty)}</span>
          {daily.tags.map((tag) => (
            <span key={tag}>#{tag}</span>
          ))}
        </div>
        <div className="mt-2 font-mono text-[10px] tracking-[0.16em] text-muted-foreground">
          {t('今天的汤是{language}的', { language: dailyLanguageLabel(daily.locale, t) })}
        </div>
        <div className="mt-4 border-l-2 border-brand/50 pl-4">
          <p className="surface-prose font-serif text-[15px] leading-8 text-foreground/90">
            {daily.surface}
          </p>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          {ongoing ? (
            <button
              type="button"
              onClick={() => onContinue(ongoing.id)}
              className="flex items-center gap-2.5 bg-foreground px-6 py-3 font-mono text-[12px] font-bold tracking-[0.22em] text-background transition-opacity hover:opacity-85"
            >
              {t('继续调查')} <ArrowRight className="size-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onStart(daily)}
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

  // 今天官方汤已经在办的话，它由上面那张 DAILY 卡片负责，
  // 不能再出现在「在办案件」列表里，否则同一个案子会摆两个框。
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
      <div className="mt-6 h-px w-full bg-foreground/80" />
      <p className="mt-6 max-w-xl font-serif text-[15px] leading-8 text-foreground/80">
        {t(
          '每一碗汤都是一桩悬案。向主持人砚（Ellis）提出「是 / 不是」的问题，逐步还原被隐去的真相。',
        )}
      </p>

      {todayDaily ? (
        <DailyCard
          daily={todayDaily}
          ongoing={todayDailyGame}
          onStart={onStartDaily}
          onContinue={onContinue}
        />
      ) : null}

      {openCases.length ? (
        <div className="mt-9 space-y-4">
          {openCases.map((game) => (
            <div key={game.id} className="border border-foreground bg-card">
              <div className="flex items-center justify-between gap-3 border-b border-foreground px-4 py-3 sm:px-5">
                <span className="font-mono text-[10px] tracking-[0.24em] text-muted-foreground">
                  {game.source === 'library'
                    ? t('题库里的汤')
                    : game.source === 'daily'
                      ? t('今日官方汤')
                      : t('在办案件')}
                </span>
                <span className="stamp px-2 py-0.5 font-mono text-[10px] font-bold tracking-[0.2em]">
                  {t('机密')}
                </span>
              </div>
              <div className="px-4 py-5 sm:px-5">
                <h2 className="font-serif text-2xl leading-snug font-semibold">{game.title}</h2>
                <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 font-mono text-[10px] tracking-[0.18em] text-muted-foreground">
                  <span>{t('等级 {level}', { level: t(game.difficulty) })}</span>
                  <span>{t('已问 {turns} 轮', { turns: game.turnCount })}</span>
                  <span>{t('更新 {when}', { when: formatWhen(game.updatedAt) })}</span>
                </div>
                <div className="mt-5 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => onContinue(game.id)}
                    className="flex items-center gap-2.5 bg-foreground px-6 py-3 font-mono text-[12px] font-bold tracking-[0.22em] text-background transition-opacity hover:opacity-85"
                  >
                    {t('继续调查')} <ArrowRight className="size-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onAbandon(game.id)}
                    className="border border-foreground/30 px-5 py-3 font-mono text-[11px] tracking-[0.18em] text-muted-foreground transition-colors hover:border-foreground hover:text-foreground"
                  >
                    {t('中止本案')}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
        <Link
          to="/library"
          className="flex items-center gap-3 bg-foreground px-7 py-4 font-mono text-[12px] font-bold tracking-[0.24em] text-background transition-opacity hover:opacity-85"
        >
          {t('去题库挑一碗')} <ArrowRight className="size-4" />
        </Link>
        <Link
          to="/daily"
          className="flex items-center gap-3 border border-foreground px-7 py-4 font-mono text-[12px] font-bold tracking-[0.24em] transition-colors hover:bg-foreground hover:text-background"
        >
          {t('玩今日官方汤')} <ArrowRight className="size-4" />
        </Link>
      </div>

      {archives.length ? (
        <div className="mt-12">
          <div className="flex items-baseline justify-between">
            <span className="font-mono text-[10px] tracking-[0.26em] text-muted-foreground">
              {t('档案室')}
            </span>
            <span className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground/70">
              {t('{count} 卷', { count: String(archives.length).padStart(2, '0') })}
              {archives.length > 5 ? t(' · 可上下滑动') : ''}
            </span>
          </div>

          {/* 每行 4.5rem，5 行再加上边框，正好露出 5 卷 */}
          <ul className="chat-scroll mt-3 max-h-[22.75rem] overflow-y-auto border-t border-foreground/25">
            {archives.map((game) => (
              <li key={game.id} className="rule-dashed flex h-[4.5rem] items-center gap-2">
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
                        <span className="block truncate font-serif text-[15px]">{game.title}</span>
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
        </div>
      ) : null}

      <div className="mt-14 flex items-center gap-2 font-mono text-[10px] tracking-[0.3em] text-muted-foreground/70">
        <Lock className="size-3" />
        {t('中途离开也没关系，进度会自动留在本机')}
      </div>
    </div>
  )
}
