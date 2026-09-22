import { useEffect, useState } from 'react'
import { ArrowRight, BadgeCheck, Loader2, Lock, Unlock } from 'lucide-react'

import { Button, Empty, Notice, PageShell } from '@/components/Bits'
import { Link } from '@/components/Link'
import { findActiveDaily, type ArchivedGame } from '@/lib/archive'
import { genreLabel } from '@/lib/library-client'
import {
  dailyLanguageLabel,
  getDaily,
  listDailies,
  type DailyDetail,
  type DailySummary,
} from '@/lib/daily-client'
import { useI18n } from '@/lib/i18n'

/** 「开始推理」或「继续调查」——同一天已经有案卷时不该重开。 */
function StartButton({
  daily,
  activeGames,
  onStart,
  onContinue,
}: {
  daily: DailyDetail
  activeGames: ArchivedGame[]
  onStart: (daily: DailyDetail) => void
  onContinue: (id: string) => void
}) {
  const { t } = useI18n()
  const ongoing = findActiveDaily(activeGames, daily.date)
  return (
    <Button onClick={() => (ongoing ? onContinue(ongoing.id) : onStart(daily))}>
      {ongoing ? t('继续调查') : t('开始推理')} <ArrowRight className="size-3.5" />
    </Button>
  )
}

/**
 * 难度和题材标签。**当天的汤不显示标签** —— 标签会直接点名题材
 * （#怪力乱神、#电梯 之类），对还没揭晓的汤来说等于剧透。
 * 过期进了题库之后才和别的题一样带上标签。
 */
function Meta({
  difficulty,
  tags,
  locked = false,
}: {
  difficulty: string
  tags: string[]
  locked?: boolean
}) {
  const { t } = useI18n()
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-[10px] tracking-[0.18em] text-muted-foreground">
      <span className="border border-foreground/25 px-1.5 py-0.5">{t(difficulty)}</span>
      {locked ? null : tags.map((tag) => <span key={tag}>#{tag}</span>)}
    </div>
  )
}

/**
 * 今天这碗只报「多少人问过」，不报解开人数 —— 那等于提前告诉读者这道题有多难。
 * 过期之后 solves 才有值，就按题库卡片那样报两个数。
 *
 * 注意口径：这是**累计**人数（按设备去重，从这碗汤生成起算），不是「此刻在线」。
 * 它只增不减，所以措辞必须是「问过」而不是「正在问」。
 */
function Counts({ plays, solves }: { plays: number; solves: number | null }) {
  const { t } = useI18n()
  return (
    <span className="font-mono text-[10px] tracking-[0.16em] text-muted-foreground">
      {solves === null
        ? t('{count} 人问过', { count: plays })
        : t('游玩 {plays} · 解开 {solves}', { plays, solves })}
    </span>
  )
}

/** 这碗汤是什么语言写的；读者界面语言未必相同，所以明说一句。顺带报出题材落点。 */
function LanguageNote({
  locale,
  genreScore,
}: {
  locale: DailySummary['locale']
  genreScore?: number | null
}) {
  const { t } = useI18n()
  const genre = genreLabel(genreScore, t)
  return (
    <span className="flex flex-wrap items-center gap-x-3 font-mono text-[10px] tracking-[0.16em] text-muted-foreground">
      <span>{t('今天的汤是{language}的', { language: dailyLanguageLabel(locale, t) })}</span>
      {genre ? <span className="text-stamp/80">{genre}</span> : null}
    </span>
  )
}

function Surface({ text }: { text: string }) {
  return (
    <div className="mt-6 border-l-2 border-brand/50 pl-4">
      <p className="surface-prose font-serif text-[15px] leading-8 text-foreground/90">{text}</p>
    </div>
  )
}

export function DailyDetailPage({
  date,
  activeGames,
  games,
  onStart,
  onContinue,
}: {
  date: string
  activeGames: ArchivedGame[]
  /** 本地所有对局：用来判断这一天的汤底该不该给这个人看 */
  games: ArchivedGame[]
  onStart: (daily: DailyDetail) => void
  onContinue: (id: string) => void
}) {
  const { t } = useI18n()
  const [daily, setDaily] = useState<DailyDetail | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    getDaily(date)
      .then((next) => {
        if (alive) {
          setDaily(next)
          setError(null)
        }
      })
      .catch((caught: unknown) => {
        if (alive) setError(caught instanceof Error ? caught.message : t('加载失败'))
      })
    return () => {
      alive = false
    }
  }, [date, t])

  const record = daily ? games.find((game) => game.id === daily.puzzleId) : undefined
  const unlocked = Boolean(record && (record.solved || record.revealed))

  if (error) {
    return (
      <PageShell label={t('官方汤')} title={t('打不开这一碗')}>
        <div className="mt-6">
          <Empty>{error}</Empty>
        </div>
        <div className="mt-6">
          <Link
            to="/daily"
            className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground transition-colors hover:text-foreground"
          >
            {t('回到每日官方汤')}
          </Link>
        </div>
      </PageShell>
    )
  }

  if (!daily) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
      </div>
    )
  }

  return (
    <PageShell title={daily.title}>
      {/* 日期、人数、语言、题材全部并到「难度」这一行 —— 它们本来就是同一类元信息 */}
      <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-[10px] tracking-[0.18em] text-muted-foreground">
        {/* 认证勋章就放在难度左边，和题库卡片上那枚「官汤」位置一致 */}
        <span className="flex items-center gap-1.5 text-stamp">
          <BadgeCheck className="size-3.5" aria-hidden />
          {t('官方')}
        </span>
        <span className="border border-foreground/25 px-1.5 py-0.5">{t(daily.difficulty)}</span>
        {daily.locked ? null : daily.tags.map((tag) => <span key={tag}>#{tag}</span>)}
        {genreLabel(daily.genreScore, t) ? (
          <span className="text-stamp/80">{genreLabel(daily.genreScore, t)}</span>
        ) : null}
        <span>{daily.date}</span>
        <Counts plays={daily.plays} solves={daily.solves} />
        <span>{t('这一碗是{language}的', { language: dailyLanguageLabel(daily.locale, t) })}</span>
      </div>
      <Surface text={daily.surface} />

      {daily.locked ? (
        <div className="mt-6">
          <Notice tone="stamp">{t('今天的官方汤还不能揭晓——过了午夜，汤底会自己浮上来。')}</Notice>
        </div>
      ) : !unlocked ? (
        /*
         * 往期的汤底不白给：本地没有「结案 / 揭晓过」的记录就先藏着。
         * 这只是不让人不小心剧透自己——接口本来就返回这些内容，
         * 存心想看的人绕得过去，但正常点进来的人不会撞见答案。
         */
        <div className="mt-6">
          <Notice>
            {t('你还没解开这一天。先自己问一问——结案或揭晓之后，汤底和完整故事都会回到这一页。')}
          </Notice>
        </div>
      ) : (
        <>
          {daily.truth ? (
            <div className="animate-pop mt-8 border-l-4 border-stamp pl-5">
              <div className="flex items-center gap-2 font-mono text-[10px] tracking-[0.26em] text-stamp">
                <Unlock className="size-3.5" /> {t('汤底')}
              </div>
              <p className="mt-3 font-serif text-[15px] leading-8 text-foreground/90">
                {daily.truth}
              </p>
            </div>
          ) : null}

          {daily.story ? (
            <div className="mt-8">
              <div className="font-mono text-[10px] tracking-[0.26em] text-muted-foreground">
                {t('完整故事')}
              </div>
              <p className="mt-3 font-serif text-[15px] leading-8 text-foreground/80">
                {daily.story}
              </p>
            </div>
          ) : null}

          {daily.hint ? (
            <div className="mt-8 border-t border-dashed border-foreground/25 pt-5">
              <div className="font-mono text-[10px] tracking-[0.26em] text-muted-foreground">
                {t('提示')}
              </div>
              <p className="mt-2 font-serif text-[14px] leading-7 text-foreground/75">
                {daily.hint}
              </p>
            </div>
          ) : null}
        </>
      )}

      <div className="mt-8 flex flex-wrap items-center gap-3">
        <StartButton
          daily={daily}
          activeGames={activeGames}
          onStart={onStart}
          onContinue={onContinue}
        />
        <Link
          to="/daily"
          className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground transition-colors hover:text-foreground"
        >
          {t('回到每日官方汤')}
        </Link>
      </div>
    </PageShell>
  )
}

export function DailyIndexPage({
  activeGames,
  onStart,
  onContinue,
}: {
  activeGames: ArchivedGame[]
  onStart: (daily: DailyDetail) => void
  onContinue: (id: string) => void
}) {
  const { t } = useI18n()
  const [today, setToday] = useState<DailyDetail | null>(null)
  const [history, setHistory] = useState<DailySummary[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let alive = true
    listDailies()
      .then((data) => {
        if (!alive) return
        setToday(data.today)
        setHistory(data.history)
        setLoaded(true)
      })
      .catch(() => {
        if (alive) setLoaded(true)
      })
    return () => {
      alive = false
    }
  }, [])

  const past = history.filter((item) => item.date !== today?.date)

  return (
    <PageShell label={t('官方汤')} title={t('每日官方汤')}>
      <p className="mt-5 max-w-xl font-serif text-[14px] leading-7 text-foreground/75">
        {t(
          '每天零点（UTC）由砚熬一碗，所有人都拿到同一道题。当天的汤只能问，不能揭晓；过了午夜就能回看汤底。',
        )}
      </p>

      {!loaded ? (
        <div className="mt-8 flex justify-center text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
        </div>
      ) : today ? (
        <div className="mt-8 border border-foreground bg-card">
          <div className="flex items-center justify-between gap-3 border-b border-foreground px-4 py-3 sm:px-5">
            <span className="font-mono text-[10px] tracking-[0.24em] text-muted-foreground">
              {t('今日')} · {today.date}
            </span>
            <span className="stamp flex items-center gap-1.5 px-2 py-0.5 font-mono text-[10px] font-bold tracking-[0.2em]">
              <Lock className="size-3" /> {t('明日解锁')}
            </span>
          </div>
          <div className="px-4 py-5 sm:px-5">
            <h2 className="font-serif text-2xl leading-snug font-semibold">{today.title}</h2>
            <Meta difficulty={today.difficulty} tags={today.tags} locked={today.locked} />
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
              <Counts plays={today.plays} solves={today.solves} />
              <LanguageNote locale={today.locale} genreScore={today.genreScore} />
            </div>
            <div className="mt-5 border-l-2 border-brand/50 pl-4">
              <p className="surface-prose font-serif text-[15px] leading-8 text-foreground/90">
                {today.surface}
              </p>
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <StartButton
                daily={today}
                activeGames={activeGames}
                onStart={onStart}
                onContinue={onContinue}
              />
              <Link
                to={`/daily/${today.date}`}
                className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground transition-colors hover:text-foreground"
              >
                {t('查看案卷')}
              </Link>
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-8">
          <Notice>{t('今天的汤还在熬，稍后再来。')}</Notice>
        </div>
      )}

      {past.length ? (
        <div className="mt-12">
          <div className="flex items-baseline justify-between">
            <span className="font-mono text-[10px] tracking-[0.26em] text-muted-foreground">
              {t('往期')}
            </span>
            <span className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground/70">
              {t('{count} 碗', { count: String(past.length).padStart(2, '0') })}
            </span>
          </div>
          <ul className="mt-3 border-t border-foreground/25">
            {past.map((item) => (
              <li key={item.date} className="rule-dashed">
                <Link
                  to={`/daily/${item.date}`}
                  className="flex items-center gap-3 py-3 transition-colors hover:text-foreground"
                >
                  <span className="shrink-0 font-mono text-[10px] tracking-[0.14em] text-muted-foreground">
                    {item.date}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-serif text-[15px]">
                    {item.title}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] tracking-[0.16em] text-muted-foreground">
                    {dailyLanguageLabel(item.locale, t)}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] tracking-[0.16em] text-muted-foreground">
                    {t(item.difficulty)}
                  </span>
                  <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-8">
        <Link
          to="/"
          className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground transition-colors hover:text-foreground"
        >
          {t('回首页')}
        </Link>
      </div>
    </PageShell>
  )
}
