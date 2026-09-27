import { useEffect, useId, useState } from 'react'
import { ChevronDown, Loader2 } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import { revealLibraryPuzzle } from '@/lib/library-client'

/** Official library stories are fetched only after the reader opens this spoiler. */
export function OfficialStory({ puzzleId }: { puzzleId: string }) {
  const { t, locale } = useI18n()
  const contentId = useId()
  const [open, setOpen] = useState(false)
  const [story, setStory] = useState<string | null>()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || story !== undefined || error) return
    let alive = true
    void revealLibraryPuzzle(puzzleId, locale, true)
      .then((result) => {
        if (alive) setStory(result.story ?? null)
      })
      .catch((caught: unknown) => {
        if (alive) setError(caught instanceof Error ? caught.message : t('完整故事加载失败'))
      })
    return () => {
      alive = false
    }
  }, [puzzleId, locale, t, open, story, error])

  return (
    <section className="mt-8 border-y border-foreground/25">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-4 py-4 text-left transition-colors hover:text-stamp"
      >
        <span className="min-w-0 flex-1">
          <span className="block font-serif text-[16px] leading-7">{t('完整背景故事')}</span>
          <span className="mt-1 block font-mono text-[10px] leading-5 tracking-[0.14em] text-muted-foreground">
            {t(open ? '收起故事' : '含剧透，点击查看')}
          </span>
        </span>
        <ChevronDown
          className={`size-4 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>
      <div id={contentId} hidden={!open}>
        {open ? (
          <div className="border-t border-dashed border-foreground/20 py-5">
            {error ? (
              <div className="font-mono text-[11px] leading-6 text-muted-foreground" role="status">
                <p>{error}</p>
                <button
                  type="button"
                  onClick={() => setError(null)}
                  className="mt-2 underline underline-offset-4"
                >
                  {t('重新加载')}
                </button>
              </div>
            ) : story === undefined ? (
              <div
                className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground"
                role="status"
              >
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
                {t('正在加载完整故事…')}
              </div>
            ) : story ? (
              <p className="surface-prose font-serif text-[15px] leading-8 break-words text-foreground/90">
                {story}
              </p>
            ) : (
              <p className="font-mono text-[11px] text-muted-foreground">
                {t('这碗汤暂时没有完整故事。')}
              </p>
            )}
          </div>
        ) : null}
      </div>
    </section>
  )
}
