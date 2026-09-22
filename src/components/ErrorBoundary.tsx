import { Component, type ReactNode } from 'react'

/**
 * 渲染兜底。
 *
 * 起因是一次真实事故：调试面板读存档里的历史判读数据时，假设某个字段一定存在，
 * 而那个字段正好改过名（`solved` ↔ `explainsSurface`）—— `undefined.toFixed()`
 * 抛错，React 没有边界可接，**整页直接白屏**，玩家手上的存档全打不开。
 *
 * 所以两层都要有：容易出错的地方（比如读历史数据的调试面板）自己容错，
 * 而整个应用再兜一层 —— 任何漏网的渲染错误都只是坏掉那一块，不会白屏。
 */
export class ErrorBoundary extends Component<
  { children: ReactNode; fallback?: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  componentDidCatch(error: unknown): void {
    console.error('[turtle-soup] 渲染出错，已兜住：', error)
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children
    return this.props.fallback ?? null
  }
}
