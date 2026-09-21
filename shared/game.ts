import { TypeSafeClient, choice, noul, score } from '@typesafe-ai/sdk'
import OpenAI from 'openai'
import { z } from 'zod'

import { ApiError } from './errors.ts'

export { ApiError }

/**
 * Environment the game logic needs. Both the Vite dev middleware and the
 * Cloudflare Worker pass their own env object, which is structurally
 * compatible with this shape (an index signature or explicit keys).
 */
export interface GameEnv {
  TYPESAFE_API_KEY?: string
  LLM_API_KEY?: string
  LLM_PROVIDER?: string
  LLM_BASE_URL?: string
  LLM_MODEL?: string
  DEEPSEEK_API_KEY?: string
  DEEPSEEK_BASE_URL?: string
  DEEPSEEK_MODEL?: string
  OPENAI_API_KEY?: string
  OPENAI_BASE_URL?: string
  OPENAI_MODEL?: string
  /** 设为 '1' 时出题失败直接抛错，便于排查。 */
  LLM_DEBUG?: string
}

export const MAX_CONVERSATION = 10
export const MAX_MESSAGE_CHARS = 600

export interface Puzzle {
  title: string
  surface: string
  truth: string
  hint: string
}

export const PuzzleSchema = z.object({
  title: z.string().min(1),
  surface: z.string().min(1),
  truth: z.string().min(1),
  hint: z.string().min(1),
  difficulty: z.string().min(1).optional(),
  tags: z.array(z.string()).optional(),
})

export type GeneratedPuzzle = z.infer<typeof PuzzleSchema>

export const BUILTIN_PUZZLES: GeneratedPuzzle[] = [
  {
    title: '海边的小屋',
    difficulty: '中等',
    surface:
      '一名男子独自住在海边的小屋里。某天他收到一个没有寄件人的包裹，打开后里面是一根羽毛。他笑了笑，把羽毛放进口袋，然后出门走向大海，再也没有回来。',
    truth:
      '男子曾是远洋客轮的乘务员。多年前客轮失事，他负责分发救生衣，却在慌乱中把一件破损的救生衣给了一个年轻乘客，对方因此溺亡，而他活了下来。此后他一直被愧疚折磨，与死者家人保持通信却从未见面。这根羽毛来自死者生前养的鹦鹉——老人临终托人把鹦鹉的一根羽毛寄给他，并附言"他早就不怪你了"。他等这句话等了太久，终于放下，走向大海自尽。',
    hint: '注意他为什么在读完包裹后笑了，而不是哭了。',
    tags: ['救赎', '海边'],
  },
  {
    title: '电梯里的男人',
    difficulty: '简单',
    surface:
      '一个男人每天早上都坐电梯到 10 楼，再走楼梯到 12 楼上班。下雨天他却会直接坐到 12 楼，然后一整天心情都很好。',
    truth:
      '男人是个侏儒，身高只够按到电梯上 10 楼的按钮，再高的按钮需要借助他的雨伞去够。下雨天他会带伞，就能直接按到 12 楼。心情好是因为下雨天有伞，不用爬楼，而不是因为天气。',
    hint: '想想他按下按钮时用的是什么工具。',
    tags: ['经典', '生活'],
  },
  {
    title: '深夜的探照灯',
    difficulty: '困难',
    surface:
      '深夜，一个女人独自开车行驶在乡间公路上。她打开车灯，却在一处弯道突然急刹车，随后弃车逃进路边的树林，直到第二天早上才敢出来。她没有遇到任何人或动物。',
    truth:
      '她的车灯照射到前方路边的树林里，反射出一双反光的眼睛。她想起当地流传的传说，以为遇到了怪物，吓得弃车逃跑。实际上那只是一只停在低矮树桩上的猫头鹰。她白天回来时，看到树桩上的猫头鹰，才明白是自己吓自己。',
    hint: '夜里在树林里反光的东西，往往有很普通的解释。',
    tags: ['误会', '夜晚'],
  },
]

export function resolveLlm(env: GameEnv) {
  const genericKey = env.LLM_API_KEY?.trim()
  if (genericKey) {
    return {
      label: env.LLM_PROVIDER?.trim() || 'custom',
      baseUrl: (env.LLM_BASE_URL?.trim() || 'https://api.deepseek.com/v1').replace(/\/+$/, ''),
      apiKey: genericKey,
      model: env.LLM_MODEL?.trim() || 'deepseek-chat',
    }
  }
  const deepseekKey = env.DEEPSEEK_API_KEY?.trim()
  if (deepseekKey) {
    return {
      label: 'deepseek',
      baseUrl: (env.DEEPSEEK_BASE_URL?.trim() || 'https://api.deepseek.com/v1').replace(/\/+$/, ''),
      apiKey: deepseekKey,
      model: env.DEEPSEEK_MODEL?.trim() || 'deepseek-chat',
    }
  }
  const openaiKey = env.OPENAI_API_KEY?.trim()
  if (openaiKey) {
    return {
      label: 'openai',
      baseUrl: (env.OPENAI_BASE_URL?.trim() || 'https://api.openai.com/v1').replace(/\/+$/, ''),
      apiKey: openaiKey,
      model: env.OPENAI_MODEL?.trim() || 'gpt-4o-mini',
    }
  }
  return null
}

type LlmConfig = NonNullable<ReturnType<typeof resolveLlm>>

export type Genre = 'realistic' | 'supernatural'

export const GENRES: Genre[] = ['realistic', 'supernatural']

/** 怪力乱神题材：允许超自然设定，但仍要求线索可推理、规则自洽。 */
const TRUTH_RULE: Record<Genre, string> = {
  realistic:
    '把汤面那件反常的事解释清楚，逻辑自洽，在现实或合理设定中成立；不要魔法、超自然、鬼怪或"其实只是一场梦"。',
  supernatural:
    '把汤面那件反常的事解释清楚，逻辑自洽。允许出现鬼神、怨灵、诅咒、因果报应、民间禁忌、诡物等超自然设定；但超自然的规则必须前后一致，而且能在汤面里找到线索。不要用"其实是一场梦""一切都是幻觉"收尾，也不要靠血腥和 jump scare 吓人。',
}

/** 汤面与汤底必须一一对应，且汤底要短。 */
const LINK_RULES = `汤底写作要求（很重要）：
- 只回答汤面里那一个反常之处，不要写成小作文，不要交代与汤面无关的人物生平、支线剧情或抒情结尾。
- 长度控制在 3 到 5 句、150 字以内，信息密度要高，每句都要有用。
- 汤面里出现的每个细节（人、物、动作、时间、数量）都必须在汤底里得到解释；解释不了的就不要写进汤面。
- 汤底里不要再引入汤面完全没有暗示过的新角色或新事件。
- 读完汤底，玩家应该能立刻回头对照汤面说"原来每一处都对上了"。`

const GENRE_STYLE: Record<Genre, string> = {
  realistic: '本格现实向：所有反常都必须有现实的、可解释的成因。',
  supernatural: '怪力乱神：可以有鬼神与因果，但要克制、有规矩，读起来像一则民间怪谈而非血浆片。',
}

export type Locale = 'zh-CN' | 'en' | 'ja'

export function readLocale(value: unknown): Locale {
  return value === 'en' || value === 'ja' ? value : 'zh-CN'
}

/** 出题正文必须用请求者当前的语言，否则英文站会端上一碗中文汤。 */
const LANGUAGE_RULE: Record<Locale, string> = {
  'zh-CN':
    'Story language: Simplified Chinese only. Write the title, surface, truth, hint and tags in Chinese.',
  en: 'Story language: English only. Write the title, surface, truth, hint and tags in natural, idiomatic English; never leave Chinese in the output.',
  ja: 'Story language: Japanese only. Write the title, surface, truth, hint and tags in natural Japanese; never leave Chinese in the output.',
}

const STYLE_RULE: Record<Locale, string> = {
  'zh-CN':
    '不要血腥、色情、恐怖 jump scare 或违法内容；正文里不要出现「汤面」「汤底」「答案」这类出题术语。',
  en: 'No gore, sexual content, jump scares or anything illegal, and never use the words "surface", "truth" or "answer" inside the prose itself.',
  ja: '残虐・性的表現・ジャンプスケア・違法な内容は避け、本文中に「湯面」「真相」「答え」といった出題用語を書かないこと。',
}

function systemPrompt(genre: Genre, locale: Locale = 'zh-CN') {
  return `你是一位顶级海龟汤（情境推理游戏）出题人。海龟汤由两部分组成：汤面是呈现给玩家的一段诡异、简短、只描述现象的情境；汤底是隐藏的完整真相。

请创作一则原创、公平、逻辑自洽的海龟汤，并且只输出一个 JSON 对象。

要求：
1. surface（汤面）：**只写一句话**，不超过 40 个字。这一句必须最能引起遐想——只呈现一个反常的现象、动作或对白，让人看完立刻想问"为什么会这样"。不要解释原因，不要点破真相，不要铺陈背景，不要写成两句话或罗列多个细节。
2. truth（汤底）：${TRUTH_RULE[genre]}
3. 反转：汤底要有一个出人意料、但回溯汤面又完全合理的转折；关键线索必须已经埋在汤面里，玩家可以靠是非提问推理出来（fair play）。
${LINK_RULES}
4. hint（提示）：一句话，不直接揭晓答案，但能推动推理方向。
5. difficulty：只能是"简单""中等""困难"之一。
6. tags：2 到 3 个中文短标签。

题材风格：${GENRE_STYLE[genre]}

风格约束：${STYLE_RULE[locale]}
${LANGUAGE_RULE[locale]}
${genre === 'supernatural' ? 'tags 里必须包含「怪力乱神」这个标签。' : ''}

输出格式（严格 JSON，不要 markdown 代码块）：
{"title": "标题", "surface": "汤面", "truth": "汤底", "hint": "提示", "difficulty": "中等", "tags": ["标签1", "标签2"]}`
}

export function readGenre(value: unknown): Genre {
  return value === 'supernatural' ? 'supernatural' : 'realistic'
}

function buildUserPrompt(
  difficulty: string,
  theme: string,
  avoid: string[] = [],
  locale: Locale = 'zh-CN',
) {
  const openers: Record<Locale, string> = {
    'zh-CN': `请创作一则难度为「${difficulty}」的海龟汤。`,
    en: `Write one turtle-soup puzzle at ${difficultyEn(difficulty)} difficulty.`,
    ja: `海亀スープのお題を一つ、難易度「${difficultyJa(difficulty)}」で書いてください。`,
  }
  const themeLabels: Record<Locale, string> = {
    'zh-CN': '主题或背景偏好',
    en: 'Theme or setting preference',
    ja: '題材・舞台の希望',
  }
  const avoidIntro: Record<Locale, string> = {
    'zh-CN':
      '最近已经出过下面这些题，请换一个完全不同的场景、物件和转折，不要与之相似，也不要同题：',
    en: 'These puzzles were generated recently. Pick a completely different setting, object and twist — do not repeat or closely echo any of them:',
    ja: '最近出したお題は以下です。舞台・小道具・どんでん返しを大きく変え、類似や同一は避けてください：',
  }
  const outro: Record<Locale, string> = {
    'zh-CN': '以 json 格式输出，只输出 json。',
    en: 'Answer with json only, no commentary.',
    ja: 'json のみで出力すること。',
  }
  const parts = [openers[locale]]
  if (theme.trim()) parts.push(`${themeLabels[locale]}：${theme.trim()}。`)
  if (avoid.length) {
    parts.push(
      `${avoidIntro[locale]}\n${avoid
        .slice(0, 12)
        .map((item) => `- ${item}`)
        .join('\n')}`,
    )
  }
  parts.push(outro[locale])
  return parts.join('')
}

function difficultyEn(value: string): string {
  return value === '简单' ? 'easy' : value === '困难' ? 'hard' : 'normal'
}

function difficultyJa(value: string): string {
  return value === '简单' ? 'やさしい' : value === '困难' ? 'むずかしい' : 'ふつう'
}

function extractJson(text: string): unknown {
  const trimmed = text.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced ? fenced[1].trim() : trimmed
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  const slice = start >= 0 && end > start ? candidate.slice(start, end + 1) : candidate
  return JSON.parse(slice)
}

type Effort = 'max' | 'high' | 'low'

/**
 * 思考模式总开关。先关掉换速度与稳定性（开着时单次要几十秒到几分钟）。
 * 想开回来只要改成 true，effort 阶梯依然有效。
 */
const THINKING_ENABLED = false
type ChatTurn = { role: 'system' | 'user' | 'assistant'; content: string }

/**
 * 流式请求只要还在吐 token 就不算超时，所以这里盯的是「空闲」而不是总时长。
 * 非流式时代一条静默的长连接常被边缘或代理掐断，这才是 high 档超时的原因。
 */
const IDLE_TIMEOUT_MS = 90_000
const MAX_CALL_MS = 600_000
/** 首次生成 + 最多两次「带着报错回炉」。 */
const MAX_ROUNDS = 3

/**
 * 输出兜底校验：结构以外的硬性要求。不通过就把具体问题连同原始要求回给模型，
 * 让它自己改，而不是直接放弃去用内置题。
 */
function validatePuzzle(puzzle: GeneratedPuzzle): string[] {
  const issues: string[] = []
  const surface = puzzle.surface.trim()
  const truth = puzzle.truth.trim()

  const surfaceStops = (surface.match(/[。！？!?…]/g) ?? []).length
  if (surface.length > 60) issues.push(`汤面太长（${surface.length} 字，要求 40 字以内）`)
  if (surfaceStops > 1) issues.push(`汤面必须只有一句话，现在有 ${surfaceStops} 句`)

  const truthStops = (truth.match(/[。！？!?…]/g) ?? []).length
  if (truth.length < 20) issues.push('汤底太短，没有把真相讲清楚')
  if (truth.length > 220) issues.push(`汤底太长（${truth.length} 字，要求 150 字以内）`)
  if (truthStops > 6) issues.push(`汤底句数太多（${truthStops} 句，要求 3-5 句`)

  if (!puzzle.title.trim()) issues.push('title 不能为空')
  if (puzzle.title.trim().length > 20) issues.push('title 太长，控制在 20 字以内')
  if (!['简单', '中等', '困难'].includes(puzzle.difficulty ?? '')) {
    issues.push('difficulty 只能是「简单」「中等」「困难」之一')
  }
  if (puzzle.hint && puzzle.hint.trim().length > 80) {
    issues.push(`hint 太长（${puzzle.hint.length} 字），一句话即可`)
  }
  return issues
}

/**
 * 只相信自己的超时：SDK 的 abort 不保证会打断 for-await，
 * 所以这里用「空闲 deadline」直接和迭代竞速，超时就抛。
 */
function withIdleDeadline<T>(
  work: (signal: AbortSignal, keepAlive: () => void) => Promise<T>,
): Promise<T> {
  const controller = new AbortController()
  let settled = false
  let idleTimer: ReturnType<typeof setTimeout> | null = null

  return new Promise<T>((resolve, reject) => {
    const fail = (error: Error) => {
      if (settled) return
      settled = true
      if (idleTimer) clearTimeout(idleTimer)
      controller.abort()
      reject(error)
    }
    const keepAlive = () => {
      if (settled) return
      if (idleTimer) clearTimeout(idleTimer)
      idleTimer = setTimeout(
        () => fail(new Error(`空闲超过 ${Math.round(IDLE_TIMEOUT_MS / 1000)} 秒，已放弃`)),
        IDLE_TIMEOUT_MS,
      )
    }
    keepAlive()
    work(controller.signal, keepAlive).then(
      (value) => {
        if (settled) return
        settled = true
        if (idleTimer) clearTimeout(idleTimer)
        resolve(value)
      },
      (error) => fail(error instanceof Error ? error : new Error(String(error))),
    )
  })
}

async function callChat(
  cfg: LlmConfig,
  messages: ChatTurn[],
  effort: Effort,
  onProgress?: (progress: { stage: 'thinking' | 'writing'; chars: number }) => void,
): Promise<string> {
  const client = new OpenAI({
    apiKey: cfg.apiKey,
    baseURL: cfg.baseUrl,
    // 重试交给我们自己控制（high 失败再上 max），SDK 不要再偷偷重试
    maxRetries: 0,
    timeout: MAX_CALL_MS,
  })

  return withIdleDeadline(async (signal, keepAlive) => {
    const stream = await client.chat.completions.create(
      {
        model: cfg.model,
        messages,
        stream: true,
        // 最后一个 chunk 带 usage，方便统计
        stream_options: { include_usage: true },
        // 结构化输出：prompt 里已给出 json 样例
        response_format: { type: 'json_object' },
        // 思考模式：思维链也算 token（max 档常上万字），不思考时 8K 足够
        max_tokens: THINKING_ENABLED ? 65536 : 8192,
        ...(THINKING_ENABLED
          ? { reasoning_effort: effort, thinking: { type: 'enabled' as const } }
          : { thinking: { type: 'disabled' as const } }),
      } as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming & {
        thinking: { type: 'enabled' | 'disabled' }
      },
      { signal },
    )

    let content = ''
    let reasoningChars = 0
    let finishReason: string | null = null

    for await (const chunk of stream) {
      keepAlive()
      const choice = chunk.choices?.[0]
      if (!choice) continue
      if (choice.finish_reason) finishReason = choice.finish_reason
      const delta = choice.delta as
        { content?: string | null; reasoning_content?: string | null } | undefined
      if (delta?.reasoning_content) reasoningChars += delta.reasoning_content.length
      if (delta?.content) content += delta.content
      if (onProgress && (reasoningChars + content.length) % 200 < 40) {
        onProgress(
          delta?.content
            ? { stage: 'writing', chars: content.length }
            : { stage: 'thinking', chars: reasoningChars },
        )
      }
    }

    const trimmed = content.trim()
    if (!trimmed) {
      throw new Error(
        `${cfg.label} 没有返回内容（finish_reason=${finishReason ?? 'unknown'}，思维链长度=${reasoningChars}）`,
      )
    }
    return trimmed
  })
}

function correctionPrompt(issues: string[], requirements: string): string {
  return `你刚才的输出没有通过校验，问题如下：
${issues.map((issue) => `- ${issue}`).join('\n')}

请对照下面的原始要求逐条修正，重新输出一份完整的 json（只输出 json，不要任何解释）：
${requirements}`
}

async function generateWithLlm(
  cfg: LlmConfig,
  difficulty: string,
  theme: string,
  genre: Genre,
  effort: Effort = 'low',
  avoid: string[] = [],
  locale: Locale = 'zh-CN',
  onProgress?: (progress: GenerateProgress) => void,
): Promise<GeneratedPuzzle> {
  const requirements = `${systemPrompt(genre, locale)}\n\n${buildUserPrompt(
    difficulty,
    theme,
    avoid,
    locale,
  )}`
  const messages: ChatTurn[] = [
    { role: 'system', content: systemPrompt(genre, locale) },
    {
      role: 'user',
      content: buildUserPrompt(difficulty, theme, avoid, locale),
    },
  ]
  let lastIssues: string[] = []

  for (let round = 1; round <= MAX_ROUNDS; round += 1) {
    const content = await callChat(cfg, messages, effort, (progress) =>
      onProgress?.({ ...progress, round }),
    )

    let candidate: GeneratedPuzzle | null = null
    let issues: string[] = []
    try {
      const parsed = PuzzleSchema.safeParse(extractJson(content))
      if (parsed.success) {
        candidate = parsed.data
        issues = validatePuzzle(candidate)
      } else {
        issues = [`json 结构不合法：${parsed.error.message.slice(0, 200)}`]
      }
    } catch (error) {
      issues = [
        `不是合法的 json：${error instanceof Error ? error.message.slice(0, 160) : '解析失败'}`,
      ]
    }

    if (candidate && !issues.length) return candidate

    lastIssues = issues
    if (round < MAX_ROUNDS) {
      console.warn(`[turtle-soup] 输出校验未通过，回炉第 ${round} 次：`, issues.join('；'))
      messages.push({ role: 'assistant', content })
      messages.push({
        role: 'user',
        content: correctionPrompt(issues, requirements),
      })
    }
  }

  throw new Error(`模型连续 ${MAX_ROUNDS} 次都没给出合格输出：${lastIssues.join('；')}`)
}

/** 归一化汤面，用来判断两则题是不是同一则。 */
export function normaliseSurface(surface: string): string {
  return surface.replace(/\s+/g, '').slice(0, 60)
}

export function pickBuiltin(
  difficulty: string,
  theme: string,
  avoid: string[] = [],
): GeneratedPuzzle {
  const usable = BUILTIN_PUZZLES.filter(
    (puzzle) => !avoid.includes(normaliseSurface(puzzle.surface)),
  )
  if (theme.trim()) {
    const hit = usable.find(
      (puzzle) => puzzle.tags?.some((tag) => theme.includes(tag)) || theme.includes(puzzle.title),
    )
    if (hit) return hit
  }
  const pool = usable.filter((puzzle) => !puzzle.difficulty || puzzle.difficulty === difficulty)
  const list = pool.length ? pool : usable.length ? usable : BUILTIN_PUZZLES
  return list[Math.floor(Math.random() * list.length)]
}

const HOST_QUESTIONS = {
  intent: choice(
    {
      question: 'What kind of message did the player just send?',
      inspect: '`latest_player_message`',
      focus: 'Classify the intent only. Do not judge whether the player is right.',
    },
    {
      yes_no_question: {
        what: 'The player asks a yes/no question about the hidden story, or makes one narrow factual claim about it that can be confirmed or denied.',
        not_for: 'A full or partial explanation of what happened; that is a guess.',
        examples: ['Was the man blind?', 'Is the woman a doctor?', 'Did he die on purpose?'],
      },
      guess: {
        what: 'The player proposes an explanation, theory, or reconstruction of what happened, usually as a statement, possibly wrapped in a question like "so did he...?".',
        not_for: 'A single narrow fact question; that is yes_no_question.',
        examples: ['He killed her because she cheated, right?', 'I think the mirror was fake.'],
      },
      meta: {
        what: 'The player talks about the game or about their own session rather than the hidden story: asks for a hint or the answer, asks about the rules, asks about their own luck or fortune today, or makes small talk.',
        examples: [
          'Give me a hint',
          'What is the answer?',
          'How do I play this?',
          'How is my luck today?',
          'What is my fortune?',
        ],
      },
      unclear: {
        what: 'The message cannot be read as a question, a guess, or a meta request, or is unrelated to the story.',
        examples: ['asdfgh', 'nice weather today'],
      },
    },
  ),
  verdict: choice(
    {
      question:
        'If `latest_player_message` is a yes/no question or a narrow factual claim about the story, how should the host answer it given only `puzzle.truth`?',
      compare: ['latest_player_message', 'puzzle.truth'],
      focus:
        'Judge strictly against the hidden truth. If the message is not a yes/no question about the story, choose cannot_answer.',
    },
    {
      yes: 'The truth confirms the claim or answers the question YES.',
      no: 'The truth contradicts the claim or answers the question NO.',
      partly: 'The truth is partly right and partly wrong, so a plain yes or no would mislead.',
      irrelevant:
        'The question asks about a detail the truth never addresses and that does not affect the story; it is neither true nor false.',
      cannot_answer: 'The message is not a yes/no question about the story.',
    },
  ),
  guess_closeness: score(
    {
      question: 'How close is the player explanation to the hidden truth in `puzzle.truth`?',
      compare: ['latest_player_message', 'puzzle.truth'],
      focus:
        'Only rate an explanation attempt. If the player did not propose an explanation, choose the lowest level.',
    },
    [
      {
        what: 'No explanation was proposed, or the explanation is unrelated to the truth or points the wrong way.',
        examples: ['What did he eat for breakfast?', 'It was aliens.'],
      },
      {
        what: 'One or two true details are present, but the core explanation is wrong or missing.',
        examples: ['He was a doctor.'],
      },
      {
        what: 'The main idea of the truth is captured, but an important cause or the key twist is still wrong or missing.',
        examples: ['He faked his death to escape debt, but who helped him is missing.'],
      },
      {
        what: 'The explanation matches the truth including the key twist; wording may differ.',
        examples: ['A complete, correct reconstruction of the truth.'],
      },
    ],
  ),
  solved: noul(
    {
      question:
        'Does `latest_player_message` fully and correctly state the core truth in `puzzle.truth`?',
      compare: ['latest_player_message', 'puzzle.truth'],
      focus: 'The core plot and the key twist must both be correct. Different wording is fine.',
    },
    {
      true: {
        what: 'The message states the core truth and the key twist correctly.',
        examples: ['The whole explanation is right.'],
      },
      false: {
        what: 'The message misses a key fact, gets the twist wrong, or is only partly right.',
        examples: ['Only a surface-level guess is right.'],
      },
    },
  ),
  meta_request: choice(
    {
      question: 'If the player is talking about the game itself, what do they want?',
      inspect: '`latest_player_message`',
      focus: 'If the player is not talking about the game itself, choose none.',
    },
    {
      hint: 'They want a hint to help them reason.',
      full_answer: 'They want the truth or solution revealed.',
      how_to_play: 'They ask about the rules or how to play.',
      jrrp: 'They ask about their own luck or fortune for today (人品 / 今日人品 / 运势 / 手气), not about the story.',
      none: 'The player is not talking about the game itself.',
    },
  ),
}

interface ChoiceAnswer {
  choice: string
  confidence: number
  probabilities: Record<string, number>
}

interface ScoreAnswer {
  score: number
  confidence: number
  probabilities: Record<string, number>
}

interface NoulAnswer {
  noul: number
}

interface HostAnswers {
  intent: ChoiceAnswer
  verdict: ChoiceAnswer
  guess_closeness: ScoreAnswer
  solved: NoulAnswer
  meta_request: ChoiceAnswer
}

export interface LuckInfo {
  date: string
  score: number
  tier: string
  good: string
  bad: string
}

/** 今日人品是前端按「站点 + 日期 + 设备码」算出来的，回答时原样带回来即可。 */
function readLuck(value: unknown): LuckInfo | null {
  if (!value || typeof value !== 'object') return null
  const luck = value as Partial<LuckInfo>
  if (typeof luck.score !== 'number' || typeof luck.tier !== 'string') return null
  return {
    date: typeof luck.date === 'string' ? luck.date.slice(0, 10) : '',
    score: Math.max(0, Math.min(100, Math.round(luck.score))),
    tier: luck.tier.slice(0, 8),
    good: typeof luck.good === 'string' ? luck.good.slice(0, 24) : '',
    bad: typeof luck.bad === 'string' ? luck.bad.slice(0, 24) : '',
  }
}

interface HostCopy {
  verdict: Record<string, string>
  rephrase: string
  howToPlay: string
  hint: (hint: string) => string
  reveal: string
  solved: string
  closeHigh: string
  closeMid: string
  closeLow: string
  unclear: string
  luckMissing: string
  luck: (luck: LuckInfo) => string
  greeting: string
  greetingFallback: string
}

function luckMoodZh(score: number) {
  return score >= 85
    ? '今天手气好得反常'
    : score >= 60
      ? '今天还算顺'
      : score >= 35
        ? '今天不好不坏'
        : '今天最好别硬猜'
}

const HOST_COPY: Record<Locale, HostCopy> = {
  'zh-CN': {
    verdict: {
      yes: '是。',
      no: '不是。',
      partly: '是，也不是。',
      irrelevant: '无关。',
    },
    rephrase: '这个问题主持人有点拿不准……能换一个更具体的问法吗？',
    howToPlay:
      '玩法：主持人只会回答「是」「不是」「无关」或者「是，也不是」。你可以不断提出能用是 / 否回答的问题，一步步逼近汤底；也可以随时说出你的完整推理，猜对了就通关。',
    hint: (hint) => `主持人压低声音说了一句提示：「${hint}」`,
    reveal: '好吧，既然你坚持——这就是真相。',
    solved: '……没错，就是这样。你完全还原了真相，这一碗被你喝到底了。',
    closeHigh: '已经很接近了！核心抓住了，但还差最后一块关键拼图。',
    closeMid: '沾到一点边了，方向可以再往关键的地方想想。',
    closeLow: '嗯……这个说法和真相差得有点远，再换条线索想想。',
    unclear: '主持人没太听懂。你可以问一个是非题，或者直接说出你的推理。',
    luckMissing:
      '主持人翻了翻手边的册子，又合上了：「今日人品得在首页那格日历上看——你刷新一下再来问我。」',
    luck: (luck) =>
      `主持人翻开手边的册子念了一句：「${luck.date}，人品 ${luck.score}，${luck.tier}——${luckMoodZh(
        luck.score,
      )}。宜${luck.good}，忌${luck.bad}。」他把册子合上，「信不信随你，汤底我是不会提前给你的。」`,
    greeting: '汤面已经端上来了。开始提问吧，我只会回答「是」「不是」「无关」或者「是，也不是」。',
    greetingFallback: '（这次出题没成功，先用一则经典汤顶上。）汤面已经端上来了，开始提问吧。',
  },
  en: {
    verdict: {
      yes: 'Yes.',
      no: 'No.',
      partly: 'Partly.',
      irrelevant: 'Unrelated.',
    },
    rephrase: 'The host is not quite sure about that one… could you ask it more concretely?',
    howToPlay:
      'How it works: the host only answers yes, no, unrelated, or partly. Keep asking questions that can be answered with yes or no to close in on the truth, or state your full theory — get it right and the case is solved.',
    hint: (hint) => `The host lowers his voice: “${hint}”`,
    reveal: 'All right, if you insist — this is what really happened.',
    solved: '…yes, exactly. You have the whole truth; this bowl is finished.',
    closeHigh: 'Very close! You have the core of it, but one key piece is still missing.',
    closeMid: 'You are brushing against it — steer toward the crucial detail.',
    closeLow: 'Hmm… that is rather far from the truth. Try another thread.',
    unclear: 'The host did not quite follow. Ask a yes-or-no question, or state your theory.',
    luckMissing:
      'The host leafs through a small notebook and closes it. “Today’s luck is on the calendar on the front page — refresh and ask me again.”',
    luck: (luck) =>
      `The host reads from a notebook: “${luck.date}, luck ${luck.score}, ${luck.tier}. Good for: ${
        luck.good
      }. Bad for: ${luck.bad}.” He shuts it. “Believe it or not, I still will not hand you the truth early.”`,
    greeting: 'The surface is served. Ask away — I only answer yes, no, or unrelated.',
    greetingFallback:
      '(Generation did not work out, so a classic bowl stands in.) The surface is served — ask away.',
  },
  ja: {
    verdict: {
      yes: 'はい。',
      no: 'いいえ。',
      partly: 'どちらでもある。',
      irrelevant: '無関係です。',
    },
    rephrase: 'その質問は司会にも判断しかねるようです……もう少し具体的に訊いてもらえますか。',
    howToPlay:
      '遊びかた：司会が答えるのは「はい」「いいえ」「無関係」「どちらでもある」だけです。はい／いいえで答えられる質問を重ねて真相に近づくか、推理をそのまま述べてください。当たれば解決です。',
    hint: (hint) => `司会が声を落として言った。「${hint}」`,
    reveal: 'わかりました、そこまで言うなら——これが真相です。',
    solved: '……そのとおり。あなたは真相を言い当てました。この一杯は飲みきられました。',
    closeHigh: 'かなり近い！芯は掴めていますが、あと一枚だけ重要なピースが足りません。',
    closeMid: '少し触れています。核心に寄せていってください。',
    closeLow: 'うーん……それは真相からだいぶ遠いですね。別の糸をたどってみては。',
    unclear: '司会にはよく伝わらなかったようです。はい／いいえの質問か、推理を述べてください。',
    luckMissing:
      '司会は手元の帳面をめくり、閉じた。「今日の運勢はホームの暦にあります。更新してもう一度訊いてください。」',
    luck: (luck) =>
      `司会が帳面を読み上げる。「${luck.date}、運勢 ${luck.score}、${luck.tier}。向くこと：${
        luck.good
      }。避けること：${luck.bad}。」帳面を閉じて、「信じるかは自由ですが、真相は先に渡しませんよ。」`,
    greeting:
      '湯面をどうぞ。質問を始めてください。答えるのは「はい」「いいえ」「無関係」だけです。',
    greetingFallback:
      '（今回はうまく作れなかったので、定番の一杯で失礼します。）湯面をどうぞ、質問を始めてください。',
  },
}

const META_KINDS = new Set(['hint', 'full_answer', 'how_to_play', 'jrrp'])

function handleMeta(kind: string, puzzle: Puzzle, luck: LuckInfo | null, locale: Locale) {
  const copy = HOST_COPY[locale]
  if (kind === 'hint') {
    return {
      intent: 'meta',
      verdict: 'hint',
      solved: false,
      revealed: false,
      reply: copy.hint(puzzle.hint),
    }
  }
  if (kind === 'full_answer') {
    return {
      intent: 'meta',
      verdict: 'reveal',
      solved: false,
      revealed: true,
      reply: copy.reveal,
    }
  }
  if (kind === 'how_to_play') {
    return {
      intent: 'meta',
      verdict: 'how_to_play',
      solved: false,
      revealed: false,
      reply: copy.howToPlay,
    }
  }
  if (kind === 'jrrp') {
    return {
      intent: 'meta',
      verdict: 'jrrp',
      solved: false,
      revealed: false,
      reply: luck ? copy.luck(luck) : copy.luckMissing,
    }
  }
  return {
    intent: 'meta',
    verdict: 'unclear',
    solved: false,
    revealed: false,
    reply: copy.rephrase,
  }
}

export function composeTurn(
  puzzle: Puzzle,
  answers: HostAnswers,
  luck: LuckInfo | null = null,
  locale: Locale = 'zh-CN',
) {
  const copy = HOST_COPY[locale]
  const intentAnswer = answers.intent
  const intent = intentAnswer.choice as string
  const intentConfidence = intentAnswer.confidence

  if (intent === 'guess') {
    const solved = answers.solved.noul
    const closeness = answers.guess_closeness.score / 3
    if (solved >= 0.7) {
      return {
        intent,
        verdict: 'solved',
        solved: true,
        revealed: true,
        closeness,
        confidence: solved,
        reply: copy.solved,
      }
    }
    const reply =
      closeness >= 0.66 ? copy.closeHigh : closeness >= 0.33 ? copy.closeMid : copy.closeLow
    return {
      intent,
      verdict: 'partial',
      solved: false,
      revealed: false,
      closeness,
      confidence: closeness,
      reply,
    }
  }

  if (intent === 'meta') {
    return {
      ...handleMeta(answers.meta_request.choice as string, puzzle, luck, locale),
      closeness: null,
      confidence: answers.meta_request.confidence,
    }
  }

  if (intent === 'yes_no_question') {
    const verdict = answers.verdict.choice as string
    const confidence = answers.verdict.confidence
    if (verdict === 'cannot_answer' || confidence < 0.35 || intentConfidence < 0.4) {
      return {
        intent,
        verdict,
        solved: false,
        revealed: false,
        closeness: null,
        confidence,
        reply: copy.rephrase,
      }
    }
    const reply = copy.verdict[verdict] ?? copy.rephrase
    return {
      intent,
      verdict,
      solved: false,
      revealed: false,
      closeness: null,
      confidence,
      reply,
    }
  }

  // 意图没判准、但元请求很明确时（例如「我今日人品怎么样」），照样按元请求回答
  const metaChoice = answers.meta_request.choice as string
  if (META_KINDS.has(metaChoice) && answers.meta_request.confidence >= 0.5) {
    return {
      ...handleMeta(metaChoice, puzzle, luck, locale),
      closeness: null,
      confidence: answers.meta_request.confidence,
    }
  }

  return {
    intent: 'unclear',
    verdict: 'unclear',
    solved: false,
    revealed: false,
    closeness: null,
    confidence: intentConfidence,
    reply: copy.unclear,
  }
}

function buildDebug(answers: HostAnswers) {
  return {
    intent: {
      choice: answers.intent.choice,
      confidence: answers.intent.confidence,
      probabilities: answers.intent.probabilities,
    },
    verdict: {
      choice: answers.verdict.choice,
      confidence: answers.verdict.confidence,
      probabilities: answers.verdict.probabilities,
    },
    solved: answers.solved.noul,
    closeness: {
      score: answers.guess_closeness.score,
      confidence: answers.guess_closeness.confidence,
      probabilities: answers.guess_closeness.probabilities,
    },
    metaRequest: {
      choice: answers.meta_request.choice,
      confidence: answers.meta_request.confidence,
    },
  }
}

function getClient(env: GameEnv) {
  const apiKey = env.TYPESAFE_API_KEY?.trim()
  return new TypeSafeClient(apiKey ? { apiKey } : {})
}

export function health(env: GameEnv) {
  const llm = resolveLlm(env)
  return {
    ok: true,
    typesafeConfigured: Boolean(env.TYPESAFE_API_KEY?.trim()),
    llm: llm ? { provider: llm.label, model: llm.model } : null,
    fallbackPuzzles: BUILTIN_PUZZLES.length,
  }
}

/**
 * Somewhere to keep a puzzle's truth. The Worker backs this with D1, the Vite
 * dev middleware with an in-memory map, so generated answers never travel to
 * the browser.
 */
export interface GenerateProgress {
  stage: 'thinking' | 'writing'
  chars: number
  round: number
}

export interface PuzzleStore {
  create(puzzle: Puzzle, meta: { difficulty: string; createdAt: number }): Promise<string>
  get(id: string): Promise<(Puzzle & { difficulty: string }) | null>
  sweep(olderThan: number): Promise<void>
  /** 最近生成过的汤面（已归一化），用来避免重复出题 */
  recentSurfaces(limit: number): Promise<string[]>
}

const SESSION_RETENTION_MS = 1000 * 60 * 60 * 24 * 90

export async function startGame(
  env: GameEnv,
  store: PuzzleStore,
  body: Record<string, unknown>,
  onProgress?: (progress: GenerateProgress) => void,
) {
  const difficulty =
    typeof body.difficulty === 'string' && body.difficulty.trim() ? body.difficulty.trim() : '中等'
  const theme = typeof body.theme === 'string' ? body.theme : ''
  const genre = readGenre(body.genre)
  const locale = readLocale(body.locale)
  const llm = resolveLlm(env)

  const avoid = await store.recentSurfaces(30)
  let puzzle: GeneratedPuzzle | null = null
  let source: 'llm' | 'builtin' = 'builtin'
  let lastError: unknown = null

  if (llm) {
    // max 档偶尔会因为思维链过长而失败；low, high 更快更稳，失败再上 max
    for (const effort of ['low', 'high', 'max'] as const) {
      try {
        const candidate = await generateWithLlm(
          llm,
          difficulty,
          theme,
          genre,
          effort,
          avoid,
          locale,
          onProgress,
        )
        if (avoid.includes(normaliseSurface(candidate.surface))) {
          throw new Error('和最近出过的题重复了')
        }
        puzzle = candidate
        source = 'llm'
        break
      } catch (error) {
        lastError = error
        console.warn(
          `[turtle-soup] 出题失败（effort=${effort}）：`,
          error instanceof Error ? error.message : error,
        )
      }
    }
  }

  if (!puzzle) {
    // 排查出题失败时把真实错误抛出去（LLM_DEBUG=1）
    if (env.LLM_DEBUG === '1' && lastError) throw lastError
    puzzle = pickBuiltin(difficulty, theme, avoid)
    source = 'builtin'
  }

  await store.sweep(Date.now() - SESSION_RETENTION_MS)
  const sessionId = await store.create(
    {
      title: puzzle.title,
      surface: puzzle.surface,
      truth: puzzle.truth,
      hint: puzzle.hint,
    },
    { difficulty: puzzle.difficulty ?? difficulty, createdAt: Date.now() },
  )

  return {
    sessionId,
    title: puzzle.title,
    surface: puzzle.surface,
    difficulty: puzzle.difficulty ?? difficulty,
    source,
    hostGreeting:
      source === 'builtin' ? HOST_COPY[locale].greetingFallback : HOST_COPY[locale].greeting,
  }
}

export function readPuzzle(value: unknown): Puzzle {
  if (!value || typeof value !== 'object') throw new ApiError(400, '缺少汤面与汤底')
  const puzzle = value as Partial<Puzzle>
  const title = typeof puzzle.title === 'string' ? puzzle.title.trim() : ''
  const surface = typeof puzzle.surface === 'string' ? puzzle.surface.trim() : ''
  const truth = typeof puzzle.truth === 'string' ? puzzle.truth.trim() : ''
  const hint = typeof puzzle.hint === 'string' ? puzzle.hint : ''
  if (!surface || !truth) throw new ApiError(400, '汤面或汤底为空')
  return { title, surface, truth, hint }
}

export async function askHost(env: GameEnv, store: PuzzleStore, body: Record<string, unknown>) {
  const puzzleId = typeof body.puzzleId === 'string' ? body.puzzleId : ''
  const puzzle = puzzleId ? await store.get(puzzleId) : null
  if (!puzzle) throw new ApiError(404, '这一局已经过期了，请重新生成一碗海龟汤')
  return judge(env, puzzle, body)
}

export async function revealGame(store: PuzzleStore, body: Record<string, unknown>) {
  const puzzleId = typeof body.puzzleId === 'string' ? body.puzzleId : ''
  const puzzle = puzzleId ? await store.get(puzzleId) : null
  if (!puzzle) throw new ApiError(404, '这一局已经过期了，请重新生成一碗海龟汤')
  return { title: puzzle.title, truth: puzzle.truth, hint: puzzle.hint }
}

/** Judge a single player message against a puzzle whose truth we already hold. */
export async function judge(env: GameEnv, puzzle: Puzzle, body: Record<string, unknown>) {
  const message = typeof body.message === 'string' ? body.message.trim() : ''
  if (!message) throw new ApiError(400, '请输入内容')
  if (message.length > MAX_MESSAGE_CHARS) throw new ApiError(400, '内容太长了，缩短一点再问吧')

  const history = Array.isArray(body.history) ? body.history : []
  const recentConversation = history
    .slice(-MAX_CONVERSATION)
    .map((turn) => {
      const item = turn as { role?: unknown; text?: unknown }
      return {
        role: item.role === 'host' ? 'host' : 'player',
        text: String(item.text ?? '').slice(0, MAX_MESSAGE_CHARS),
      }
    })
    .filter((turn) => turn.text)

  const state = {
    puzzle: {
      title: puzzle.title,
      surface: puzzle.surface,
      truth: puzzle.truth,
    },
    recent_conversation: recentConversation,
    latest_player_message: message,
  }

  const client = getClient(env)
  const { answers, model } = await client.systemOne({
    state,
    questions: HOST_QUESTIONS,
  })

  const turn = composeTurn(puzzle, answers, readLuck(body.luck), readLocale(body.locale))
  return { ...turn, model, debug: buildDebug(answers) }
}
