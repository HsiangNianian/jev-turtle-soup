import type { ArchivedGame } from '@/lib/archive'

import { SaveRequestError, type SaveRequestOptions } from '@turtle-soup/client-core/transport'
export { SaveRequestError } from '@turtle-soup/client-core/transport'
export type { SaveRequestOptions } from '@turtle-soup/client-core/transport'
async function request<T>(
  path: string,
  options: SaveRequestOptions,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(path, {
    ...init,
    signal: options.signal,
    headers: { 'Content-Type': 'application/json', 'X-Save-Owner': options.owner },
  })
  const data = (await response.json().catch(() => ({}))) as { error?: string }
  if (!response.ok)
    throw new SaveRequestError(response.status, data.error || `HTTP ${response.status}`)
  return data as T
}
export function listSaves(options: SaveRequestOptions) {
  return request<{ items: ArchivedGame[] }>('/api/me/saves', options).then((data) => data.items)
}
export function putSave(game: ArchivedGame, options: SaveRequestOptions) {
  return request<{ ok: boolean }>(`/api/me/saves/${encodeURIComponent(game.id)}`, options, {
    method: 'PUT',
    body: JSON.stringify({ game }),
  })
}
export function deleteSave(id: string, options: SaveRequestOptions) {
  return request<{ ok: boolean }>(`/api/me/saves/${encodeURIComponent(id)}`, options, {
    method: 'DELETE',
  })
}
