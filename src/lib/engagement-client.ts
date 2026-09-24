import { getDeviceId } from '@/lib/luck'

export type EngagementEvent = 'entry_view' | 'puzzle_open' | 'first_question' | 'discussion_open'

function entrySource(): string {
  const campaign = new URLSearchParams(window.location.search).get('utm_source')
  if (campaign) return campaign
  try {
    const referrer = new URL(document.referrer)
    if (referrer.origin !== window.location.origin) return referrer.hostname
  } catch {
    // Direct visits have no referrer.
  }
  return 'direct'
}

/** Best-effort first-party measurement; gameplay never waits for this request. */
export function trackWebEngagement(event: EngagementEvent, puzzleId = ''): void {
  if (import.meta.env.DEV) return
  void fetch('/api/engagement', {
    method: 'POST',
    credentials: 'same-origin',
    keepalive: true,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      event,
      actorKey: getDeviceId(),
      puzzleId,
      platform: 'web',
      source: event === 'entry_view' ? entrySource() : 'internal',
    }),
  }).catch(() => undefined)
}
