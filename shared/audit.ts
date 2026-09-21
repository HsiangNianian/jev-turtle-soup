import { z } from 'zod'

import type { D1Like } from './auth.ts'
import { ApiError, generateJson, resolveLlm, type GameEnv } from './game.ts'

/**
 * 判读巡检：定期抽查「无关 / 是，也不是」这两类判读。
 *
 * 它们是最容易敷衍过去的答案——把本可以判「是」的问题推给「无关」，
 * 玩家会以为这条线索走不通。巡检让 Jev 以旁观者身份重新判一次，
 * 只把「改判了」的条目记进 judge_flags，供人回看、反推判准。
 */
const SUSPECT_VERDICTS = ['irrelevant', 'partly'] as const

const VERDICT_LABEL: Record<string, string> = {
  yes: '是',
  no: '不是',
  partly: '是，也不是',
  irrelevant: '无关',
}

const CritiqueSchema = z.object({
  items: z.array(
    z.object({
      i: z.number().int(),
      verdict: z.enum(['yes', 'no', 'partly', 'irrelevant']),
      confidence: z.number().min(0).max(1).optional(),
      reason: z.string().optional(),
    }),
  ),
})

const CRITIQUE_SYSTEM = `你是一位海龟汤主持人，正在独立复核同行给出的判读。

海龟汤的规则：玩家只能问可以用「是」或「不是」回答的问题；主持人看过汤底，回答只有四种——
yes（是）、no（不是）、partly（是，也不是，即部分正确或方向对但细节错）、irrelevant（无关）。

对每一条待复核记录，你会看到：汤面、汤底、玩家的提问。
你**不会**看到原判读——请独立判断，结合汤底，这个提问的正确回答应该是什么。

要求：
1. 只依据给出的汤底判断，不要脑补汤底没写的情节。
2. 若提问与汤底的核心事实确实没有关系，判 irrelevant；若汤底已经能确定答案，就给出确定的判读。
3. 一条也不要漏答。
4. 全文使用简体中文。

只输出一个 json 对象，不要 markdown 代码块：
{"items":[{"i":0,"verdict":"yes","confidence":0.9,"reason":"不超过 20 字的理由"}]}
i 必须对应题目里的编号。`

export interface AuditableTurn {
  turnLogId: string
  puzzleId: string
  surface: string
  truth: string
  question: string
  verdict: string
  confidence: number | null
}

export interface JudgeFlag {
  turnLogId: string
  puzzleId: string
  question: string
  firstVerdict: string
  secondVerdict: string
  confidence: number
  reason: string
}

export interface AuditResult {
  /** 这次复核了几条 */
  checked: number
  /** 其中改判了几条 */
  flagged: number
  model: string
}

interface CandidateRow {
  turn_log_id: string
  puzzle_id: string
  message: string
  verdict: string
  confidence: number | null
  surface: string
  truth: string
}

/** 挑出还没被巡检过、且判读可疑的记录。 */
export async function pickSuspectTurns(
  db: D1Like,
  options: { limit: number; since: number },
): Promise<AuditableTurn[]> {
  const placeholders = SUSPECT_VERDICTS.map(() => '?').join(', ')
  const { results } = await db
    .prepare(
      `SELECT t.id AS turn_log_id, t.puzzle_id, t.message, t.verdict, t.confidence,
              p.surface, p.truth
         FROM turn_logs t
         JOIN puzzles p ON p.id = t.puzzle_id
        WHERE t.created_at >= ?
          AND t.intent = 'yes_no_question'
          AND t.verdict IN (${placeholders})
          AND NOT EXISTS (SELECT 1 FROM judge_flags f WHERE f.turn_log_id = t.id)
        ORDER BY t.created_at DESC
        LIMIT ?`,
    )
    .bind(options.since, ...SUSPECT_VERDICTS, options.limit)
    .all<CandidateRow>()

  return (results ?? []).map((row) => ({
    turnLogId: row.turn_log_id,
    puzzleId: row.puzzle_id,
    surface: row.surface,
    truth: row.truth,
    question: row.message,
    verdict: row.verdict,
    confidence: row.confidence,
  }))
}

/** 故意不把原判读写进 prompt：先让 Jev 盲判，改判才有对照意义。 */
function renderTurn(turn: AuditableTurn, index: number): string {
  return [
    `#${index}`,
    `汤面：${turn.surface}`,
    `汤底：${turn.truth}`,
    `玩家提问：${turn.question}`,
  ].join('\n')
}

/**
 * 哪些改判才值得记下来。
 *
 * `无关 → 不是` 这一类不算：汤底没写的事，判「无关」和判「不是」都站得住，
 * 记下来只会淹没有用的信号。真正要抓的是「漏掉了一条真线索」和「前后矛盾」。
 */
function isMaterial(first: string, second: string): boolean {
  if (first === second) return false
  // 漏判：本来能答「是 / 是，也不是」，却推给了「无关」
  if (first === 'irrelevant' && (second === 'yes' || second === 'partly')) return true
  // 直接矛盾
  if ((first === 'yes' && second === 'no') || (first === 'no' && second === 'yes')) return true
  // 其实能确定，却只给了「是，也不是」
  if (first === 'partly' && second === 'yes') return true
  return false
}

/**
 * 复核最近一段时间的可疑判读，把改判的记进 judge_flags。
 * 一次巡检只用一次 LLM 调用（所有条目打包成一个请求），所以可以放心定时跑。
 */
export async function inspectJudgments(
  env: GameEnv,
  db: D1Like,
  options: { limit?: number; days?: number; onProgress?: (chars: number) => void } = {},
): Promise<AuditResult> {
  const cfg = resolveLlm(env)
  if (!cfg) throw new ApiError(503, '未配置 LLM Key，无法巡检判读')

  const limit = Math.max(1, Math.min(Math.trunc(options.limit ?? 12), 20))
  const since = Date.now() - (options.days ?? 7) * 24 * 60 * 60 * 1000
  const turns = await pickSuspectTurns(db, { limit, since })
  if (!turns.length) return { checked: 0, flagged: 0, model: cfg.model }

  const critique = await generateJson<z.infer<typeof CritiqueSchema>>(cfg, {
    system: CRITIQUE_SYSTEM,
    user: `请复核下面 ${turns.length} 条判读，逐条给出你的判断：\n\n${turns
      .map((turn, index) => renderTurn(turn, index))
      .join('\n\n')}\n\n只输出 json。`,
    effort: 'low',
    onProgress: (progress) => options.onProgress?.(progress.chars),
    check: (raw) => {
      const parsed = CritiqueSchema.safeParse(raw)
      if (!parsed.success) {
        return { issues: [`json 结构不合法：${parsed.error.message.slice(0, 160)}`] }
      }
      const items = parsed.data.items.filter((item) => item.i >= 0 && item.i < turns.length)
      if (!items.length) return { issues: ['没有返回任何有效条目'] }
      return { value: { items }, issues: [] }
    },
  })

  const flags: JudgeFlag[] = []
  /** 不一致但没到「值得记录」的，按「原判读→复核意见」计数，方便回看噪声长什么样 */
  const skipped = new Map<string, number>()
  for (const item of critique.items) {
    const turn = turns[item.i]
    if (!turn || item.verdict === turn.verdict) continue
    if (!isMaterial(turn.verdict, item.verdict)) {
      const key = `${VERDICT_LABEL[turn.verdict] ?? turn.verdict}→${
        VERDICT_LABEL[item.verdict] ?? item.verdict
      }`
      skipped.set(key, (skipped.get(key) ?? 0) + 1)
      continue
    }
    flags.push({
      turnLogId: turn.turnLogId,
      puzzleId: turn.puzzleId,
      question: turn.question,
      firstVerdict: turn.verdict,
      secondVerdict: item.verdict,
      confidence: item.confidence ?? 0,
      reason: (item.reason ?? '').slice(0, 200),
    })
  }

  for (const flag of flags) {
    try {
      // 唯一索引兜底：同一条记录不会被巡检两遍
      await db
        .prepare(
          `INSERT OR IGNORE INTO judge_flags
             (id, turn_log_id, puzzle_id, question, first_verdict, second_verdict, confidence, reason, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          crypto.randomUUID(),
          flag.turnLogId,
          flag.puzzleId,
          flag.question,
          flag.firstVerdict,
          flag.secondVerdict,
          flag.confidence,
          flag.reason,
          Date.now(),
        )
        .run()
    } catch (error) {
      console.warn('[turtle-soup] 写入 judge_flags 失败：', error)
    }
  }

  const noise = [...skipped.entries()].map(([key, count]) => `${key}×${count}`).join('、')
  console.log(
    `[audit] 复核 ${turns.length} 条｜值得记录 ${flags.length} 条` +
      (noise ? `｜其余不一致（不计）：${noise}` : ''),
  )
  return { checked: turns.length, flagged: flags.length, model: cfg.model }
}

export interface StoredFlag extends JudgeFlag {
  id: string
  createdAt: number
}

interface FlagRow {
  id: string
  turn_log_id: string
  puzzle_id: string
  question: string
  first_verdict: string
  second_verdict: string
  confidence: number
  reason: string
  created_at: number
}

export async function listJudgeFlags(db: D1Like, limit = 50): Promise<StoredFlag[]> {
  const { results } = await db
    .prepare(
      `SELECT id, turn_log_id, puzzle_id, question, first_verdict, second_verdict,
              confidence, reason, created_at
         FROM judge_flags
        ORDER BY created_at DESC
        LIMIT ?`,
    )
    .bind(Math.max(1, Math.min(Math.trunc(limit), 200)))
    .all<FlagRow>()

  return (results ?? []).map((row) => ({
    id: row.id,
    turnLogId: row.turn_log_id,
    puzzleId: row.puzzle_id,
    question: row.question,
    firstVerdict: row.first_verdict,
    secondVerdict: row.second_verdict,
    confidence: row.confidence,
    reason: row.reason,
    createdAt: row.created_at,
  }))
}
