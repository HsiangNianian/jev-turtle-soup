import { useQuestionJump } from '@/lib/play-navigation'
import { useEffect, useRef, useState } from 'react'
import { ArrowRight } from 'lucide-react'

import { CaseDrawer } from '@/components/CaseDrawer'
import { Transcript } from '@/components/ChatPanel'
import { PuzzlePanel } from '@/components/PuzzlePanel'
import { PlayTranscriptBar } from './PlayPair'
import { messageVerdict } from '@/lib/play-transcript'
import { usePersonalMarks } from '@/lib/personal-marks-context'
import {
  STATUS_LABEL,
  buildLedger,
  formatWhen,
  shareTarget,
  toSession,
  winningConclusion,
  type ArchivedGame,
} from '@/lib/archive'
import { useI18n } from '@/lib/i18n'
import { useReportStory } from '@/lib/use-report-story'

export function ArchiveView({
  game,
  onContinue,
  onStoryLoaded,
}: {
  game: ArchivedGame
  onContinue: () => void
  onStoryLoaded: (id: string, story: string | null) => void
}) {
  const { t } = useI18n()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const marks = usePersonalMarks()
  const [verdictFilter, setVerdictFilter] = useState<string | null>(null)
  useQuestionJump(() => {
    marks?.setFilter('all')
    setVerdictFilter(null)
  })
  const transcript = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (transcript.current) transcript.current.scrollTop = 0
  }, [marks?.filter])
  const session = toSession(game)
  const storyRecovery = useReportStory(
    session,
    game.revealed && Boolean(game.truth),
    game.story,
    onStoryLoaded,
  )
  const ledger = buildLedger(game.messages)
  const caseFile = (
    <PuzzlePanel
      session={session}
      revealed={game.revealed}
      truth={game.truth}
      story={game.story}
      storyRecovery={storyRecovery}
      solved={game.solved}
      closeness={game.closeness}
      turnCount={game.turnCount}
      ledger={ledger}
      conclusion={game.solved ? winningConclusion(game.messages) : null}
      onReveal={() => {}}
      readOnly
    />
  )

  return (
    <main className="play-layout flex min-h-0 flex-1 flex-col lg:flex-row">
      <section className="play-case-rail chat-scroll hidden min-h-0 overflow-y-auto lg:block lg:h-full lg:border-r lg:border-foreground/25">
        {caseFile}
      </section>

      <section className="flex min-h-0 flex-1 flex-col">
        <CaseDrawer
          title={game.title}
          meta={`${t(STATUS_LABEL[game.status])} · ${t('已问 {turns} 轮', { turns: game.turnCount })}`}
          open={drawerOpen}
          onOpenChange={setDrawerOpen}
          share={shareTarget(game)}
        >
          {caseFile}
        </CaseDrawer>

        <div className="play-transcript-title">
          <span className="font-mono text-[10px] font-bold tracking-[0.2em] sm:text-[11px] sm:tracking-[0.22em]">
            {t('讯问记录')}
          </span>
          <span className="truncate font-mono text-[10px] tracking-[0.16em] text-muted-foreground">
            {t(STATUS_LABEL[game.status])} · {formatWhen(game.updatedAt)}
          </span>
        </div>

        <PlayTranscriptBar
          verdicts={game.messages.flatMap((m) => (messageVerdict(m) ? [messageVerdict(m)!] : []))}
          selected={verdictFilter}
          onSelect={(v) => {
            setVerdictFilter(v)
            if (transcript.current) transcript.current.scrollTop = 0
          }}
        />
        <div ref={transcript} className="chat-scroll min-h-0 flex-1 overflow-y-auto">
          <Transcript
            messages={game.messages}
            verdictFilter={verdictFilter}
            onClear={() => setVerdictFilter(null)}
          />
        </div>

        {game.status === 'active' ? (
          <div className="shrink-0 border-t border-foreground px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-4 lg:px-8">
            <button
              type="button"
              onClick={onContinue}
              className="flex w-full items-center justify-center gap-3 bg-foreground px-6 py-3.5 font-mono text-[12px] font-bold tracking-[0.22em] text-background transition-opacity hover:opacity-85 sm:w-auto"
            >
              {t('继续调查')} <ArrowRight className="size-4" />
            </button>
          </div>
        ) : null}
      </section>
    </main>
  )
}
