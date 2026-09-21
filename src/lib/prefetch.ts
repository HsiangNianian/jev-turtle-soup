import { listDailies } from '@/lib/daily-client'
import { listPuzzles } from '@/lib/library-client'

/**
 * 悬停/触摸导航时就把目标页要的数据取回来。
 *
 * 原生 App 常用这一招：你还在 A 页，它已经替 B 页把数据准备好了，
 * 点进去就是渲染好的。网页里等 `pointerenter` 就够了——手指按住或鼠标移上去，
 * 到真正点击之间通常有几百毫秒。
 *
 * 只预热「值得预热」的：列表页那种要打接口的。关于页是纯静态，没必要。
 * 同一个目标一分钟内只预热一次，免得来回蹭导航反复请求。
 */
const PREFETCH_TTL_MS = 60 * 1000
const prefetched = new Map<string, number>()

const LOADERS: Record<string, () => Promise<unknown>> = {
  '/': () => listDailies(),
  '/daily': () => listDailies(),
  '/library': () => listPuzzles({ sort: 'new' }),
}

export function prefetchRoute(path: string): void {
  const loader = LOADERS[path]
  if (!loader) return
  const last = prefetched.get(path) ?? 0
  if (Date.now() - last < PREFETCH_TTL_MS) return
  prefetched.set(path, Date.now())
  // 失败无所谓：真正点进去时还会再请求一次，这里只是提前把缓存焐热
  void loader().catch(() => undefined)
}
