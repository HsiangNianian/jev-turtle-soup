import { useEffect, useState } from 'react'
import type { GameSession } from '@/lib/api'
import { useI18n } from '@/lib/i18n'
import { revealSession } from '@/lib/reveal-client'

export interface StoryRecovery {
  loading: boolean
  error: string | null
  retry: () => void
}

/** Older reports already have the answer, but predate storing the original story. */
export function useReportStory(
  session: GameSession | null,
  revealed: boolean,
  story: string | null | undefined,
  onLoaded: (id: string, story: string | null) => void,
): StoryRecovery {
  const { locale, t } = useI18n()
  const [attempt, setAttempt] = useState(0)
  const [settled, setSettled] = useState<{
    id: string
    locale: string
    attempt: number
    error: string | null
  } | null>(null)
  const id = session?.sessionId
  const libraryId = session?.libraryId
  const source = session?.source
  const needsStory = Boolean(revealed && story === undefined && (source === 'daily' || libraryId))

  useEffect(() => {
    if (!id || !needsStory) return
    let alive = true
    void revealSession({ sessionId: id, libraryId }, locale)
      .then((result) => {
        if (!alive) return
        onLoaded(id, result.story ?? null)
        setSettled({ id, locale, attempt, error: null })
      })
      .catch((error: unknown) => {
        if (alive) {
          setSettled({
            id,
            locale,
            attempt,
            error: error instanceof Error ? error.message : t('完整故事加载失败'),
          })
        }
      })
    return () => {
      alive = false
    }
  }, [id, libraryId, needsStory, locale, t, onLoaded, attempt])

  const current = settled?.id === id && settled?.locale === locale && settled?.attempt === attempt
  return {
    loading: needsStory && !current,
    error: needsStory && current ? settled.error : null,
    retry: () => setAttempt((value) => value + 1),
  }
}
