import { BookOpen, CalendarDays, Inbox, UserRound } from 'lucide-react'

import { Link } from '@/components/Link'
import { useI18n } from '@/lib/i18n'
import { cn } from '@/lib/utils'

export function MobileNavigation({
  path,
  signedIn,
  unread,
}: {
  path: string
  signedIn: boolean
  unread: number
}) {
  const { t } = useI18n()
  const tabs = [
    {
      to: '/',
      label: t('调查局'),
      icon: Inbox,
      active: path === '/' || path.startsWith('/archive/'),
    },
    {
      to: '/daily',
      label: t('每日'),
      icon: CalendarDays,
      active: path.startsWith('/daily'),
    },
    {
      to: '/library',
      label: t('题库'),
      icon: BookOpen,
      active: path.startsWith('/library'),
    },
    {
      to: signedIn ? '/me' : '/login',
      label: t('我的'),
      icon: UserRound,
      active: path.startsWith('/me') || path === '/login' || path === '/upload',
    },
  ]

  return (
    <nav
      aria-label={t('主要导航')}
      className="z-20 grid shrink-0 grid-cols-4 border-t border-bar-foreground/20 bg-bar px-2 pb-[env(safe-area-inset-bottom)] text-bar-foreground sm:hidden"
    >
      {tabs.map(({ to, label, icon: Icon, active }) => (
        <Link
          key={to}
          to={to}
          aria-current={active ? 'page' : undefined}
          className={cn(
            'relative flex min-h-14 flex-col items-center justify-center gap-1 font-mono text-[10px] tracking-[0.08em] transition-colors',
            active ? 'text-bar-foreground' : 'text-bar-foreground/55 hover:text-bar-foreground',
          )}
        >
          {active ? (
            <span aria-hidden="true" className="absolute top-0 h-0.5 w-8 bg-stamp" />
          ) : null}
          <span className="relative inline-flex">
            <Icon
              aria-hidden="true"
              className={cn('size-[18px] stroke-[1.6]', active && 'text-stamp')}
            />
            {to === '/me' && unread > 0 ? (
              <span
                aria-label={t('有新动态')}
                className="absolute -top-1 -right-1 size-1.5 rounded-full bg-stamp"
              />
            ) : null}
          </span>
          <span>{label}</span>
        </Link>
      ))}
    </nav>
  )
}
