import { TypeSafeClient, noul, score } from '@typesafe-ai/sdk'
import { z } from 'zod'

import { ApiError, generateJson, resolveLlm, scoreGenre, type GameEnv } from './game.ts'
import { DAILY_COPY, dailyLanguageIssues, localizedGenreBrief } from './daily-language.ts'

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

export type DailyLocale = 'zh-CN' | 'en' | 'ja'

/** 每天随机摇一次：走本格还是变格、什么题材、用哪种语言原生写。 */
export interface DailyRoll {
  locale: DailyLocale
  /** 0 = 本格·逻辑推理，100 = 变格·怪力乱神 */
  genreTarget: number
  tag: string
}

const DAILY_LOCALES: DailyLocale[] = ['zh-CN', 'en', 'ja']

const REALISTIC_TAGS = [
  '都市',
  '悬疑',
  '推理',
  '密室',
  '误会',
  '身份',
  '时间线',
  '心理',
  '记忆',
  '反转',
  '雨夜',
  '老房子',
  '医院',
  '电梯',
  '婚礼',
  '葬礼',
  '书信',
  '照片',
  '镜子',
]
const SUPERNATURAL_TAGS = ['民俗', '禁忌', '诅咒', '诡物', '怪力乱神', '替身', '幻觉', '灵异']

function pick<T>(list: T[]): T {
  return list[Math.floor(Math.random() * list.length)]
}

/** 摇一次。同一句话里给足「有多变格」和「写什么题材」两条指令。 */
export function rollDaily(): DailyRoll {
  const genreTarget = Math.floor(Math.random() * 101)
  const pool =
    genreTarget >= 70
      ? [...SUPERNATURAL_TAGS, ...REALISTIC_TAGS]
      : genreTarget <= 30
        ? REALISTIC_TAGS
        : [...REALISTIC_TAGS, ...SUPERNATURAL_TAGS]
  return { locale: pick(DAILY_LOCALES), genreTarget, tag: pick(pool) }
}

/**
 * 题材档位的说法。变格那一头要放开鬼神，但规则必须自洽——
 * 和本格一样，仍然要求「汤面里能找到线索」，不许用「其实是场梦」收尾。
 */
function genreBrief(roll: DailyRoll): string {
  const { genreTarget, tag } = roll
  const motif = `题材围绕「${tag}」展开。`
  if (genreTarget <= 15) {
    return `【本格·逻辑推理】故事发生在现实世界，答案完全能靠线索推理出来，不要任何超自然成分。${motif}`
  }
  if (genreTarget <= 40) {
    return `【偏本格】现实题材，可以靠巧合、冷知识或时间线错位来解开，不要超自然。${motif}`
  }
  if (genreTarget <= 60) {
    return `【中间】现实框架，关键落在心理、身份错认或幻觉这类主观成分上；幻觉可以用，但要有现实成因。${motif}`
  }
  if (genreTarget <= 85) {
    return `【偏变格】设定可以离奇（民俗、诅咒、替身、诡物），但规则必须前后一致、线索可推理。${motif}`
  }
  return `【变格·怪力乱神】可以有明确的鬼神、怨灵或超自然力量，但超自然的规则必须自洽，并且线索都在故事里交代过。不要用「其实是一场梦」「一切都是幻觉」收尾，也不要靠血腥和 jump scare 吓人。${motif}`
}

/** 后台/日志里给人看的语言名，不影响玩家界面。 */
export const LOCALE_LABEL_ZH: Record<DailyLocale, string> = {
  'zh-CN': '简体中文',
  en: '英文',
  ja: '日文',
}

interface LocaleSpec {
  /** 写进 prompt 的长度说法——英文按词数说，模型才写得准 */
  storyBrief: string
  storyMin: number
  storyMax: number
  /** 校验时按字还是按词量 */
  unit: '字' | 'words'
  surfaceMax: number
  truthMax: number
}

/**
 * 英文按字符量会离谱地长（9000 字≈1500 词），所以英文改用**词数**，
 * 而且校验上限要留出余量：上限等于 prompt 里的目标值时，模型稍微写长一点
 * 就会连试三轮都过不了，整天的汤直接生成失败（实测踩过）。
 */
const LOCALE_SPECS: Record<DailyLocale, LocaleSpec> = {
  'zh-CN': {
    storyBrief: '800 到 1200 字',
    storyMin: 400,
    storyMax: 2500,
    unit: '字',
    surfaceMax: 60,
    truthMax: 220,
  },
  ja: {
    storyBrief: '800 から 1200 字',
    storyMin: 400,
    storyMax: 2500,
    unit: '字',
    surfaceMax: 60,
    truthMax: 220,
  },
  en: {
    storyBrief: '700 to 1000 words',
    storyMin: 500,
    storyMax: 1400,
    unit: 'words',
    surfaceMax: 220,
    truthMax: 800,
  },
}

function measureStory(story: string, spec: LocaleSpec): number {
  return spec.unit === 'words' ? story.trim().split(/\s+/).filter(Boolean).length : story.length
}

function storySystem(roll: DailyRoll): string {
  const setting = localizedGenreBrief(roll) ?? genreBrief(roll)
  const lengthRule = LOCALE_SPECS[roll.locale].storyBrief
  if (roll.locale === 'en') {
    return `You are a top-tier turtle-soup (situation puzzle) writer. The first step is not to write the riddle — it is to write a **complete, self-consistent story that stands on its own**; the surface and the truth are distilled from it afterwards.

Write an original story and output exactly one json object.

Requirements:
1. story: the full story, ${lengthRule}. Give it real characters, motives, a timeline and a chain of cause and effect. Every strange event must be explained inside the story itself — no contradictions.
2. key_twist: one sentence naming the single most important reversal (used for review).
3. The reversal must be surprising, yet completely justified in hindsight, and its clues must be planted in the story.
4. ${setting}
5. No gore, sexual content, jump scares or anything illegal.
6. title: a short title. tags: 2-3 short tags **in English**. difficulty: exactly one of 简单 / 中等 / 困难 (keep the Chinese value — the interface translates it).
7. Write everything in natural, idiomatic English.

Output format (strict json, no markdown fences):
{"title": "Title", "story": "Full story", "key_twist": "The twist", "difficulty": "中等", "tags": ["tag1", "tag2"]}`
  }
  if (roll.locale === 'ja') {
    return `あなたは一流のウミガメのスープ（状況推理）作家です。最初に書くのは謎かけではありません。**それ自体で成立する、完全で矛盾のない物語**を先に書き、そこから湯面と真相を凝縮して作ります。

オリジナルの物語を書き、json オブジェクトを一つだけ出力してください。

条件：
1. story：物語の全文、${lengthRule}。具体的な人物・動機・時系列・因果関係を用意し、不可解な出来事はすべて物語の内部で説明すること。矛盾は禁止。
2. key_twist：この物語で最も重要な反転を一文で（審査に使います）。
3. 反転は意外でありながら、振り返れば完全に筋が通っていること。手がかりは物語の中に置いておくこと。
4. ${setting}
5. 残虐・性的表現・ジャンプスケア・違法な内容は禁止。
6. title：短いタイトル。tags：**日本語**の短いタグを 2〜3 個。difficulty：简单 / 中等 / 困难 のいずれかをそのまま（表示側で翻訳します）。
7. 全文を自然な日本語で書くこと。

出力形式（厳密な json、markdown のコードブロックは不要）：
{"title": "タイトル", "story": "物語全文", "key_twist": "反転", "difficulty": "中等", "tags": ["タグ1", "タグ2"]}`
  }
  return `你是一位顶级海龟汤出题人。海龟汤的第一步不是写谜面，而是先写一则**完整、自洽、能站得住的故事**，之后才会从它里面凝练出汤底与汤面。

请写一则原创故事，并只输出一个 json 对象。

要求：
1. story：完整的故事正文，${lengthRule}。要有具体的人物、动机、时间线和因果链；每一件反常的事都必须在故事内部得到解释，不能互相矛盾。
2. key_twist：一句话点明这个故事最关键的反转（供审核使用）。
3. 反转必须出人意料、但回溯故事又完全合理，并且线索在故事里都交代过。
4. ${setting}
5. 不要血腥、色情、恐怖 jump scare 或违法内容。
6. title：一个 2 到 10 字的标题。tags：2 到 3 个**中文**短标签。difficulty：简单 / 中等 / 困难。
7. 全文使用简体中文。

输出格式（严格 json，不要 markdown 代码块）：
{"title": "标题", "story": "完整故事", "key_twist": "关键反转", "difficulty": "中等", "tags": ["标签1", "标签2"]}`
}

function condenseSystem(roll: DailyRoll): string {
  const spec = LOCALE_SPECS[roll.locale]
  if (roll.locale === 'en') {
    return `Condense a finished story into one turtle-soup puzzle. Output exactly one json object.

Requirements:
1. truth: 3-5 sentences, under ${spec.truthMax} characters, stating the core cause and effect and the key reversal. **Only use what the story already contains** — invent no character, event or motive, and drop no part of the twist.
2. surface: **one sentence only**, under ${spec.surfaceMax} characters. Show only the single strangest thing that happens; never explain it or give the answer away.
3. hint: one sentence that nudges the reasoning without revealing the answer.
4. Every detail in the surface must be explainable by the truth.
5. If the story involves a death or mistaken identity, make clear exactly who died, who is still alive at the time of the riddle, and which person each role refers to. Preserve this distinction when shortening the truth.
6. Write entirely in natural English.

Output format (strict json, no markdown fences):
{"truth": "Truth", "surface": "Surface", "hint": "Hint"}`
  }
  if (roll.locale === 'ja') {
    return `書き上がった物語を一つのウミガメのスープに凝縮します。json オブジェクトを一つだけ出力してください。

条件：
1. truth（真相）：3〜5 文、${spec.truthMax} 字以内。物語の核心的な因果と重要な反転を述べること。**物語にある情報だけ**を使い、人物・出来事・動機を新たに足したり、反転を落としたりしないこと。
2. surface（湯面）：**一文だけ**、${spec.surfaceMax} 字以内。物語で最も不可解な現象だけを見せ、理由も真相も書かないこと。
3. hint（ヒント）：一文。答えを明かさず、推理の方向を押すこと。
4. 湯面の細部はすべて真相で説明できること。
5. 死亡や人物の取り違えがある場合、誰が亡くなり、謎の時点で誰が生きているか、各呼称が誰を指すかを明記すること。真相を短くしてもこの区別を残すこと。
6. 全文を自然な日本語で書くこと。

出力形式（厳密な json、markdown のコードブロックは不要）：
{"truth": "真相", "surface": "湯面", "hint": "ヒント"}`
  }
  return `你要把一则已经写好的故事凝练成一道海龟汤。你只输出一个 json 对象。

要求：
1. truth（汤底）：3 到 5 句、${spec.truthMax} 字以内，把故事的核心因果与关键反转讲清楚。**只能使用故事里已有的信息**，不得新增人物、事件或动机，也不得遗漏关键反转。
2. surface（汤面）：**只写一句话**，不超过 ${spec.surfaceMax} 个字。只呈现故事里最反常的那一个现象，不解释原因、不点破真相。
3. hint（提示）：一句话，不直接揭晓答案，但能推动推理方向。
4. 汤面里出现的每个细节，都要能被汤底解释。
5. 如果故事涉及死亡或人物错认，汤底须明确谁去世、谜题当下谁还活着、每个称呼指向谁；压缩时也要保留这些区别。
6. 全文使用简体中文。

输出格式（严格 json，不要 markdown 代码块）：
{"truth": "汤底", "surface": "汤面", "hint": "提示"}`
}

export interface DailyReview {
  passed: boolean
  score: number
  issues: string[]
  checks: Record<string, number>
  thresholds: Record<string, number>
}

export interface DailyDraft {
  /** 这碗汤原生用什么语言写的 */
  locale: DailyLocale
  /** 摇到的题材坐标与题材标签（留档，用于回看与巡检） */
  genreTarget: number
  tag: string
  /** 实际落点：和题库用的是同一把尺子（0 本格 · 100 变格），没有就是 null */
  genreScore: number | null
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
    if (value < threshold) issues.push(`${key}: ${value.toFixed(2)} < ${threshold}`)
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

function issueBlock(issues: string[], locale: DailyLocale): string {
  if (!issues.length) return ''
  return `\n\n${DAILY_COPY[locale].retry}\n${issues.map((issue) => `- ${issue}`).join('\n')}`
}

/**
 * 生成当天的官方汤：先写完整故事，再凝练汤底/汤面，再审核；
 * 结构、长度和语言先硬校验；质量审核不过才逐次放宽标准，返回最好的一次（relaxed=true）。
 * 语言不符只能回炉，不能因为质量分高或 relaxed 而发布。
 */
export interface DailyProgress {
  stage: 'story' | 'condense' | 'review'
  attempt: number
  chars: number
}

export async function composeDaily(
  env: GameEnv,
  options: {
    avoid?: string[]
    date?: string
    onProgress?: (progress: DailyProgress) => void
    /** 不给就现摇一次；手动重生成时可以传进来复用 */
    roll?: DailyRoll
  },
): Promise<DailyDraft> {
  const cfg = resolveLlm(env)
  if (!cfg) throw new ApiError(503, '未配置 LLM Key，无法生成每日汤')

  const roll = options.roll ?? rollDaily()
  const spec = LOCALE_SPECS[roll.locale]
  const copy = DAILY_COPY[roll.locale]
  console.log(
    `[daily] 摇到：${LOCALE_LABEL_ZH[roll.locale]}｜题材 ${roll.tag}｜坐标 ${roll.genreTarget}`,
  )

  const avoid = options.avoid ?? []
  let best: (DailyDraft & { score: number }) | null = null
  let carryIssues: string[] = []

  for (let attempt = 1; attempt <= MAX_DAILY_ATTEMPTS; attempt += 1) {
    const avoidBlock = avoid.length
      ? `\n\n${copy.avoid}\n${avoid
          .slice(0, 10)
          .map((item) => `- ${item}`)
          .join('\n')}`
      : ''
    const retryBlock = issueBlock(carryIssues, roll.locale)

    const story = await generateJson<z.infer<typeof StorySchema>>(cfg, {
      system: `${storySystem(roll)}\n\n${copy.languageRule}`,
      user: `${copy.writeStory}${avoidBlock}${retryBlock}\n\n${copy.languageRule}`,
      locale: roll.locale,
      effort: 'max',
      onProgress: (progress) =>
        options.onProgress?.({ stage: 'story', attempt, chars: progress.chars }),
      check: (raw) => {
        const parsed = StorySchema.safeParse(raw)
        if (!parsed.success) {
          return { issues: [`${copy.invalidSchema}: ${parsed.error.message.slice(0, 160)}`] }
        }
        const measured = measureStory(parsed.data.story, spec)
        const issues = dailyLanguageIssues(roll.locale, {
          title: parsed.data.title,
          story: parsed.data.story,
          key_twist: parsed.data.key_twist,
          ...Object.fromEntries(
            (parsed.data.tags ?? []).map((tag, index) => [`tags[${index}]`, tag]),
          ),
        })
        if (measured < spec.storyMin || measured > spec.storyMax) {
          issues.push(copy.length('story', measured, spec.storyMin, spec.storyMax, spec.unit))
        }
        return issues.length ? { issues } : { value: parsed.data, issues: [] }
      },
    })

    const condensed = await generateJson<z.infer<typeof CondensedSchema>>(cfg, {
      system: `${condenseSystem(roll)}\n\n${copy.languageRule}`,
      user: `${copy.story}:\n\n${story.story}\n\n${copy.twist}: ${story.key_twist}\n\n${copy.condense}${retryBlock}\n\n${copy.languageRule}`,
      locale: roll.locale,
      effort: 'high',
      onProgress: (progress) =>
        options.onProgress?.({ stage: 'condense', attempt, chars: progress.chars }),
      check: (raw) => {
        const parsed = CondensedSchema.safeParse(raw)
        if (!parsed.success) {
          return { issues: [`${copy.invalidSchema}: ${parsed.error.message.slice(0, 160)}`] }
        }
        const issues = dailyLanguageIssues(roll.locale, parsed.data)
        const unit = roll.locale === 'en' ? 'characters' : '字'
        const stops = (parsed.data.surface.match(/[。！？!?…]/g) ?? []).length
        if (parsed.data.surface.length > spec.surfaceMax) {
          issues.push(copy.length('surface', parsed.data.surface.length, 1, spec.surfaceMax, unit))
        }
        if (stops > 1) issues.push(copy.sentence)
        if (parsed.data.truth.length > spec.truthMax) {
          issues.push(copy.length('truth', parsed.data.truth.length, 20, spec.truthMax, unit))
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
      locale: roll.locale,
      genreTarget: roll.genreTarget,
      tag: roll.tag,
      genreScore: null,
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
    if (review.passed) return finalise(env, candidate)
    carryIssues = review.issues
  }

  if (!best) throw new ApiError(502, '每日汤生成失败')
  console.warn('[daily] 连续未过审，发布分数最高的一版')
  return finalise(env, { ...best, relaxed: true })
}

/** 定稿：补上实际落点。打不了分（没密钥/失败）就留 null，不影响发布。 */
async function finalise(env: GameEnv, draft: DailyDraft & { score: number }): Promise<DailyDraft> {
  const genreScore = await scoreGenre(env, {
    title: draft.title,
    surface: draft.surface,
    truth: draft.truth,
    hint: draft.hint,
  })
  return { ...draft, genreScore }
}
