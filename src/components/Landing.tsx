import { useState } from 'react'
import { ArrowRight, Loader2, Lock, Trash2 } from 'lucide-react'

import { DailyLuck } from '@/components/DailyLuck'
import { STATUS_LABEL, formatWhen, type ArchivedGame, type GameStatus } from '@/lib/archive'
import { cn } from '@/lib/utils'

const SKIP_DELETE_CONFIRM_KEY = 'turtle-soup.archive.skip-delete-confirm'

function readSkipDeleteConfirm(): boolean {
  try {
    return localStorage.getItem(SKIP_DELETE_CONFIRM_KEY) === '1'
  } catch {
    return false
  }
}

const GENRE_CHOICES = [
  { value: 'realistic', label: '本格', hint: '现实向推理' },
  { value: 'supernatural', label: '怪力乱神', hint: '鬼神 · 因果 · 禁忌' },
] as const

const DIFFICULTIES = [
  { value: '简单', hint: '线索直给' },
  { value: '中等', hint: '需要联想' },
  { value: '困难', hint: '反转刁钻' },
] as const

const STAMP_TONE: Record<GameStatus, string> = {
  active: 'border-stamp text-stamp',
  solved: 'border-[var(--v-yes)] text-[var(--v-yes)]',
  revealed: 'border-stamp text-stamp',
  abandoned: 'border-muted-foreground/60 text-muted-foreground',
}

function StatusStamp({ status }: { status: GameStatus }) {
  return (
    <span
      className={cn(
        'shrink-0 border px-2 py-0.5 font-mono text-[10px] font-bold tracking-[0.16em]',
        STAMP_TONE[status],
      )}
    >
      {STATUS_LABEL[status]}
    </span>
  )
}

interface LandingProps {
  difficulty: string
  genre: 'realistic' | 'supernatural'
  theme: string
  generating: boolean
  error: string | null
  activeGames: ArchivedGame[]
  canGenerate: boolean
  archives: ArchivedGame[]
  onDifficultyChange: (value: string) => void
  onGenreChange: (value: 'realistic' | 'supernatural') => void
  onThemeChange: (value: string) => void
  onGenerate: () => void
  onContinue: (id: string) => void
  onView: (id: string) => void
  onAbandon: (id: string) => void
  onDelete: (id: string) => void
}

export function Landing({
  difficulty,
  genre,
  theme,
  generating,
  error,
  activeGames,
  canGenerate,
  archives,
  onDifficultyChange,
  onGenreChange,
  onThemeChange,
  onGenerate,
  onContinue,
  onView,
  onAbandon,
  onDelete,
}: LandingProps) {
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [dontAskAgain, setDontAskAgain] = useState(false)
  const [skipConfirm, setSkipConfirm] = useState(readSkipDeleteConfirm)

  function requestDelete(id: string) {
    if (skipConfirm) {
      onDelete(id)
      return
    }
    setDontAskAgain(false)
    setConfirmingId(id)
  }

  function confirmDelete(id: string) {
    if (dontAskAgain) {
      try {
        localStorage.setItem(SKIP_DELETE_CONFIRM_KEY, '1')
      } catch {
        /* 隐私模式下忽略 */
      }
      setSkipConfirm(true)
    }
    setConfirmingId(null)
    onDelete(id)
  }

  const [focused, setFocused] = useState(false)

  return (
    <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col justify-center px-5 py-12 sm:px-6 sm:py-16">
      <div className="font-mono text-[10px] tracking-[0.3em] text-muted-foreground sm:text-[11px]">
        案件受理 · CASE INTAKE
      </div>
      <div className="mt-5 flex items-start justify-between gap-5">
        <h1 className="font-serif text-[clamp(2.75rem,9vw,4.5rem)] leading-none font-semibold">
          海龟汤
        </h1>
        <DailyLuck />
      </div>
      <div className="mt-6 h-px w-full bg-foreground/80" />
      <p className="mt-6 max-w-xl font-serif text-[15px] leading-8 text-foreground/80">
        每一碗汤都是一桩悬案。向主持人砚（Ellis）提出「是 / 不是」的问题，逐步还原被隐去的真相。
      </p>

      {activeGames.length ? (
        <div className="mt-9 space-y-4">
          {activeGames.map((game) => (
            <div key={game.id} className="border border-foreground bg-card">
              <div className="flex items-center justify-between gap-3 border-b border-foreground px-4 py-3 sm:px-5">
                <span className="font-mono text-[10px] tracking-[0.24em] text-muted-foreground">
                  {game.source === 'library' ? '别人的汤 / PLAYING' : '在办案件 / OPEN CASE'}
                </span>
                <span className="stamp px-2 py-0.5 font-mono text-[10px] font-bold tracking-[0.2em]">
                  机密
                </span>
              </div>
              <div className="px-4 py-5 sm:px-5">
                <h2 className="font-serif text-2xl leading-snug font-semibold">{game.title}</h2>
                <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 font-mono text-[10px] tracking-[0.18em] text-muted-foreground">
                  <span>等级 {game.difficulty}</span>
                  <span>已问 {game.turnCount} 轮</span>
                  <span>更新 {formatWhen(game.updatedAt)}</span>
                </div>
                <div className="mt-5 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => onContinue(game.id)}
                    className="flex items-center gap-2.5 bg-foreground px-6 py-3 font-mono text-[12px] font-bold tracking-[0.22em] text-background transition-opacity hover:opacity-85"
                  >
                    继续调查 <ArrowRight className="size-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onAbandon(game.id)}
                    className="border border-foreground/30 px-5 py-3 font-mono text-[11px] tracking-[0.18em] text-muted-foreground transition-colors hover:border-foreground hover:text-foreground"
                  >
                    中止本案
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {canGenerate ? (
        <>
          <div className="mt-9">
            <div className="font-mono text-[10px] tracking-[0.26em] text-muted-foreground">
              等级 / LEVEL
            </div>
            <div className="mt-3 grid grid-cols-3 border border-foreground">
              {DIFFICULTIES.map((item, index) => (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => onDifficultyChange(item.value)}
                  className={cn(
                    'border-foreground px-3 py-3.5 text-left transition-colors sm:px-4 sm:py-4 [&:not(:last-child)]:border-r',
                    difficulty === item.value
                      ? 'bg-foreground text-background'
                      : 'hover:bg-foreground/5',
                  )}
                >
                  <div className="font-mono text-[10px] tracking-[0.2em] opacity-60">
                    等级 0{index + 1}
                  </div>
                  <div className="mt-1.5 font-serif text-base">{item.value}</div>
                  <div className="mt-0.5 font-mono text-[10px] opacity-55">{item.hint}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="mt-7">
            <div className="font-mono text-[10px] tracking-[0.26em] text-muted-foreground">
              题材 / GENRE
            </div>
            <div className="mt-3 grid grid-cols-2 border border-foreground">
              {GENRE_CHOICES.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => onGenreChange(item.value)}
                  className={cn(
                    'border-foreground px-3 py-3.5 text-left transition-colors sm:px-4 sm:py-4 [&:not(:last-child)]:border-r',
                    genre === item.value
                      ? 'bg-foreground text-background'
                      : 'hover:bg-foreground/5',
                  )}
                >
                  <div className="font-serif text-base">{item.label}</div>
                  <div className="mt-0.5 font-mono text-[10px] opacity-55">{item.hint}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="mt-7">
            <label
              htmlFor="theme"
              className="font-mono text-[10px] tracking-[0.26em] text-muted-foreground"
            >
              口味 / THEME <span className="opacity-60">（可选）</span>
            </label>
            <div
              className={cn(
                'mt-3 flex items-center gap-3 border bg-card px-4',
                focused ? 'border-foreground' : 'border-foreground/30',
              )}
            >
              <input
                id="theme"
                value={theme}
                placeholder="医院、密室、雨夜、老房子、凶杀、伦理、感情……"
                onChange={(event) => onThemeChange(event.target.value)}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !generating) onGenerate()
                }}
                className="h-12 flex-1 bg-transparent font-serif text-sm outline-none placeholder:text-muted-foreground/70"
              />
              <span aria-hidden className="font-mono text-[11px] text-muted-foreground">
                ↵
              </span>
            </div>
          </div>

          {error ? (
            <p className="mt-5 border-l-2 border-stamp bg-stamp/[0.06] px-4 py-3 font-mono text-[11px] text-stamp">
              {error}
            </p>
          ) : null}

          <button
            type="button"
            onClick={onGenerate}
            disabled={generating}
            className="mt-8 flex w-fit items-center gap-3 bg-foreground px-7 py-4 font-mono text-[12px] font-bold tracking-[0.24em] text-background transition-opacity hover:opacity-85 disabled:opacity-50"
          >
            {generating ? (
              <>
                <Loader2 className="size-4 animate-spin" /> 正在熬制……
              </>
            ) : (
              <>
                立案并熬一碗 <ArrowRight className="size-4" />
              </>
            )}
          </button>
        </>
      ) : (
        <div className="mt-9 border-l-2 border-stamp bg-card px-4 py-3 font-mono text-[11px] leading-6 text-stamp">
          自己那碗还没喝完——结案（猜中 / 揭晓 / 中止）之后才能立案新的。想先玩别人的汤，可以去题库。
        </div>
      )}

      {archives.length ? (
        <div className="mt-12">
          <div className="flex items-baseline justify-between">
            <span className="font-mono text-[10px] tracking-[0.26em] text-muted-foreground">
              档案室 / ARCHIVE
            </span>
            <span className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground/70">
              {String(archives.length).padStart(2, '0')} 卷
              {archives.length > 5 ? ' · 可上下滑动' : ''}
            </span>
          </div>

          {/* 每行 4.5rem，5 行再加上边框，正好露出 5 卷 */}
          <ul className="chat-scroll mt-3 max-h-[22.75rem] overflow-y-auto border-t border-foreground/25">
            {archives.map((game) => (
              <li key={game.id} className="rule-dashed flex h-[4.5rem] items-center gap-2">
                {confirmingId === game.id ? (
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-2 py-2">
                    <span className="font-serif text-[13px] text-muted-foreground">
                      删除《{game.title}》？删除后无法恢复。
                    </span>
                    <button
                      type="button"
                      onClick={() => confirmDelete(game.id)}
                      className="border border-stamp bg-stamp px-3 py-1.5 font-mono text-[10px] font-bold tracking-[0.16em] text-background transition-opacity hover:opacity-85"
                    >
                      确认删除
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmingId(null)}
                      className="border border-foreground/30 px-3 py-1.5 font-mono text-[10px] tracking-[0.16em] text-muted-foreground transition-colors hover:text-foreground"
                    >
                      取消
                    </button>
                    <label className="flex cursor-pointer items-center gap-2 font-mono text-[10px] tracking-[0.14em] text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={dontAskAgain}
                        onChange={(event) => setDontAskAgain(event.target.checked)}
                        className="size-3.5 accent-[var(--stamp)]"
                      />
                      以后不再提示
                    </label>
                  </div>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => onView(game.id)}
                      className="flex min-w-0 flex-1 items-center gap-3 py-2 text-left"
                    >
                      <StatusStamp status={game.status} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-serif text-[15px]">{game.title}</span>
                        <span className="mt-0.5 block font-mono text-[10px] tracking-[0.14em] text-muted-foreground">
                          {formatWhen(game.updatedAt)} · 已问 {game.turnCount} 轮
                        </span>
                      </span>
                      <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                    </button>
                    <button
                      type="button"
                      aria-label={`删除《${game.title}》`}
                      onClick={() => requestDelete(game.id)}
                      className="flex size-8 shrink-0 items-center justify-center border border-transparent text-muted-foreground/50 transition-colors hover:border-stamp hover:text-stamp"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-14 flex items-center gap-2 font-mono text-[10px] tracking-[0.3em] text-muted-foreground/70">
        <Lock className="size-3" />
        中途离开也没关系，进度会自动留在本机
      </div>
    </div>
  )
}
