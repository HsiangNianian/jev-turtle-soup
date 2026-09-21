import type { ReactNode } from 'react'

import { externalHref, isInternalUrl } from '@/lib/external'
import { prefetchRoute } from '@/lib/prefetch'
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
  // 手指按下去 / 鼠标移上来就把目标页的数据预热好；
  // 到真正点击之间通常还有几百毫秒，够一个来回。
  const warm = () => prefetchRoute(to)

  return (
    <a
      href={to}
      className={className}
      onPointerEnter={warm}
      onPointerDown={warm}
      onFocus={warm}
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
  if (isInternalUrl(href))
    return (
      <Link to={href} className={className}>
        {children}
      </Link>
    )

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
