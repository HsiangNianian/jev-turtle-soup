import { useMemo } from 'react'

import { dailyLuck, getDeviceId, todayKey } from '@/lib/luck'
import { useI18n } from '@/lib/i18n'

export function DailyLuck() {
  const { t } = useI18n()
  const luck = useMemo(() => {
    const device = getDeviceId()
    return dailyLuck(todayKey(), window.location.host, device)
  }, [])

  return (
    <div className="flex h-[clamp(2.75rem,9vw,4.5rem)] shrink-0 flex-col items-center justify-center border border-foreground/40 bg-card px-2.5 sm:px-3">
      <div className="font-mono text-[9px] leading-none tracking-[0.14em] whitespace-nowrap text-muted-foreground">
        {t('今日人品')}
      </div>
      <div
        className="mt-1 font-mono text-[clamp(18px,4.2vw,30px)] leading-none font-bold tabular-nums"
        style={{ color: luck.tier.tone }}
      >
        {luck.score}
      </div>
    </div>
  )
}
