import { useEffect } from 'react'
import { ArrowLeft, ExternalLink } from 'lucide-react'

import { Button, Notice, PageShell } from '@/components/Bits'
import { isInternalUrl, isSafeUrl } from '@/lib/external'
import { useI18n } from '@/lib/i18n'
import { navigate } from '@/lib/router'

/**
 * 站外链接中转页：先把目标亮出来，再让用户决定要不要去。
 * 目标地址只允许 http/https，避免 javascript: 之类的伪协议。
 */
export function LeavingPage() {
  const { t } = useI18n()
  const target = new URLSearchParams(window.location.search).get('to') ?? ''
  const internal = isInternalUrl(target)

  // 站内地址不需要警告：直接过去
  useEffect(() => {
    if (isSafeUrl(target) && internal) navigate(target, { replace: true })
  }, [target, internal])

  const safe = isSafeUrl(target) && !internal

  let host = ''
  try {
    host = safe ? new URL(target).host : ''
  } catch {
    host = ''
  }

  return (
    <PageShell label={t('站外链接')} title={safe ? t('即将离开本站') : t('这个链接不能用')}>
      {safe ? (
        <>
          <p className="mt-6 max-w-xl font-serif text-[15px] leading-8 text-foreground/80">
            {t(
              '你要去的是另一个网站，不是海龟汤调查局的一部分。我们不控制它的内容，也不对它的隐私做法负责。',
            )}
          </p>

          <div className="mt-5 border border-foreground/25 bg-card px-4 py-3.5">
            <div className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground">
              {t('目标地址')}
            </div>
            <div className="mt-2 font-mono text-[12px] break-all text-foreground/90">{target}</div>
            {host ? (
              <div className="mt-1 font-mono text-[10px] tracking-[0.14em] text-stamp">
                {t('站点：{host}', { host })}
              </div>
            ) : null}
          </div>

          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Button onClick={() => window.open(target, '_blank', 'noopener,noreferrer')}>
              {t('继续前往')} <ExternalLink className="size-3.5" />
            </Button>
            <button
              type="button"
              onClick={() => {
                if (window.history.length > 1) window.history.back()
                else navigate('/')
              }}
              className="flex items-center gap-2 border border-foreground/30 px-5 py-2.5 font-mono text-[11px] tracking-[0.18em] text-muted-foreground transition-colors hover:border-foreground hover:text-foreground"
            >
              <ArrowLeft className="size-3.5" /> {t('返回')}
            </button>
          </div>

          <p className="mt-6 font-mono text-[10px] leading-6 tracking-[0.14em] text-muted-foreground/70">
            {t('继续前往会在新标签页打开，并且不会把本站的登录状态带过去。')}
          </p>
        </>
      ) : (
        <>
          <div className="mt-6">
            <Notice tone="stamp">{t('这个链接的地址不合法，可能被截断或改写过。')}</Notice>
          </div>
          <div className="mt-6">
            <Button onClick={() => navigate('/')}>
              <ArrowLeft className="size-3.5" /> {t('回首页')}
            </Button>
          </div>
        </>
      )}
    </PageShell>
  )
}
