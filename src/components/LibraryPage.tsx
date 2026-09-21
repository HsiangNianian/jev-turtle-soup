import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, Loader2, Search } from 'lucide-react'

import { Empty, PageShell, inputClass } from '@/components/Bits'

import { SUPERNATURAL_TAG, listPuzzles, listTags, type LibraryPuzzle } from '@/lib/library-client'
import { cn } from '@/lib/utils'
import { Link } from '@/components/Link'
import { useI18n } from '@/lib/i18n'

/** 「怪力乱神」常驻第一个，加上数量最高的九个，一共十格。 */
const TAG_SLOTS = 10

/** 滑块的默认位置：居中 = 不挑题材，列表还是按 最新 / 最热 排。 */
const GENRE_NEUTRAL = 50

function genreLabel(score: number | null, t: (key: string) => string): string | null {
  if (typeof score !== 'number') return null
  return score >= GENRE_NEUTRAL ? `${t('变格度')} ${score}` : `${t('本格度')} ${100 - score}`
}

function PuzzleCard({ puzzle }: { puzzle: LibraryPuzzle }) {
  const { t } = useI18n()
  const label = genreLabel(puzzle.genreScore, t)
  return (
    <Link
      to={`/library/${puzzle.id}`}
      className="flex h-full flex-col border border-foreground/30 bg-card p-4 transition-colors hover:border-foreground"
    >
      <div className="flex items-center gap-2 font-mono text-[10px] tracking-[0.16em] text-muted-foreground">
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
        <span className="text-stamp">@</span>
        <span className="truncate">{puzzle.owner.displayName}</span>
      </div>
    </Link>
  )
}

export function LibraryPage() {
  const { t } = useI18n()
  const [items, setItems] = useState<LibraryPuzzle[] | null>(null)
  const [sort, setSort] = useState<'new' | 'hot'>('new')
  const [query, setQuery] = useState('')
  const [tag, setTag] = useState<string | null>(null)
  const [tags, setTags] = useState<{ tag: string; count: number }[]>([])
  const [tagsOpen, setTagsOpen] = useState(false)
  const [genre, setGenre] = useState(GENRE_NEUTRAL)
  const [error, setError] = useState<string | null>(null)

  // 居中 = 不挑题材；一旦拖动就让服务端按「离这个位置多近」排序
  const genreFilter = genre === GENRE_NEUTRAL ? undefined : genre

  useEffect(() => {
    listTags()
      .then(setTags)
      .catch(() => setTags([]))
  }, [])

  useEffect(() => {
    let alive = true
    // 拖动时每一帧都发请求太浪费，压到 120ms：手感上还是「实时」
    const timer = setTimeout(
      () => {
        listPuzzles({ sort, q: query.trim(), tag: tag ?? undefined, genre: genreFilter })
          .then((next) => {
            if (alive) {
              setItems(next)
              setError(null)
            }
          })
          .catch((caught: unknown) => {
            if (alive) setError(caught instanceof Error ? caught.message : t('加载失败'))
          })
      },
      query ? 250 : genreFilter === undefined ? 0 : 120,
    )
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [sort, query, tag, genreFilter, t])

  const chipTags = useMemo(
    () => [
      {
        tag: SUPERNATURAL_TAG,
        count: tags.find((item) => item.tag === SUPERNATURAL_TAG)?.count ?? 0,
      },
      // 怪力乱神固定占一个位置，其余按使用数取前九个
      ...tags.filter((item) => item.tag !== SUPERNATURAL_TAG).slice(0, TAG_SLOTS - 1),
    ],
    [tags],
  )

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
      <div className="mt-5 border border-foreground/30 bg-card px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <span className="font-mono text-[10px] tracking-[0.26em] text-muted-foreground">
            {t('题材坐标')}
          </span>
          <span className="font-mono text-[11px] tracking-[0.14em] tabular-nums text-stamp">
            {genreFilter === undefined ? t('居中 · 不限') : genreLabel(genre, t)}
          </span>
        </div>

        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={genre}
          aria-label={t('题材坐标')}
          onChange={(event) => setGenre(Number(event.target.value))}
          className="genre-range mt-3"
        />

        <div className="flex items-start justify-between gap-4 font-mono text-[10px] tracking-[0.14em] text-muted-foreground">
          <span className="max-w-[45%]">{t('本格·逻辑推理')}</span>
          <span className="max-w-[45%] text-right">{t('变格·怪力乱神')}</span>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2.5">
        <Search className="size-4 shrink-0 text-muted-foreground" />
        <input
          value={query}
          placeholder={t('按标题搜索……')}
          onChange={(event) => setQuery(event.target.value)}
          className={inputClass}
        />
      </div>

      <div className="mt-3">
        <button
          type="button"
          onClick={() => setTagsOpen((open) => !open)}
          className="flex items-center gap-1.5 font-mono text-[10px] tracking-[0.18em] text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronDown className={cn('size-3.5 transition-transform', tagsOpen && 'rotate-180')} />
          {tagsOpen ? t('收起标签') : t('按标签筛选')}
          {tag ? <span className="text-stamp">· {tag}</span> : null}
        </button>

        {tagsOpen ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {chipTags.map((item) => (
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
                {t('清除筛选')}
              </button>
            ) : null}
          </div>
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
          {tag
            ? t('还没有带「{tag}」标签的汤。', { tag })
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
