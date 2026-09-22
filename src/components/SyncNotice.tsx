import { useEffect, useState } from 'react'
import { Cloud } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import type { SyncState } from '@/lib/save-sync'

/** Keyed by status in the app so each new sync gets a fresh notice and timer. */
export function SyncNotice({ state, onRetry }: { state: SyncState; onRetry: () => void }) {
  const { t } = useI18n()
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    if (state.status !== 'synced') return
    const timer = window.setTimeout(() => setHidden(true), 3000)
    return () => window.clearTimeout(timer)
  }, [state.status])

  if (hidden) return null

  return (
    <div
      role="status"
      className="flex shrink-0 flex-wrap items-center gap-2 border-b border-foreground/20 px-4 py-1.5 font-mono text-[11px] sm:px-6"
    >
      <Cloud className="size-3.5" />
      <span>
        {t(
          {
            local: '已保存在本机',
            syncing: '同步中',
            synced: '已同步',
            offline: '等待联网',
            error: '同步失败',
            auth: '同步失败：请重新登录',
            storage: '进度尚未保存：本机存储不可用',
          }[state.status],
        )}
      </span>
      {state.status === 'error' ? (
        <span>
          {t(
            state.httpStatus === 429 || (state.httpStatus ?? 0) >= 500
              ? '稍后自动重试'
              : '服务器拒绝存档，请重试或减少单局内容',
          )}{' '}
          ({state.httpStatus})
        </span>
      ) : null}
      {['offline', 'error', 'auth', 'storage'].includes(state.status) ? (
        <button type="button" onClick={onRetry} className="underline underline-offset-2">
          {t('重试同步')}
        </button>
      ) : null}
    </div>
  )
}
