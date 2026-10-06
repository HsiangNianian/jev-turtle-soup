import { useEffect, useState } from 'react'
import { Eye, Loader2, Lock } from 'lucide-react'

import { Badges, Difficulty, Empty, PageShell } from '@/components/Bits'
import { SocialPanel } from '@/components/SocialPanel'

import { getPublicProfile, type PublicProfile } from '@/lib/library-client'
import { renderInline } from '@/lib/markdown'
import { Link } from '@/components/Link'
import { useI18n } from '@/lib/i18n'

export function ProfilePage({ handle, isSelf }: { handle: string; isSelf: boolean }) {
  const { t, formatDate } = useI18n()
  const [profile, setProfile] = useState<PublicProfile | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    getPublicProfile(handle, {
      onStale: (known) => {
        if (alive) {
          setProfile(known)
          setError(null)
        }
      },
    })
      .then((next) => {
        if (alive) {
          setProfile(next)
          setError(null)
        }
      })
      .catch((caught: unknown) => {
        if (alive) setError(caught instanceof Error ? caught.message : t('加载失败'))
      })
    return () => {
      alive = false
    }
  }, [handle, t])

  if (error) {
    return (
      <PageShell label={t('作者')} title={t('找不到这个作者')}>
        <div className="mt-6">
          <Empty>{error}</Empty>
        </div>
      </PageShell>
    )
  }

  if (!profile) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
      </div>
    )
  }

  return (
    <PageShell
      label={t('作者')}
      title={profile.displayName}
      meta={
        <span className="font-mono text-[11px] tracking-[0.16em] text-muted-foreground">
          @{profile.handle}
        </span>
      }
    >
      <div className="sheet mt-8 flex flex-col gap-5 p-5 sm:flex-row sm:items-start sm:p-6">
        <span
          aria-hidden
          className="flex size-16 shrink-0 items-center justify-center rounded-full bg-foreground font-serif text-2xl text-background ring-4 ring-stamp-soft"
        >
          {profile.displayName.slice(0, 1)}
        </span>
        <div className="min-w-0 flex-1">
          {profile.bio ? (
            <div className="font-serif text-[15px] leading-8 text-foreground/85">
              {renderInline(profile.bio)}
            </div>
          ) : (
            <p className="font-serif text-[15px] leading-8 text-muted-foreground">
              {t('这位作者还没有写简介。')}
            </p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-[10px] tracking-[0.16em] text-muted-foreground">
            <span>{t('加入于 {date}', { date: formatDate(profile.createdAt) })}</span>
            {profile.puzzles.length ? (
              <span>{t('{count} 碗公开的汤', { count: profile.puzzles.length })}</span>
            ) : null}
            {isSelf ? (
              <Link to="/me/profile" className="ink-link text-stamp">
                {t('编辑资料')} →
              </Link>
            ) : null}
          </div>
          {profile.recognition?.badges.length ? (
            <Badges badges={profile.recognition.badges} className="mt-4" />
          ) : null}
        </div>
      </div>

      {!profile.profilePublic ? (
        <div className="mt-8 flex items-center gap-3 border border-dashed border-foreground/25 px-5 py-8 font-mono text-[11px] tracking-[0.16em] text-muted-foreground">
          <Lock className="size-4 shrink-0" />
          {t('这位作者把主页设为私密了。')}
        </div>
      ) : null}

      {profile.profilePublic && !profile.puzzles.length ? (
        <Empty>{t('还没有公开的海龟汤。')}</Empty>
      ) : null}

      {profile.puzzles.length ? (
        <section className="mt-12">
          <div className="flex items-end justify-between border-b border-foreground/20 pb-3">
            <h2 className="font-serif text-xl leading-none font-semibold tracking-wide">
              {t('公开的汤')}
            </h2>
            <span className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground">
              {String(profile.puzzles.length).padStart(2, '0')}
            </span>
          </div>
          <ul className="mt-5 grid gap-4 sm:grid-cols-2">
            {profile.puzzles.map((puzzle) => (
              <li key={puzzle.id}>
                <Link
                  to={`/library/${puzzle.id}`}
                  className="sheet sheet-hover sheet-fold group flex h-full flex-col p-5"
                >
                  <span className="font-serif text-lg leading-snug font-semibold transition-colors group-hover:text-stamp">
                    {puzzle.title}
                  </span>
                  <span className="mt-2 line-clamp-2 font-serif text-[13px] leading-6 text-foreground/70">
                    {puzzle.surface}
                  </span>
                  <span className="mt-auto flex items-center justify-between gap-3 pt-4 font-mono text-[10px] tracking-[0.12em] text-muted-foreground">
                    <Difficulty value={puzzle.difficulty} />
                    <span className="inline-flex items-center gap-1 tabular-nums">
                      <Eye className="size-3" aria-hidden />
                      {puzzle.plays}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {profile.profilePublic ? (
        <SocialPanel
          kind="profile"
          id={profile.handle}
          path={`/u/${profile.handle}`}
          title={profile.displayName}
        />
      ) : null}
    </PageShell>
  )
}
