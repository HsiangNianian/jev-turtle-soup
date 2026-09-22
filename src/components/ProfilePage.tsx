import { useEffect, useState } from 'react'
import { Loader2, Lock } from 'lucide-react'

import { Badges, Empty, PageShell } from '@/components/Bits'
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
        <span className="font-mono text-[10px] tracking-[0.16em] text-muted-foreground">
          @{profile.handle}
        </span>
      }
    >
      {profile.bio ? (
        <div className="mt-6 max-w-xl font-serif text-[15px] leading-8 text-foreground/80">
          {renderInline(profile.bio)}
        </div>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center gap-3 font-mono text-[10px] tracking-[0.18em] text-muted-foreground">
        <span>{t('加入于 {date}', { date: formatDate(profile.createdAt) })}</span>
        {isSelf ? (
          <Link to="/me/profile" className="transition-colors hover:text-foreground">
            {t('编辑资料')}
          </Link>
        ) : null}
      </div>

      {profile.recognition?.badges.length ? (
        <Badges badges={profile.recognition.badges} className="mt-4" />
      ) : null}

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
        <>
          <div className="mt-9 font-mono text-[10px] tracking-[0.24em] text-muted-foreground">
            {t('公开的汤')}
          </div>
          <ul className="mt-3 border-t border-foreground/20">
            {profile.puzzles.map((puzzle) => (
              <li key={puzzle.id}>
                <Link
                  to={`/library/${puzzle.id}`}
                  className="rule-dashed flex items-center gap-3 py-3.5 transition-colors hover:bg-foreground/[0.03]"
                >
                  <span className="shrink-0 border border-foreground/25 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                    {t(puzzle.difficulty)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-serif text-[15px]">{puzzle.title}</span>
                    <span className="mt-0.5 block truncate font-serif text-[12px] text-muted-foreground">
                      {puzzle.surface}
                    </span>
                  </span>
                  <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
                    {puzzle.plays}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </>
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
