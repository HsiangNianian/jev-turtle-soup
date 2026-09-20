export interface ReportPayload {
  puzzleId: string
  kind: 'session' | 'library'
  note: string
  playerKey: string
  locale: string
  snapshot: unknown
}

export function submitReport(payload: ReportPayload) {
  return fetch('/api/reports', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then(async (response) => {
    const data = (await response.json().catch(() => ({}))) as { error?: string }
    if (!response.ok) throw new Error(data.error || `提交失败（${response.status}）`)
    return data
  })
}
