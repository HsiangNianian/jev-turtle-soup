import { ArrowRight } from 'lucide-react'

import { CaseDrawer } from '@/components/CaseDrawer'
import { Transcript } from '@/components/ChatPanel'
import { PuzzlePanel } from '@/components/PuzzlePanel'
import { STATUS_LABEL, buildLedger, formatWhen, toSession, type ArchivedGame } from '@/lib/archive'

export function ArchiveView({ game, onContinue }: { game: ArchivedGame; onContinue: () => void }) {
  const session = toSession(game)
  const ledger = buildLedger(game.messages)
  const caseFile = (
    <PuzzlePanel
      session={session}
      revealed={game.truth !== null}
      truth={game.truth}
      solved={game.solved}
      closeness={game.closeness}
      revealing={false}
      turnCount={game.turnCount}
      ledger={ledger}
      onReveal={() => {}}
      readOnly
    />
  )

  return (
    <main className="flex min-h-0 flex-1 flex-col lg:flex-row">
      <section className="chat-scroll hidden min-h-0 overflow-y-auto lg:block lg:h-full lg:w-[42%] lg:border-r lg:border-foreground/25">
        {caseFile}
      </section>

      <section className="flex min-h-0 flex-1 flex-col">
        <CaseDrawer
          title={game.title}
          meta={`${STATUS_LABEL[game.status]} · 已问 ${game.turnCount} 轮`}
        >
          {caseFile}
        </CaseDrawer>

        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-foreground px-4 py-3 sm:px-6 sm:py-3.5 lg:px-8">
          <span className="font-mono text-[10px] font-bold tracking-[0.2em] sm:text-[11px] sm:tracking-[0.22em]">
            讯问记录 / TRANSCRIPT
          </span>
          <span className="truncate font-mono text-[10px] tracking-[0.16em] text-muted-foreground">
            {STATUS_LABEL[game.status]} · {formatWhen(game.updatedAt)}
          </span>
        </div>

        <div className="chat-scroll min-h-0 flex-1 overflow-y-auto">
          <Transcript messages={game.messages} />
        </div>

        {game.status === 'active' ? (
          <div className="shrink-0 border-t border-foreground px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-4 lg:px-8">
            <button
              type="button"
              onClick={onContinue}
              className="flex w-full items-center justify-center gap-3 bg-foreground px-6 py-3.5 font-mono text-[12px] font-bold tracking-[0.22em] text-background transition-opacity hover:opacity-85 sm:w-auto"
            >
              继续调查 <ArrowRight className="size-4" />
            </button>
          </div>
        ) : null}
      </section>
    </main>
  )
}
