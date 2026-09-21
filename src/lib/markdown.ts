import type { ReactNode } from 'react'
import { createElement } from 'react'

import { BARE_URL, externalHref, isInternalUrl, isSafeUrl } from '@/lib/external'
import { navigate } from '@/lib/router'

/**
 * 极简内联 markdown：**粗体**、*斜体*、~~删除线~~、[文字](链接)，外加自动识别裸链接。
 * 输出 React 节点，不做 innerHTML，所以不存在注入问题。
 */
export function renderInline(source: string): ReactNode[] {
  const nodes: ReactNode[] = []
  let key = 0
  let rest = source

  const pushText = (text: string) => {
    if (!text) return
    // 文本里的裸链接也自动变成可点链接
    let cursor = 0
    const matches = [...text.matchAll(new RegExp(BARE_URL, 'gi'))]
    for (const match of matches) {
      const index = match.index ?? 0
      if (index > cursor) nodes.push(text.slice(cursor, index))
      const url = match[0]
      nodes.push(linkNode(`u${key++}`, url, url))
      cursor = index + url.length
    }
    if (cursor < text.length) nodes.push(text.slice(cursor))
  }

  const patterns: Array<{ re: RegExp; render: (m: RegExpExecArray) => ReactNode }> = [
    {
      re: /\[([^\]]+)\]\(\s*([^)\s]+)\s*\)/,
      render: (m) => (isSafeUrl(m[2]) ? linkNode(`l${key++}`, m[2], m[1]) : m[0]),
    },
    { re: /\*\*([^*]+)\*\*/, render: (m) => createElement('strong', { key: `b${key++}` }, m[1]) },
    { re: /~~([^~]+)~~/, render: (m) => createElement('del', { key: `s${key++}` }, m[1]) },
    {
      re: /(?<!\*)\*([^*\n]+)\*(?!\*)/,
      render: (m) => createElement('em', { key: `i${key++}` }, m[1]),
    },
    {
      re: /(?<![\w_])_([^_\n]+)_(?![\w_])/,
      render: (m) => createElement('em', { key: `i${key++}` }, m[1]),
    },
  ]

  while (rest) {
    let earliest: {
      index: number
      match: RegExpExecArray
      pattern: (typeof patterns)[number]
    } | null = null
    for (const pattern of patterns) {
      const match = pattern.re.exec(rest)
      if (match && (earliest === null || (match.index ?? 0) < earliest.index)) {
        earliest = { index: match.index ?? 0, match, pattern }
      }
    }
    if (!earliest) {
      pushText(rest)
      break
    }
    pushText(rest.slice(0, earliest.index))
    nodes.push(earliest.pattern.render(earliest.match))
    rest = rest.slice(earliest.index + earliest.match[0].length)
  }

  return nodes
}

const LINK_CLASS =
  'underline decoration-foreground/40 underline-offset-4 transition-colors hover:text-foreground'

/** 站内链接直接走客户端路由，站外才经过警告页。 */
function linkNode(key: string, url: string, label: string) {
  if (isInternalUrl(url)) {
    return createElement(
      'a',
      {
        key,
        href: url,
        className: LINK_CLASS,
        onClick: (event: MouseEvent) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
          event.preventDefault()
          navigate(url)
        },
      },
      label,
    )
  }
  return externalNode(key, url, label)
}

function externalNode(key: string, url: string, label: string) {
  return createElement(
    'a',
    {
      key,
      href: externalHref(url),
      className: LINK_CLASS,
      onClick: (event: MouseEvent) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
        event.preventDefault()
        leaveTo(url)
      },
    },
    label,
  )
}

/** 站外链接统一走警告页；这里用事件委托避免引入组件依赖。 */
function leaveTo(url: string) {
  window.history.pushState({}, '', externalHref(url))
  window.dispatchEvent(new PopStateEvent('popstate'))
}
