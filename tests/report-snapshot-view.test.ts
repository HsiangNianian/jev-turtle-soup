import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { ReportSnapshot } from '../src/components/ReportSnapshot'
import { readReportSnapshot } from '../shared/report-snapshot'

it('shows recovered content and warns that later conversation is missing', () => {
  const report = readReportSnapshot(
    '{"title":"题目","messages":[{"role":"player","text":"完整提问"},{"role":"host","text":"截断',
  )
  const html = renderToStaticMarkup(createElement(ReportSnapshot, report))
  expect(html).toContain('对局快照（部分恢复）')
  expect(html).toContain('完整提问')
  expect(html).toContain('后续对话可能缺失')
  expect(html).toContain('查看损坏快照原文')
})

it('shows damaged raw content as escaped text instead of silently hiding the snapshot', () => {
  const raw = '<script>alert(1)</script>'
  const html = renderToStaticMarkup(createElement(ReportSnapshot, readReportSnapshot(raw)))
  expect(html).toContain('快照已损坏')
  expect(html).toContain('&lt;script&gt;')
  expect(html).not.toContain('<script>')
})

it('explains when no snapshot was stored', () => {
  const html = renderToStaticMarkup(createElement(ReportSnapshot, readReportSnapshot(null)))
  expect(html).toContain('这条反馈没有可用的快照')
})
