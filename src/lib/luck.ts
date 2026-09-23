import { uid } from '@/lib/utils'

const DEVICE_KEY = 'turtle-soup.device.v1'

export { dailyLuck, todayKey } from '@turtle-soup/client-core/luck'
export type { DailyLuck, LuckTier } from '@turtle-soup/client-core/luck'

export function getDeviceId(): string {
  try {
    const existing = localStorage.getItem(DEVICE_KEY)
    if (existing) return existing
    const created = uid()
    localStorage.setItem(DEVICE_KEY, created)
    return created
  } catch {
    return 'anonymous-device'
  }
}
