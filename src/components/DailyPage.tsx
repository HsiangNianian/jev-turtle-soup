import { useEffect, useState } from 'react'
import { ArrowRight, Loader2, Lock, Unlock } from 'lucide-react'

import { Button, Empty, Notice, PageShell } from '@/components/Bits'
import { Link } from '@/components/Link'
import { findActiveDaily, type ArchivedGame } from '@/lib/archive'
import { getDaily, listDailies, type DailyDetail, type DailySummary } from '@/lib/daily-client'
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

function Meta({ difficulty, tags }: { difficulty: string; tags: string[] }) {
  const { t } = useI18n()
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-[10px] tracking-[0.18em] text-muted-foreground">
      <span className="border border-foreground/25 px-1.5 py-0.5">{t(difficulty)}</span>
      {tags.map((tag) => (
        <span key={tag}>#{tag}</span>
      ))}
    </div>
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
  onStart,
  onContinue,
}: {
  date: string
  activeGames: ArchivedGame[]
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
    <PageShell
      label={t('官方汤')}
      title={daily.title}
      meta={
        <span className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground">
          {daily.date}
        </span>
      }
    >
      <Meta difficulty={daily.difficulty} tags={daily.tags} />
      <Surface text={daily.surface} />

      {daily.locked ? (
        <div className="mt-6">
          <Notice tone="stamp">{t('今天的官方汤还不能揭晓——过了午夜，汤底会自己浮上来。')}</Notice>
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
            <Meta difficulty={today.difficulty} tags={today.tags} />
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
