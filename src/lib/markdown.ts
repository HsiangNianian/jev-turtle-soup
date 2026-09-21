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

  const patterns: Array<{
    find: (text: string) => { index: number; match: RegExpExecArray } | null
    render: (m: RegExpExecArray) => ReactNode
  }> = [
    {
      find: scan(/\[([^\]]+)\]\(\s*([^)\s]+)\s*\)/),
      render: (m) => (isSafeUrl(m[2]) ? linkNode(`l${key++}`, m[2], m[1]) : m[0]),
    },
    {
      find: scan(/\*\*([^*]+)\*\*/),
      render: (m) => createElement('strong', { key: `b${key++}` }, m[1]),
    },
    { find: scan(/~~([^~]+)~~/), render: (m) => createElement('del', { key: `s${key++}` }, m[1]) },
    {
      // *斜体* 两侧不能再挨着 *，否则那是 **粗体** 的一部分
      find: scan(/\*([^*\n]+)\*/, (text, m) => {
        const before = text[m.index - 1]
        const after = text[m.index + m[0].length]
        return before !== '*' && after !== '*'
      }),
      render: (m) => createElement('em', { key: `i${key++}` }, m[1]),
    },
    {
      // _斜体_ 两侧不能是字母数字，免得吃掉 snake_case 里的下划线
      find: scan(/_([^_\n]+)_/, (text, m) => {
        const isWord = (ch: string | undefined) => Boolean(ch && /\w/.test(ch))
        return !isWord(text[m.index - 1]) && !isWord(text[m.index + m[0].length])
      }),
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
      const found = pattern.find(rest)
      if (found && (earliest === null || found.index < earliest.index)) {
        earliest = { ...found, pattern }
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

/**
 * 在整段文本里找第一个通过边界检查的匹配。
 * 边界本来是用正则的 lookbehind 写的，但 lookbehind 要 Safari 16.4 才支持，
 * 更老的 iOS 上整个 bundle 会在**解析阶段**就 SyntaxError，直接白屏——
 * 所以改成扫描 + 回调判断。
 */
function scan(re: RegExp, guard?: (text: string, match: RegExpExecArray) => boolean) {
  const scanner = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`)
  return (text: string) => {
    scanner.lastIndex = 0
    let match = scanner.exec(text)
    while (match) {
      if (!guard || guard(text, match)) return { index: match.index, match }
      match = scanner.exec(text)
    }
    return null
  }
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
