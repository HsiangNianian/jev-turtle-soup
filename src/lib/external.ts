/** 站外链接统一先走 /leaving 警告页。 */
export function externalHref(url: string): string {
  return `/leaving?to=${encodeURIComponent(url)}`
}

export function isSafeUrl(url: string): boolean {
  return /^https?:\/\//i.test(url.trim())
}

export const BARE_URL = /https?:\/\/[^\s<>()「」【】]+/i

/**
 * 是不是我们自己站内的地址：相对路径算站内；绝对地址则比对当前域名
 * （忽略 www. 前缀与端口差异），同站不弹警告，直接正常跳转。
 */
export function isInternalUrl(url: string, currentHost = window.location.host): boolean {
  const value = url.trim()
  if (!value) return false
  if (value.startsWith('/') && !value.startsWith('//')) return true
  if (!/^https?:\/\//i.test(value)) return false
  try {
    const target = new URL(value).host.toLowerCase().replace(/^www\./, '').split(':')[0]
    const current = currentHost.toLowerCase().replace(/^www\./, '').split(':')[0]
    return target === current
  } catch {
    return false
  }
}
