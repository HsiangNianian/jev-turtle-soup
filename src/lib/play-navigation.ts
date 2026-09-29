import { useEffect } from 'react'

export function jumpToQuestion(id: string) {
  window.dispatchEvent(new CustomEvent('soup:jump-question', { detail: id }))
}

export function useQuestionJump(reset: () => void) {
  useEffect(() => {
    const jump = (event: Event) => {
      reset()
      requestAnimationFrame(() => {
        const row = document.getElementById(
          `play-question-${(event as CustomEvent<string>).detail}`,
        )
        row?.scrollIntoView({
          block: 'center',
          behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
            ? 'auto'
            : 'smooth',
        })
        row?.focus({ preventScroll: true })
      })
    }
    window.addEventListener('soup:jump-question', jump)
    return () => window.removeEventListener('soup:jump-question', jump)
  }, [reset])
}

/** Keep the active conversation above mobile keyboards without interfering with pinch zoom. */
export function usePlayViewport(active: boolean) {
  useEffect(() => {
    if (!active) return
    const viewport = window.visualViewport
    const mobile = window.matchMedia('(max-width: 1023px)')
    const root = document.documentElement
    const resize = () => {
      if (mobile.matches && viewport?.scale === 1)
        root.style.setProperty('--play-viewport-height', `${viewport.height}px`)
      else root.style.removeProperty('--play-viewport-height')
    }
    resize()
    viewport?.addEventListener('resize', resize)
    mobile.addEventListener('change', resize)
    return () => {
      viewport?.removeEventListener('resize', resize)
      mobile.removeEventListener('change', resize)
      root.style.removeProperty('--play-viewport-height')
    }
  }, [active])
}
