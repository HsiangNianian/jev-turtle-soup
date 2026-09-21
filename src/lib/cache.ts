/**
 * 本地优先的一层小缓存。
 *
 * 原生 App 看起来「秒开」，靠的不是网络快，而是**打开时先拿本地存的那份渲染**，
 * 网络回来再悄悄替换（stale-while-revalidate）。这里就是网页版的同一招。
 *
 * 只用 localStorage：量小（几 KB 的列表/用户资料）、同步可读，首屏渲染前就能拿到，
 * 不像 IndexedDB 那样要等一个微任务。存不下或隐私模式就安静地当没有缓存。
 */
const PREFIX = 'turtle-soup.cache.v1.'

interface Entry<T> {
  /** 写入时间，用来判断新鲜度 */
  at: number
  value: T
}

function storage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export function readCache<T>(key: string, maxAgeMs: number): T | null {
  const store = storage()
  if (!store) return null
  try {
    const raw = store.getItem(PREFIX + key)
    if (!raw) return null
    const entry = JSON.parse(raw) as Entry<T>
    if (typeof entry?.at !== 'number') return null
    if (Date.now() - entry.at > maxAgeMs) return null
    return entry.value
  } catch {
    return null
  }
}

export function writeCache<T>(key: string, value: T): void {
  const store = storage()
  if (!store) return
  try {
    store.setItem(PREFIX + key, JSON.stringify({ at: Date.now(), value } satisfies Entry<T>))
  } catch {
    /* 配额满了就算了，缓存不值得打扰用户 */
  }
}

export function dropCache(key: string): void {
  try {
    storage()?.removeItem(PREFIX + key)
  } catch {
    /* 忽略 */
  }
}

/**
 * 本地优先取数：手上有缓存就先把它交出去（调用方立刻上屏），
 * 然后照常请求；拿到新数据再交一次。
 *
 * 缓存里没有东西时行为和普通请求一样，只是多了一次 localStorage 读。
 */
export async function staleWhileRevalidate<T>(
  key: string,
  maxAgeMs: number,
  fetcher: () => Promise<T>,
  hooks: { onStale?: (value: T) => void } = {},
): Promise<T> {
  const cached = readCache<T>(key, maxAgeMs)
  if (cached !== null) hooks.onStale?.(cached)
  const fresh = await fetcher()
  writeCache(key, fresh)
  return fresh
}
