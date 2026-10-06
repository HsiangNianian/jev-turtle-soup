import { useEffect, useState } from 'react'
import { RoomEntry } from '@/components/RoomEntry'
import { ArrowRight, Lock, MessageCircleQuestion, ScrollText, Search, Trash2 } from 'lucide-react'

import { Difficulty } from '@/components/Bits'
import { Link } from '@/components/Link'
import { DailyLuck } from '@/components/DailyLuck'
import { STATUS_LABEL, formatWhen, type ArchivedGame, type GameStatus } from '@/lib/archive'
import { dailyLanguageLabel, listDailies, type DailyDetail } from '@/lib/daily-client'
import { genreLabel, listCuratedPuzzles, type LibraryPuzzle } from '@/lib/library-client'
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

/** 台账的分节头：编号 + 栏名，右边一点注记，底下一条细线。 */
function SectionHead({
  index,
  label,
  aside,
  className,
}: {
  index?: string
  label: React.ReactNode
  aside?: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex min-h-11 flex-wrap items-end gap-x-3 gap-y-1 border-b border-foreground/20 pb-3',
        className,
      )}
    >
      {index ? (
        <span className="font-mono text-[11px] leading-none text-stamp tabular-nums">{index}</span>
      ) : null}
      <h2 className="font-serif text-xl leading-none font-semibold tracking-wide">{label}</h2>
      {aside ? <span className="ml-auto">{aside}</span> : null}
    </div>
  )
}

/** 新来的人看一眼就知道怎么玩：三步，不展开。 */
function HowItWorks() {
  const { t } = useI18n()
  const steps = [
    { icon: ScrollText, title: t('读汤面'), body: t('一段离奇的怪事') },
    { icon: MessageCircleQuestion, title: t('问是非'), body: t('砚只答是、不是、无关') },
    { icon: Search, title: t('还原汤底'), body: t('拼出完整的真相') },
  ]
  return (
    <ol className="grid grid-cols-3 gap-px overflow-hidden border border-foreground/15 bg-foreground/15">
      {steps.map((step, index) => (
        <li key={step.title} className="bg-sheet/80 px-3 py-3.5 sm:px-4">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] text-stamp tabular-nums">0{index + 1}</span>
            <step.icon className="size-3.5 text-muted-foreground" aria-hidden />
          </div>
          <div className="mt-2 font-serif text-[15px] font-semibold">{step.title}</div>
          <div className="mt-0.5 hidden font-serif text-[12px] leading-5 text-muted-foreground sm:block">
            {step.body}
          </div>
        </li>
      ))}
    </ol>
  )
}

interface LandingProps {
  activeGames: ArchivedGame[]
  archives: ArchivedGame[]
  /** 登录后进度跟着账号走；游客只留在本机，顺手邀请一下 */
  signedIn?: boolean
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
  signedIn = false,
  onStartDaily,
  onContinue,
  onView,
  onAbandon,
  onDelete,
}: LandingProps) {
  const { t, locale } = useI18n()
  const [todayDaily, setTodayDaily] = useState<DailyDetail | null>(null)
  const [curated, setCurated] = useState<LibraryPuzzle[] | null>(null)
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

  useEffect(() => {
    if (locale !== 'zh-CN') return
    let alive = true
    listCuratedPuzzles()
      .then((items) => {
        if (alive) setCurated(items)
      })
      .catch(() => {
        if (alive) setCurated([])
      })
    return () => {
      alive = false
    }
  }, [locale])

  // 今天官方汤已经在办的话，它由上面「今日」那一段负责，
  // 不能再出现在「在办」里，否则同一个案子会摆两次。
  const todayDailyGame = todayDaily
    ? activeGames.find((game) => game.source === 'daily' && game.dailyDate === todayDaily.date)
    : undefined
  const openCases = todayDailyGame
    ? activeGames.filter((game) => game.id !== todayDailyGame.id)
    : activeGames
  const hasSections = Boolean(todayDaily) || openCases.length > 0 || archives.length > 0

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
    <div className="mx-auto w-full max-w-6xl px-5 pt-10 pb-12 sm:px-8 sm:pt-16 lg:pt-20">
      {/* ── 案件受理：左边是调查局的门牌，右边是今天桌上那一份卷宗 ── */}
      <section className="grid items-start gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-x-16">
        <div className="animate-rise-in">
          <span className="eyebrow">{t('案件受理')}</span>
          <div className="mt-6 flex items-start justify-between gap-5">
            <h1 className="relative font-serif text-[clamp(3.5rem,11vw,6.5rem)] leading-[0.95] font-semibold tracking-tight">
              {t('海龟汤')}
              <span
                aria-hidden
                className="seal absolute -top-1 -right-7 size-6 rotate-6 text-[12px] sm:-right-9 sm:size-8 sm:text-[16px]"
              >
                局
              </span>
            </h1>
            <DailyLuck />
          </div>
          <p className="mt-7 max-w-lg font-serif text-[16px] leading-8 text-foreground/80">
            {t(
              '汤友写下一件怪事，主持人砚替他们守住汤底。挑一碗原创汤，向砚提出「是 / 不是」的问题，一起还原真相。',
            )}
          </p>

          <div className="mt-7 flex flex-wrap items-center gap-3">
            <RoomEntry />
            <Link
              to="/cloze"
              className="inline-flex min-h-10 items-center gap-2 rounded-full bg-stamp-soft px-4 font-mono text-[11px] tracking-wider text-stamp transition-colors hover:bg-stamp hover:text-[#fbf6ec]"
            >
              <span className="size-1.5 rounded-full bg-current" aria-hidden />
              汤底填空 · 新模式
            </Link>
            {signedIn ? (
              <Link
                to="/me/rooms"
                className="ink-link font-mono text-[11px] tracking-wider text-muted-foreground hover:text-foreground"
              >
                {t('我的同桌')} →
              </Link>
            ) : null}
          </div>
        </div>

        {/* 今日官方汤：一叠卷宗，最上面那页写着今天的怪事。手机上紧跟门牌，先给能玩的 */}
        <div className="animate-rise-in [animation-delay:120ms] lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:pt-6">
          {todayDaily ? (
            <article className="sheet-stack">
              <div className="sheet overflow-hidden">
                <div className="flex items-center gap-3 border-b border-dashed border-foreground/20 px-5 py-3.5 sm:px-7">
                  <span aria-hidden className="seal size-6 text-[12px]">
                    今
                  </span>
                  <span className="min-w-0 truncate font-mono text-[10px] tracking-[0.2em] text-muted-foreground">
                    {t('今日官方汤')} · {todayDaily.date} ·{' '}
                    {dailyLanguageLabel(todayDaily.locale, t)}
                  </span>
                  {todayDaily.locked ? (
                    <span className="stamp ml-auto flex shrink-0 items-center gap-1.5 px-2 py-0.5 font-mono text-[10px] font-bold tracking-[0.2em]">
                      <Lock className="size-3" /> {t('明日解锁')}
                    </span>
                  ) : null}
                </div>
                <div className="px-5 pt-6 pb-7 sm:px-7 sm:pt-8">
                  <h2 className="font-serif text-[clamp(1.75rem,4vw,2.5rem)] leading-tight font-semibold">
                    {todayDaily.title}
                  </h2>
                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 font-mono text-[10px] tracking-[0.16em] text-muted-foreground">
                    <Difficulty value={todayDaily.difficulty} />
                    {/* 当天的汤不带标签：标签会点名题材，等于剧透 */}
                    {todayDaily.locked
                      ? null
                      : todayDaily.tags.map((tag) => <span key={tag}>#{tag}</span>)}
                    {/* 和题库同一把尺子，读数也同一处来 */}
                    {genreLabel(todayDaily.genreScore, t) ? (
                      <span className="text-stamp/80">{genreLabel(todayDaily.genreScore, t)}</span>
                    ) : null}
                    {/* 只报「多少人问过」：解开人数对还没揭晓的汤来说是剧透。
                        累计口径（按设备去重、只增不减），所以不是「正在问」。 */}
                    {todayDaily.plays > 0 ? (
                      <span>{t('{count} 人问过', { count: todayDaily.plays })}</span>
                    ) : null}
                  </div>
                  <p className="surface-prose mt-6 border-l-2 border-stamp/50 pl-4 font-serif text-[16px] leading-8 text-foreground/90">
                    {todayDaily.surface}
                  </p>
                  <div className="mt-7 flex flex-wrap items-center gap-4 border-t border-foreground/10 pt-6">
                    <button
                      type="button"
                      onClick={() =>
                        todayDailyGame ? onContinue(todayDailyGame.id) : onStartDaily(todayDaily)
                      }
                      className="group flex min-h-12 items-center gap-3 bg-foreground px-7 font-mono text-[12px] font-bold tracking-[0.22em] text-background shadow-[0_10px_24px_-12px_rgba(23,21,15,0.7)] transition-[background-color,transform,color] duration-200 hover:-translate-y-px hover:bg-stamp hover:text-[#fbf6ec]"
                    >
                      {todayDailyGame ? t('继续调查') : t('开始推理')}
                      <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
                    </button>
                    {todayDailyGame ? (
                      <span className="font-mono text-[10px] tracking-[0.16em] text-muted-foreground">
                        {t('已问 {turns} 轮', { turns: todayDailyGame.turnCount })}
                      </span>
                    ) : null}
                    <Link
                      to="/daily"
                      className="ink-link ml-auto font-mono text-[11px] tracking-[0.16em] text-muted-foreground hover:text-foreground"
                    >
                      {t('往期与汤底')} →
                    </Link>
                  </div>
                </div>
              </div>
            </article>
          ) : (
            <div className="sheet-stack">
              <div className="sheet flex min-h-72 flex-col items-start justify-center gap-5 px-7 py-10">
                <span className="eyebrow">{t('今日官方汤')}</span>
                <p className="font-serif text-xl leading-9 text-foreground/80">
                  {t('今天的汤还在熬，稍后再来。')}
                </p>
                <Link
                  to="/library"
                  prefetchOnView
                  className="flex min-h-11 items-center gap-2.5 bg-foreground px-5 font-mono text-[11px] font-bold tracking-[0.2em] text-background transition-colors hover:bg-stamp"
                >
                  {t('去题库挑一碗')} <ArrowRight className="size-3.5" />
                </Link>
              </div>
            </div>
          )}
        </div>
        <div className="animate-rise-in [animation-delay:200ms] lg:col-start-1 lg:-mt-3">
          <HowItWorks />
        </div>
      </section>

      {locale === 'zh-CN' ? (
        <section className="mt-20 sm:mt-24" aria-label="编辑精选">
          <SectionHead
            index="01"
            label="汤友原创 · 编辑精选"
            aside={
              <Link
                to="/library"
                className="ink-link inline-flex items-center gap-1 font-mono text-[11px] tracking-[0.1em] whitespace-nowrap text-muted-foreground hover:text-foreground"
              >
                <span className="sm:hidden">查看全部</span>
                <span className="hidden sm:inline">去题库看全部</span>
                <ArrowRight className="size-3 text-stamp" />
              </Link>
            }
          />
          {curated === null ? (
            <div className="mt-6 grid gap-5 md:grid-cols-3">
              {[0, 1, 2].map((key) => (
                <div key={key} className="sheet h-48 animate-pulse opacity-60" />
              ))}
            </div>
          ) : curated.length ? (
            <ul
              className={cn(
                'mt-6 grid gap-5',
                curated.length === 2 ? 'md:grid-cols-2' : curated.length > 2 && 'md:grid-cols-3',
              )}
            >
              {curated.map((puzzle, index) => (
                <li
                  key={puzzle.id}
                  className="animate-rise-in"
                  style={{ animationDelay: `${index * 70}ms` }}
                >
                  <article
                    className={cn(
                      'sheet sheet-hover sheet-fold flex h-full flex-col p-5 sm:p-6',
                      curated.length === 1 &&
                        'md:grid md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] md:gap-x-10 md:p-8',
                    )}
                  >
                    <div className="flex items-center gap-2 self-start font-mono text-[10px] tracking-[0.16em]">
                      <span className="rounded-full bg-stamp-soft px-2 py-0.5 text-stamp">
                        编辑荐
                      </span>
                      <Link
                        to={`/u/${puzzle.owner.handle}`}
                        className="relative z-10 min-w-0 truncate text-muted-foreground hover:text-stamp"
                      >
                        @{puzzle.owner.displayName}
                      </Link>
                    </div>
                    <Link
                      to={`/library/${puzzle.id}`}
                      prefetchOnView
                      className={cn(
                        'mt-4 block self-start font-serif text-[22px] leading-snug font-semibold after:absolute after:inset-0 hover:text-stamp',
                        curated.length === 1 && 'md:text-3xl',
                      )}
                    >
                      {puzzle.title}
                    </Link>
                    <p
                      className={cn(
                        'mt-2.5 line-clamp-3 font-serif text-[14px] leading-7 text-foreground/75',
                        curated.length === 1 &&
                          'md:col-start-2 md:row-span-2 md:row-start-1 md:mt-0 md:self-center md:text-[16px] md:leading-8',
                      )}
                    >
                      {puzzle.surface}
                    </p>
                    {puzzle.featuredNote ? (
                      <p
                        className={cn(
                          'mt-auto border-t border-dashed border-foreground/15 pt-3 font-serif text-[12px] leading-6 text-muted-foreground',
                          curated.length === 1 && 'md:col-span-2 md:mt-6',
                        )}
                      >
                        <span className="text-stamp">编者按 · </span>
                        {puzzle.featuredNote}
                      </p>
                    ) : null}
                  </article>
                </li>
              ))}
            </ul>
          ) : (
            <div className="py-7 font-serif text-sm leading-7 text-muted-foreground">
              编辑正在挑选新汤。
              <Link to="/library" className="text-stamp underline underline-offset-4">
                先去题库看看汤友们的作品 →
              </Link>
            </div>
          )}
        </section>
      ) : null}

      <div className="mt-20 grid gap-16 sm:mt-24 lg:grid-cols-2 lg:gap-12">
        {openCases.length ? (
          <section className={cn(!archives.length && 'lg:col-span-2')}>
            <SectionHead
              index="02"
              label={t('在办案件')}
              aside={
                <span className="flex items-center gap-3">
                  <span className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground">
                    {t('{count} 桩', { count: openCases.length })}
                  </span>
                  <span className="stamp px-2 py-0.5 font-mono text-[10px] font-bold tracking-[0.2em]">
                    {t('机密')}
                  </span>
                </span>
              }
            />
            <ul className="mt-5 space-y-3">
              {openCases.map((game) => (
                <li key={game.id} className="sheet group flex items-center gap-4 py-4 pr-4 pl-5">
                  <span
                    aria-hidden
                    className="absolute inset-y-3 left-0 w-[3px] bg-stamp transition-all group-hover:inset-y-0"
                  />
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate font-serif text-[19px] leading-tight font-semibold">
                      {game.title}
                    </h3>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] tracking-[0.12em] text-muted-foreground">
                      <span>
                        {game.source === 'library'
                          ? t('题库里的汤')
                          : game.source === 'daily'
                            ? t('今日官方汤')
                            : t('在办案件')}
                      </span>
                      <Difficulty value={game.difficulty} />
                      <span>{t('已问 {turns} 轮', { turns: game.turnCount })}</span>
                      <span className="hidden sm:inline">
                        {t('更新 {when}', { when: formatWhen(game.updatedAt) })}
                      </span>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5 sm:flex-row sm:items-center sm:gap-4">
                    <button
                      type="button"
                      onClick={() => onContinue(game.id)}
                      className="inline-flex min-h-9 items-center gap-1.5 border border-stamp/50 px-3 font-mono text-[11px] font-bold tracking-[0.16em] text-stamp transition-colors hover:bg-stamp hover:text-[#fbf6ec]"
                    >
                      {t('继续调查')} <ArrowRight className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onAbandon(game.id)}
                      className="font-mono text-[10px] tracking-[0.16em] text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {t('中止本案')}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {archives.length ? (
          <section className={cn(!openCases.length && 'lg:col-span-2')}>
            <SectionHead
              index={openCases.length ? '03' : '02'}
              label={t('档案室')}
              aside={
                <span className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground">
                  {t('{count} 卷', { count: String(archives.length).padStart(2, '0') })}
                  {archives.length > 5 ? t(' · 可上下滑动') : ''}
                </span>
              }
            />
            {/* 每行 4.5rem，5 行再加上边框，正好露出 5 卷 */}
            <ul className="sheet chat-scroll mt-5 max-h-[22.75rem] overflow-y-auto px-4">
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
          </section>
        ) : null}
      </div>

      {/*
        收尾行：题库 / 官方汤往期是「另一类入口」，不该和今天这碗抢同一档重量。
        所以一律用描边按钮，实心只留给「今日」那一个动作；
        今天没有汤可玩时，才把「玩今日官方汤」补出来当入口。
      */}
      <div
        className={cn(
          'flex flex-wrap items-center gap-3',
          hasSections ? 'mt-16 border-t border-foreground/15 pt-8' : 'mt-12',
        )}
      >
        <Link
          to="/library"
          prefetchOnView
          className="group flex min-h-11 items-center gap-2.5 border border-foreground/80 px-5 font-mono text-[11px] font-bold tracking-[0.2em] transition-colors hover:bg-foreground hover:text-background"
        >
          {t('去题库挑一碗')}{' '}
          <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
        </Link>
        {todayDaily ? null : (
          <Link
            to="/daily"
            className="flex min-h-11 items-center gap-2.5 border border-foreground/80 px-5 font-mono text-[11px] font-bold tracking-[0.2em] transition-colors hover:bg-foreground hover:text-background"
          >
            {t('玩今日官方汤')} <ArrowRight className="size-3.5" />
          </Link>
        )}
        <div className="ml-auto flex items-start gap-2 font-mono text-[10px] leading-5 tracking-[0.1em] text-muted-foreground sm:tracking-[0.14em]">
          <Lock className="mt-1 size-3 shrink-0" aria-hidden="true" />
          <p className="min-w-0">
            {signedIn ? (
              t('中途离开也没关系，进度会跟着账号走，换设备也能接着玩')
            ) : (
              <>
                {t('中途离开也没关系，进度只留在本机。')}{' '}
                <Link
                  to="/login"
                  className="whitespace-nowrap text-stamp underline decoration-dotted underline-offset-4"
                >
                  {t('登录后跟着账号走')}
                </Link>
              </>
            )}
          </p>
        </div>
      </div>
    </div>
  )
}
