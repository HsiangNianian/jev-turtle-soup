import { afterEach, describe, expect, it, vi } from 'vitest'
import { judge } from '../shared/game'
import { buildLedger } from '../src/lib/archive'

const puzzle = {
  title: '怀孕的哥哥',
  surface: '哥哥怀孕了，怀的是妈妈',
  truth: '哥哥吃零食吃撑了，肚子鼓起来。妹妹笑他怀孕了，哥哥生气地回嘴。',
  hint: '',
}

function modelAnswers(verdict: string, confidence = 0.81, intentConfidence = 0.99) {
  return {
    intent: {
      choice: 'yes_no_question',
      confidence: intentConfidence,
      probabilities: { yes_no_question: 1 },
    },
    verdict: { choice: verdict, confidence, probabilities: { [verdict]: 1 } },
    motive_correct: { noul: 0 },
    method_correct: { noul: 0 },
    twist_correct: { noul: 0 },
    solved: { noul: 0 },
    meta_request: { choice: 'none', confidence: 1, probabilities: { none: 1 } },
  }
}

function mockModel(answers: ReturnType<typeof modelAnswers>, extra = {}) {
  const fetch = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ answers: { ...answers, ...extra }, model: 'test' }), {
      headers: { 'content-type': 'application/json' },
    }),
  )
  vi.stubGlobal('fetch', fetch)
  return fetch
}

afterEach(() => vi.unstubAllGlobals())

describe('fresh host judgments', () => {
  it.each([
    ['哥哥活着', '哥哥死了吗？', 'no', 'yes', '是。'],
    ['妈妈死了', '妈妈活着吗？', 'yes', 'no', '不是。'],
    ['哥哥活着', '哥哥活着', 'no', 'yes', '是。'],
    ['哥哥没吃零食吗', '哥哥吃零食吗', 'no', 'no', '不是。'],
  ])(
    'judges %s without copying or inverting an earlier answer',
    async (message, previous, oldVerdict, verdict, reply) => {
      mockModel(modelAnswers(verdict), {
        // Reproduce the erroneous historical match from the reports. Even a stale
        // model response containing these fields must not override the judgment.
        matches_earlier: { choice: 'fact_0', confidence: 0.89 },
        contradicts_earlier: { noul: 0.96 },
      })
      const turn = await judge({ TYPESAFE_API_KEY: 'local-test-only' }, puzzle, {
        message,
        history: [
          { role: 'player', text: previous },
          { role: 'host', text: oldVerdict === 'yes' ? '是。' : '不是。' },
        ],
        // Older clients may still send a ledger; it is no longer authoritative.
        established: [{ question: previous, verdict: oldVerdict }],
      })
      expect(turn).toMatchObject({ verdict, reply, solved: false, revealed: false })
      expect(turn.debug.finalVerdict).toBe(verdict)
    },
  )

  it('sends the source story but does not feed prior host verdicts back into judgment', async () => {
    const fetch = mockModel(modelAnswers('yes'))
    const dailyPuzzle = { ...puzzle, story: '哥哥生前十九岁。妹妹二十六岁时最后一次见到他。' }
    const history = [
      { role: 'player', text: '哥哥死了吗？' },
      { role: 'host', text: '不是。' },
    ]
    await judge({ TYPESAFE_API_KEY: 'local-test-only' }, dailyPuzzle, {
      message: '哥哥活着',
      history,
      established: [{ question: '哥哥死了吗？', verdict: 'no' }],
    })
    const request = JSON.parse(fetch.mock.calls[0][1].body)
    expect(request.state).toEqual({
      puzzle: {
        title: puzzle.title,
        surface: puzzle.surface,
        canonical_source: dailyPuzzle.story,
        solution_summary: puzzle.truth,
      },
      recent_player_messages: [{ role: 'player', text: '哥哥死了吗？' }],
      latest_player_message: '哥哥活着',
    })
    expect(request.questions).not.toHaveProperty('matches_earlier')
    expect(request.questions).not.toHaveProperty('opposite_of')
    expect(request.questions).not.toHaveProperty('contradicts_earlier')
  })

  it('uses the submitted truth as the canonical source when no original story exists', async () => {
    const fetch = mockModel(modelAnswers('yes'))
    await judge({ TYPESAFE_API_KEY: 'local-test-only' }, puzzle, {
      message: '哥哥吃撑了吗？',
    })
    const request = JSON.parse(fetch.mock.calls[0][1].body)
    expect(request.state.puzzle).toMatchObject({
      canonical_source: puzzle.truth,
      solution_summary: puzzle.truth,
    })
  })

  it.each(['yes', 'no', 'partly', 'irrelevant'])(
    'keeps an uncertain %s out of verdict badges and the ledger',
    async (verdict) => {
      mockModel(modelAnswers(verdict, 0.17))
      const turn = await judge({ TYPESAFE_API_KEY: 'local-test-only' }, puzzle, {
        message: '现在母亲死亡了',
      })
      expect(turn).toMatchObject({
        verdict: 'cannot_answer',
        reply: expect.stringContaining('拿不准'),
        debug: { verdict: { choice: verdict }, finalVerdict: 'cannot_answer' },
      })
      expect(
        buildLedger([
          { id: 'question', role: 'player', text: '现在母亲死亡了' },
          { id: 'reply', role: 'host', text: turn.reply, verdict: turn.verdict },
        ]),
      ).toEqual([])
    },
  )

  it('asks for clarification when the intent is uncertain even if the verdict is confident', async () => {
    mockModel(modelAnswers('yes', 0.9, 0.3))
    const turn = await judge({ TYPESAFE_API_KEY: 'local-test-only' }, puzzle, {
      message: '哥哥这样',
    })
    expect(turn).toMatchObject({
      verdict: 'cannot_answer',
      reply: expect.stringContaining('拿不准'),
    })
  })

  it('does not mix an uncertain fact verdict with cold feedback for a supposed theory', async () => {
    mockModel({
      ...modelAnswers('partly', 0.39),
      intent: {
        choice: 'guess',
        confidence: 0.57,
        probabilities: { guess: 0.68, yes_no_question: 0.31, meta: 0, unclear: 0.01 },
      },
      verdict: {
        choice: 'partly',
        confidence: 0.39,
        probabilities: { partly: 0.51, yes: 0.19, no: 0.12, cannot_answer: 0.17, irrelevant: 0.01 },
      },
      motive_correct: { noul: 0.11 },
      method_correct: { noul: 0.09 },
      twist_correct: { noul: 0.15 },
    })
    const turn = await judge({ TYPESAFE_API_KEY: 'local-test-only' }, puzzle, {
      message: '母亲死了',
    })
    expect(turn).toMatchObject({
      verdict: 'cannot_answer',
      closeness: null,
      reply: expect.stringContaining('单独问'),
    })
  })
})
