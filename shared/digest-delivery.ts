import type { D1Like } from './auth.ts'
import { ApiError } from './errors.ts'
import {
  DIGEST_ORIGIN,
  DIGEST_WINDOW_MS,
  digestPeriod,
  listDigestRecipients,
  renderDigest,
  type DigestCounts,
  type DigestEnv,
} from './digest.ts'

type DeliveryStatus = 'sending' | 'sent' | 'failed' | 'uncertain' | 'skipped'
interface DeliveryRow {
  uid: string
  status: DeliveryStatus
  attempts: number
  updated_at: number
  error_code: string | null
}
export interface DigestRunSummary {
  periodEnd: number
  updatedAt: number
  source: string
  sent: number
  failed: number
  uncertain: number
  sending: number
  skipped: number
}

export async function digestHistory(db: D1Like): Promise<DigestRunSummary[]> {
  const cutoff = Date.now() - 15 * 60_000
  const { results } = await db
    .prepare(
      `
    SELECT r.period_end AS periodEnd, r.updated_at AS updatedAt, r.source,
      SUM(CASE WHEN d.status = 'sent' THEN 1 ELSE 0 END) AS sent,
      SUM(CASE WHEN d.status = 'failed' THEN 1 ELSE 0 END) AS failed,
      SUM(CASE WHEN d.status = 'uncertain' OR (d.status = 'sending' AND d.updated_at < ?) THEN 1 ELSE 0 END) AS uncertain,
      SUM(CASE WHEN d.status = 'sending' AND d.updated_at >= ? THEN 1 ELSE 0 END) AS sending,
      SUM(CASE WHEN d.status = 'skipped' THEN 1 ELSE 0 END) AS skipped
    FROM digest_runs r LEFT JOIN digest_deliveries d ON d.period_end = r.period_end
    GROUP BY r.period_end ORDER BY r.period_end DESC LIMIT 12
  `,
    )
    .bind(cutoff, cutoff)
    .all<DigestRunSummary>()
  return results ?? []
}

export async function digestOverview(db: D1Like, env: DigestEnv, now = Date.now()) {
  const period = digestPeriod(now)
  const candidates = await listDigestRecipients(db, period.since, period.until)
  const { results } = await db
    .prepare(
      'SELECT uid, status, attempts, updated_at, error_code FROM digest_deliveries WHERE period_end = ?',
    )
    .bind(period.until)
    .all<DeliveryRow>()
  const deliveries = new Map((results ?? []).map((row) => [row.uid, row]))
  const recipients = candidates.map(({ token: _token, ...item }) => {
    const row = deliveries.get(item.uid)
    const status =
      row?.status === 'sending' && row.updated_at < now - 15 * 60_000
        ? 'uncertain'
        : (row?.status ?? 'pending')
    return { ...item, status, attempts: row?.attempts ?? 0, errorCode: row?.error_code ?? null }
  })
  return {
    ...period,
    windowMs: DIGEST_WINDOW_MS,
    configured: Boolean(env.EMAIL),
    recipients,
    sendable: recipients.filter(
      (r) => r.status === 'pending' || (r.status === 'failed' && r.attempts < 3),
    ).length,
    preview: candidates[0]
      ? renderDigest({ ...candidates[0], token: 'PREVIEW' }, DIGEST_ORIGIN)
      : null,
    history: await digestHistory(db),
  }
}

// Only explicit provider rejections are safe to resend. Network/internal failures
// may have happened after acceptance; keep those visible for operator inspection.
const REJECTED_CODES = new Set([
  'E_VALIDATION_ERROR',
  'E_FIELD_MISSING',
  'E_TOO_MANY_RECIPIENTS',
  'E_TOO_MANY_ATTACHMENTS',
  'E_SENDER_NOT_VERIFIED',
  'E_RECIPIENT_NOT_ALLOWED',
  'E_RECIPIENT_SUPPRESSED',
  'E_SENDER_DOMAIN_NOT_AVAILABLE',
  'E_CONTENT_TOO_LARGE',
  'E_DELIVERY_FAILED',
  'E_RATE_LIMIT_EXCEEDED',
  'E_DAILY_LIMIT_EXCEEDED',
  'E_HEADER_NOT_ALLOWED',
  'E_HEADER_USE_API_FIELD',
  'E_HEADER_VALUE_INVALID',
  'E_HEADER_VALUE_TOO_LONG',
  'E_HEADER_NAME_INVALID',
  'E_HEADERS_TOO_LARGE',
  'E_HEADERS_TOO_MANY',
])

/** Cron retries skip reservations. Manual retries only reclaim explicit rejections. */
export async function deliverDigest(
  db: D1Like,
  env: DigestEnv,
  at: number,
  source: 'cron' | 'manual',
) {
  if (!env.EMAIL) throw new ApiError(503, '邮件服务尚未配置')
  const { since, until } = digestPeriod(at)
  await db
    .prepare(
      `INSERT INTO digest_runs (period_end, started_at, updated_at, source)
    VALUES (?, ?, ?, ?) ON CONFLICT(period_end) DO UPDATE SET updated_at = excluded.updated_at, source = excluded.source
  `,
    )
    .bind(until, Date.now(), Date.now(), source)
    .run()
  const recipients = await listDigestRecipients(db, since, until)
  let sent = 0
  let failed = 0
  let uncertain = 0
  for (const recipient of recipients) {
    // Re-check consent immediately before claiming. Tokens are created atomically
    // and never rotate if another issue happens to be sending at the same time.
    const user = await db
      .prepare(
        `UPDATE users SET digest_token = COALESCE(digest_token, ?)
      WHERE id = ? AND digest_opt_out = 0
        AND EXISTS (SELECT 1 FROM puzzles p WHERE p.owner_id = users.id AND p.visibility = 'public')
      RETURNING email, digest_token
    `,
      )
      .bind(crypto.randomUUID().replace(/-/g, ''), recipient.uid)
      .first<{ email: string; digest_token: string }>()
    if (!user) continue
    const claim = await db
      .prepare(
        `
      INSERT INTO digest_deliveries (period_end, uid, status, counts, updated_at)
      VALUES (?, ?, 'sending', ?, ?)
      ON CONFLICT(period_end, uid) DO UPDATE SET status = 'sending', attempts = attempts + 1,
        updated_at = excluded.updated_at, error_code = NULL
      WHERE digest_deliveries.status = 'failed' AND digest_deliveries.attempts < 3 AND ? = 'manual'
      RETURNING counts
    `,
      )
      .bind(until, recipient.uid, JSON.stringify(recipient.counts), Date.now(), source)
      .first<{ counts: string }>()
    if (!claim) continue
    const counts = JSON.parse(claim.counts) as DigestCounts
    const email = renderDigest(
      {
        ...recipient,
        email: user.email,
        token: user.digest_token,
        counts,
        total: counts.plays + counts.solves + counts.likes + counts.comments,
      },
      DIGEST_ORIGIN,
    )
    // Opt-outs that occurred during the claim must also take effect.
    const consent = await db
      .prepare('SELECT id FROM users WHERE id = ? AND digest_opt_out = 0')
      .bind(recipient.uid)
      .first()
    if (!consent) {
      await db
        .prepare(
          "UPDATE digest_deliveries SET status = 'skipped', updated_at = ? WHERE period_end = ? AND uid = ?",
        )
        .bind(Date.now(), until, recipient.uid)
        .run()
      continue
    }
    let result: unknown
    try {
      result = await env.EMAIL.send({
        to: user.email,
        from: {
          email: env.MAIL_FROM?.trim() || 'noreply@hgt.mmstudio.games',
          name: '海龟汤调查局',
        },
        ...email,
      })
    } catch (error) {
      const code =
        error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
          ? error.code
          : 'UNKNOWN'
      const status = REJECTED_CODES.has(code) ? 'failed' : 'uncertain'
      await db
        .prepare(
          'UPDATE digest_deliveries SET status = ?, error_code = ?, updated_at = ? WHERE period_end = ? AND uid = ?',
        )
        .bind(status, code.slice(0, 80), Date.now(), until, recipient.uid)
        .run()
      if (status === 'failed') failed++
      else uncertain++
      console.warn(`[digest] ${until} ${status}: ${code}`)
      continue
    }
    const messageId =
      result &&
      typeof result === 'object' &&
      'messageId' in result &&
      typeof result.messageId === 'string'
        ? result.messageId
        : null
    // If this write fails after provider acceptance, leave the reservation in
    // 'sending'. Never automatically repeat a potentially delivered message.
    await db
      .prepare(
        "UPDATE digest_deliveries SET status = 'sent', sent_at = ?, updated_at = ?, message_id = ? WHERE period_end = ? AND uid = ?",
      )
      .bind(Date.now(), Date.now(), messageId, until, recipient.uid)
      .run()
    sent++
  }
  await db
    .prepare('UPDATE digest_runs SET updated_at = ? WHERE period_end = ?')
    .bind(Date.now(), until)
    .run()
  const outstanding = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM digest_deliveries
    WHERE period_end = ? AND status IN ('failed', 'uncertain', 'sending')
  `,
    )
    .bind(until)
    .first<{ n: number }>()
  return {
    periodEnd: until,
    sent,
    failed,
    uncertain,
    outstanding: outstanding?.n ?? 0,
    total: recipients.length,
  }
}
