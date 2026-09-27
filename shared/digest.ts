import type { D1Like, EmailLike } from './auth.ts'

/**
 * 作者周报。
 *
 * 每周一 12:00 UTC（北京时间 20:00）发送；后台可查看、补发最近一期。
 * **只在过去一周有动静时才发**：没动静就不打扰。
 */

export const DIGEST_WINDOW_MS = 7 * 24 * 60 * 60 * 1000
export const DIGEST_CRON = '0 12 * * mon'
export const DIGEST_ORIGIN = 'https://hgt.mmstudio.games'
const MONDAY_NOON = Date.parse('1970-01-05T12:00:00Z')

/** Fixed half-open windows: retries and manual sends always address the same issue. */
export function digestPeriod(now = Date.now()) {
  const until = MONDAY_NOON + Math.floor((now - MONDAY_NOON) / DIGEST_WINDOW_MS) * DIGEST_WINDOW_MS
  return { since: until - DIGEST_WINDOW_MS, until, nextSendAt: until + DIGEST_WINDOW_MS }
}

export interface DigestEnv {
  EMAIL?: EmailLike
  MAIL_FROM?: string
}

export interface DigestCounts {
  plays: number
  solves: number
  likes: number
  comments: number
}

export interface DigestRecipient {
  uid: string
  email: string
  displayName: string
  locale: string
  token: string
  counts: DigestCounts
  total: number
}

function total(counts: DigestCounts): number {
  return counts.plays + counts.solves + counts.likes + counts.comments
}

/** 一周内的四类动静（主页与名下所有题都算）。 */
export async function recentCounts(
  db: D1Like,
  uid: string,
  since: number,
  until: number,
): Promise<DigestCounts> {
  const row = await db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM attempts a JOIN puzzles p ON p.id = a.puzzle_id
           WHERE p.owner_id = ? AND COALESCE(a.player_key, '') <> p.owner_id
             AND a.created_at >= ? AND a.created_at < ?) AS plays,
         (SELECT COUNT(*) FROM attempts a JOIN puzzles p ON p.id = a.puzzle_id
           WHERE p.owner_id = ? AND COALESCE(a.player_key, '') <> p.owner_id
             AND a.solved = 1 AND a.updated_at >= ? AND a.updated_at < ?) AS solves,
         (SELECT (SELECT COUNT(*) FROM comments c JOIN puzzles p ON p.id = c.target_id
                   WHERE c.target_type = 'puzzle' AND p.owner_id = ? AND c.author_id <> p.owner_id
                     AND c.created_at >= ? AND c.created_at < ?)
               + (SELECT COUNT(*) FROM comments c
                   WHERE c.target_type = 'profile' AND c.target_id = ? AND c.author_id <> c.target_id
                     AND c.created_at >= ? AND c.created_at < ?)) AS comments,
         (SELECT (SELECT COUNT(*) FROM likes l JOIN puzzles p ON p.id = l.target_id
                   WHERE l.target_type = 'puzzle' AND p.owner_id = ? AND l.player_key <> p.owner_id
                     AND l.created_at >= ? AND l.created_at < ?)
               + (SELECT COUNT(*) FROM likes l
                   WHERE l.target_type = 'profile' AND l.target_id = ? AND l.player_key <> l.target_id
                     AND l.created_at >= ? AND l.created_at < ?)) AS likes`,
    )
    .bind(
      uid,
      since,
      until,
      uid,
      since,
      until,
      uid,
      since,
      until,
      uid,
      since,
      until,
      uid,
      since,
      until,
      uid,
      since,
      until,
    )
    .first<DigestCounts>()
  return {
    plays: Number(row?.plays) || 0,
    solves: Number(row?.solves) || 0,
    likes: Number(row?.likes) || 0,
    comments: Number(row?.comments) || 0,
  }
}

interface RecipientRow {
  id: string
  email: string
  display_name: string | null
  locale: string | null
}

/**
 * 这一周该收到周报的人：有公开作品、没退订、且过去一周确实有动静。
 * 预览不写数据库；退订令牌在真正发送前创建。分页遍历，避免漏掉第 201 位作者。
 */
export async function listDigestRecipients(
  db: D1Like,
  since: number,
  until: number,
): Promise<DigestRecipient[]> {
  const recipients: DigestRecipient[] = []
  let cursor = ''
  for (;;) {
    const { results } = await db
      .prepare(
        `SELECT id, email, display_name, locale
         FROM users
        WHERE digest_opt_out = 0 AND id > ?
          AND EXISTS (SELECT 1 FROM puzzles p WHERE p.owner_id = users.id AND p.visibility = 'public')
        ORDER BY id LIMIT 200`,
      )
      .bind(cursor)
      .all<RecipientRow>()

    for (const row of results ?? []) {
      cursor = row.id
      const counts = await recentCounts(db, row.id, since, until)
      if (total(counts) === 0) continue
      recipients.push({
        uid: row.id,
        email: row.email,
        displayName: row.display_name ?? row.email.split('@')[0],
        locale: row.locale ?? 'zh-CN',
        token: '',
        counts,
        total: total(counts),
      })
    }
    if ((results?.length ?? 0) < 200) break
  }
  return recipients
}

interface DigestCopy {
  subject: (total: number) => string
  greeting: (name: string) => string
  intro: string
  lines: (counts: DigestCounts) => string[]
  cta: (origin: string) => string
  unsubscribe: (origin: string, token: string) => string
}

const COPY: Record<string, DigestCopy> = {
  'zh-CN': {
    subject: (n) => `【海龟汤调查局】你这周的汤有 ${n} 次动静`,
    greeting: (name) => `${name}，`,
    intro: '这一周你的海龟汤有人来过了：',
    lines: (c) =>
      [
        c.plays ? `· ${c.plays} 人问过` : '',
        c.solves ? `· ${c.solves} 人解开` : '',
        c.likes ? `· 收到 ${c.likes} 个赞` : '',
        c.comments ? `· ${c.comments} 条留言` : '',
      ].filter(Boolean),
    cta: (origin) => `去「我的题库」看完整动态：${origin}/me`,
    unsubscribe: (origin, token) =>
      `不想再收到这类邮件？点这里退订：${origin}/api/digest/unsubscribe?t=${token}`,
  },
  en: {
    subject: (n) => `[Turtle Soup Bureau] ${n} new moves on your puzzles this week`,
    greeting: (name) => `Hi ${name},`,
    intro: 'Your puzzles saw some action this week:',
    lines: (c) =>
      [
        c.plays ? `· ${c.plays} players` : '',
        c.solves ? `· ${c.solves} solved` : '',
        c.likes ? `· ${c.likes} likes` : '',
        c.comments ? `· ${c.comments} comments` : '',
      ].filter(Boolean),
    cta: (origin) => `See the full activity: ${origin}/me`,
    unsubscribe: (origin, token) =>
      `Do not want these emails? Unsubscribe: ${origin}/api/digest/unsubscribe?t=${token}`,
  },
  ja: {
    subject: (n) => `【海亀スープ調査局】今週あなたのお題に ${n} 件の動き`,
    greeting: (name) => `${name} さん、`,
    intro: '今週、あなたのお題に動きがありました：',
    lines: (c) =>
      [
        c.plays ? `· 挑戦 ${c.plays} 人` : '',
        c.solves ? `· 解決 ${c.solves} 人` : '',
        c.likes ? `· いいね ${c.likes} 件` : '',
        c.comments ? `· コメント ${c.comments} 件` : '',
      ].filter(Boolean),
    cta: (origin) => `詳しくはこちら：${origin}/me`,
    unsubscribe: (origin, token) =>
      `このメールが不要な場合はこちら：${origin}/api/digest/unsubscribe?t=${token}`,
  },
}

export interface RenderedDigest {
  subject: string
  text: string
  html: string
}

export function renderDigest(recipient: DigestRecipient, origin: string): RenderedDigest {
  const copy = COPY[recipient.locale] ?? COPY['zh-CN']
  const lines = copy.lines(recipient.counts)
  const text = [
    copy.greeting(recipient.displayName),
    '',
    copy.intro,
    ...lines,
    '',
    copy.cta(origin),
    '',
    copy.unsubscribe(origin, recipient.token),
  ].join('\n')

  const html = `<div style="font-family:ui-monospace,Menlo,monospace;line-height:1.9;color:#17150f">
  <p>${escapeHtml(copy.greeting(recipient.displayName))}</p>
  <p>${copy.intro}</p>
  <ul style="padding-left:1.1em">${lines.map((line) => `<li>${line.replace(/^·\s*/, '')}</li>`).join('')}</ul>
  <p><a href="${escapeHtml(origin)}/me">${escapeHtml(copy.cta(origin))}</a></p>
  <p style="color:#8c8677;font-size:12px">${escapeHtml(copy.unsubscribe(origin, recipient.token))}</p>
</div>`

  return { subject: copy.subject(recipient.total), text, html }
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )
}

/** 退订：按令牌找到人并标记，返回是否命中。 */
export async function unsubscribeByToken(db: D1Like, token: string): Promise<boolean> {
  if (!token) return false
  const row = await db
    .prepare('SELECT id FROM users WHERE digest_token = ?')
    .bind(token)
    .first<{ id: string }>()
  if (!row) return false
  await db.prepare('UPDATE users SET digest_opt_out = 1 WHERE id = ?').bind(row.id).run()
  return true
}
