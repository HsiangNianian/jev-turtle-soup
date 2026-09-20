import { useEffect, useState } from 'react'
import { Loader2, Plus, Trash2 } from 'lucide-react'

import { Button, Empty, Notice, PageShell } from '@/components/Bits'
import { navigate } from '@/lib/router'
import { Link } from '@/components/Link'
import {
  deletePuzzle,
  listMyPuzzles,
  updatePuzzle,
  type OwnPuzzle,
} from '@/lib/library-client'
import { cn } from '@/lib/utils'

export function MePage({ handle }: { handle: string }) {
  const [items, setItems] = useState<OwnPuzzle[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  useEffect(() => {
    listMyPuzzles()
      .then(setItems)
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : '加载失败'))
  }, [])

  async function toggle(puzzle: OwnPuzzle) {
    setBusyId(puzzle.id)
    try {
      const visibility = puzzle.visibility === 'public' ? 'private' : 'public'
      await updatePuzzle(puzzle.id, { visibility })
      setItems((prev) =>
        (prev ?? []).map((item) => (item.id === puzzle.id ? { ...item, visibility } : item)),
      )
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '修改失败')
    } finally {
      setBusyId(null)
    }
  }

  async function remove(puzzle: OwnPuzzle) {
    if (!window.confirm(`删除《${puzzle.title}》？删除后无法恢复。`)) return
    setBusyId(puzzle.id)
    try {
      await deletePuzzle(puzzle.id)
      setItems((prev) => (prev ?? []).filter((item) => item.id !== puzzle.id))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '删除失败')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <PageShell
      label="我的题库 / MY PUZZLES"
      title="我的海龟汤"
      meta={
        <Link
          to={`/u/${handle}`}
          className="font-mono text-[10px] tracking-[0.16em] text-muted-foreground transition-colors hover:text-foreground"
        >
          查看我的主页 →
        </Link>
      }
    >
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Button onClick={() => navigate('/upload')}>
          <Plus className="size-3.5" /> 上传新汤
        </Button>
        <Button variant="outline" onClick={() => navigate('/me/profile')}>
          编辑资料
        </Button>
      </div>

      {error ? (
        <div className="mt-6">
          <Notice tone="stamp">{error}</Notice>
        </div>
      ) : null}

      {!items && !error ? (
        <div className="mt-12 flex justify-center text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
        </div>
      ) : null}
      {items && !items.length ? <Empty>还没有上传过。点「上传新汤」写一个吧。</Empty> : null}

      {items?.length ? (
        <ul className="mt-7 border-t border-foreground/20">
          {items.map((puzzle) => (
            <li key={puzzle.id} className="rule-dashed flex flex-wrap items-center gap-3 py-4">
              <span
                className={cn(
                  'shrink-0 border px-1.5 py-0.5 font-mono text-[10px] font-bold tracking-[0.14em]',
                  puzzle.visibility === 'public'
                    ? 'border-[var(--v-yes)] text-[var(--v-yes)]'
                    : 'border-foreground/30 text-muted-foreground',
                )}
              >
                {puzzle.visibility === 'public' ? '公开' : '私密'}
              </span>

              <span className="min-w-0 flex-1">
                <span className="block truncate font-serif text-[15px]">{puzzle.title}</span>
                <span className="mt-0.5 block truncate font-serif text-[12px] text-muted-foreground">
                  {puzzle.surface}
                </span>
              </span>

              <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
                {puzzle.plays} / {puzzle.solves}
              </span>

              <span className="flex shrink-0 items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busyId === puzzle.id}
                  onClick={() => void toggle(puzzle)}
                >
                  {puzzle.visibility === 'public' ? '转为私密' : '设为公开'}
                </Button>
                <button
                  type="button"
                  aria-label="删除"
                  disabled={busyId === puzzle.id}
                  onClick={() => void remove(puzzle)}
                  className="flex size-8 items-center justify-center border border-foreground/30 text-muted-foreground transition-colors hover:border-stamp hover:text-stamp disabled:opacity-40"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </PageShell>
  )
}
