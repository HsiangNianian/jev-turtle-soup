/** 站外链接统一先走 /leaving 警告页。 */
export function externalHref(url: string): string {
  return `/leaving?to=${encodeURIComponent(url)}`
}

export function isSafeUrl(url: string): boolean {
  return /^https?:\/\//i.test(url.trim())
}

export const BARE_URL = /https?:\/\/[^\s<>()「」【】]+/i
