import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * 本地唯一 id。
 * `crypto.randomUUID` 只在**安全上下文**（https / localhost）里存在；
 * 从 http 打开时它是 undefined，直接调用会抛错——游戏一开始就白屏。
 * 所以这里留一条兜底，宁可 id 弱一点也不要整页挂掉。
 */
export function uid(): string {
  const webCrypto = globalThis.crypto
  if (webCrypto && typeof webCrypto.randomUUID === 'function') {
    try {
      return webCrypto.randomUUID()
    } catch {
      /* 某些实现会抛，落到下面兜底 */
    }
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
