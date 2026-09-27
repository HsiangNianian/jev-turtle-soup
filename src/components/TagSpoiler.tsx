import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { useI18n } from '@/lib/i18n'

const REVEAL_MS = 3000

/** One continuous glass veil over the tags and their spacing. */
export function TagSpoiler({ tags }: { tags: string[] }) {
  const { t } = useI18n()
  const [revealed, setRevealed] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  const dustSeed =
    Array.from(tags.join(' ')).reduce(
      (seed, letter) => Math.imul(seed, 31) + (letter.codePointAt(0) ?? 0),
      7,
    ) >>> 0

  const hide = useCallback(() => {
    window.clearTimeout(timer.current)
    timer.current = undefined
    setRevealed(false)
  }, [])

  const reveal = () => {
    window.clearTimeout(timer.current)
    setRevealed(true)
    timer.current = window.setTimeout(hide, REVEAL_MS)
  }

  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) hide()
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('blur', hide)
    return () => {
      window.clearTimeout(timer.current)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('blur', hide)
    }
  }, [hide])

  if (!tags.length) return null

  return (
    <button
      type="button"
      className="tag-spoiler"
      data-revealed={revealed}
      aria-expanded={revealed}
      aria-label={
        revealed
          ? t('标签：{tag}，点击延长显示', { tag: tags.join(' · ') })
          : t('显示标签，3 秒后自动隐藏')
      }
      title={t('点击或悬停，短暂显示标签')}
      onPointerEnter={(event) => {
        // A finger entering while scrolling must not reveal a spoiler.
        if (event.pointerType === 'mouse' || event.pointerType === 'pen') reveal()
      }}
      onClick={reveal}
      onBlur={hide}
      onKeyDown={(event) => {
        if (event.key === 'Escape') hide()
      }}
    >
      <span className="tag-spoiler__face" aria-hidden="true">
        <span className="tag-spoiler__text">
          {tags.map((tag, index) => (
            <span key={`${index}:${tag}`}>#{tag}</span>
          ))}
        </span>
        <span
          className="tag-spoiler__veil"
          style={
            {
              '--tag-dust-x': `${dustSeed % 128}px`,
              '--tag-dust-y': `${(dustSeed >>> 8) % 40}px`,
              '--tag-dust-phase': `${-(dustSeed % 1700)}ms`,
            } as CSSProperties
          }
        />
      </span>
    </button>
  )
}
