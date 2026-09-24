import { useEffect, useState } from 'react'
import { ArrowRight, Loader2 } from 'lucide-react'

import { Button, Empty, OfficialMark, PageShell } from '@/components/Bits'
import { SocialPanel } from '@/components/SocialPanel'
import { genreLabel } from '@/lib/library-client'

import { getPuzzle, type LibraryPuzzleDetail } from '@/lib/library-client'
import { Link } from '@/components/Link'
import { useI18n } from '@/lib/i18n'
import { trackWebEngagement } from '@/lib/engagement-client'

export function PuzzleDetailPage({
  id,
  onStart,
}: {
  id: string
  onStart: (puzzle: LibraryPuzzleDetail) => void
}) {
  const { t } = useI18n()
  const [puzzle, setPuzzle] = useState<LibraryPuzzleDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const discussionRequested = new URLSearchParams(window.location.search).get('discussion') === '1'

  useEffect(() => {
    let alive = true
    trackWebEngagement('puzzle_open', id)
    getPuzzle(id, {
      // 列表里已经有这道题了：先把已知的字段渲染出来，只等作者简介
      onStale: (known) => {
        if (alive) {
          setPuzzle(known)
          setError(null)
        }
      },
    })
      .then((next) => {
        if (alive) {
          setPuzzle(next)
          setError(null)
        }
      })
      .catch((caught: unknown) => {
        if (alive) setError(caught instanceof Error ? caught.message : t('加载失败'))
      })
    return () => {
      alive = false
    }
  }, [id, t])

  useEffect(() => {
    if (!puzzle || !discussionRequested) return
    const frame = requestAnimationFrame(() =>
      document.getElementById('discussion')?.scrollIntoView(),
    )
    return () => cancelAnimationFrame(frame)
  }, [puzzle, discussionRequested])

  if (error) {
    return (
      <PageShell label={t('案卷')} title={t('打不开这一卷')}>
        <div className="mt-6">
          <Empty>{error}</Empty>
        </div>
      </PageShell>
    )
  }

  if (!puzzle) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
      </div>
    )
  }

  return (
    <PageShell
      label={t('案卷')}
      title={puzzle.title}
      meta={
        <span className="font-mono text-[10px] tracking-[0.16em] text-muted-foreground">
          {t('游玩 {plays} · 解开 {solves}', { plays: puzzle.plays, solves: puzzle.solves })}
        </span>
      }
    >
      <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-[10px] tracking-[0.18em] text-muted-foreground">
        {puzzle.official ? <OfficialMark /> : null}
        <span className="border border-foreground/25 px-1.5 py-0.5">{t(puzzle.difficulty)}</span>
        {puzzle.tags.map((tag) => (
          <span key={tag}>#{tag}</span>
        ))}
        {genreLabel(puzzle.genreScore, t) ? (
          <span className="text-stamp/80">{genreLabel(puzzle.genreScore, t)}</span>
        ) : null}
        {/* 官方汤没有作者可点，署调查局的名字 */}
        {puzzle.official ? (
          <span className="ml-auto">{t('海龟汤调查局')}</span>
        ) : (
          <Link
            to={`/u/${puzzle.owner.handle}`}
            className="ml-auto transition-colors hover:text-foreground"
          >
            @{puzzle.owner.displayName}
          </Link>
        )}
      </div>

      <div className="mt-6 border-l-2 border-brand/50 pl-4">
        <p className="surface-prose font-serif text-[15px] leading-8 text-foreground/90">
          {puzzle.surface}
        </p>
      </div>

      <div className="mt-8 flex flex-wrap items-center gap-3">
        <Button onClick={() => onStart(puzzle)}>
          {t('开始推理')} <ArrowRight className="size-3.5" />
        </Button>
        <Link
          to="/library"
          className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground transition-colors hover:text-foreground"
        >
          {t('回到题库')}
        </Link>
      </div>

      <SocialPanel
        key={puzzle.id}
        kind="puzzle"
        id={puzzle.id}
        path={`/library/${puzzle.id}`}
        title={puzzle.title}
        spoilerGate
        initiallyExpanded={discussionRequested}
      />
    </PageShell>
  )
}
