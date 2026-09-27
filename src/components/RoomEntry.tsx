import { UsersRound } from 'lucide-react'
import { Link } from './Link'
import { useI18n } from '@/lib/i18n'

/** Links also work before login; the destination preserves the chosen puzzle. */
export function RoomEntry({ puzzleId }: { puzzleId?: string }) {
  const { t } = useI18n()
  return (
    <Link
      to={puzzleId ? `/rooms/new?puzzle=${encodeURIComponent(puzzleId)}` : '/rooms/join'}
      className="inline-flex min-h-10 items-center gap-2 border border-foreground/25 px-3.5 font-mono text-[11px] tracking-wider transition-colors hover:border-foreground hover:bg-card"
    >
      <UsersRound className="size-4" aria-hidden />
      {t(puzzleId ? '邀朋友同桌' : '凭邀请入座')}
    </Link>
  )
}
