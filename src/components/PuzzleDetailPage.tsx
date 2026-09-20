import { useEffect, useState } from 'react'
import { ArrowRight, Loader2 } from 'lucide-react'

import { Button, Empty, Notice, PageShell } from '@/components/Bits'

import { getPuzzle, type LibraryPuzzleDetail } from '@/lib/library-client'
import { Link } from '@/components/Link'

export function PuzzleDetailPage({
  id,
  onStart,
}: {
  id: string
  onStart: (puzzle: LibraryPuzzleDetail) => void
}) {
  const [puzzle, setPuzzle] = useState<LibraryPuzzleDetail | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    getPuzzle(id)
      .then((next) => {
        if (alive) {
          setPuzzle(next)
          setError(null)
        }
      })
      .catch((caught: unknown) => {
        if (alive) setError(caught instanceof Error ? caught.message : '加载失败')
      })
    return () => {
      alive = false
    }
  }, [id])

  if (error) {
    return (
      <PageShell label="案卷 / CASE" title="打不开这一卷">
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
      label="案卷 / CASE"
      title={puzzle.title}
      meta={
        <span className="font-mono text-[10px] tracking-[0.16em] text-muted-foreground">
          游玩 {puzzle.plays} · 解开 {puzzle.solves}
        </span>
      }
    >
      <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-[10px] tracking-[0.18em] text-muted-foreground">
        <span className="border border-foreground/25 px-1.5 py-0.5">{puzzle.difficulty}</span>
        {puzzle.tags.map((tag) => (
          <span key={tag}>#{tag}</span>
        ))}
        <Link
          to={`/u/${puzzle.owner.handle}`}
          className="ml-auto transition-colors hover:text-foreground"
        >
          @{puzzle.owner.displayName}
        </Link>
      </div>

      <div className="mt-6 border-l-2 border-brand/50 pl-4">
        <p className="surface-prose font-serif text-[15px] leading-8 text-foreground/90">
          {puzzle.surface}
        </p>
      </div>

      <div className="mt-8 flex flex-wrap items-center gap-3">
        <Button onClick={() => onStart(puzzle)}>
          开始推理 <ArrowRight className="size-3.5" />
        </Button>
        <Link
          to="/library"
          className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground transition-colors hover:text-foreground"
        >
          回到题库
        </Link>
      </div>

      <div className="mt-8">
        <Notice>汤底在服务器上，主持人判读时会读取它；你这边只会拿到「是 / 不是 / 无关」。</Notice>
      </div>
    </PageShell>
  )
}
