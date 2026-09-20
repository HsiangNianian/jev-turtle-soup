import { useEffect, useState } from 'react'

const NAVIGATE_EVENT = 'turtle-soup:navigate'

function emit() {
  window.dispatchEvent(new Event(NAVIGATE_EVENT))
}

export function navigate(to: string, options: { replace?: boolean } = {}): void {
  const url = new URL(to, window.location.origin)
  const current = window.location.pathname + window.location.search
  if (url.pathname + url.search === current) return
  window.history[options.replace ? 'replaceState' : 'pushState']({}, '', url)
  emit()
}

/** Minimal path router: returns the current pathname and re-renders on navigation. */
export function usePath(): string {
  const [path, setPath] = useState(() => window.location.pathname)

  useEffect(() => {
    const sync = () => setPath(window.location.pathname)
    window.addEventListener('popstate', sync)
    window.addEventListener(NAVIGATE_EVENT, sync)
    return () => {
      window.removeEventListener('popstate', sync)
      window.removeEventListener(NAVIGATE_EVENT, sync)
    }
  }, [])

  return path
}

export function matchPath(path: string, pattern: string): Record<string, string> | null {
  const parts = path.split('/').filter(Boolean)
  const wanted = pattern.split('/').filter(Boolean)
  if (parts.length !== wanted.length) return null
  const params: Record<string, string> = {}
  for (let index = 0; index < wanted.length; index += 1) {
    const segment = wanted[index]
    if (segment.startsWith(':')) {
      params[segment.slice(1)] = decodeURIComponent(parts[index])
    } else if (segment !== parts[index]) {
      return null
    }
  }
  return params
}
