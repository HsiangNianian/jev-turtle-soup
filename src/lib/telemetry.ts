/**
 * 客户端错误上报。
 *
 * 和「反馈」互补：反馈要玩家自己发现、自己描述，而**白屏时他根本按不到反馈按钮**。
 * 所以这一条是自动的 —— 出事故时我们主动知道，而不是等玩家截图。
 *
 * 只发技术信息（错误、堆栈、路径、版本、语言）。**不发题面、对话、邮箱**，
 * 错误上报不该变成偷偷上传用户数据。
 */
let sent = 0
/** 一次页面加载最多上报几条：避免某个循环里把自己刷屏。 */
const MAX_PER_LOAD = 3

function buildId(): string {
  try {
    return document.querySelector('meta[name="build"]')?.getAttribute('content') ?? ''
  } catch {
    return ''
  }
}

function locale(): string {
  try {
    return localStorage.getItem('turtle-soup.locale') ?? ''
  } catch {
    return ''
  }
}

export function reportError(error: unknown, source: string): void {
  if (sent >= MAX_PER_LOAD) return
  sent += 1

  const message =
    error instanceof Error ? error.message : typeof error === 'string' ? error : '未知错误'
  const stack = error instanceof Error ? (error.stack ?? '') : ''

  try {
    void fetch('/api/errors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // keepalive：白屏 / 跳转时也尽量把它送出去
      keepalive: true,
      body: JSON.stringify({
        message,
        stack,
        path: location.pathname,
        buildId: buildId(),
        locale: locale(),
        source,
      }),
    }).catch(() => undefined)
  } catch {
    /* 上报本身失败就算了，绝不能再抛一次 */
  }
}

/** 装两个全局钩子。React 渲染错误由 ErrorBoundary 单独报（带组件栈）。 */
export function installErrorReporting(): void {
  window.addEventListener('error', (event) => {
    // 资源加载失败（img/script 404）没有 error 对象，交给 index.html 的自愈脚本
    if (!event.error) return
    reportError(event.error, 'error')
  })
  window.addEventListener('unhandledrejection', (event) => {
    reportError(event.reason, 'unhandledrejection')
  })
}
