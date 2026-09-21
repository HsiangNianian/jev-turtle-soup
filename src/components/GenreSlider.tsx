import { useEffect, useMemo, useRef, useState } from 'react'

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
  const boxRef = useRef<HTMLDivElement>(null)

  const readout = useMemo(
    () => (next: number) => {
      if (next <= POLE) return t('本格·逻辑推理')
      if (next >= 100 - POLE) return t('变格·怪力乱神')
      if (next === GENRE_NEUTRAL) return t('居中 · 不限')
      return next > GENRE_NEUTRAL ? `${t('变格度')} ${next}` : `${t('本格度')} ${100 - next}`
    },
    [t],
  )

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
  }, [])

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

  function handleInput(next: number) {
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
    <div ref={boxRef} className="relative mt-6 h-40 select-none sm:h-52">
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
        onPointerDown={() => setDragging(true)}
        onPointerUp={() => setDragging(false)}
        onKeyDown={() => setDragging(true)}
        onKeyUp={() => setDragging(false)}
        onBlur={() => setDragging(false)}
        className="peer absolute inset-0 z-10 h-full w-full cursor-ew-resize opacity-0"
      />

      {/* 大字：既是读数，也是背景 */}
      <div
        className="pointer-events-none absolute inset-0 flex items-center justify-center"
        aria-hidden
      >
        <span className="relative inline-block h-[1.3em] overflow-hidden whitespace-nowrap align-bottom font-serif text-[3.25rem] leading-none font-black tracking-[-0.02em] tabular-nums sm:text-[5rem]">
          {/* 量宽用：描边那层往右下错开一点，这里留出余量，免得被裁掉 */}
          <span className="invisible block pr-[0.1em]">{fromText ?? toText}</span>
          {fromText !== null && fromText !== toText ? (
            <span className="invisible block pr-[0.1em]">{toText}</span>
          ) : null}
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
            {/* 错位的描边层：像套印没对准的那一下 */}
            <span
              aria-hidden
              className="absolute inset-0 translate-x-[0.045em] translate-y-[0.03em] text-transparent"
              style={{ WebkitTextStroke: '0.03em var(--foreground)' }}
            >
              {toText}
            </span>
            <span className="relative">{toText}</span>
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
