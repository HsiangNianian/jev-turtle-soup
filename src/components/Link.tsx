import type { ReactNode } from 'react'

import { externalHref } from '@/lib/external'
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

/** 站外链接：先跳警告页，不放行直接离开。 */
export function ExternalLink({
  href,
  className,
  children,
}: {
  href: string
  className?: string
  children: ReactNode
}) {
  const to = externalHref(href)
  return (
    <a
      href={to}
      className={className}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
        event.preventDefault()
        navigate(to)
      }}
    >
      {children}
    </a>
  )
}
