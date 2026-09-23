import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { composeDaily, type DailyLocale } from '../shared/daily'
import { generateTodayDaily } from '../worker/index'
import { database } from './sqlite'

const fixtures = {
  'zh-CN': {
    title: '旧信',
    story: '她回到母亲留下的房子，发现抽屉里有一封旧信。信上的日期比她出生的日子还早。'.repeat(16),
    key_twist: '这些信其实是母亲写给自己的。',
    tags: ['书信', '亲情'],
    truth: '母亲把这些信写给了自己。她每次旅行都会寄一封回来，假装还有朋友挂念自己。',
    surface: '母亲留下的信，为什么全是她自己的笔迹？',
    hint: '想想写信的人为什么要换一个名字。',
  },
  en: {
    title: 'Signed Rose',
    story:
      'Mira found the letters in a box after her mother died. Each letter carried a different stamp but the handwriting never changed. '.repeat(
        25,
      ),
    key_twist: 'Her mother had written the letters to herself.',
    tags: ['letters', 'family'],
    truth:
      'Her mother wrote the letters to herself. She posted one on each trip, pretending that a friend still remembered her.',
    surface: 'Why did all the letters from her mother’s friend have her mother’s handwriting?',
    hint: 'Consider why the writer needed another name.',
  },
  ja: {
    // A Japanese title/tag can consist entirely of kanji.
    title: '手紙',
    story:
      '母が亡くなった後、娘は家に帰り、引き出しの中に古い手紙を見つけた。消印は違っていたが、筆跡はどれも同じだった。'.repeat(
        12,
      ),
    key_twist: '母は自分自身に手紙を書いていた。',
    tags: ['手紙', '家族'],
    truth:
      '母は自分に手紙を書いていた。旅行のたびに一通ずつ送り、友人がまだ自分を覚えているふりをしていた。',
    surface: '母の友人からの手紙は、なぜすべて母と同じ筆跡だったのか？',
    hint: '差出人が別の名前を使った理由を考えてみよう。',
  },
}

type Messages = { role: string; content: string }[]
let requests: Messages[]
let outputs: unknown[]
let reviewCount: number
let reviewPasses: boolean

function story(locale: DailyLocale) {
  const { title, story, key_twist, tags } = fixtures[locale]
  return { title, story, key_twist, tags, difficulty: '中等' }
}

function condensed(locale: DailyLocale) {
  const { truth, surface, hint } = fixtures[locale]
  return { truth, surface, hint }
}

function compose(locale: DailyLocale, avoid: string[] = []) {
  return composeDaily(
    { LLM_API_KEY: 'local-test-only', TYPESAFE_API_KEY: 'local-test-only' },
    { roll: { locale, genreTarget: 20, tag: '书信' }, avoid },
  )
}

beforeEach(() => {
  requests = []
  outputs = []
  reviewCount = 0
  reviewPasses = true
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(init!.body as string)
      if (body.messages) {
        requests.push(body.messages)
        const next = outputs.shift()
        if (!next) throw new Error('Unexpected generation request')
        const chunk = {
          choices: [{ delta: { content: JSON.stringify(next) }, finish_reason: 'stop' }],
        }
        return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, {
          headers: { 'content-type': 'text/event-stream' },
        })
      }
      reviewCount++
      return new Response(
        JSON.stringify({
          answers: {
            story_coherent: { noul: reviewPasses ? 1 : 0 },
            truth_faithful: { noul: 1 },
            surface_fair: { noul: 1 },
            surface_covered: { noul: 1 },
            policy_ok: { noul: 1 },
            quality: { score: 2, confidence: 1, probabilities: {} },
            genre: { score: 0, confidence: 1, probabilities: {} },
          },
          model: 'test',
        }),
        { headers: { 'content-type': 'application/json' } },
      )
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('daily generation language', () => {
  it.each(['zh-CN', 'en', 'ja'] as const)(
    'accepts a complete %s puzzle with the stored difficulty enum',
    async (locale) => {
      outputs.push(story(locale), condensed(locale))
      const draft = await compose(locale)
      expect(draft).toMatchObject({
        title: fixtures[locale].title,
        story: fixtures[locale].story,
        ...condensed(locale),
        locale,
        difficulty: '中等',
        relaxed: false,
      })
      expect(requests).toHaveLength(2)
    },
  )

  it.each(['en', 'ja'] as const)(
    'regenerates Chinese condensed fields for a %s story',
    async (locale) => {
      outputs.push(story(locale), condensed('zh-CN'), condensed(locale))
      const draft = await compose(locale)
      expect(draft).toMatchObject(condensed(locale))
      expect(requests).toHaveLength(3)
      expect(requests[2].at(-1)?.content).toMatch(/truth/)
      expect(requests[2].at(-1)?.content).toMatch(/surface/)
      expect(requests[2].at(-1)?.content).toMatch(/hint/)
    },
  )

  it.each(['truth', 'surface', 'hint'] as const)(
    'checks %s independently of the other English fields',
    async (field) => {
      outputs.push(
        story('en'),
        { ...condensed('en'), [field]: fixtures['zh-CN'][field] },
        condensed('en'),
      )
      const draft = await compose('en')
      expect(draft[field]).toBe(fixtures.en[field])
      expect(requests).toHaveLength(3)
    },
  )

  it.each(['title', 'story', 'key_twist', 'tags'] as const)(
    'repairs a wrong-language %s before condensation',
    async (field) => {
      // Keep the English prose inside Japanese length limits to isolate the language check.
      const wrong = field === 'story' ? fixtures.en.story.slice(0, 1200) : fixtures.en[field]
      outputs.push({ ...story('ja'), [field]: wrong }, story('ja'), condensed('ja'))
      const draft = await compose('ja')
      expect(draft).toMatchObject({
        title: fixtures.ja.title,
        story: fixtures.ja.story,
        tags: fixtures.ja.tags,
      })
      expect(requests).toHaveLength(3)
      expect(requests[1].at(-1)?.content).toContain(field)
    },
  )

  it('rejects Chinese prose with a token Japanese suffix', async () => {
    outputs.push(
      story('ja'),
      { ...condensed('ja'), hint: fixtures['zh-CN'].hint.repeat(5) + 'です' },
      condensed('ja'),
    )
    expect(await compose('ja')).toMatchObject(condensed('ja'))
    expect(requests).toHaveLength(3)
  })

  it('repairs foreign prose in a Chinese puzzle too', async () => {
    outputs.push(
      story('zh-CN'),
      { ...condensed('zh-CN'), hint: fixtures.en.hint },
      condensed('zh-CN'),
    )
    expect(await compose('zh-CN')).toMatchObject(condensed('zh-CN'))
    expect(requests).toHaveLength(3)
  })

  it('keeps Japanese task and repair instructions in Japanese', async () => {
    outputs.push(story('ja'), condensed('zh-CN'), condensed('ja'))
    await compose('ja', ['Old letters'])
    expect(requests[0][0].content).toContain('「手紙」を題材にしてください')
    expect(requests[0][1].content).toContain('条件に従って完全な物語を書き')
    expect(requests[1][1].content).toContain('すべて日本語の JSON')
    expect(requests[2].at(-1)?.content).toContain('出力が検証に通りませんでした')
    for (const messages of requests) {
      for (const message of messages.filter((item) => item.role !== 'assistant')) {
        expect(message.content).not.toMatch(/请|故事如下|关键反转|题材围绕|上一轮/)
      }
    }
  })

  it('keeps English instructions in English, including length-repair prompts and quality retries', async () => {
    reviewPasses = false
    const oversized = { ...condensed('en'), surface: 'A long surface '.repeat(25) }
    outputs.push(
      story('en'),
      oversized,
      condensed('en'),
      story('en'),
      condensed('en'),
      story('en'),
      condensed('en'),
    )
    expect(await compose('en')).toMatchObject({ relaxed: true })
    for (const messages of requests) {
      for (const message of messages.filter((item) => item.role !== 'assistant')) {
        // These are stable storage enums, not narrative content.
        expect(message.content.replace(/简单|中等|困难/g, '')).not.toMatch(/\p{Script=Han}/u)
      }
    }
  })

  it('retains foreign-language history as reference without adopting its language', async () => {
    outputs.push(story('en'), condensed('en'))
    await compose('en', ['旧信｜中文汤面'])
    const prompt = requests[0].at(-1)!.content
    expect(prompt).toContain('旧信｜中文汤面')
    expect(prompt).toContain('English')
  })

  it('does not publish or review a puzzle when language repair is exhausted', async () => {
    const data = database()
    vi.spyOn(Math, 'random').mockReturnValue(0.4) // Pick English.
    outputs.push(story('en'), condensed('zh-CN'), condensed('zh-CN'), condensed('zh-CN'))
    try {
      await expect(
        generateTodayDaily({
          DB: data.db,
          LLM_API_KEY: 'local-test-only',
          TYPESAFE_API_KEY: 'local-test-only',
        }),
      ).rejects.toThrow()
      expect(reviewCount).toBe(0)
      expect(data.sqlite.prepare('SELECT COUNT(*) AS n FROM dailies').get()).toEqual({ n: 0 })
      expect(data.sqlite.prepare('SELECT COUNT(*) AS n FROM puzzles').get()).toEqual({ n: 0 })
      expect(requests).toHaveLength(4)
    } finally {
      data.sqlite.close()
    }
  })
})
