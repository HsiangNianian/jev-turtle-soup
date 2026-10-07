import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { Eraser } from 'lucide-react'

import {
  blankGroups,
  blankableBetween,
  clozeIssues,
  composeDoc,
  isBlankable,
  paint,
  parseDoc,
  type ClozeIssue,
} from '@/lib/cloze-template'
import { cn } from '@/lib/utils'
import { useI18n } from '@/lib/i18n'

const ISSUE_TEXT: Record<ClozeIssue, string> = {
  unpaired: '[[ ]] 没有成对，或者互相嵌套了',
  blank: '有一处填空是空的',
  spaced: '填空里不能有空格或换行',
  punct: '填空里不要包含标点或符号，请只选文字',
  tooLong: '加上填空标记后超过了字数上限，请缩短故事或少挖几处',
}

/** 双击的间隔，以及触屏上算「长按」的时长 */
const DOUBLE_TAP_MS = 320
const LONG_PRESS_MS = 280

interface LastTap {
  /** 记下点击时的故事文字：故事改过之后，这条记录里的下标就不作数了 */
  text: string
  index: number
  time: number
  kind: 'tap' | 'range'
  before: Set<number>
}

interface Press {
  index: number
  x: number
  y: number
  touch: boolean
  dragging: boolean
  mode: 'add' | 'remove'
  timer: number | undefined
}

/**
 * 挖空面板：把整个汤底一个字一个字摆出来，在上面直接点选。
 * - 点一个字：挖空／取消
 * - 按住拖动划选（触屏上先长按再拖）：一次挖一段
 * - 双击起点字，再点终点字：两字之间全部挖空
 * 空格和标点不能挖，原样留在空与空之间。
 */
export function ClozePicker({
  value,
  maxLength,
  onChange,
}: {
  value: string
  maxLength: number
  onChange: (next: string) => void
}) {
  const { t } = useI18n()
  const doc = parseDoc(value)
  const groups = blankGroups(doc)
  const cells = groups.reduce((sum, group) => sum + group.end - group.start, 0)
  const issues = clozeIssues(value, maxLength)

  const root = useRef<HTMLDivElement>(null)
  const press = useRef<Press | null>(null)
  const lastTap = useRef<LastTap | null>(null)
  const text = doc.chars.join('')
  // 起点和上一次点击都按下标记录，故事文字一改，它们指的位置就变了，必须作废
  const [anchorAt, setAnchorAt] = useState<{ index: number; text: string } | null>(null)
  const anchor = anchorAt?.text === text ? anchorAt.index : null
  const setAnchor = (index: number | null) => setAnchorAt(index === null ? null : { index, text })
  const [drag, setDrag] = useState<{
    start: number
    current: number
    mode: 'add' | 'remove'
  } | null>(null)
  const [focusIndex, setFocusIndex] = useState<number | null>(null)

  // 触屏上拖动划选时要拦住页面滚动；这个监听必须是非被动的才拦得住
  useEffect(() => {
    const element = root.current
    if (!element) return
    const block = (event: TouchEvent) => {
      if (press.current?.dragging && event.cancelable) event.preventDefault()
    }
    element.addEventListener('touchmove', block, { passive: false })
    return () => element.removeEventListener('touchmove', block)
  }, [])
  useEffect(() => () => window.clearTimeout(press.current?.timer), [])

  function commit(blanks: Set<number>) {
    onChange(composeDoc({ chars: doc.chars, blanks }))
  }

  function indexOf(target: EventTarget | Element | null): number {
    const element = (target as Element | null)?.closest?.('[data-i]') as HTMLElement | null
    return element ? Number(element.dataset.i) : -1
  }

  function indexAt(x: number, y: number): number {
    return indexOf(document.elementFromPoint(x, y))
  }

  function tap(index: number, now: number) {
    const previous = lastTap.current?.text === text ? lastTap.current : null
    const quick =
      previous !== null && previous.index === index && now - previous.time < DOUBLE_TAP_MS
    // 刚用这个字收尾了一次划选，紧跟着的第二下是同一个双击的一部分
    if (quick && previous.kind === 'range') return
    if (quick) {
      // 双击：第一下的切换撤回去，改把这个字当作范围的起点（再双击一次起点就取消）
      commit(previous.before)
      setAnchor(anchor === index ? null : index)
      lastTap.current = null
      return
    }
    if (anchor !== null && anchor !== index) {
      const before = doc.blanks
      commit(paint(doc.blanks, blankableBetween(doc.chars, anchor, index), 'add'))
      setAnchor(null)
      lastTap.current = { index, time: now, kind: 'range', before, text }
      return
    }
    lastTap.current = { index, time: now, kind: 'tap', before: doc.blanks, text }
    commit(paint(doc.blanks, [index]))
  }

  function onPointerDown(event: PointerEvent) {
    const index = indexOf(event.target)
    if (index < 0 || (event.pointerType === 'mouse' && event.button !== 0)) return
    const touch = event.pointerType !== 'mouse'
    const mode = doc.blanks.has(index) ? 'remove' : 'add'
    const current: Press = {
      index,
      x: event.clientX,
      y: event.clientY,
      touch,
      dragging: false,
      mode,
      timer: undefined,
    }
    if (touch) {
      current.timer = window.setTimeout(() => {
        if (press.current !== current) return
        current.dragging = true
        setDrag({ start: index, current: index, mode })
        navigator.vibrate?.(8)
      }, LONG_PRESS_MS)
    } else {
      root.current?.setPointerCapture(event.pointerId)
    }
    press.current = current
    setFocusIndex(index)
  }

  function onPointerMove(event: PointerEvent) {
    const current = press.current
    if (!current) return
    if (current.touch && !current.dragging) {
      // 还没到长按就动了：这是在滚动页面，不是划选
      if (Math.hypot(event.clientX - current.x, event.clientY - current.y) > 10) {
        window.clearTimeout(current.timer)
        press.current = null
      }
      return
    }
    const index = indexAt(event.clientX, event.clientY)
    if (index < 0) return
    if (!current.dragging) {
      if (index === current.index) return
      current.dragging = true
    }
    setDrag({ start: current.index, current: index, mode: current.mode })
  }

  function onPointerUp(event: PointerEvent) {
    const current = press.current
    press.current = null
    if (!current) return
    window.clearTimeout(current.timer)
    if (current.dragging) {
      if (drag) {
        commit(paint(doc.blanks, blankableBetween(doc.chars, drag.start, drag.current), drag.mode))
      }
      setDrag(null)
      setAnchor(null)
      lastTap.current = null
      return
    }
    if (isBlankable(doc.chars[current.index])) tap(current.index, event.timeStamp)
  }

  function onPointerCancel() {
    window.clearTimeout(press.current?.timer)
    press.current = null
    setDrag(null)
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      setAnchor(null)
      return
    }
    const index = indexOf(event.target)
    if (index < 0) return
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault()
      if (event.shiftKey && anchor !== null && anchor !== index) {
        commit(paint(doc.blanks, blankableBetween(doc.chars, anchor, index), 'add'))
        setAnchor(null)
      } else if (event.shiftKey) {
        setAnchor(index)
      } else {
        commit(paint(doc.blanks, [index]))
      }
      return
    }
    const step =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? -1
          : 0
    if (!step) return
    event.preventDefault()
    let next = index + step
    while (next >= 0 && next < doc.chars.length && !isBlankable(doc.chars[next])) next += step
    if (next < 0 || next >= doc.chars.length) return
    setFocusIndex(next)
    root.current?.querySelector<HTMLElement>(`[data-i="${next}"]`)?.focus()
  }

  const preview = drag ? new Set(blankableBetween(doc.chars, drag.start, drag.current)) : null
  // 拖动中按预览显示，不拖动时按实际状态
  function isShown(index: number) {
    return preview?.has(index) ? drag?.mode === 'add' : doc.blanks.has(index)
  }
  const firstTabbable =
    focusIndex !== null && isBlankable(doc.chars[focusIndex] ?? '')
      ? focusIndex
      : doc.chars.findIndex(isBlankable)

  return (
    <div className="mt-3 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <span className="font-mono text-[11px] tracking-[0.22em] text-muted-foreground">
          {t('挖空')}
        </span>
        <span className="flex items-center gap-3 font-mono text-[10px] tabular-nums tracking-[0.1em] text-muted-foreground">
          {groups.length ? t('共 {count} 处 · {cells} 格', { count: groups.length, cells }) : null}
          {groups.length ? (
            <button
              type="button"
              onClick={() => {
                setAnchor(null)
                lastTap.current = null
                commit(new Set())
              }}
              className="inline-flex items-center gap-1 text-muted-foreground transition-colors hover:text-stamp"
            >
              <Eraser className="size-3" />
              {t('清除全部')}
            </button>
          ) : null}
        </span>
      </div>

      <p className="text-xs leading-6 text-muted-foreground">
        {anchor !== null
          ? t('已选起点：再点一个字，两字之间都会挖空。')
          : t('点字挖空，拖动划选（手机上先长按）；双击起点字再点终点字，中间一起挖空。')}
        {anchor !== null ? (
          <button
            type="button"
            onClick={() => setAnchor(null)}
            className="ml-2 underline underline-offset-4 hover:text-foreground"
          >
            {t('取消')}
          </button>
        ) : null}
      </p>

      {issues.length ? (
        <ul role="alert" className="space-y-1 border-l-2 border-l-stamp pl-3 text-xs text-stamp">
          {issues.map((issue) => (
            <li key={issue}>{t(ISSUE_TEXT[issue])}</li>
          ))}
        </ul>
      ) : null}

      <div
        ref={root}
        role="group"
        aria-label={t('点选要挖空的字')}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onKeyDown={onKeyDown}
        onContextMenu={(event) => event.preventDefault()}
        className="max-h-[22rem] touch-pan-y overflow-y-auto border border-dashed border-foreground/25 bg-sheet px-3.5 py-3 font-serif text-[15px] leading-10 break-words whitespace-pre-wrap select-none [-webkit-touch-callout:none]"
      >
        {doc.chars.length ? (
          doc.chars.map((char, index) => {
            if (!isBlankable(char)) return <span key={index}>{char}</span>
            const blank = doc.blanks.has(index)
            const inPreview = preview?.has(index) ?? false
            const shown = isShown(index)
            const joined = shown && isShown(index - 1)
            return (
              <span
                key={index}
                data-i={index}
                role="checkbox"
                aria-checked={blank}
                tabIndex={index === firstTabbable ? 0 : -1}
                className={cn(
                  'cursor-pointer border-b-2 border-transparent px-px outline-none transition-colors',
                  'hover:bg-stamp-soft focus-visible:shadow-[0_0_0_2px_var(--stamp)]',
                  shown && 'border-stamp bg-stamp-soft font-semibold',
                  joined && 'border-l border-l-stamp/30',
                  inPreview && 'bg-stamp/25',
                  anchor === index && 'bg-stamp text-[#fbf6ec]',
                )}
              >
                {char}
              </span>
            )
          })
        ) : (
          <span className="font-sans text-xs text-muted-foreground">
            {t('先在上面写下完整的故事，然后在这里点选要挖空的字。')}
          </span>
        )}
      </div>
    </div>
  )
}
