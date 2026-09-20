import { useEffect, useState } from 'react'
import { Loader2, Search } from 'lucide-react'

import { Empty, PageShell, inputClass } from '@/components/Bits'

import { SUPERNATURAL_TAG, listPuzzles, listTags, type LibraryPuzzle } from '@/lib/library-client'
import { cn } from '@/lib/utils'
import { Link } from '@/components/Link'

function PuzzleCard({ puzzle }: { puzzle: LibraryPuzzle }) {
  return (
    <Link
      to={`/library/${puzzle.id}`}
      className="flex h-full flex-col border border-foreground/30 bg-card p-4 transition-colors hover:border-foreground"
    >
      <div className="flex items-center gap-2 font-mono text-[10px] tracking-[0.16em] text-muted-foreground">
        <span className="border border-foreground/25 px-1.5 py-0.5">{puzzle.difficulty}</span>
        <span>游玩 {puzzle.plays}</span>
        <span>·</span>
        <span>解开 {puzzle.solves}</span>
      </div>
      <h3 className="mt-2.5 font-serif text-lg leading-snug">{puzzle.title}</h3>
      <p className="mt-1.5 line-clamp-3 font-serif text-[13px] leading-6 text-foreground/75">
        {puzzle.surface}
      </p>
      <div className="mt-auto flex items-center gap-1.5 pt-3 font-mono text-[10px] tracking-[0.14em] text-muted-foreground">
        <span className="text-stamp">@</span>
        <span className="truncate">{puzzle.owner.displayName}</span>
      </div>
    </Link>
  )
}

export function LibraryPage() {
  const [items, setItems] = useState<LibraryPuzzle[] | null>(null)
  const [sort, setSort] = useState<'new' | 'hot'>('new')
  const [query, setQuery] = useState('')
  const [tag, setTag] = useState<string | null>(null)
  const [tags, setTags] = useState<{ tag: string; count: number }[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    listTags()
      .then(setTags)
      .catch(() => setTags([]))
  }, [])

  useEffect(() => {
    let alive = true
    const timer = setTimeout(() => {
      listPuzzles({ sort, q: query.trim(), tag: tag ?? undefined })
        .then((next) => {
          if (alive) {
            setItems(next)
            setError(null)
          }
        })
        .catch((caught: unknown) => {
          if (alive) setError(caught instanceof Error ? caught.message : '加载失败')
        })
    }, query ? 250 : 0)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [sort, query, tag])

  return (
    <PageShell
      label="题库 / LIBRARY"
      title="别人熬的汤"
      meta={
        <div className="flex items-center gap-1">
          {(['new', 'hot'] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setSort(key)}
              className={cn(
                'px-2.5 py-1 font-mono text-[10px] tracking-[0.18em] transition-colors',
                sort === key ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {key === 'new' ? '最新' : '最热'}
            </button>
          ))}
        </div>
      }
    >
      <div className="mt-5 flex flex-wrap items-center gap-2">
        {[
          { tag: SUPERNATURAL_TAG, count: tags.find((item) => item.tag === SUPERNATURAL_TAG)?.count ?? 0 },
          ...tags.filter((item) => item.tag !== SUPERNATURAL_TAG),
        ].map((item) => (
          <button
            key={item.tag}
            type="button"
            onClick={() => setTag((current) => (current === item.tag ? null : item.tag))}
            className={cn(
              'border px-3 py-1.5 font-mono text-[11px] tracking-[0.14em] transition-colors',
              tag === item.tag
                ? 'border-foreground bg-foreground text-background'
                : 'border-foreground/30 text-muted-foreground hover:text-foreground',
            )}
          >
            {item.tag}
            {item.count ? <span className="ml-1.5 opacity-60">{item.count}</span> : null}
          </button>
        ))}
        {tag ? (
          <button
            type="button"
            onClick={() => setTag(null)}
            className="font-mono text-[10px] tracking-[0.16em] text-muted-foreground transition-colors hover:text-foreground"
          >
            清除筛选
          </button>
        ) : null}
      </div>

      <div className="mt-4 flex items-center gap-2.5">
        <Search className="size-4 shrink-0 text-muted-foreground" />
        <input
          value={query}
          placeholder="按标题搜索……"
          onChange={(event) => setQuery(event.target.value)}
          className={inputClass}
        />
      </div>

      {error ? <Empty>{error}</Empty> : null}
      {!items && !error ? (
        <div className="mt-12 flex justify-center text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
        </div>
      ) : null}
      {items && !items.length ? (
        <Empty>{tag ? `还没有带「${tag}」标签的汤。` : '还没有人公开过海龟汤，你可以第一个。'}</Empty>
      ) : null}

      {items?.length ? (
        <ul className="mt-6 grid gap-3 sm:grid-cols-2">
          {items.map((puzzle) => (
            <li key={puzzle.id}>
              <PuzzleCard puzzle={puzzle} />
            </li>
          ))}
        </ul>
      ) : null}
    </PageShell>
  )
}
