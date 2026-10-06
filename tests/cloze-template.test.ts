import { describe, expect, it } from 'vitest'
import {
  blankGroups,
  blankableBetween,
  clozeIssues,
  composeDoc,
  editText,
  isBlankable,
  paint,
  parseDoc,
} from '../src/lib/cloze-template'
import { parseCloze } from '../shared/cloze'

describe('cloze document model', () => {
  it('round-trips a marked template', () => {
    const template = '他用[[雨伞]]按下按钮，因为他够不到[[十六层]]的按钮。'
    const doc = parseDoc(template)
    expect(doc.chars.join('')).toBe('他用雨伞按下按钮，因为他够不到十六层的按钮。')
    expect(blankGroups(doc)).toHaveLength(2)
    expect(composeDoc(doc)).toBe(template)
  })

  it('never blanks spaces or punctuation, so a range over them splits into several blanks', () => {
    const doc = parseDoc('the red umbrella, again')
    expect(isBlankable(' ')).toBe(false)
    expect(isBlankable('，')).toBe(false)
    const range = blankableBetween(doc.chars, 4, 15)
    const template = composeDoc({ chars: doc.chars, blanks: paint(doc.blanks, range) })
    expect(template).toBe('the [[red]] [[umbrella]], again')
    expect(() => parseCloze(template)).not.toThrow()
  })

  it('toggles a run: all blank → clear, otherwise blank everything', () => {
    const doc = parseDoc('他用[[雨伞]]按下按钮')
    expect(composeDoc({ ...doc, blanks: paint(doc.blanks, [2, 3]) })).toBe('他用雨伞按下按钮')
    expect(composeDoc({ ...doc, blanks: paint(doc.blanks, [2, 3, 4]) })).toBe(
      '他用[[雨伞按]]下按钮',
    )
    expect(composeDoc({ ...doc, blanks: paint(doc.blanks, [3]) })).toBe('他用[[雨]]伞按下按钮')
  })

  it('keeps blanks attached to their words while the story is edited', () => {
    const doc = parseDoc('他用[[雨伞]]按下按钮。')
    expect(composeDoc(editText(doc, '昨晚他用雨伞按下按钮。'))).toBe('昨晚他用[[雨伞]]按下按钮。')
    expect(composeDoc(editText(doc, '他用雨伞按下按钮。然后离开了。'))).toBe(
      '他用[[雨伞]]按下按钮。然后离开了。',
    )
    // 改到了被挖空的字：没动的那个字仍然是空，改过的字不再算
    expect(composeDoc(editText(doc, '他用雨衣按下按钮。'))).toBe('他用[[雨]]衣按下按钮。')
  })

  it('handles astral characters the way the server counts cells', () => {
    const doc = parseDoc('他用𠮷野家[[𠮷野]]')
    expect(doc.chars).toHaveLength(7)
    expect(composeDoc(doc)).toBe('他用𠮷野家[[𠮷野]]')
  })

  it('reports the same problems the server rejects', () => {
    const cases: [string, string[]][] = [
      ['他用[[雨伞]]按下按钮。', []],
      ['他用[[雨 伞]]按下按钮。', ['spaced']],
      ['他用[[ ]]按下按钮。', ['blank']],
      ['他用[[雨伞]按下按钮。', ['unpaired']],
      ['他用[[雨[[伞]]]]按下按钮。', ['unpaired']],
    ]
    for (const [text, issues] of cases) {
      expect(clozeIssues(text)).toEqual(issues)
      let accepted = true
      try {
        parseCloze(text)
      } catch {
        accepted = false
      }
      expect(accepted).toBe(issues.length === 0)
    }
    expect(clozeIssues('[[雨伞]]', 3)).toEqual(['tooLong'])
  })

  it('always produces templates the server accepts', () => {
    const doc = parseDoc('他用雨伞按下按钮，因为够不到十六层。')
    const all = doc.chars.map((_, index) => index)
    expect(() => parseCloze(composeDoc({ ...doc, blanks: paint(doc.blanks, all) }))).not.toThrow()
  })
})
