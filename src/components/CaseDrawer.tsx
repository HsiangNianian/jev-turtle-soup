import type { ReactNode } from 'react'
import { useState } from 'react'
import { ChevronDown } from 'lucide-react'

import { cn } from '@/lib/utils'

interface CaseDrawerProps {
  title: string
  meta: string
  children: ReactNode
}

export function CaseDrawer({ title, meta, children }: CaseDrawerProps) {
  const [open, setOpen] = useState(false)

  return (
    <div className="shrink-0 border-b border-foreground lg:hidden">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <span className="shrink-0 font-mono text-[10px] tracking-[0.24em] text-stamp">案卷</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-serif text-[15px] leading-6">{title}</span>
          <span className="mt-0.5 block font-mono text-[10px] tracking-[0.16em] text-muted-foreground">
            {meta}
          </span>
        </span>
        <ChevronDown
          className={cn('size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')}
        />
      </button>
      {open ? (
        <div className="chat-scroll max-h-[56dvh] overflow-y-auto border-t border-foreground/25">
          {children}
        </div>
      ) : null}
    </div>
  )
}
