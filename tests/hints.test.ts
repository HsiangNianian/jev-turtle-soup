import { describe, expect, it } from 'vitest'
import { composeTurn, type Locale } from '../shared/game'

const answers: Parameters<typeof composeTurn>[1] = {
  intent: { choice: 'meta', confidence: 1, probabilities: { meta: 1 } },
  meta_request: { choice: 'hint', confidence: 1, probabilities: { hint: 1 } },
  verdict: { choice: 'irrelevant', confidence: 1, probabilities: { irrelevant: 1 } },
  motive_correct: { noul: 0 },
  method_correct: { noul: 0 },
  twist_correct: { noul: 0 },
  solved: { noul: 0 },
}
const puzzle = { title: 'A case', surface: 'A mystery', truth: 'A secret answer', hint: '' }
const locales: [Locale, string][] = [
  ['zh-CN', '这碗汤没附提示'],
  ['en', 'No hints with this bowl'],
  ['ja', 'ヒントは付いていない'],
]

describe.each(locales)('hint replies in %s', (locale, absent) => {
  it.each(['', ' \n\t　 '])(
    'gives a playful reply for blank hint %j without revealing the answer',
    (hint) => {
      const turn = composeTurn({ ...puzzle, hint }, answers, null, locale)
      expect(turn).toMatchObject({
        intent: 'meta',
        verdict: 'hint',
        solved: false,
        revealed: false,
      })
      expect(turn.reply).toContain(absent)
      expect(turn.reply).not.toContain(puzzle.truth)
      expect(turn.reply).not.toMatch(/「\s*」|“\s*”/)
    },
  )
  it('keeps the supplied hint when one is available', () => {
    const turn = composeTurn(
      { ...puzzle, hint: '  Look behind the door.  ' },
      answers,
      null,
      locale,
    )
    expect(turn.reply).toContain('Look behind the door.')
    expect(turn.reply).not.toContain(absent)
  })
})
