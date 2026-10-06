import { useCallback, useEffect, useRef, useState } from 'react'
import { CircleCheck, Eye, Loader2, Search } from 'lucide-react'

import { Difficulty, Empty, OfficialMark, PageShell } from '@/components/Bits'

import { genreLabel, listPuzzles, rerankPuzzles, type LibraryPuzzle } from '@/lib/library-client'
import { Link } from '@/components/Link'
import { GenreSlider, GENRE_NEUTRAL } from '@/components/GenreSlider'
import { useI18n } from '@/lib/i18n'

/** 打完字停多久才让 Jev 重排。重排是一次模型调用，不能跟着每一次按键跑。 */
const RERANK_DELAY_MS = 700

function PuzzleCard({ puzzle }: { puzzle: LibraryPuzzle }) {
  const { t } = useI18n()
  // 和对局页「案卷 NO.」同一种取法：从 id 里抽数字，稳定不随排序变
  const caseNo = (puzzle.id.replace(/\D/g, '').slice(-3) || '000').padStart(3, '0')
  const label = genreLabel(puzzle.genreScore, t)
  return (
    <Link
      to={`/library/${puzzle.id}`}
      className="sheet sheet-hover sheet-fold group flex h-full flex-col p-5"
    >
      <div className="flex items-center gap-2 font-mono text-[10px] tracking-[0.16em] text-muted-foreground">
        {puzzle.official ? <OfficialMark /> : null}
        {puzzle.mode === 'cloze' ? (
          <span className="rounded-full bg-stamp-soft px-2 py-0.5 text-stamp">汤底填空</span>
        ) : null}
        {puzzle.featured ? (
          <span className="rounded-full bg-stamp px-2 py-0.5 font-bold tracking-[0.14em] text-[#fbf6ec]">
            {t('精选')}
          </span>
        ) : null}
        <span className="ml-auto tabular-nums text-muted-foreground/70">No.{caseNo}</span>
      </div>
      <h3 className="mt-4 font-serif text-[20px] leading-snug font-semibold transition-colors group-hover:text-stamp">
        {puzzle.title}
      </h3>
      <p className="mt-2 line-clamp-3 font-serif text-[14px] leading-7 text-foreground/75">
        {puzzle.surface}
      </p>
      <div className="mt-auto pt-5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-dashed border-foreground/15 pt-3 font-mono text-[10px] tracking-[0.12em] text-muted-foreground">
          <Difficulty value={puzzle.difficulty} />
          {label ? <span className="text-stamp/80">{label}</span> : null}
          <span className="ml-auto inline-flex items-center gap-3 tabular-nums">
            <span
              title={t('游玩 {plays}', { plays: puzzle.plays })}
              className="inline-flex items-center gap-1"
            >
              <Eye className="size-3" aria-hidden />
              {puzzle.plays}
            </span>
            <span
              title={t('解开 {solves}', { solves: puzzle.solves })}
              className="inline-flex items-center gap-1"
            >
              <CircleCheck className="size-3" aria-hidden />
              {puzzle.solves}
            </span>
          </span>
        </div>
        <div className="mt-2 flex items-center gap-1.5 font-mono text-[10px] tracking-[0.14em] text-muted-foreground">
          {puzzle.official ? (
            <span className="truncate">{t('海龟汤调查局')}</span>
          ) : (
            <>
              <span className="text-stamp">@</span>
              <span className="truncate">{puzzle.owner.displayName}</span>
            </>
          )}
        </div>
      </div>
    </Link>
  )
}

export function LibraryPage({ mode }: { mode?: 'cloze' }) {
  const { t } = useI18n()
  const [items, setItems] = useState<LibraryPuzzle[] | null>(null)
  const [sort, setSort] = useState<'new' | 'hot' | 'featured'>('new')
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
          { sort, q: trimmed, genre: genreFilter, mode },
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
            { sort, q: trimmed, genre: genreFilter, mode },
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
    [sort, genreFilter, mode, t],
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
      wide
      label={t('题库')}
      title={mode === 'cloze' ? '汤底填空' : t('别人熬的汤')}
      lead={
        mode === 'cloze'
          ? '汤底被挖掉了几处字。一边向砚提问，一边把缺的字一格一格补回去，补齐就是真相。'
          : undefined
      }
      meta={
        <div className="flex items-center gap-1 rounded-full border border-foreground/15 bg-sheet/60 p-1">
          {(['new', 'hot', 'featured'] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setSort(key)}
              aria-pressed={sort === key}
              className="chip min-h-7 hover:border-transparent"
            >
              {key === 'new' ? t('最新') : key === 'hot' ? t('最热') : t('精选')}
            </button>
          ))}
        </div>
      }
    >
      {mode === 'cloze' ? (
        <Link
          to="/upload"
          className="mt-6 inline-flex min-h-10 items-center gap-2 rounded-full bg-stamp-soft px-4 font-mono text-[11px] tracking-wider text-stamp transition-colors hover:bg-stamp hover:text-[#fbf6ec]"
        >
          <span className="size-1.5 rounded-full bg-current" aria-hidden />
          上传一碗填空汤 →
        </Link>
      ) : null}
      <div className="sheet mt-8 px-5 pt-5 pb-2 sm:px-7">
        <div className="flex items-center gap-3 border-b border-foreground/15 pb-4 focus-within:border-foreground">
          <Search className="size-5 shrink-0 text-muted-foreground" />
          <input
            value={query}
            placeholder={t('搜索标题、汤面、标签或作者……')}
            onChange={(event) => setQuery(event.target.value)}
            className="min-w-0 flex-1 bg-transparent font-serif text-lg outline-none placeholder:text-muted-foreground/60"
          />
          {reranking ? (
            <span className="flex shrink-0 items-center gap-1.5 font-mono text-[10px] tracking-[0.16em] text-muted-foreground">
              <Loader2 className="size-3 animate-spin" />
              {t('语义重排中…')}
            </span>
          ) : reranked ? (
            <span className="shrink-0 rounded-full bg-stamp-soft px-2 py-0.5 font-mono text-[10px] tracking-[0.16em] text-stamp">
              {t('已按语义重排')}
            </span>
          ) : null}
        </div>
        <GenreSlider onCommit={setCommittedGenre} />
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
        <ul className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((puzzle, index) => (
            <li
              key={puzzle.id}
              className="animate-rise-in"
              style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
            >
              <PuzzleCard puzzle={puzzle} />
            </li>
          ))}
        </ul>
      ) : null}
    </PageShell>
  )
}
