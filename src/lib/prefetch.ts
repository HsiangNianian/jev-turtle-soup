import { listDailies } from '@/lib/daily-client'
import { getPublicProfile, listPuzzles } from '@/lib/library-client'

/**
 * 悬停/触摸导航时就把目标页要的数据取回来。
 *
 * 原生 App 常用这一招：你还在 A 页，它已经替 B 页把数据准备好了，点进去就是渲染好的。
 *
 * 但「能预取」不等于「该预取」，这里只挑三种：
 *
 * 1. 固定路径的列表页（首页、每日、题库）——一次请求换整页，稳赚。
 * 2. `/u/:handle` —— 作者主页的数据事先无从得知，预热有价值，而且它是公开数据。
 * 3. 其余一律不碰：
 *    - `/library/:id` **不需要**预取：列表里已经带着标题/汤面/难度/标签/作者，
 *      详情页只差一句作者简介，本地就能先渲染（见 getPuzzle 的 onStale）。
 *      再预取一次等于把同一份数据要两遍。
 *    - `/me`、`/upload`、`/profile` 是**登录后才有的私有数据**，而且未登录时必然 401。
 *      指针扫过一个链接就把私有数据拉进内存，是隐私上的坏味道，也没人等着它。
 *
 * 另外加了「停顿」：鼠标从一排链接上扫过去不该逐个发请求，
 * 所以悬停要停够 DWELL_MS 才真的发；指针移开就取消。
 * 按下/聚焦（触摸与键盘）不等待——那已经是明确的意图了。
 *
 * **移动端**没有悬停，所以那套「悬停预热」在这里几乎用不上：
 * 手指按下去到 click 只有几十毫秒，预热来不及。移动端真正对应的一招是
 * **进入视口就预热**（见 Link 的 prefetchOnView）——手机上你是滚着看的，
 * 下一屏要什么基本可预测。代价是流量，所以只在省流量/慢网之外才做。
 */
/**
 * 移动端的取舍和桌面端不一样：那里悬停是免费的，这里是**提前花用户的流量和电**。
 * 所以：省流量模式一定不预取（这是 Save-Data 的约定，用户说了省就别偷偷下），
 * 2G 级别的网络也不预取（等它下完，人早就自己点进去了）。
 *
 * 但**不**因为 3G 就不做：延迟越高，提前取回来的收益越大 —— 在慢网上把 3G 也
 * 排除掉是把因果关系弄反了。真机上 Chrome 报 3g 很常见（信号一般时就是 3g）。
 */
interface NetworkInfo {
  saveData?: boolean
  effectiveType?: string
}

function shouldPrefetch(): boolean {
  const connection = (navigator as Navigator & { connection?: NetworkInfo }).connection
  if (!connection) return true
  if (connection.saveData) return false
  if (connection.effectiveType && /^(slow-2g|2g)$/.test(connection.effectiveType)) return false
  return true
}

const DWELL_MS = 120
/** 同一个目标一分钟内只预热一次 */
const PREFETCH_TTL_MS = 60 * 1000

const timers = new Map<string, number>()
const prefetched = new Map<string, number>()

const FIXED_LOADERS: Record<string, () => Promise<unknown>> = {
  '/': () => listDailies(),
  '/daily': () => listDailies(),
  '/library': () => listPuzzles({ sort: 'new' }),
}

function loaderFor(path: string): (() => Promise<unknown>) | null {
  const fixed = FIXED_LOADERS[path]
  if (fixed) return fixed
  const profile = /^\/u\/([^/]+)$/.exec(path)
  if (profile) {
    const handle = decodeURIComponent(profile[1])
    return () => getPublicProfile(handle)
  }
  return null
}

export function prefetchRoute(path: string, options: { immediate?: boolean } = {}): void {
  const loader = loaderFor(path)
  if (!loader) return
  if (!shouldPrefetch()) return
  if (Date.now() - (prefetched.get(path) ?? 0) < PREFETCH_TTL_MS) return

  window.clearTimeout(timers.get(path))
  const run = () => {
    timers.delete(path)
    prefetched.set(path, Date.now())
    // 失败无所谓：真正点进去时还会再请求一次，这里只是提前把缓存焐热
    void loader().catch(() => undefined)
  }
  if (options.immediate) run()
  else timers.set(path, window.setTimeout(run, DWELL_MS))
}

/** 指针移开了就别预热了。 */
export function cancelPrefetch(path: string): void {
  const timer = timers.get(path)
  if (timer === undefined) return
  window.clearTimeout(timer)
  timers.delete(path)
}
