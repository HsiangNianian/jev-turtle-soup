import { useEffect, useRef, type ReactNode } from 'react'

import { externalHref, isInternalUrl } from '@/lib/external'
import { cancelPrefetch, prefetchRoute } from '@/lib/prefetch'
import { navigate } from '@/lib/router'

export function Link({
  to,
  className,
  children,
  onNavigate,
  prefetchOnView = false,
}: {
  to: string
  className?: string
  children: ReactNode
  onNavigate?: () => void
  /**
   * 进入视口就预热。移动端的「悬停」——手机上没法悬停，
   * 但滚动时下一屏要什么基本可预测。只给主入口用，别给整页链接都开。
   */
  prefetchOnView?: boolean
}) {
  const ref = useRef<HTMLAnchorElement>(null)

  useEffect(() => {
    if (!prefetchOnView) return
    const node = ref.current
    if (!node || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return
        prefetchRoute(to, { immediate: true })
        observer.disconnect()
      },
      { rootMargin: '200px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [prefetchOnView, to])

  // 悬停要停一下才预热（鼠标扫过一排链接不该逐个发请求）；
  // 按下或聚焦就直接预热——那已经是明确的意图了。
  return (
    <a
      ref={ref}
      href={to}
      className={className}
      onPointerEnter={() => prefetchRoute(to)}
      onPointerLeave={() => cancelPrefetch(to)}
      onPointerDown={() => prefetchRoute(to, { immediate: true })}
      onFocus={() => prefetchRoute(to, { immediate: true })}
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
