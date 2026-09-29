import { type ReactNode } from 'react'
import { PersonalMarkActions, PersonalMarkFilter } from './PersonalMarks'
import { VerdictToken } from './VerdictToken'
import { useI18n } from '@/lib/i18n'
import { usePersonalMarks } from '@/lib/personal-marks-context'
import './PlayLayout.css'

export function PlayPair({
  id,
  number,
  speaker,
  question,
  children,
  actions,
}: {
  id: string
  number?: number
  speaker: string
  question: ReactNode
  children: ReactNode
  actions?: ReactNode
}) {
  const marks = usePersonalMarks()
  return (
    <article
      id={`play-question-${id}`}
      tabIndex={-1}
      data-question-id={id}
      className="play-pair"
      data-useful={marks?.marks[id] === 'useful' || undefined}
    >
      <div className="play-pair-gutter">
        {number !== undefined ? <span>{String(number).padStart(2, '0')}</span> : null}
        <span title={speaker}>{speaker}</span>
      </div>
      <div className="play-pair-body">
        <div className="play-question">{question}</div>
        {children}
      </div>
      <PersonalMarkActions questionId={id} compact>
        {actions}
      </PersonalMarkActions>
    </article>
  )
}

export function PlayTranscriptBar({
  verdicts,
  selected,
  onSelect,
  hasEarlier = false,
}: {
  verdicts: string[]
  selected: string | null
  onSelect: (verdict: string | null) => void
  hasEarlier?: boolean
}) {
  const { t } = useI18n()
  return (
    <div className="play-transcript-bar">
      <div className="play-verdict-counts" role="group" aria-label={t('问答记录')}>
        {['yes', 'no', 'partly', 'irrelevant', 'solved'].map((verdict) => {
          const count = verdicts.filter((v) => v === verdict).length
          if (verdict === 'solved' && !count) return null
          return (
            <button
              key={verdict}
              type="button"
              aria-pressed={selected === verdict}
              onClick={() => onSelect(selected === verdict ? null : verdict)}
            >
              <VerdictToken verdict={verdict} />
              <span>{count}</span>
            </button>
          )
        })}
      </div>
      <PersonalMarkFilter compact hasEarlier={hasEarlier} />
    </div>
  )
}
