import { TypeSafeClient, choice, noul, score } from '@typesafe-ai/sdk'
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
    '完整交代真正发生了什么，逻辑自洽，在现实或合理设定中成立；不要魔法、超自然、鬼怪或"其实只是一场梦"。汤底必须能解释汤面里的每一个反常细节。',
  supernatural:
    '完整交代真正发生了什么，逻辑自洽。允许出现鬼神、怨灵、诅咒、因果报应、民间禁忌、诡物等超自然设定；但超自然的规则必须前后一致，并且关键线索要埋在汤面里，玩家靠是非提问能推出来。不要用"其实是一场梦""一切都是幻觉"收尾，也不要靠血腥和 jump scare 吓人。',
}

const GENRE_STYLE: Record<Genre, string> = {
  realistic: '本格现实向：所有反常都必须有现实的、可解释的成因。',
  supernatural: '怪力乱神：可以有鬼神与因果，但要克制、有规矩，读起来像一则民间怪谈而非血浆片。',
}

function systemPrompt(genre: Genre) {
  return `你是一位顶级海龟汤（情境推理游戏）出题人。海龟汤由两部分组成：汤面是呈现给玩家的一段诡异、简短、只描述现象的情境；汤底是隐藏的完整真相。

请创作一则原创、公平、逻辑自洽的海龟汤，并且只输出一个 JSON 对象。

要求：
1. surface（汤面）：**只写一句话**，不超过 40 个字。这一句必须最能引起遐想——只呈现一个反常的现象、动作或对白，让人看完立刻想问"为什么会这样"。不要解释原因，不要点破真相，不要铺陈背景，不要写成两句话或罗列多个细节。
2. truth（汤底）：${TRUTH_RULE[genre]}
3. 反转：汤底要有一个出人意料、但回溯汤面又完全合理的转折；关键线索必须已经埋在汤面里，玩家可以靠是非提问推理出来（fair play）。
4. hint（提示）：一句话，不直接揭晓答案，但能推动推理方向。
5. difficulty：只能是"简单""中等""困难"之一。
6. tags：2 到 3 个中文短标签。

题材风格：${GENRE_STYLE[genre]}

风格约束：只用简体中文；不要血腥、色情、恐怖jump scare 或违法内容；不要出现"汤面""汤底""答案"等出题术语在正文里。

输出格式（严格 JSON，不要 markdown 代码块）：
{"title": "标题", "surface": "汤面", "truth": "汤底", "hint": "提示", "difficulty": "中等", "tags": ["标签1", "标签2"]}`
}

export function readGenre(value: unknown): Genre {
  return value === 'supernatural' ? 'supernatural' : 'realistic'
}

function buildUserPrompt(difficulty: string, theme: string) {
  const parts = [`请创作一则难度为「${difficulty}」的海龟汤。`]
  if (theme.trim()) parts.push(`主题或背景偏好：${theme.trim()}。`)
  parts.push('记住：只输出 JSON。')
  return parts.join('')
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

async function generateWithLlm(
  cfg: LlmConfig,
  difficulty: string,
  theme: string,
  genre: Genre,
): Promise<GeneratedPuzzle> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 60_000)
  try {
    const response = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        messages: [
          { role: 'system', content: systemPrompt(genre) },
          { role: 'user', content: buildUserPrompt(difficulty, theme) },
        ],
        response_format: { type: 'json_object' },
        temperature: 1.1,
      }),
      signal: controller.signal,
    })
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new Error(`${cfg.label} 返回 ${response.status}: ${detail.slice(0, 300)}`)
    }
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const content = payload.choices?.[0]?.message?.content
    if (!content) throw new Error(`${cfg.label} 没有返回内容`)
    const parsed = PuzzleSchema.safeParse(extractJson(content))
    if (!parsed.success) {
      throw new Error(`模型输出不符合结构: ${parsed.error.message.slice(0, 200)}`)
    }
    return parsed.data
  } finally {
    clearTimeout(timer)
  }
}

export function pickBuiltin(difficulty: string, theme: string): GeneratedPuzzle {
  if (theme.trim()) {
    const hit = BUILTIN_PUZZLES.find(
      (puzzle) => puzzle.tags?.some((tag) => theme.includes(tag)) || theme.includes(puzzle.title),
    )
    if (hit) return hit
  }
  const pool = BUILTIN_PUZZLES.filter((puzzle) => !puzzle.difficulty || puzzle.difficulty === difficulty)
  const list = pool.length ? pool : BUILTIN_PUZZLES
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

function replyLuck(luck: LuckInfo | null) {
  if (!luck) {
    return '主持人翻了翻手边的册子，又合上了：「今日人品得在首页那格日历上看——你刷新一下再来问我。」'
  }
  const mood =
    luck.score >= 85
      ? '今天手气好得反常'
      : luck.score >= 60
        ? '今天还算顺'
        : luck.score >= 35
          ? '今天不好不坏'
          : '今天最好别硬猜'
  return `主持人翻开手边的册子念了一句：「${luck.date}，人品 ${luck.score}，${luck.tier}——${mood}。宜${luck.good}，忌${luck.bad}。」他把册子合上，「信不信随你，汤底我是不会提前给你的。」`
}

const META_KINDS = new Set(['hint', 'full_answer', 'how_to_play', 'jrrp'])

const VERDICT_REPLY: Record<string, string> = {
  yes: '是。',
  no: '不是。',
  partly: '是，也不是。',
  irrelevant: '无关。',
}

const REPHRASE = '这个问题主持人有点拿不准……能换一个更具体的问法吗？'
const HOW_TO_PLAY =
  '玩法：主持人只会回答「是」「不是」「无关」或者「是，也不是」。你可以不断提出能用是 / 否回答的问题，一步步逼近汤底；也可以随时说出你的完整推理，猜对了就通关。'

function handleMeta(kind: string, puzzle: Puzzle, luck: LuckInfo | null) {
  if (kind === 'hint') {
    return {
      intent: 'meta',
      verdict: 'hint',
      solved: false,
      revealed: false,
      reply: `主持人压低声音说了一句提示：「${puzzle.hint}」`,
    }
  }
  if (kind === 'full_answer') {
    return {
      intent: 'meta',
      verdict: 'reveal',
      solved: false,
      revealed: true,
      reply: '好吧，既然你坚持——这就是真相。',
    }
  }
  if (kind === 'how_to_play') {
    return {
      intent: 'meta',
      verdict: 'how_to_play',
      solved: false,
      revealed: false,
      reply: HOW_TO_PLAY,
    }
  }
  if (kind === 'jrrp') {
    return {
      intent: 'meta',
      verdict: 'jrrp',
      solved: false,
      revealed: false,
      reply: replyLuck(luck),
    }
  }
  return {
    intent: 'meta',
    verdict: 'unclear',
    solved: false,
    revealed: false,
    reply: REPHRASE,
  }
}

export function composeTurn(puzzle: Puzzle, answers: HostAnswers, luck: LuckInfo | null = null) {
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
        reply: '……没错，就是这样。你完全还原了真相，这一碗被你喝到底了。',
      }
    }
    const reply =
      closeness >= 0.66
        ? '已经很接近了！核心抓住了，但还差最后一块关键拼图。'
        : closeness >= 0.33
          ? '沾到一点边了，方向可以再往关键的地方想想。'
          : '嗯……这个说法和真相差得有点远，再换条线索想想。'
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
      ...handleMeta(answers.meta_request.choice as string, puzzle, luck),
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
        reply: REPHRASE,
      }
    }
    const reply = VERDICT_REPLY[verdict] ?? REPHRASE
    return { intent, verdict, solved: false, revealed: false, closeness: null, confidence, reply }
  }

  // 意图没判准、但元请求很明确时（例如「我今日人品怎么样」），照样按元请求回答
  const metaChoice = answers.meta_request.choice as string
  if (META_KINDS.has(metaChoice) && answers.meta_request.confidence >= 0.5) {
    return {
      ...handleMeta(metaChoice, puzzle, luck),
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
    reply: '主持人没太听懂。你可以问一个是非题，或者直接说出你的推理。',
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
export interface PuzzleStore {
  create(puzzle: Puzzle, meta: { difficulty: string; createdAt: number }): Promise<string>
  get(id: string): Promise<(Puzzle & { difficulty: string }) | null>
  sweep(olderThan: number): Promise<void>
}

const SESSION_RETENTION_MS = 1000 * 60 * 60 * 24 * 90

export async function startGame(env: GameEnv, store: PuzzleStore, body: Record<string, unknown>) {
  const difficulty =
    typeof body.difficulty === 'string' && body.difficulty.trim() ? body.difficulty.trim() : '中等'
  const theme = typeof body.theme === 'string' ? body.theme : ''
  const genre = readGenre(body.genre)
  const llm = resolveLlm(env)

  let puzzle: GeneratedPuzzle
  let source: 'llm' | 'builtin'
  if (llm) {
    try {
      puzzle = await generateWithLlm(llm, difficulty, theme, genre)
      source = 'llm'
    } catch (error) {
      puzzle = pickBuiltin(difficulty, theme)
      source = 'builtin'
      console.warn(
        '[turtle-soup] 生成失败，回退到内置汤：',
        error instanceof Error ? error.message : error,
      )
    }
  } else {
    puzzle = pickBuiltin(difficulty, theme)
    source = 'builtin'
  }

  await store.sweep(Date.now() - SESSION_RETENTION_MS)
  const sessionId = await store.create(
    { title: puzzle.title, surface: puzzle.surface, truth: puzzle.truth, hint: puzzle.hint },
    { difficulty: puzzle.difficulty ?? difficulty, createdAt: Date.now() },
  )

  return {
    sessionId,
    title: puzzle.title,
    surface: puzzle.surface,
    difficulty: puzzle.difficulty ?? difficulty,
    source,
    hostGreeting: '汤面已经端上来了。开始提问吧，我只会回答「是」「不是」「无关」或者「是，也不是」。',
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

  const turn = composeTurn(puzzle, answers, readLuck(body.luck))
  return { ...turn, model, debug: buildDebug(answers) }
}
