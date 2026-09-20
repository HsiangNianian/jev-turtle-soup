import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { ChevronUp, X } from 'lucide-react'

interface CaseDrawerProps {
  title: string
  meta: string
  children: ReactNode
}

export function CaseDrawer({ title, meta, children }: CaseDrawerProps) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previous
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-expanded={open}
        className="flex w-full shrink-0 items-center gap-3 border-b border-foreground px-4 py-3 text-left transition-colors active:bg-foreground/[0.04]"
      >
        <span className="shrink-0 font-mono text-[10px] tracking-[0.24em] text-stamp">案卷</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-serif text-[15px] leading-6">{title}</span>
          <span className="mt-0.5 block font-mono text-[10px] tracking-[0.16em] text-muted-foreground">
            {meta}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1 font-mono text-[10px] tracking-[0.16em] text-muted-foreground">
          展开
          <ChevronUp className="size-3.5" />
        </span>
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="收起案卷"
            onClick={() => setOpen(false)}
            className="animate-fade-in absolute inset-0 bg-foreground/45"
          />
          <div className="animate-sheet-up absolute inset-x-0 top-12 bottom-0 flex flex-col bg-background">
            <div className="flex shrink-0 items-center gap-3 border-b border-foreground px-4 py-3">
              <span className="shrink-0 font-mono text-[10px] tracking-[0.24em] text-stamp">案卷</span>
              <span className="min-w-0 flex-1 truncate font-serif text-[15px]">{title}</span>
              <button
                type="button"
                aria-label="收起案卷"
                onClick={() => setOpen(false)}
                className="flex size-8 shrink-0 items-center justify-center border border-foreground transition-colors active:bg-foreground active:text-background"
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="chat-scroll min-h-0 flex-1 overflow-y-auto pb-[max(1rem,env(safe-area-inset-bottom))]">
              {children}
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
