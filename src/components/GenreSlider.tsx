import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { useI18n } from '@/lib/i18n'

/**
 * 题材坐标：没有轨道、没有边框，读数本身就是控件。
 *
 * 一行大字当背景（本格度 59 / 居中 · 不限 / 变格·怪力乱神……），上面跑一条示波器曲线，
 * 红色光标落在曲线上。读数变化时旧字向上退出、新字从下方顶上来（上下覆写）。
 *
 * 三个刻意的取舍：
 * - 检索只发生在**松手**那一刻（原生 change），拖动过程一帧一请求都发不出去。
 * - 翻字有最小间隔：拖得快时直接换字，不让每一帧都重启动画——否则字会永远停在
 *   半路上，整块看起来像空的。
 * - 出屏或系统开了「减少动态效果」就停帧，别让一个常驻动画白烧电。
 */
export const GENRE_NEUTRAL = 50

/** 两头留一点余地，滑到最边上直接报出这一极的名字。 */
const POLE = 4

/** 采样点数：够平滑，又不至于每帧算太多。 */
const SAMPLES = 128
const VIEW_HEIGHT = 120
const BASELINE = VIEW_HEIGHT / 2

/** 翻字动画时长，以及两次翻字之间的最小间隔。 */
const FLIP_MS = 150
const FLIP_GAP_MS = 120

/**
 * 字号上限与下限。真正的字号按容器宽度折算（见 useFitText）——
 * 「变格·怪力乱神」比「居中 · 不限」长得多，写死一个 rem 总有一头要溢出。
 */
const MAX_FONT_PX = 84
const MIN_FONT_PX = 18

/**
 * 大字只占容器宽度的这个比例，剩下两边留给波形。
 * 取 1 就会顶满整条示波器，字看着像块背景板而不是读数。
 */
const FILL_RATIO = 0.66
/** 量宽用的参考字号：用大一点的数字量，折算误差小。 */
const PROBE_PX = 100

/**
 * 让这一行字始终装得下，而且**框子大小恒定**：
 * 宽度直接钉成容器宽度的 FILL_RATIO，再用隐藏探针量出的文案宽度折算字号。
 * 宽度不跟着文案走，翻页时旧字再长也顶不出控件（多出来的部分被裁掉）。
 * 改的是 DOM 上的 style，不经过 React state，所以不会每换一次字就多一次渲染。
 * 窗口大小变化会重算。
 */
function useFitText(text: string) {
  const boxRef = useRef<HTMLDivElement>(null)
  const probeRef = useRef<HTMLSpanElement>(null)
  const sizeRef = useRef<HTMLSpanElement>(null)

  useLayoutEffect(() => {
    const box = boxRef.current
    const probe = probeRef.current
    const target = sizeRef.current
    if (!box || !probe || !target) return
    const fit = () => {
      const available = box.clientWidth
      const width = probe.getBoundingClientRect().width
      if (!available || !width) return
      const frameWidth = available * FILL_RATIO
      const size = Math.max(MIN_FONT_PX, Math.min(MAX_FONT_PX, (frameWidth / width) * PROBE_PX))
      target.style.width = `${frameWidth}px`
      target.style.fontSize = `${size}px`
    }
    fit()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(fit)
    observer.observe(box)
    return () => observer.disconnect()
  }, [text])

  return { boxRef, probeRef, sizeRef }
}

function waveY(x: number, value: number, phase: number): number {
  const amp = 3 + (value / 100) * 12
  const spikes = value / 100
  const wave = Math.sin((x * 6 + phase) * 1.6) * 0.45 + Math.sin((x * 14 + phase * 2) * 1.3) * 0.2
  const burst = Math.exp(-Math.pow((x - 0.78) * 5, 2)) * spikes * 1.6
  return BASELINE - (wave + burst * Math.sin(x * 40 + phase * 4)) * amp
}

export function GenreSlider({ onCommit }: { onCommit: (value: number) => void }) {
  const { t } = useI18n()
  const [value, setValue] = useState(GENRE_NEUTRAL)
  const [phase, setPhase] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [visible, setVisible] = useState(true)
  const [calm, setCalm] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  /** 正在拖拽的手指/鼠标；axis 为空表示还没判断方向。 */
  const pointer = useRef<{ id: number; x: number; y: number; axis: 'x' | 'y' | null } | null>(null)
  const latest = useRef(value)

  /**
   * 上下覆写用的两帧。存的是**数值**不是文案：文案在渲染时按当前语言算，
   * 所以切换界面语言时大字自己就跟着变了，不需要额外的同步。
   */
  const [frame, setFrame] = useState(() => ({
    from: null as number | null,
    to: GENRE_NEUTRAL,
    id: 0,
  }))
  const lastFlip = useRef(0)

  const readout = useMemo(
    () => (next: number) => {
      if (next <= POLE) return t('本格·逻辑推理')
      if (next >= 100 - POLE) return t('变格·怪力乱神')
      if (next === GENRE_NEUTRAL) return t('居中 · 不限')
      return next > GENRE_NEUTRAL ? `${t('变格度')} ${next}` : `${t('本格度')} ${100 - next}`
    },
    [t],
  )

  // 字号跟着容器宽度走，长的那几个（变格·怪力乱神）也不会捅出去
  const { boxRef, probeRef, sizeRef } = useFitText(readout(frame.to))

  // 松手那一刻才通知外面去检索
  useEffect(() => {
    const node = inputRef.current
    if (!node) return
    const settled = () => onCommit(Number(node.value))
    node.addEventListener('change', settled)
    return () => node.removeEventListener('change', settled)
  }, [onCommit])

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setCalm(media.matches)
    sync()
    media.addEventListener('change', sync)
    return () => media.removeEventListener('change', sync)
  }, [])

  // 滚出视野就停帧
  useEffect(() => {
    const node = boxRef.current
    if (!node || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), {
      rootMargin: '80px',
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [boxRef])

  const animating = visible && (!calm || dragging)

  useEffect(() => {
    if (!animating) return
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const delta = now - last
      last = now
      setPhase((prev) => prev + delta * (dragging ? 0.012 : 0.0015))
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [animating, dragging])

  const points = useMemo(() => {
    const list: string[] = []
    for (let i = 0; i <= SAMPLES; i += 1) {
      const x = i / SAMPLES
      list.push(`${(x * 100).toFixed(2)},${waveY(x, value, phase).toFixed(2)}`)
    }
    return list.join(' ')
  }, [value, phase])

  const cursorY = waveY(value / 100, value, phase)
  const readoutText = readout(value)
  const fromText = frame.from === null ? null : readout(frame.from)
  const toText = readout(frame.to)

  /** 手指/鼠标落在控件的哪个位置 → 0–100。整块区域都算。 */
  function valueAt(clientX: number): number {
    const box = boxRef.current
    if (!box) return latest.current
    const rect = box.getBoundingClientRect()
    if (!rect.width) return latest.current
    const ratio = (clientX - rect.left) / rect.width
    return Math.round(Math.min(1, Math.max(0, ratio)) * 100)
  }

  /**
   * 自己处理指针，而不是靠原生 range：
   * 原生 range 只有轨道附近那一条细带能被拖动，手机上按到这块区域的
   * 上半或下半，手势就归浏览器去滚页面了——这正是「指针很难拖」的原因。
   * 方向先判：横着划才动游标，竖着划放给页面滚动。
   */
  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    pointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY, axis: null }
    event.currentTarget.setPointerCapture(event.pointerId)
    // 键盘仍然走原生 range，所以照样要给它焦点
    inputRef.current?.focus({ preventScroll: true })
    event.preventDefault()
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const state = pointer.current
    if (!state || state.id !== event.pointerId) return
    const dx = event.clientX - state.x
    const dy = event.clientY - state.y
    if (state.axis === null) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return
      state.axis = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y'
      if (state.axis === 'y') {
        // 竖向手势：还给浏览器滚页面
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId)
        }
        pointer.current = null
        setDragging(false)
        return
      }
      setDragging(true)
    }
    if (state.axis !== 'x') return
    handleInput(valueAt(event.clientX))
  }

  /**
   * 收尾。cancelled 为真表示浏览器把手势判成了滚动（touch-action: pan-y），
   * 这时候**不能**当成点击跳转——否则竖向滑动会顺手把游标甩到手指所在的横坐标。
   */
  function endPointer(event: React.PointerEvent<HTMLDivElement>, cancelled: boolean) {
    const state = pointer.current
    if (!state || state.id !== event.pointerId) return
    pointer.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    // 没判断出方向 = 单纯点了一下：点哪儿跳哪儿
    if (!cancelled && state.axis === null) handleInput(valueAt(event.clientX))
    setDragging(false)
    onCommit(latest.current)
  }

  function onPointerUp(event: React.PointerEvent<HTMLDivElement>) {
    endPointer(event, false)
  }

  function onPointerCancel(event: React.PointerEvent<HTMLDivElement>) {
    endPointer(event, true)
  }

  function handleInput(next: number) {
    latest.current = next
    setValue(next)
    const now = performance.now()
    // 拖得太快就只换字、不重启动画：否则每帧都从半路重来，整块会看着像空的
    const flip = frame.id === 0 || now - lastFlip.current >= FLIP_GAP_MS
    if (flip) lastFlip.current = now
    setFrame((prev) =>
      prev.to === next
        ? prev
        : flip
          ? { from: prev.to, to: next, id: prev.id + 1 }
          : { ...prev, to: next },
    )
  }

  return (
    <div
      ref={boxRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      className="relative mt-6 h-36 touch-pan-y cursor-ew-resize overflow-hidden select-none sm:h-44"
    >
      {/*
        量宽探针：同字体同字重，按参考字号量一遍文案宽度。
        必须套在一个 0×0 + overflow-hidden 的壳里——探针是按 100px 量的，
        直接摆在外面会撑出好几倍宽度，把主滚动容器变成可以横向拖动的，
        手机上表现就是「一划整页跟着跑」。
      */}
      <span
        aria-hidden
        className="pointer-events-none absolute top-0 left-0 h-0 w-0 overflow-hidden"
      >
        <span
          ref={probeRef}
          className="invisible block font-serif font-black whitespace-nowrap tracking-[-0.02em] tabular-nums"
          style={{ fontSize: `${PROBE_PX}px` }}
        >
          {toText}
        </span>
      </span>

      {/*
        input 只负责键盘与无障碍语义，**不接指针**：
        原生 range 在 touchstart 时会直接把值跳到手指的横坐标（tap-to-seek），
        而且 preventDefault 拦不住它（那是 touch 的默认行为，不由 pointer 事件决定）。
        手指一旦落在控件上去滚页面，游标就会被顺手甩过去。指针全由外层容器处理。
      */}
      <input
        ref={inputRef}
        type="range"
        min={0}
        max={100}
        step={1}
        value={value}
        aria-label={t('题材坐标')}
        aria-valuetext={readoutText}
        onChange={(event) => handleInput(Number(event.target.value))}
        onKeyDown={() => setDragging(true)}
        onKeyUp={() => setDragging(false)}
        onBlur={() => setDragging(false)}
        className="peer pointer-events-none absolute inset-0 h-full w-full opacity-0"
      />

      {/* 大字：既是读数，也是背景 */}
      <div
        className="pointer-events-none absolute inset-0 flex items-center justify-center"
        aria-hidden
      >
        <span
          ref={sizeRef}
          className="relative inline-block h-[1.3em] overflow-hidden text-center whitespace-nowrap align-bottom font-serif text-[2rem] leading-none font-black tracking-[-0.02em] tabular-nums"
        >
          {fromText ? (
            <span
              key={`out-${frame.id}`}
              className="absolute inset-x-0 top-0 text-muted-foreground/35"
              style={{
                animation: `genre-flip-out ${FLIP_MS}ms cubic-bezier(0.3,0.8,0.3,1) forwards`,
              }}
            >
              {fromText}
            </span>
          ) : null}
          <span
            key={`in-${frame.id}`}
            className="absolute inset-x-0 top-0"
            style={
              frame.id === 0
                ? undefined
                : { animation: `genre-flip-in ${FLIP_MS}ms cubic-bezier(0.3,0.8,0.3,1)` }
            }
          >
            {toText}
          </span>
        </span>
      </div>

      <svg
        className="pointer-events-none absolute inset-0 h-full w-full text-foreground/60"
        viewBox={`0 0 100 ${VIEW_HEIGHT}`}
        preserveAspectRatio="none"
        aria-hidden
      >
        <polyline
          points={points}
          fill="none"
          stroke="currentColor"
          strokeWidth="0.7"
          vectorEffect="non-scaling-stroke"
        />
      </svg>

      <div
        className="pointer-events-none absolute inset-y-0 w-px bg-[var(--stamp)] opacity-80 peer-focus-visible:w-[2px]"
        style={{ left: `${value}%` }}
      />
      <span
        className="pointer-events-none absolute size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--stamp)]"
        style={{ left: `${value}%`, top: `${(cursorY / VIEW_HEIGHT) * 100}%` }}
      />
    </div>
  )
}
