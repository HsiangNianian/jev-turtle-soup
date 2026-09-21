import { TypeSafeClient, noul, score } from '@typesafe-ai/sdk'
import { z } from 'zod'

import { ApiError, generateJson, resolveLlm, type GameEnv, type GeneratedPuzzle } from './game.ts'

/** 每日官方汤按 UTC 换新。 */
export function utcDateKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10)
}

export const MAX_DAILY_ATTEMPTS = 3

const StorySchema = z.object({
  title: z.string().min(1),
  story: z.string().min(120),
  key_twist: z.string().min(4),
  difficulty: z.string().optional(),
  tags: z.array(z.string()).optional(),
})

const CondensedSchema = z.object({
  truth: z.string().min(20),
  surface: z.string().min(1),
  hint: z.string().min(1),
})

const STORY_SYSTEM = `你是一位顶级海龟汤出题人。海龟汤的第一步不是写谜面，而是先写一则**完整、自洽、能站得住的故事**，之后才会从它里面凝练出汤底与汤面。

请写一则原创故事，并只输出一个 json 对象。

要求：
1. story：完整的故事正文，800 到 1200 字。要有具体的人物、动机、时间线和因果链；每一件反常的事都必须在故事内部得到解释，不能互相矛盾。
2. key_twist：一句话点明这个故事最关键的反转（供审核使用）。
3. 反转必须出人意料、但回溯故事又完全合理，并且线索在故事里都交代过。
4. 故事发生在现实世界，可以用巧合、误会、身份、职业、心理、时间线错位等手法；不要鬼神、超自然、灵异，不要"其实是一场梦"。
5. 不要血腥、色情、恐怖 jump scare 或违法内容。
6. title：一个 2 到 10 字的标题。tags：2 到 3 个中文短标签。difficulty：简单 / 中等 / 困难。
7. 全文使用简体中文。

输出格式（严格 json，不要 markdown 代码块）：
{"title": "标题", "story": "完整故事", "key_twist": "关键反转", "difficulty": "中等", "tags": ["标签1", "标签2"]}`

const CONDENSE_SYSTEM = `你要把一则已经写好的故事凝练成一道海龟汤。你只输出一个 json 对象。

要求：
1. truth（汤底）：3 到 5 句、150 字以内，把故事的核心因果与关键反转讲清楚。**只能使用故事里已有的信息**，不得新增人物、事件或动机，也不得遗漏关键反转。
2. surface（汤面）：**只写一句话**，不超过 40 个字。只呈现故事里最反常的那一个现象，不解释原因、不点破真相。
3. hint（提示）：一句话，不直接揭晓答案，但能推动推理方向。
4. 汤面里出现的每个细节，都要能被汤底解释。
5. 全文使用简体中文。

输出格式（严格 json，不要 markdown 代码块）：
{"truth": "汤底", "surface": "汤面", "hint": "提示"}`

export interface DailyReview {
  passed: boolean
  score: number
  issues: string[]
  checks: Record<string, number>
  thresholds: Record<string, number>
}

export interface DailyDraft {
  title: string
  story: string
  truth: string
  surface: string
  hint: string
  tags: string[]
  difficulty: string
  review: DailyReview
  attempts: number
  relaxed: boolean
}

/** 一次审核比一次宽松：连续不过就放宽，避免一直重来。 */
const THRESHOLD_STEPS = [
  {
    story_coherent: 0.8,
    truth_faithful: 0.8,
    surface_fair: 0.6,
    surface_covered: 0.7,
    policy_ok: 0.9,
    quality: 1.6,
  },
  {
    story_coherent: 0.7,
    truth_faithful: 0.7,
    surface_fair: 0.5,
    surface_covered: 0.6,
    policy_ok: 0.8,
    quality: 1.2,
  },
  {
    story_coherent: 0.5,
    truth_faithful: 0.5,
    surface_fair: 0.4,
    surface_covered: 0.5,
    policy_ok: 0.6,
    quality: 0.8,
  },
] as const

function dailyQuestions() {
  return {
    story_coherent: noul(
      {
        question:
          'Is `story` internally consistent — no contradictions, and every strange event explained inside it?',
        inspect: '`story`',
        focus:
          'Judge coherence only. A story that needs outside knowledge to make sense is not coherent.',
      },
      {
        true: 'The story holds together and explains its own events.',
        false: 'Something contradicts another part, or a key event is never explained.',
      },
    ),
    truth_faithful: noul(
      {
        question:
          'Does `truth` stay faithful to `story` — adding nothing that is not in it, and keeping the `key_twist`?',
        compare: ['truth', 'story', 'key_twist'],
        focus:
          'Judge only fidelity. A shorter wording is fine; an invented detail or a missing twist is not.',
      },
      {
        true: 'The condensed truth is a faithful summary including the key twist.',
        false: 'It invents something, changes an event, or drops the key twist.',
      },
    ),
    surface_fair: noul(
      {
        question:
          'Reading only `surface` and `truth`, could a player reach `key_twist` through yes/no questions?',
        compare: ['surface', 'truth', 'key_twist'],
        focus:
          'Judge whether the surface hints at the twist without giving it away, so the puzzle is solvable rather than a guess.',
      },
      {
        true: 'The surface leaves real threads to pull, and the twist is inferable.',
        false: 'The twist comes out of nowhere, or the surface already gives it away.',
      },
    ),
    surface_covered: noul(
      {
        question: 'Does `truth` explain every odd detail that `surface` mentions?',
        compare: ['surface', 'truth'],
        focus: 'List the surface details mentally and check each one against the truth.',
      },
      {
        true: 'Every detail in the surface is accounted for.',
        false: 'Some detail in the surface is never explained.',
      },
    ),
    policy_ok: noul(
      {
        question: 'Is `story` free of gore, sexual content, jump scares and anything illegal?',
        inspect: '`story`',
        focus: 'Judge content policy only, not quality.',
      },
      {
        true: 'Nothing in the story violates those limits.',
        false: 'It contains gore, sexual content, horror scares or illegal material.',
      },
    ),
    quality: score(
      {
        question: 'As a mystery puzzle, how good is this one?',
        compare: ['surface', 'truth', 'key_twist'],
        focus:
          'Judge the puzzle: is the twist surprising yet fair, and is it satisfying to uncover?',
      },
      [
        { what: 'Flat: the twist is trivial, arbitrary, or the surface is confusing.' },
        { what: 'Solid: a fair, playable puzzle with a real twist.' },
        { what: 'Clever: surprising, fair, and memorable — worth showing everyone today.' },
      ],
    ),
  }
}

interface ReviewAnswers {
  story_coherent: { noul: number }
  truth_faithful: { noul: number }
  surface_fair: { noul: number }
  surface_covered: { noul: number }
  policy_ok: { noul: number }
  quality: { score: number; confidence: number; probabilities: Record<string, number> }
}

/** 让 Jev 审核这一版草稿；返回每项分数与是否达标。 */
export async function reviewDaily(
  env: GameEnv,
  draft: {
    title: string
    story: string
    truth: string
    surface: string
    hint: string
    key_twist: string
  },
  attempt: number,
): Promise<DailyReview> {
  const thresholds = THRESHOLD_STEPS[Math.min(attempt, THRESHOLD_STEPS.length) - 1]
  const apiKey = env.TYPESAFE_API_KEY?.trim()
  const client = new TypeSafeClient(apiKey ? { apiKey } : {})
  const { answers } = await client.systemOne({
    state: draft,
    questions: dailyQuestions(),
  })
  const a = answers as unknown as ReviewAnswers
  const checks = {
    story_coherent: a.story_coherent.noul,
    truth_faithful: a.truth_faithful.noul,
    surface_fair: a.surface_fair.noul,
    surface_covered: a.surface_covered.noul,
    policy_ok: a.policy_ok.noul,
    quality: a.quality.score,
  }
  const issues: string[] = []
  for (const [key, threshold] of Object.entries(thresholds)) {
    const value = checks[key as keyof typeof checks]
    if (value < threshold) issues.push(`${key} 只有 ${value.toFixed(2)}，要求 ≥ ${threshold}`)
  }
  // 综合分用于挑「最好的一次」
  const score =
    checks.story_coherent * 0.15 +
    checks.truth_faithful * 0.2 +
    checks.surface_fair * 0.2 +
    checks.surface_covered * 0.15 +
    checks.policy_ok * 0.1 +
    (checks.quality / 2) * 0.2
  return { passed: issues.length === 0, score, issues, checks, thresholds }
}

function issueBlock(issues: string[]): string {
  if (!issues.length) return ''
  return `\n\n上一轮没有通过审核，问题如下，请针对性修正：\n${issues.map((issue) => `- ${issue}`).join('\n')}`
}

/**
 * 生成当天的官方汤：先写完整故事，再凝练汤底/汤面，再审核；
 * 不过就带着具体问题重来，并逐次放宽标准；全不过则返回最好的一次（relaxed=true）。
 */
export interface DailyProgress {
  stage: 'story' | 'condense' | 'review'
  attempt: number
  chars: number
}

export async function composeDaily(
  env: GameEnv,
  options: { avoid?: string[]; date?: string; onProgress?: (progress: DailyProgress) => void },
): Promise<DailyDraft> {
  const cfg = resolveLlm(env)
  if (!cfg) throw new ApiError(503, '未配置 LLM Key，无法生成每日汤')

  const avoid = options.avoid ?? []
  let best: (DailyDraft & { score: number }) | null = null
  let carryIssues: string[] = []

  for (let attempt = 1; attempt <= MAX_DAILY_ATTEMPTS; attempt += 1) {
    const avoidBlock = avoid.length
      ? `\n\n最近几期的官方汤是这些，请换一个完全不同的场景与手法，不要相似：\n${avoid
          .slice(0, 10)
          .map((item) => `- ${item}`)
          .join('\n')}`
      : ''
    const retryBlock = issueBlock(carryIssues)

    const story = await generateJson<z.infer<typeof StorySchema>>(cfg, {
      system: STORY_SYSTEM,
      user: `请按上面的要求写一则完整的故事，以 json 输出。${avoidBlock}${retryBlock}`,
      effort: 'max',
      onProgress: (progress) =>
        options.onProgress?.({ stage: 'story', attempt, chars: progress.chars }),
      check: (raw) => {
        const parsed = StorySchema.safeParse(raw)
        if (!parsed.success) {
          return { issues: [`json 结构不合法：${parsed.error.message.slice(0, 160)}`] }
        }
        const issues: string[] = []
        if (parsed.data.story.length < 400) issues.push('故事太短，至少要写清楚完整经过')
        if (parsed.data.story.length > 2000) issues.push('故事太长，请压缩到 1200 字左右')
        return issues.length ? { issues } : { value: parsed.data, issues: [] }
      },
    })

    const condensed = await generateJson<z.infer<typeof CondensedSchema>>(cfg, {
      system: CONDENSE_SYSTEM,
      user: `故事如下：\n\n${story.story}\n\n关键反转：${story.key_twist}\n\n请凝练出汤底、汤面与提示，以 json 输出。${retryBlock}`,
      effort: 'high',
      onProgress: (progress) =>
        options.onProgress?.({ stage: 'condense', attempt, chars: progress.chars }),
      check: (raw) => {
        const parsed = CondensedSchema.safeParse(raw)
        if (!parsed.success) {
          return { issues: [`json 结构不合法：${parsed.error.message.slice(0, 160)}`] }
        }
        const issues: string[] = []
        const stops = (parsed.data.surface.match(/[。！？!?…]/g) ?? []).length
        if (parsed.data.surface.length > 60) {
          issues.push(`汤面太长（${parsed.data.surface.length} 字，要求 40 字以内）`)
        }
        if (stops > 1) issues.push(`汤面必须只有一句话，现在有 ${stops} 句`)
        if (parsed.data.truth.length > 220) {
          issues.push(`汤底太长（${parsed.data.truth.length} 字，要求 150 字以内）`)
        }
        return issues.length ? { issues } : { value: parsed.data, issues: [] }
      },
    })

    const draft = {
      title: story.title,
      story: story.story,
      truth: condensed.truth,
      surface: condensed.surface,
      hint: condensed.hint,
      key_twist: story.key_twist,
    }
    options.onProgress?.({ stage: 'review', attempt, chars: 0 })
    const review = await reviewDaily(env, draft, attempt)
    const candidate: DailyDraft & { score: number } = {
      title: draft.title,
      story: draft.story,
      truth: draft.truth,
      surface: draft.surface,
      hint: draft.hint,
      tags: story.tags ?? [],
      difficulty: story.difficulty ?? '中等',
      review,
      attempts: attempt,
      relaxed: !review.passed,
      score: review.score,
    }
    console.log(
      `[daily] 第 ${attempt} 轮：score=${review.score.toFixed(2)} passed=${review.passed}`,
      review.issues.join('；') || '—',
    )
    if (!best || candidate.score > best.score) best = candidate
    if (review.passed) return candidate
    carryIssues = review.issues
  }

  if (!best) throw new ApiError(502, '每日汤生成失败')
  console.warn('[daily] 连续未过审，发布分数最高的一版')
  return { ...best, relaxed: true }
}

export type { GeneratedPuzzle }
