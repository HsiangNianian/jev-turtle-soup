import {
  APIConnectionError,
  APITimeoutError,
  TypeSafeClient,
  choice,
  noul,
  score,
  type EntryType,
} from '@typesafe-ai/sdk'
import OpenAI from 'openai'

import { QQ_GROUP } from './community.ts'
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
  /** 官汤的完整原故事；判读细节时比压缩后的汤底更准确。 */
  story?: string
}

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

export type Locale = 'zh-CN' | 'en' | 'ja'

/** 玩家会在对话里看到的报错，必须跟着界面语言走。 */
const ASK_ERRORS: Record<
  Locale,
  Record<
    | 'missing'
    | 'empty'
    | 'tooLong'
    | 'notFound'
    | 'notPublic'
    | 'locked'
    | 'timeout'
    | 'unavailable',
    string
  >
> = {
  'zh-CN': {
    missing: '这一局已经过期了，请重新生成一碗海龟汤',
    empty: '请输入内容',
    tooLong: '内容太长了，缩短一点再问吧',
    notFound: '这道汤不存在',
    notPublic: '这道汤没有公开',
    locked: '今天的官方汤不能提前揭晓，明天它就会解锁。',
    timeout: '主持人响应超时了，问题已保留，请稍后再问一次。',
    unavailable: '暂时连不上主持人，问题已保留，请稍后再试。',
  },
  en: {
    missing: 'This case has expired — start a new one',
    empty: 'Type something first',
    tooLong: 'That is too long, please shorten it',
    notFound: 'This puzzle does not exist',
    notPublic: 'This puzzle is not public',
    locked: 'Today’s official bowl cannot be unsealed early — it unlocks tomorrow.',
    timeout:
      'The host timed out. Your question is still in the conversation; please try again shortly.',
    unavailable:
      'The host is temporarily unreachable. Your question is still in the conversation; please try again shortly.',
  },
  ja: {
    missing: 'この一件は期限切れです。新しい一杯を作ってください',
    empty: '内容を入力してください',
    tooLong: '長すぎます。もう少し短くしてください',
    notFound: 'このお題は存在しません',
    notPublic: 'このお題は公開されていません',
    locked: '本日の公式の一杯は前もって開封できません。明日になれば解放されます。',
    timeout:
      '司会の応答がタイムアウトしました。質問は会話に残っています。少し待ってからもう一度お試しください。',
    unavailable:
      '司会に接続できません。質問は会話に残っています。少し待ってからもう一度お試しください。',
  },
}

export function askError(locale: Locale, key: keyof (typeof ASK_ERRORS)['zh-CN']): ApiError {
  const status =
    key === 'timeout'
      ? 504
      : key === 'unavailable'
        ? 503
        : key === 'missing' || key === 'notFound'
          ? 404
          : key === 'notPublic' || key === 'locked'
            ? 403
            : 400
  return new ApiError(status, ASK_ERRORS[locale][key])
}

export function readLocale(value: unknown): Locale {
  return value === 'en' || value === 'ja' ? value : 'zh-CN'
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
 * 思考模式总开关。开着单次会慢（low 大约十几到几十秒），换来更稳的判断与出题。
 * 关掉走非思考模式，几秒出题。
 */
const THINKING_ENABLED = true
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
      // 只在真有思维链时才报「已思考 N 字」；关掉思考后这些事件根本不该出现
      if (delta?.reasoning_content) {
        reasoningChars += delta.reasoning_content.length
        if (onProgress && reasoningChars % 200 < 40) {
          onProgress({ stage: 'thinking', chars: reasoningChars })
        }
      }
      if (delta?.content) {
        content += delta.content
        if (onProgress && content.length % 400 < 40) {
          onProgress({ stage: 'writing', chars: content.length })
        }
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

function correctionPrompt(issues: string[], requirements: string, locale: Locale): string {
  const list = issues.map((issue) => `- ${issue}`).join('\n')
  if (locale === 'en') {
    return `Your output failed validation:\n${list}\n\nCorrect each issue using the original requirements below. Return the complete JSON object only. Keep all content in English; preserve only explicitly required enum values.\n${requirements}`
  }
  if (locale === 'ja') {
    return `出力が検証に通りませんでした：\n${list}\n\n以下の元の条件に従って各問題を修正し、完全な JSON オブジェクトだけを出力してください。内容はすべて日本語にし、指定された列挙値だけはそのまま保ってください。\n${requirements}`
  }
  return `你刚才的输出没有通过校验，问题如下：
${list}

请对照下面的原始要求逐条修正，重新输出一份完整的 json（只输出 json，不要任何解释）：
${requirements}`
}

/**
 * 「让模型产出结构化结果 + 校验 + 带着报错回炉」的通用原语。
 * 出题和每日官方汤的每一段流水线都走它，规则一致。
 */
export async function generateJson<T>(
  cfg: LlmConfig,
  options: {
    system: string
    user: string
    effort: Effort
    /** 生成及纠错指令的语言；不传时保持现有中文调用的行为。 */
    locale?: Locale
    /** 把解析出来的值变成「问题列表」；空数组表示通过 */
    check: (value: unknown) => { value?: T; issues: string[] }
    rounds?: number
    onProgress?: (progress: GenerateProgress) => void
  },
): Promise<T> {
  const locale = options.locale ?? 'zh-CN'
  const requirements = `${options.system}\n\n${options.user}`
  const messages: ChatTurn[] = [
    { role: 'system', content: options.system },
    { role: 'user', content: options.user },
  ]
  const rounds = options.rounds ?? MAX_ROUNDS
  let lastIssues: string[] = []

  for (let round = 1; round <= rounds; round += 1) {
    const content = await callChat(cfg, messages, options.effort, (progress) =>
      options.onProgress?.({ ...progress, round }),
    )

    let issues: string[] = []
    let accepted: T | undefined
    try {
      const result = options.check(extractJson(content))
      issues = result.issues
      accepted = result.value
    } catch (error) {
      const prefix = { 'zh-CN': '不是合法的 json', en: 'Invalid JSON', ja: '無効な JSON' }[locale]
      issues = [`${prefix}: ${error instanceof Error ? error.message.slice(0, 160) : prefix}`]
    }

    if (accepted !== undefined && !issues.length) return accepted

    lastIssues = issues
    if (round < rounds) {
      console.warn(`[turtle-soup] 输出校验未通过，回炉第 ${round} 次：`, issues.join('；'))
      messages.push({ role: 'assistant', content })
      messages.push({ role: 'user', content: correctionPrompt(issues, requirements, locale) })
    }
  }

  throw new Error(`模型连续 ${rounds} 次都没给出合格输出：${lastIssues.join('；')}`)
}

const REPLY_LOCALES: Record<string, Locale> = { 'zh-CN': 'zh-CN', en: 'en', ja: 'ja' }

/** 玩家用什么语言提问，主持人就用什么语言回答；认不出或没把握时跟随界面语言。 */
function replyLocaleFor(answers: HostAnswers, uiLocale: Locale): Locale {
  const answer = answers.message_language
  const picked = answer ? REPLY_LOCALES[answer.choice] : undefined
  return picked && answer!.confidence >= 0.6 ? picked : uiLocale
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
        examples: [
          'Was the man blind?',
          'Is the woman a doctor?',
          'Did he die on purpose?',
          '母亲死了',
          'Her mother is still alive.',
        ],
      },
      guess: {
        what: 'The player proposes an explanation, theory, or reconstruction of what happened, usually as a statement, possibly wrapped in a question like "so did he...?".',
        not_for: 'One checkable fact about one event, person, or property, even if phrased as a statement without a question mark; that is yes_no_question.',
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
        'If `latest_player_message` is a yes/no question or a narrow factual claim, what answer follows from `puzzle.canonical_source`?',
      compare: [
        'latest_player_message',
        'puzzle.canonical_source',
        'puzzle.surface',
        'recent_player_messages',
      ],
      focus:
        'puzzle.canonical_source is the only authority for factual events. Use its final reveal and established events, not an earlier character belief or apparent mystery that the source later disproves. Ignore puzzle.solution_summary if it disagrees; do not average the two into partly. Puzzle.surface anchors references but is not proof that its apparent event happened. Use recent_player_messages only to resolve references, never as evidence. First identify the exact person or event the player names; do not transfer a relative\'s fate to that person. If someone speaks or acts in the source\'s present, they are alive at that time. For an exact age or year, calculate the timeline and distinguish an event happening then from having happened earlier. (1) Search the canonical source for the fact. If it is there, even incidentally, answer yes, no or partly — never irrelevant. (2) Choose partly only when two legitimate readings of the player\'s claim are genuinely supported by that source, or the claim bundles true and false facts; a conflict with the nonauthoritative summary is not a partly answer. (3) Choose irrelevant only if the canonical source genuinely says nothing about the fact. (4) If the message is not a yes/no question or narrow factual claim about the story, choose cannot_answer.',
    },
    {
      yes: 'The authoritative source confirms the claim or answers the question YES.',
      no: 'Use only when the authoritative source clearly rules the claim out, so that answering yes would be misleading.',
      partly: {
        what: 'The claim comes out true under one legitimate reading and false under another, so yes or no alone would mislead the player.',
        not_for:
          'Do not use partly when the claim is simply wrong, or when only one reading of the question is actually available in the story.',
        examples: [
          'The story: he worked through the night at the office, fell asleep at his desk, missed the company clock-in cut-off, and only badged in later, after the system had already marked him late. The question: "was he awake at clock-in time?" — asleep at the required clock-in time, awake at the moment he actually badged in, so the honest answer is partly. Both readings of "clock-in time" are real in this story.',
          'The question: "is he both the father and the killer?" when he is the father but not the killer.',
          'The question: "did he do it to pay off a debt?" when he did do it, but for another reason.',
          'The question: "does the body exist?" when there is a body, but not where the player thinks.',
        ],
      },
      irrelevant: {
        what: 'The authoritative source genuinely says nothing about this. The fact the player asks about is neither present nor ruled out anywhere in that source.',
        not_for:
          'Do not choose irrelevant because the detail looks unimportant or only minor, and do not choose it when the authoritative source mentions the fact only in passing. If that source contains the fact at all, answer yes or no.',
        examples: [
          'Not irrelevant — answer yes instead: "was he carrying anything?" when the canonical source says he was holding a bag of rice on the scale.',
          'Not irrelevant — answer yes or no instead: "was it kitchen-related?" when the canonical source says he was on his way to the kitchen to cook.',
          'Genuinely irrelevant: "was it raining that day?" when the canonical source never mentions weather and does not depend on it.',
          'Genuinely irrelevant: "does he have siblings?" when the canonical source never mentions anyone but him and his wife.',
        ],
      },
      cannot_answer: 'The message is not a yes/no question about the story.',
    },
  ),
  motive_correct: noul(
    {
      question:
        "Is the player's stated motive correct according to `puzzle.canonical_source`?",
      compare: ['latest_player_message', 'puzzle.canonical_source', 'puzzle.solution_summary'],
      focus:
        'Judge only the reason or intention behind the events. The canonical source overrides a conflicting solution summary; use the summary only to identify which motive is central. If the player proposed no explanation, answer false.',
    },
    {
      true: 'The why the player gives matches the canonical source.',
      false: 'The motive is missing, wrong, or only tangentially related.',
    },
  ),
  method_correct: noul(
    {
      question:
        "Is the player's account of how it happened correct according to `puzzle.canonical_source`?",
      compare: ['latest_player_message', 'puzzle.canonical_source', 'puzzle.solution_summary'],
      focus:
        'Judge only the mechanics: who did what, in what order, by what means. The canonical source overrides a conflicting solution summary; use the summary only to identify which steps are central. If no explanation was proposed, answer false.',
    },
    {
      true: 'The sequence of events and the means match the canonical source.',
      false: 'The mechanics are missing, wrong, or only partly right.',
    },
  ),
  twist_correct: noul(
    {
      question:
        'Has the player identified the key twist established by `puzzle.canonical_source`?',
      compare: ['latest_player_message', 'puzzle.canonical_source', 'puzzle.solution_summary'],
      focus:
        'Judge only the single surprising fact that makes the surface make sense. The canonical source overrides a conflicting solution summary; use the summary only to locate the intended twist. If no explanation was proposed, answer false.',
    },
    {
      true: 'The player named the key twist established by the canonical source, in any wording.',
      false: 'The key twist is missing or named incorrectly.',
    },
  ),
  solved: noul(
    {
      question:
        'Does `latest_player_message` fully and correctly state the core plot and twist established by `puzzle.canonical_source`?',
      compare: ['latest_player_message', 'puzzle.canonical_source', 'puzzle.solution_summary'],
      focus:
        'The core plot and key twist must both be correct. Use the solution summary to identify what is central, but the canonical source wins on any factual conflict. Different wording is fine.',
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
  message_language: choice(
    {
      question: 'Which language is `latest_player_message` written in?',
      inspect: '`latest_player_message`',
      focus:
        'Judge the language of the message itself, not of the puzzle or the interface. For a message with no words at all, choose unclear.',
    },
    {
      'zh-CN': 'Chinese (simplified or traditional).',
      en: 'English.',
      ja: 'Japanese (including kana or kanji-only sentences).',
      unclear: 'No words to judge, or the language is not one of the above.',
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
      contact:
        'They ask how to give feedback, report a problem, or reach the people behind the game (怎么反馈 / 联系方式 / 有没有群 / 找你们).',
      none: 'The player is not talking about the game itself.',
    },
  ),
}

interface ChoiceAnswer {
  choice: string
  confidence: number
  probabilities: Record<string, number>
}

interface NoulAnswer {
  noul: number
}

interface HostAnswers {
  message_language?: ChoiceAnswer
  intent: ChoiceAnswer
  verdict: ChoiceAnswer
  motive_correct: NoulAnswer
  method_correct: NoulAnswer
  twist_correct: NoulAnswer
  solved: NoulAnswer
  meta_request: ChoiceAnswer
}

/**
 * 今日人品由前端按「站点 + 日期 + 设备码」算出来（服务端没有设备码，重算不了），
 * 所以只把结果里的**号码**带回来：档位用 key、宜忌用槽位下标，
 * 具体用词一律由服务端按回复语言决定——否则中文词会漏进英文或日文的回答里。
 */
export interface LuckInfo {
  date: string
  score: number
  tierKey: string
  goodIndex: number
  badIndex: number
}

function readInt(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0
}

function readLuck(value: unknown): LuckInfo | null {
  if (!value || typeof value !== 'object') return null
  const luck = value as Partial<LuckInfo>
  if (typeof luck.score !== 'number' || typeof luck.tierKey !== 'string') return null
  return {
    date: typeof luck.date === 'string' ? luck.date.slice(0, 10) : '',
    score: Math.max(0, Math.min(100, Math.round(luck.score))),
    tierKey: luck.tierKey.slice(0, 12),
    goodIndex: readInt(luck.goodIndex),
    badIndex: readInt(luck.badIndex),
  }
}

interface HostCopy {
  verdict: Record<string, string>
  dailyLocked: string
  rephrase: string
  howToPlay: string
  hint: (hint: string) => string
  noHint: string
  reveal: string
  solved: string
  closeHigh: string
  closeMid: string
  closeLow: string
  clarifyGuess: string
  /** 玩家陈述的是「一个判断」而不是一套理论时，按判断本身的真假回答 */
  affirm: string
  deny: string
  partlyStatement: string
  irrelevantStatement: string
  unclear: string
  /** 被问到怎么反馈 / 怎么找我们时，把读者群报出去 */
  contact: string
  luckMissing: string
  luck: (luck: LuckInfo) => string
}

/**
 * 今日人品的用词全在这里：档位名、宜、忌各按语言写一份。
 * 前端只回传档位 key 和宜忌的下标，所以这里的数组顺序就是「槽位」，
 * 增删条目不会让旧客户端错位（下标取模兜底）。
 */
interface LuckWords {
  tiers: Record<string, string>
  good: string[]
  bad: string[]
  mood: (score: number) => string
}

const LUCK_WORDS: Record<Locale, LuckWords> = {
  'zh-CN': {
    tiers: { great: '大吉', good: '吉', plain: '中平', minor: '小凶', bad: '凶' },
    good: [
      '追问细节',
      '大胆猜测',
      '换个角度',
      '重读汤面',
      '记录时间线',
      '相信直觉',
      '检查反常之处',
      '先问是不是',
    ],
    bad: [
      '凭空臆断',
      '连问三题',
      '熬夜盘问',
      '忽视细节',
      '轻信第一直觉',
      '半途而废',
      '急着揭晓',
      '自说自话',
    ],
    mood: (score) =>
      score >= 85
        ? '今天手气好得反常'
        : score >= 60
          ? '今天还算顺'
          : score >= 35
            ? '今天不好不坏'
            : '今天最好别硬猜',
  },
  en: {
    tiers: {
      great: 'Great luck',
      good: 'Good',
      plain: 'Middling',
      minor: 'Slightly off',
      bad: 'Bad luck',
    },
    good: [
      'asking for details',
      'guessing boldly',
      'changing your angle',
      're-reading the surface',
      'sketching a timeline',
      'trusting your instinct',
      'inspecting the odd detail',
      'starting with yes/no questions',
    ],
    bad: [
      'jumping to conclusions',
      'asking three things at once',
      'interrogating all night',
      'skipping details',
      'trusting first impressions',
      'giving up halfway',
      'revealing too soon',
      'talking past the host',
    ],
    mood: (score) =>
      score >= 85
        ? 'your instincts are unusually sharp today'
        : score >= 60
          ? 'the day runs your way'
          : score >= 35
            ? 'neither good nor bad'
            : 'better not to guess hard today',
  },
  ja: {
    tiers: { great: '大吉', good: '吉', plain: '中平', minor: '小凶', bad: '凶' },
    good: [
      '細部まで訊くこと',
      '大胆に推理すること',
      '視点を変えること',
      '湯面を読み返すこと',
      '時系列を書き出すこと',
      '直感を信じること',
      '違和感を確かめること',
      'まず可否で訊くこと',
    ],
    bad: [
      '当てずっぽう',
      '三つまとめて訊くこと',
      '夜通し尋問すること',
      '細部を軽視すること',
      '最初の直感に飛びつくこと',
      '途中で投げ出すこと',
      'すぐ開封すること',
      '独りよがり',
    ],
    mood: (score) =>
      score >= 85
        ? '今日は勘が異様に冴えています'
        : score >= 60
          ? '今日はまずまず流れが良い'
          : score >= 35
            ? '良くも悪くもありません'
            : '今日は無理に当てにいかないほうがいい',
  },
}

/** 把「前端算出来的号码」翻成回复语言里的一句话。 */
function luckLine(locale: Locale, luck: LuckInfo): string {
  const words = LUCK_WORDS[locale]
  const tier = words.tiers[luck.tierKey] ?? luck.tierKey
  const mood = words.mood(luck.score)
  const good = words.good[luck.goodIndex % words.good.length]
  const bad = words.bad[luck.badIndex % words.bad.length]
  if (locale === 'en') {
    return `The host reads from a notebook: “${luck.date}, luck ${luck.score}, ${tier} — ${mood}. Good for: ${good}. Bad for: ${bad}.” He shuts it. “Believe it or not, I still will not hand you the truth early.”`
  }
  if (locale === 'ja') {
    return `司会が帳面を読み上げる。「${luck.date}、運勢 ${luck.score}、${tier}——${mood}。向くこと：${good}。避けること：${bad}。」帳面を閉じて、「信じるかは自由ですが、真相は先に渡しませんよ。」`
  }
  return `主持人翻开手边的册子念了一句：「${luck.date}，人品 ${luck.score}，${tier}——${mood}。宜${good}，忌${bad}。」他把册子合上，「信不信随你，汤底我是不会提前给你的。」`
}

const HOST_COPY: Record<Locale, HostCopy> = {
  'zh-CN': {
    verdict: {
      yes: '是。',
      no: '不是。',
      partly: '是，也不是。',
      irrelevant: '无关。',
    },
    dailyLocked: '今天这碗官方汤不能提前揭晓——明天它就会解锁，到时候你随时可以翻看。',
    rephrase: '这个问题主持人有点拿不准……能换一个更具体的问法吗？',
    howToPlay:
      '玩法：主持人只会回答「是」「不是」「无关」或者「是，也不是」。你可以不断提出能用是 / 否回答的问题，一步步逼近汤底；也可以随时说出你的完整推理，猜对了就通关。',
    hint: (hint) => `主持人压低声音说了一句提示：「${hint}」`,
    noHint: '砚摸了摸空口袋：「这碗汤没附提示，我也掏不出来。再问个问题试试？」',
    reveal: '好吧，既然你坚持——这就是真相。',
    solved: '……没错，就是这样。你完全还原了真相，这一碗被你喝到底了。',
    clarifyGuess: '这个说法暂时判不准。能把其中一个事实单独问我吗？',
    closeHigh: '已经很接近了！核心抓住了，但还差最后一块关键拼图。',
    closeMid: '沾到一点边了，方向可以再往关键的地方想想。',
    closeLow: '嗯……这个说法和真相差得有点远，再换条线索想想。',
    affirm: '对，这一点是成立的。',
    deny: '不是这样。',
    partlyStatement: '一半对一半：方向是对的，细节不对。',
    irrelevantStatement: '这和真相没有关系。',
    unclear: '主持人没太听懂。你可以问一个是非题，或者直接说出你的推理。',
    contact: `砚从桌角抽出一张纸条推过来：「有事要找我？编辑部在群里——${QQ_GROUP.name}，群号 ${QQ_GROUP.number}。链接就在下面，点一下就能进。」`,
    luckMissing:
      '主持人翻了翻手边的册子，又合上了：「今日人品得在首页那格日历上看——你刷新一下再来问我。」',
    luck: (luck) => luckLine('zh-CN', luck),
  },
  en: {
    verdict: {
      yes: 'Yes.',
      no: 'No.',
      partly: 'Partly.',
      irrelevant: 'Unrelated.',
    },
    dailyLocked:
      'The daily bowl cannot be unsealed early — it unlocks tomorrow, and then you can read the truth whenever you like.',
    rephrase: 'The host is not quite sure about that one… could you ask it more concretely?',
    howToPlay:
      'How it works: the host only answers yes, no, unrelated, or partly. Keep asking questions that can be answered with yes or no to close in on the truth, or state your full theory — get it right and the case is solved.',
    hint: (hint) => `The host lowers his voice: “${hint}”`,
    noHint:
      'The host checks his empty pockets. “No hints with this bowl, I’m afraid. Mystery is all I’ve got. Try another question?”',
    reveal: 'All right, if you insist — this is what really happened.',
    solved: '…yes, exactly. You have the whole truth; this bowl is finished.',
    clarifyGuess: 'I cannot judge that claim yet. Could you ask about one fact at a time?',
    closeHigh: 'Very close! You have the core of it, but one key piece is still missing.',
    closeMid: 'You are brushing against it — steer toward the crucial detail.',
    closeLow: 'Hmm… that is rather far from the truth. Try another thread.',
    affirm: 'Yes — that much is true.',
    deny: 'No, that is not it.',
    partlyStatement: 'Half right: the direction is right, the detail is not.',
    irrelevantStatement: 'That has nothing to do with it.',
    unclear: 'The host did not quite follow. Ask a yes-or-no question, or state your theory.',
    contact: `The host slides a slip of paper across the desk. “Want to reach us? There is an editorial group — ${QQ_GROUP.name}, number ${QQ_GROUP.number}. The link is below. Fair warning: it is a Chinese-language group.”`,
    luckMissing:
      'The host leafs through a small notebook and closes it. “Today’s luck is on the calendar on the front page — refresh and ask me again.”',
    luck: (luck) => luckLine('en', luck),
  },
  ja: {
    verdict: {
      yes: 'はい。',
      no: 'いいえ。',
      partly: 'どちらでもある。',
      irrelevant: '無関係です。',
    },
    dailyLocked:
      '本日の公式の一杯は前もって開封できません。明日になれば解放され、いつでも真相を読めます。',
    rephrase: 'その質問は司会にも判断しかねるようです……もう少し具体的に訊いてもらえますか。',
    howToPlay:
      '遊びかた：司会が答えるのは「はい」「いいえ」「無関係」「どちらでもある」だけです。はい／いいえで答えられる質問を重ねて真相に近づくか、推理をそのまま述べてください。当たれば解決です。',
    hint: (hint) => `司会が声を落として言った。「${hint}」`,
    noHint:
      '司会が空っぽのポケットを探る。「この一杯、ヒントは付いていないんです。謎ならたっぷりありますけど。もう一問どうぞ。」',
    reveal: 'わかりました、そこまで言うなら——これが真相です。',
    solved: '……そのとおり。あなたは真相を言い当てました。この一杯は飲みきられました。',
    clarifyGuess: 'その推理はまだ判定しきれません。事実を一つずつ質問してもらえますか。',
    closeHigh: 'かなり近い！芯は掴めていますが、あと一枚だけ重要なピースが足りません。',
    closeMid: '少し触れています。核心に寄せていってください。',
    closeLow: 'うーん……それは真相からだいぶ遠いですね。別の糸をたどってみては。',
    affirm: 'はい、その点は事実です。',
    deny: 'いいえ、そうではありません。',
    partlyStatement: '半分正解です。方向は合っていますが、細部が違います。',
    irrelevantStatement: 'それは真相と関係ありません。',
    unclear: '司会にはよく伝わらなかったようです。はい／いいえの質問か、推理を述べてください。',
    contact: `司会が机の端から紙切れを差し出した。「連絡したい？ 編集部のグループがある——${QQ_GROUP.name}、グループ番号 ${QQ_GROUP.number}。リンクは下にあります。ただし中国語のグループです。」`,
    luckMissing:
      '司会は手元の帳面をめくり、閉じた。「今日の運勢はホームの暦にあります。更新してもう一度訊いてください。」',
    luck: (luck) => luckLine('ja', luck),
  },
}

const META_KINDS = new Set(['hint', 'full_answer', 'how_to_play', 'jrrp'])

/**
 * 模型在「不是」和「是，也不是」之间摇摆时倾向后者。
 * 两种误判代价不对等：假「不是」会让玩家丢掉半条正确线索，假「是，也不是」追问一句就澄清了。
 * 阈值写在代码里，方便用 turn_logs 复盘。
 */
const PARTLY_NUDGE_MIN = 0.3
const PARTLY_NUDGE_GAP = 0.3

function nudgeTowardPartly(
  verdict: string,
  probabilities: Record<string, number>,
): { verdict: string; nudged: boolean } {
  if (verdict !== 'yes' && verdict !== 'no') return { verdict, nudged: false }
  const partly = probabilities.partly ?? 0
  const top = probabilities[verdict] ?? 1
  if (partly >= PARTLY_NUDGE_MIN && top - partly <= PARTLY_NUDGE_GAP) {
    return { verdict: 'partly', nudged: true }
  }
  return { verdict, nudged: false }
}

function handleMeta(
  kind: string,
  puzzle: Puzzle,
  luck: LuckInfo | null,
  locale: Locale,
  truthLocked: boolean,
) {
  const copy = HOST_COPY[locale]
  if (kind === 'hint') {
    const hint = puzzle.hint?.trim()
    return {
      intent: 'meta',
      verdict: 'hint',
      solved: false,
      revealed: false,
      reply: hint ? copy.hint(hint) : copy.noHint,
    }
  }
  if (kind === 'full_answer') {
    // 今日官方汤：当天不许提前揭晓
    if (truthLocked) {
      return {
        intent: 'meta',
        verdict: 'locked',
        solved: false,
        revealed: false,
        reply: copy.dailyLocked,
      }
    }
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
  if (kind === 'contact') {
    return {
      intent: 'meta',
      verdict: 'contact',
      solved: false,
      revealed: false,
      reply: copy.contact,
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
  truthLocked = false,
) {
  const copy = HOST_COPY[locale]
  const intentAnswer = answers.intent
  const intent = intentAnswer.choice as string
  const intentConfidence = intentAnswer.confidence

  if (intent === 'guess') {
    const motive = answers.motive_correct.noul
    const method = answers.method_correct.noul
    const twist = answers.twist_correct.noul
    // 接近度由三个维度加权而来（反转权重最高），进度条和文案都用它
    const closeness = Math.min(1, 0.25 * motive + 0.3 * method + 0.45 * twist)
    // 通关判定：整体判断通过，或者三块都咬得很死
    const solved = answers.solved.noul >= 0.7 || (twist >= 0.85 && motive >= 0.7 && method >= 0.5)
    if (solved) {
      return {
        intent,
        verdict: 'solved',
        solved: true,
        revealed: true,
        closeness,
        confidence: answers.solved.noul,
        reply: copy.solved,
      }
    }
    /*
     * 玩家说的可能是「一套理论」，也可能只是「一个判断」（「电子锁时间不对」）。
     * 只看 closeness（由动机/手法/反转三个维度加权）的话，单个判断的维度分天然很低，
     * 于是同一句话会被答成「差得有点远」；而把它加上「是不是」写成问句，
     * 走的是判读那条路，又会答「是」——两条路径口径相反。
     *
     * 所以先看这个判断本身成不成立：判读说得清楚就用判读，说不清楚（含糊的理论）
     * 才退回 closeness 的冷热提示。
     */
    const statedVerdict = answers.verdict.choice as string
    const statedConfidence = answers.verdict.confidence
    if (statedConfidence >= 0.5 && ['yes', 'no', 'partly', 'irrelevant'].includes(statedVerdict)) {
      const reply =
        statedVerdict === 'yes'
          ? copy.affirm
          : statedVerdict === 'no'
            ? copy.deny
            : statedVerdict === 'partly'
              ? copy.partlyStatement
              : copy.irrelevantStatement
      return {
        intent,
        verdict: statedVerdict,
        solved: false,
        revealed: false,
        closeness,
        confidence: statedConfidence,
        reply,
      }
    }

    // A short factual claim can still be misclassified as a theory. When both
    // intent and verdict are uncertain, a coldness score says nothing useful.
    if (intentConfidence < 0.6) {
      return {
        intent,
        verdict: 'cannot_answer',
        solved: false,
        revealed: false,
        closeness: null,
        confidence: Math.min(intentConfidence, statedConfidence),
        reply: copy.clarifyGuess,
      }
    }

    const note =
      closeness >= 0.66 ? copy.closeHigh : closeness >= 0.33 ? copy.closeMid : copy.closeLow
    return {
      intent,
      verdict: 'partial',
      solved: false,
      revealed: false,
      closeness,
      confidence: closeness,
      reply: note,
    }
  }

  if (intent === 'meta') {
    return {
      ...handleMeta(answers.meta_request.choice as string, puzzle, luck, locale, truthLocked),
      closeness: null,
      confidence: answers.meta_request.confidence,
    }
  }

  if (intent === 'yes_no_question') {
    const rawVerdict = answers.verdict.choice as string
    const confidence = answers.verdict.confidence
    if (rawVerdict === 'cannot_answer' || confidence < 0.35 || intentConfidence < 0.4) {
      return {
        intent,
        verdict: 'cannot_answer',
        solved: false,
        revealed: false,
        closeness: null,
        confidence,
        reply: copy.rephrase,
      }
    }
    const { verdict, nudged } = nudgeTowardPartly(rawVerdict, answers.verdict.probabilities)
    const reply = copy.verdict[verdict] ?? copy.rephrase
    return {
      intent,
      verdict,
      solved: false,
      revealed: false,
      closeness: null,
      confidence,
      reply,
      ...(nudged ? { nudgedFrom: rawVerdict } : {}),
    }
  }

  // 意图没判准、但元请求很明确时（例如「我今日人品怎么样」），照样按元请求回答
  const metaChoice = answers.meta_request.choice as string
  if (META_KINDS.has(metaChoice) && answers.meta_request.confidence >= 0.5) {
    return {
      ...handleMeta(metaChoice, puzzle, luck, locale, truthLocked),
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
    partlyNudge: {
      min: PARTLY_NUDGE_MIN,
      gap: PARTLY_NUDGE_GAP,
      partlyProbability: answers.verdict.probabilities?.partly ?? 0,
    },
    solved: answers.solved.noul,
    closeness: {
      score:
        Math.round(
          Math.min(
            1,
            0.25 * answers.motive_correct.noul +
              0.3 * answers.method_correct.noul +
              0.45 * answers.twist_correct.noul,
          ) *
            3 *
            100,
        ) / 100,
      confidence: answers.twist_correct.noul,
      probabilities: {},
    },
    dimensions: {
      motive: answers.motive_correct.noul,
      method: answers.method_correct.noul,
      twist: answers.twist_correct.noul,
    },
    metaRequest: {
      choice: answers.meta_request.choice,
      confidence: answers.meta_request.confidence,
    },
    ...(answers.message_language
      ? {
          messageLanguage: {
            choice: answers.message_language.choice,
            confidence: answers.message_language.confidence,
          },
        }
      : {}),
  }
}

function getClient(env: GameEnv) {
  const apiKey = env.TYPESAFE_API_KEY?.trim()
  return new TypeSafeClient(apiKey ? { apiKey } : {})
}

export interface RerankCandidate {
  id: string
  title: string
  surface: string
  tags: string[]
  author: string
}

/**
 * 检索后重排：拿关键字检索出来的候选，逐个问一个 Noul「这道汤有没有可能就是
 * `query` 在找的那道」，用 0–1 的分数重新排序。
 *
 * 这正是 TypeSafe cookbook 的 rerank 场景：快检索负责「从一堆里捞出候选」，
 * 模型只负责「把候选择出正确的顺序」。所有候选打包在**一次**请求里，问题之间
 * 互不可见、并行判定，所以每次搜索只花一次调用。
 * 没有密钥或判定失败时返回 null，调用方保留原来的关键字顺序。
 */
export async function rerankCandidates(
  env: GameEnv,
  query: string,
  candidates: RerankCandidate[],
): Promise<Map<string, number> | null> {
  if (!env.TYPESAFE_API_KEY?.trim()) return null
  if (candidates.length < 2) return null

  try {
    const state = {
      query,
      candidates: candidates.map((candidate) => ({
        title: candidate.title,
        surface: candidate.surface,
        tags: candidate.tags,
        author: candidate.author,
      })),
    }
    const questions: Record<string, ReturnType<typeof noul>> = {}
    candidates.forEach((_, index) => {
      questions[`c${index}`] = noul(
        {
          question: `Could \`candidates[${index}]\` be the turtle-soup puzzle the searcher is looking for, given \`query\`?`,
          compare: [
            'query',
            `candidates[${index}].title`,
            `candidates[${index}].surface`,
            `candidates[${index}].tags`,
            `candidates[${index}].author`,
          ],
          focus:
            'Judge the topic the searcher is after: would someone read this puzzle and say "yes, this is the kind of thing I searched for"? A shared common word, or a much broader subject, is not a match. The query may name a motif (病因、密室、雨夜), an author, or describe a plot; compare against whichever part of the candidate answers it.',
        },
        {
          true: 'The title, surface, tags or author is what the query describes.',
          false: 'Only a word in common, or a noticeably broader subject.',
        },
      )
    })

    const { answers } = await getClient(env).systemOne({
      state: state as unknown as EntryType,
      questions,
    })
    const scores = new Map<string, number>()
    candidates.forEach((candidate, index) => {
      const answer = (answers as Record<string, { noul?: number } | undefined>)[`c${index}`]
      scores.set(candidate.id, typeof answer?.noul === 'number' ? answer.noul : 0)
    })
    return scores
  } catch (error) {
    console.warn('[turtle-soup] 语义重排失败：', error)
    return null
  }
}

export function health(env: GameEnv) {
  const llm = resolveLlm(env)
  return {
    ok: true,
    typesafeConfigured: Boolean(env.TYPESAFE_API_KEY?.trim()),
    llm: llm ? { provider: llm.label, model: llm.model } : null,
  }
}

/**
 * 题材坐标的锚点：0 → 100 依次是「本格·逻辑推理」到「变格·怪力乱神」。
 * 用 Score 而不是让模型直接吐数字，是为了拿到「有序档位上的加权位置」，
 * 每道题的分数彼此可比，才谈得上按接近度排序。
 */
const GENRE_LEVELS = [
  '纯本格：现实世界，答案完全能靠题面线索推理出来，没有超自然成分。',
  '偏本格：现实题材，但要靠一点冷知识、巧合或时间线错位才说得通。',
  '中间：现实框架，关键落在心理、身份错认或幻觉这类主观成分上。',
  '偏变格：设定离奇（民俗、诅咒、替身、诡物），但规则自洽、仍然可推理。',
  '变格·怪力乱神：明确的鬼神、怨灵或超自然力量在推动故事。',
] as const

/**
 * 给一道汤打一个 0–100 的题材分。只在发布和维护时各跑一次，不进任何请求热路径。
 * 没有 TypeSafe 密钥或判断失败时返回 null，交给调用方退回标签启发式。
 */
export async function scoreGenre(env: GameEnv, puzzle: Puzzle): Promise<number | null> {
  if (!env.TYPESAFE_API_KEY?.trim()) return null
  try {
    const { answers } = await getClient(env).systemOne({
      state: {
        puzzle: { title: puzzle.title, surface: puzzle.surface, truth: puzzle.truth },
      },
      questions: {
        genre: score(
          {
            question:
              'How far does `puzzle` sit from 本格 (orthodox, realistic deduction) toward 变格 (supernatural, weird)?',
            compare: ['puzzle.surface', 'puzzle.truth'],
            focus:
              'Judge only how 变格 the puzzle is, not how good it is. Read the truth — that is what actually explains the surface — and ignore the tags.',
          },
          GENRE_LEVELS,
        ),
      },
    })
    const raw = (answers as unknown as { genre?: { score?: unknown } }).genre?.score
    if (typeof raw !== 'number' || !Number.isFinite(raw)) return null
    const span = GENRE_LEVELS.length - 1
    return Math.max(0, Math.min(100, Math.round((raw / span) * 100)))
  } catch (error) {
    console.warn('[turtle-soup] 题材打分失败：', error)
    return null
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
  create(
    puzzle: Puzzle,
    meta: {
      difficulty: string
      createdAt: number
      visibility?: 'session' | 'daily'
      /** 官汤也要把标签写进 puzzle 行：题库搜索读的就是这一份 */
      tags?: string[]
    },
  ): Promise<string>
  get(id: string): Promise<(Puzzle & { difficulty: string; visibility: string }) | null>
  sweep(olderThan: number): Promise<void>
}

/** 临时对局（自己开的那碗）保留 90 天，由定时维护清理。 */
export const SESSION_RETENTION_MS = 1000 * 60 * 60 * 24 * 90

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

export async function askHost(
  env: GameEnv,
  store: PuzzleStore,
  body: Record<string, unknown>,
  options: { truthLocked?: boolean } = {},
) {
  const puzzleId = typeof body.puzzleId === 'string' ? body.puzzleId : ''
  const puzzle = puzzleId ? await store.get(puzzleId) : null
  if (!puzzle) throw askError(readLocale(body.locale), 'missing')
  return judge(env, puzzle, body, options)
}

export async function revealGame(store: PuzzleStore, body: Record<string, unknown>) {
  const puzzleId = typeof body.puzzleId === 'string' ? body.puzzleId : ''
  const puzzle = puzzleId ? await store.get(puzzleId) : null
  if (!puzzle) throw askError(readLocale(body.locale), 'missing')
  return { title: puzzle.title, truth: puzzle.truth, hint: puzzle.hint }
}

/** Judge a single player message against a puzzle whose truth we already hold. */
export async function judge(
  env: GameEnv,
  puzzle: Puzzle,
  body: Record<string, unknown>,
  options: { truthLocked?: boolean } = {},
) {
  const locale = readLocale(body.locale)
  const message = typeof body.message === 'string' ? body.message.trim() : ''
  if (!message) throw askError(locale, 'empty')
  if (message.length > MAX_MESSAGE_CHARS) throw askError(locale, 'tooLong')

  const history = Array.isArray(body.history) ? body.history : []
  const recentPlayerMessages = history
    .map((turn) => {
      const item = turn as { role?: unknown; text?: unknown }
      return {
        role: item.role === 'player' ? 'player' : 'host',
        text: String(item.text ?? '').slice(0, MAX_MESSAGE_CHARS),
      }
    })
    .filter((turn) => turn.role === 'player' && turn.text)
    .slice(-MAX_CONVERSATION)

  const state = {
    puzzle: {
      title: puzzle.title,
      surface: puzzle.surface,
      // Official bowls use the writer's full story; community bowls use their
      // submitted truth. The model never has to decide which source outranks which.
      canonical_source: puzzle.story?.trim() || puzzle.truth,
      solution_summary: puzzle.truth,
    },
    recent_player_messages: recentPlayerMessages,
    latest_player_message: message,
  }

  const client = getClient(env)
  const { answers, model } = await client
    .systemOne(
      {
        state,
        questions: HOST_QUESTIONS,
      },
      {
        // Slow responses should finish instead of being cancelled at the SDK's 10s default.
        // Two attempts plus at most 1s backoff keep the total wait bounded at about 41s.
        timeout: 20000,
        retry: { maxRetries: 1, backoffMaxMs: 1000, maxRetryAfterMs: 1000 },
      },
    )
    .catch((error: unknown) => {
      if (error instanceof APITimeoutError) throw askError(locale, 'timeout')
      if (error instanceof APIConnectionError) throw askError(locale, 'unavailable')
      throw error
    })

  const replyLocale = replyLocaleFor(answers, locale)
  const turn = composeTurn(
    puzzle,
    answers,
    readLuck(body.luck),
    replyLocale,
    options.truthLocked ?? false,
  )
  return {
    ...turn,
    model,
    // 前端据此渲染判定徽章（可能和界面语言不同）
    replyLocale,
    // 低置信度时实际回答是「无法回答」，明细仍保留模型的原始判读。
    debug: { ...buildDebug(answers), finalVerdict: turn.verdict, finalIntent: turn.intent },
    // 只有「这一次真的揭晓了」才把汤底一起带回去，其余一律不给
    ...(turn.revealed ? { truth: puzzle.truth } : {}),
  }
}
