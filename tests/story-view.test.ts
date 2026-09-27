import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PuzzlePanel } from '../src/components/PuzzlePanel'
import { OfficialStory } from '../src/components/OfficialStory'
import { I18nContext, type I18nValue } from '../src/lib/i18n'

const i18n: I18nValue = {
  locale: 'zh-CN',
  setLocale: () => {},
  t: (key) => key,
  formatDate: String,
  formatNumber: String,
}
const fullStory = '故事第一段。\n\n<script>故事第二段</script>'

describe('full-story spoiler display', () => {
  it.each([false, true])(
    'only includes the full story inside a revealed report (revealed=%s)',
    (revealed) => {
      const html = renderToStaticMarkup(
        createElement(
          I18nContext.Provider,
          { value: i18n },
          createElement(PuzzlePanel, {
            session: {
              sessionId: 'daily',
              title: '官汤',
              surface: '汤面',
              source: 'daily',
              difficulty: '中等',
              hostGreeting: '',
            },
            revealed,
            truth: '简短汤底',
            story: fullStory,
            solved: false,
            closeness: null,
            turnCount: 0,
            ledger: [],
            onReveal: () => {},
          }),
        ),
      )
      if (revealed) {
        expect(html).toContain('简短汤底')
        expect(html).toContain('完整故事')
        expect(html).toContain('故事第一段。\n\n&lt;script&gt;故事第二段&lt;/script&gt;')
      } else {
        expect(html).not.toContain('故事第一段')
        expect(html).not.toContain('简短汤底')
      }
      expect(html).not.toContain('<script>')
    },
  )

  it('starts the library disclosure closed with an explicit spoiler label', () => {
    const html = renderToStaticMarkup(
      createElement(
        I18nContext.Provider,
        { value: i18n },
        createElement(OfficialStory, { puzzleId: 'daily' }),
      ),
    )
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('完整背景故事')
    expect(html).toContain('含剧透，点击查看')
    expect(html).not.toContain('正在加载完整故事')
  })
})
