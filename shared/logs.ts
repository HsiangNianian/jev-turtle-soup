import type { D1Like } from './auth.ts'
import { ApiError } from './errors.ts'
import { serializeReportSnapshot } from './report-snapshot.ts'

const MAX_NOTE_CHARS = 500
const MAX_MESSAGE_CHARS = 600

export interface TurnLogEntry {
  puzzleId: string
  kind: 'session' | 'library'
  seq: number
  playerKey: string
  locale: string
  message: string
  reply: string
  intent?: string
  verdict?: string
  closeness?: number | null
  solved?: boolean
  confidence?: number | null
  model?: string
  debug?: unknown
  history?: unknown
}

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : ''
}

function json(value: unknown, max: number): string | null {
  if (value === undefined || value === null) return null
  try {
    return JSON.stringify(value).slice(0, max)
  } catch {
    return null
  }
}

/**
 * 每一次判读都留档，方便复盘「同一个问题给了不同答案」这类不一致。
 * 写日志失败不应该影响玩家，所以这里吞掉异常只告警。
 */
export async function logTurn(db: D1Like, entry: TurnLogEntry): Promise<void> {
  try {
    await db
      .prepare(
        `INSERT INTO turn_logs
           (id, puzzle_id, kind, seq, player_key, locale, message, reply, intent, verdict,
            closeness, solved, confidence, model, debug_json, history_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        entry.puzzleId,
        entry.kind,
        Number.isFinite(entry.seq) ? Math.max(0, Math.trunc(entry.seq)) : 0,
        text(entry.playerKey, 64),
        text(entry.locale, 12),
        text(entry.message, MAX_MESSAGE_CHARS),
        text(entry.reply, 2000),
        text(entry.intent, 32) || null,
        text(entry.verdict, 32) || null,
        typeof entry.closeness === 'number' ? entry.closeness : null,
        entry.solved ? 1 : 0,
        typeof entry.confidence === 'number' ? entry.confidence : null,
        text(entry.model, 64) || null,
        json(entry.debug, 12_000),
        json(entry.history, 12_000),
        Date.now(),
      )
      .run()
  } catch (error) {
    console.warn('[turtle-soup] 写入 turn_logs 失败：', error)
  }
}

/** 日志保留期：判读流水 90 天，玩家反馈 1 年。 */
export const TURN_LOG_RETENTION_MS = 1000 * 60 * 60 * 24 * 90
export const REPORT_RETENTION_MS = 1000 * 60 * 60 * 24 * 365

export async function purgeOldLogs(db: D1Like, now = Date.now()): Promise<void> {
  try {
    await db
      .prepare('DELETE FROM turn_logs WHERE created_at < ?')
      .bind(now - TURN_LOG_RETENTION_MS)
      .run()
    await db
      .prepare('DELETE FROM reports WHERE created_at < ?')
      .bind(now - REPORT_RETENTION_MS)
      .run()
  } catch (error) {
    console.warn('[turtle-soup] 清理旧日志失败：', error)
  }
}

export interface ReportInput {
  puzzleId: string
  kind: string
  note: string
  snapshot: unknown
  playerKey: string
  locale: string
  /** 举报的具体对象（例如一条留言） */
  targetType?: string
  targetId?: string
}

export async function submitReport(db: D1Like, input: ReportInput): Promise<{ id: string }> {
  const note = input.note.trim()
  if (note.length < 2) throw new ApiError(400, '请简单描述一下遇到的问题')
  if (note.length > MAX_NOTE_CHARS) throw new ApiError(400, '描述太长了，精简一点再发')
  const snapshot = serializeReportSnapshot(input.snapshot)
  if (!snapshot) throw new ApiError(400, '缺少对局快照')

  const id = crypto.randomUUID()
  await db
    .prepare(
      `INSERT INTO reports (id, puzzle_id, kind, player_key, locale, note, snapshot_json, status, created_at, target_type, target_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)`,
    )
    .bind(
      id,
      text(input.puzzleId, 64) || null,
      text(input.kind, 16) || null,
      text(input.playerKey, 64) || null,
      text(input.locale, 12) || null,
      note,
      snapshot,
      Date.now(),
      text(input.targetType, 16) || null,
      text(input.targetId, 64) || null,
    )
    .run()
  return { id }
}
