import { ApiError } from './errors.ts'

const MAX_SNAPSHOT_CHARS = 24_000

export interface ReportSnapshotRead {
  snapshot: unknown
  snapshotStatus: 'complete' | 'trimmed' | 'recovered' | 'corrupt' | 'missing'
  snapshotRaw?: string
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Keep a suffix of whole messages. Never cut the serialized JSON itself. */
export function serializeReportSnapshot(value: unknown): string | null {
  if (value === undefined || value === null) return null
  let raw: string | undefined
  try {
    raw = JSON.stringify(value)
  } catch {
    return null
  }
  if (!raw) return null
  if (raw.length <= MAX_SNAPSHOT_CHARS) return raw

  // Work on the serialized shape, without mutating the caller's transcript.
  const snapshot: unknown = JSON.parse(raw)
  if (!isObject(snapshot) || !Array.isArray(snapshot.messages)) {
    throw new ApiError(400, '对局快照内容过大，无法保存')
  }
  const messages = snapshot.messages
  const kept: unknown[] = []
  let omittedDebugMessages = 0
  const encode = (items: unknown[], omittedDebug: number) =>
    JSON.stringify({
      ...snapshot,
      messages: items,
      snapshotMeta: {
        omittedMessages: messages.length - items.length,
        omittedDebugMessages: omittedDebug,
      },
    })
  let result = encode(kept, 0)
  if (result.length > MAX_SNAPSHOT_CHARS) {
    throw new ApiError(400, '对局快照内容过大，无法保存')
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    let message = messages[index]
    let debugRemoved = 0
    let candidate = encode([message, ...kept], omittedDebugMessages)
    if (candidate.length > MAX_SNAPSHOT_CHARS && isObject(message) && 'debug' in message) {
      message = { ...message }
      delete message.debug
      debugRemoved = 1
      candidate = encode([message, ...kept], omittedDebugMessages + debugRemoved)
    }
    if (candidate.length > MAX_SNAPSHOT_CHARS) break
    kept.unshift(message)
    omittedDebugMessages += debugRemoved
    result = candidate
  }
  if (messages.length && !kept.length) {
    throw new ApiError(400, '对局快照中的单条消息过大，无法保存')
  }
  return result
}

/**
 * Old snapshots were sliced mid-JSON. Recover only complete top-level fields
 * and complete array entries; never manufacture the tail of a partial message.
 */
function recoverPrefix(raw: string): unknown | null {
  const closers: string[] = []
  let quoted = false
  let escaped = false
  let end = 0
  let suffix = ''
  const checkpoint = (position: number) => {
    if (
      closers[0] === '}' &&
      (closers.length === 1 || (closers.length === 2 && closers[1] === ']'))
    ) {
      end = position
      suffix = [...closers].reverse().join('')
    }
  }
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index]
    if (quoted) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') quoted = false
      continue
    }
    if (char === '"') quoted = true
    else if (char === '{' || char === '[') {
      closers.push(char === '{' ? '}' : ']')
      if (char === '[') checkpoint(index + 1)
    } else if (char === '}' || char === ']') {
      if (closers.pop() !== char || !closers.length) return null
      checkpoint(index + 1)
    } else if (char === ',') checkpoint(index)
  }
  if (!end || !closers.length) return null
  try {
    return JSON.parse(raw.slice(0, end) + suffix)
  } catch {
    return null
  }
}

export function readReportSnapshot(raw: string | null): ReportSnapshotRead {
  if (!raw) return { snapshot: null, snapshotStatus: 'missing' }
  try {
    const snapshot: unknown = JSON.parse(raw)
    if (snapshot === null) return { snapshot, snapshotStatus: 'missing' }
    const meta =
      isObject(snapshot) && isObject(snapshot.snapshotMeta) ? snapshot.snapshotMeta : null
    const trimmed =
      meta &&
      ((typeof meta.omittedMessages === 'number' && meta.omittedMessages > 0) ||
        (typeof meta.omittedDebugMessages === 'number' && meta.omittedDebugMessages > 0))
    return { snapshot, snapshotStatus: trimmed ? 'trimmed' : 'complete' }
  } catch {
    const snapshot = recoverPrefix(raw)
    return {
      snapshot,
      snapshotStatus: snapshot === null ? 'corrupt' : 'recovered',
      snapshotRaw: raw,
    }
  }
}
