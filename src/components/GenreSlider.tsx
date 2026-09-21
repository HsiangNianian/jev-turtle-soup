import { useEffect, useMemo, useRef, useState } from 'react'

import { useI18n } from '@/lib/i18n'

/**
 * 题材坐标：一根示波器。
 *
 * 波形随位置变形——越靠变格，振幅越大、右边那道尖峰越炸；红色光标落在曲线上，
 * 拖动时波形走得快，静止时也留一点极慢的行进，让它看起来是活的。
 *
 * 两个刻意的取舍：
 * - 检索只发生在**松手**那一刻（原生 change），拖动过程一帧一请求都发不出去。
 * - 出屏或系统开了「减少动态效果」就停帧，别让一个常驻动画白烧电。
 */
export const GENRE_NEUTRAL = 50

/** 采样点数：够平滑，又不至于每帧算太多。 */
const SAMPLES = 128
const VIEW_HEIGHT = 64
const BASELINE = VIEW_HEIGHT / 2

function waveY(x: number, value: number, phase: number): number {
  const amp = 4 + (value / 100) * 20
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
  const [sweeping, setSweeping] = useState(false)
  const [visible, setVisible] = useState(true)
  const [calm, setCalm] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)

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
    // value 变了要重画；phase 一直在动，所以波形一直是活的
  }, [value, phase])

  const cursorY = waveY(value / 100, value, phase)
  const readoutLabel =
    value === GENRE_NEUTRAL ? t('居中 · 不限') : value > GENRE_NEUTRAL ? t('变格度') : t('本格度')
  const readoutValue = value === GENRE_NEUTRAL ? null : value > GENRE_NEUTRAL ? value : 100 - value
  const readoutText = readoutValue === null ? readoutLabel : `${readoutLabel} ${readoutValue}`

  function release() {
    if (calm) return
    setSweeping(false)
    window.requestAnimationFrame(() => setSweeping(true))
    window.setTimeout(() => setSweeping(false), 520)
  }

  return (
    <div ref={boxRef} className="border border-foreground/30 bg-card px-4 py-4 sm:px-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="font-mono text-[10px] tracking-[0.26em] text-muted-foreground">
          {t('题材坐标')}
        </span>
        <span className="font-mono text-[11px] tracking-[0.16em] tabular-nums">
          <span className="text-muted-foreground">{readoutLabel}</span>
          {readoutValue === null ? null : <> {readoutValue}</>}
        </span>
      </div>

      <div className="relative mt-4 h-16">
        <input
          ref={inputRef}
          type="range"
          min={0}
          max={100}
          step={1}
          value={value}
          aria-label={t('题材坐标')}
          aria-valuetext={readoutText}
          onChange={(event) => setValue(Number(event.target.value))}
          onPointerDown={() => setDragging(true)}
          onPointerUp={() => {
            setDragging(false)
            release()
          }}
          onKeyDown={() => setDragging(true)}
          onKeyUp={() => {
            setDragging(false)
            release()
          }}
          onBlur={() => setDragging(false)}
          className="peer absolute inset-0 z-10 h-full w-full cursor-ew-resize opacity-0"
        />

        <svg
          className="absolute inset-0 h-full w-full text-foreground"
          viewBox={`0 0 100 ${VIEW_HEIGHT}`}
          preserveAspectRatio="none"
          aria-hidden
        >
          {[16, 32, 48].map((y) => (
            <line
              key={y}
              x1="0"
              x2="100"
              y1={y}
              y2={y}
              stroke="currentColor"
              strokeWidth="0.2"
              opacity="0.14"
            />
          ))}
          {[25, 50, 75].map((x) => (
            <line
              key={x}
              x1={x}
              x2={x}
              y1="0"
              y2={VIEW_HEIGHT}
              stroke="currentColor"
              strokeWidth="0.2"
              opacity="0.14"
            />
          ))}
          <polyline
            points={points}
            fill="none"
            stroke="currentColor"
            strokeWidth="0.7"
            vectorEffect="non-scaling-stroke"
          />
        </svg>

        {/* 松手后扫一道；键盘操作时也算 */}
        {sweeping ? (
          <span
            className="pointer-events-none absolute inset-y-0 w-8 bg-gradient-to-r from-transparent via-foreground/25 to-transparent"
            style={{ animation: 'genre-sweep 500ms linear' }}
          />
        ) : null}

        <div
          className="pointer-events-none absolute inset-y-0 w-px bg-[var(--stamp)] opacity-80 peer-focus-visible:w-[2px]"
          style={{ left: `${value}%` }}
        />
        <span
          className="pointer-events-none absolute size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--stamp)]"
          style={{ left: `${value}%`, top: `${(cursorY / VIEW_HEIGHT) * 100}%` }}
        />
      </div>

      <div className="mt-3 flex items-start justify-between gap-4 font-mono text-[10px] tracking-[0.14em] text-muted-foreground">
        <span className="max-w-[45%]">{t('本格·逻辑推理')}</span>
        <span className="max-w-[45%] text-right">{t('变格·怪力乱神')}</span>
      </div>
    </div>
  )
}
