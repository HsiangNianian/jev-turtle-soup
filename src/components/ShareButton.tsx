import { useState } from 'react'
import { Check, Share2 } from 'lucide-react'

import { cn } from '@/lib/utils'
import { useI18n } from '@/lib/i18n'

/**
 * 复制链接 + 系统分享；不引任何第三方脚本。
 * 默认是留言板上那枚安静的文字链；`iconOnly` 只留一枚盖章色图标（对局里的分享入口），
 * 不加边框，含义与复制成功都靠 aria-label / title 交代。
 */
export function ShareButton({
  path,
  title,
  label,
  iconOnly = false,
  className,
}: {
  path: string
  title: string
  /** 覆盖按钮文案；默认「分享」 */
  label?: string
  iconOnly?: boolean
  className?: string
}) {
  const { t } = useI18n()
  const [copied, setCopied] = useState(false)

  async function share() {
    const url = `${window.location.origin}${path}`
    const nav = navigator as Navigator & { share?: (data: ShareData) => Promise<void> }
    if (typeof nav.share === 'function') {
      try {
        await nav.share({ title, url })
        return
      } catch {
        /* 用户取消分享就当作没事，继续走复制 */
      }
    }
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      window.prompt(t('请手动复制这个链接'), url)
    }
  }

  const text = copied ? t('已复制链接') : (label ?? t('分享'))

  return (
    <button
      type="button"
      onClick={() => void share()}
      aria-label={text}
      title={text}
      className={cn(
        'flex items-center font-mono tracking-[0.16em] transition-colors',
        iconOnly
          ? 'justify-center p-1.5 text-stamp hover:opacity-70'
          : 'gap-1.5 text-[11px] text-muted-foreground hover:text-foreground',
        className,
      )}
    >
      {copied && iconOnly ? (
        <Check className="size-3.5" aria-hidden />
      ) : (
        <Share2 className="size-3.5" aria-hidden />
      )}
      {iconOnly ? null : text}
    </button>
  )
}
