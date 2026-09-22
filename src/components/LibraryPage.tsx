import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Search } from 'lucide-react'

import { Empty, OfficialMark, PageShell, inputClass } from '@/components/Bits'

import { genreLabel, listPuzzles, rerankPuzzles, type LibraryPuzzle } from '@/lib/library-client'
import { cn } from '@/lib/utils'
import { Link } from '@/components/Link'
import { GenreSlider, GENRE_NEUTRAL } from '@/components/GenreSlider'
import { useI18n } from '@/lib/i18n'

/** 打完字停多久才让 Jev 重排。重排是一次模型调用，不能跟着每一次按键跑。 */
const RERANK_DELAY_MS = 700

function PuzzleCard({ puzzle }: { puzzle: LibraryPuzzle }) {
  const { t } = useI18n()
  const label = genreLabel(puzzle.genreScore, t)
  return (
    <Link
      to={`/library/${puzzle.id}`}
      className="flex h-full flex-col border border-foreground/30 bg-card p-4 transition-colors hover:border-foreground"
    >
      <div className="flex items-center gap-2 font-mono text-[10px] tracking-[0.16em] text-muted-foreground">
        {puzzle.official ? <OfficialMark /> : null}
        <span className="border border-foreground/25 px-1.5 py-0.5">{t(puzzle.difficulty)}</span>
        <span>{t('游玩 {plays}', { plays: puzzle.plays })}</span>
        <span>·</span>
        <span>{t('解开 {solves}', { solves: puzzle.solves })}</span>
        {label ? <span className="ml-auto text-stamp/80">{label}</span> : null}
      </div>
      <h3 className="mt-2.5 font-serif text-lg leading-snug">{puzzle.title}</h3>
      <p className="mt-1.5 line-clamp-3 font-serif text-[13px] leading-6 text-foreground/75">
        {puzzle.surface}
      </p>
      <div className="mt-auto flex items-center gap-1.5 pt-3 font-mono text-[10px] tracking-[0.14em] text-muted-foreground">
        {puzzle.official ? (
          <span className="truncate">{t('海龟汤调查局')}</span>
        ) : (
          <>
            <span className="text-stamp">@</span>
            <span className="truncate">{puzzle.owner.displayName}</span>
          </>
        )}
      </div>
    </Link>
  )
}

export function LibraryPage() {
  const { t } = useI18n()
  const [items, setItems] = useState<LibraryPuzzle[] | null>(null)
  const [sort, setSort] = useState<'new' | 'hot'>('new')
  const [query, setQuery] = useState('')
  // 滑块自己管游标的实时跟手；只有松手那一刻的值才会到这里来触发检索。
  const [committedGenre, setCommittedGenre] = useState(GENRE_NEUTRAL)
  const [error, setError] = useState<string | null>(null)
  // 语义重排是异步补上的：先给关键字结果，重排回来再换一次顺序
  const [reranking, setReranking] = useState(false)
  const [reranked, setReranked] = useState(false)
  const rerankToken = useRef(0)

  // 居中 = 不挑题材；一旦拖动就让服务端按「离这个位置多近」排序
  const genreFilter = committedGenre === GENRE_NEUTRAL ? undefined : committedGenre

  const search = useCallback(
    async (text: string, signal: { alive: boolean }) => {
      const trimmed = text.trim()
      let keywords: LibraryPuzzle[] = []
      try {
        // 本地优先：上次同一组筛选条件的结果先上屏，网络回来再替换
        keywords = await listPuzzles(
          { sort, q: trimmed, genre: genreFilter },
          {
            onStale: (cached) => {
              if (!signal.alive) return
              setItems(cached)
              setError(null)
            },
          },
        )
        if (!signal.alive) return
        setItems(keywords)
        setError(null)
      } catch (caught) {
        if (signal.alive) setError(caught instanceof Error ? caught.message : t('加载失败'))
        return
      }
      if (signal.alive) {
        setReranked(false)
        setReranking(false)
      }

      // 关键字结果先上屏；停手之后再让 Jev 把这一批候选重排
      if (trimmed.length < 2 || keywords.length < 2) return
      const token = (rerankToken.current += 1)
      window.setTimeout(async () => {
        if (!signal.alive || token !== rerankToken.current) return
        setReranking(true)
        try {
          const ranked = await rerankPuzzles(
            { sort, q: trimmed, genre: genreFilter },
            {
              onStale: (cached) => {
                if (!signal.alive || token !== rerankToken.current) return
                setItems(cached)
                setReranked(true)
              },
            },
          )
          if (!signal.alive || token !== rerankToken.current) return
          setItems(ranked)
          setReranked(true)
        } catch {
          /* 重排失败就保持关键字顺序，不打扰用户 */
        } finally {
          if (signal.alive && token === rerankToken.current) setReranking(false)
        }
      }, RERANK_DELAY_MS)
    },
    [sort, genreFilter, t],
  )

  useEffect(() => {
    const signal = { alive: true }
    // 打字时每一帧都发请求太浪费，压到 220ms
    const timer = setTimeout(() => void search(query, signal), query ? 220 : 0)
    return () => {
      signal.alive = false
      clearTimeout(timer)
    }
  }, [query, search])

  return (
    <PageShell
      label={t('题库')}
      title={t('别人熬的汤')}
      meta={
        <div className="flex items-center gap-1">
          {(['new', 'hot'] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setSort(key)}
              className={cn(
                'px-2.5 py-1 font-mono text-[10px] tracking-[0.18em] transition-colors',
                sort === key
                  ? 'bg-foreground text-background'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {key === 'new' ? t('最新') : t('最热')}
            </button>
          ))}
        </div>
      }
    >
      <GenreSlider onCommit={setCommittedGenre} />

      <div className="mt-4 flex items-center gap-2.5">
        <Search className="size-4 shrink-0 text-muted-foreground" />
        <input
          value={query}
          placeholder={t('搜索标题、汤面、标签或作者……')}
          onChange={(event) => setQuery(event.target.value)}
          className={inputClass}
        />
        {reranking ? (
          <span className="flex shrink-0 items-center gap-1.5 font-mono text-[10px] tracking-[0.16em] text-muted-foreground">
            <Loader2 className="size-3 animate-spin" />
            {t('语义重排中…')}
          </span>
        ) : reranked ? (
          <span className="shrink-0 font-mono text-[10px] tracking-[0.16em] text-muted-foreground">
            {t('已按语义重排')}
          </span>
        ) : null}
      </div>

      {error ? <Empty>{error}</Empty> : null}
      {!items && !error ? (
        <div className="mt-12 flex justify-center text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
        </div>
      ) : null}
      {items && !items.length ? (
        <Empty>
          {query.trim()
            ? t('没有找到相关的汤，换个说法试试。')
            : t('还没有人公开过海龟汤，你可以第一个。')}
        </Empty>
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
