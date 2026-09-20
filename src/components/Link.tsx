import type { ReactNode } from 'react'

import { navigate } from '@/lib/router'

export function Link({
  to,
  className,
  children,
  onNavigate,
}: {
  to: string
  className?: string
  children: ReactNode
  onNavigate?: () => void
}) {
  return (
    <a
      href={to}
      className={className}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
        event.preventDefault()
        onNavigate?.()
        navigate(to)
      }}
    >
      {children}
    </a>
  )
}
