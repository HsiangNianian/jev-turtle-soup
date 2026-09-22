import { TriangleAlert } from 'lucide-react'

import { useI18n } from '@/lib/i18n'

/**
 * 兜底界面：渲染出错时至少给一句人话和一个能按的按钮，而不是一片白。
 * 存档在本机，刷新不会丢东西 —— 这一点要说出来，否则玩家不敢刷新。
 */
export function CrashNote() {
  const { t } = useI18n()
  return (
    <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col items-center justify-center px-5 py-16 text-center">
      <TriangleAlert className="size-5 text-stamp" />
      <h1 className="mt-4 font-serif text-2xl font-semibold">{t('这一页出了点问题')}</h1>
      <p className="mt-3 max-w-md font-serif text-[14px] leading-7 text-foreground/75">
        {t('刷新一下就好。你的案卷存在本机，刷新不会丢。')}
      </p>
      <p className="mt-2 max-w-md font-mono text-[10px] leading-6 tracking-[0.12em] text-muted-foreground">
        {t('这个错误已经自动记下来了，不用你另外反馈。')}
      </p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="mt-6 bg-foreground px-6 py-3 font-mono text-[11px] font-bold tracking-[0.2em] text-background transition-opacity hover:opacity-85"
      >
        {t('刷新')}
      </button>
    </div>
  )
}
