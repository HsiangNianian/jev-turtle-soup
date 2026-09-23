import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { submitReport } from '../shared/logs'
import { listReports } from '../shared/admin'
import { database } from './sqlite'

let data: ReturnType<typeof database>
beforeEach(() => {
  data = database()
})
afterEach(() => data.sqlite.close())

const input = {
  puzzleId: 'puzzle',
  kind: 'library',
  note: '回答前后矛盾',
  playerKey: 'player',
  locale: 'zh-CN',
}
async function save(snapshot: unknown) {
  const { id } = await submitReport(data.db, { ...input, snapshot })
  const row = data.sqlite.prepare('SELECT snapshot_json FROM reports WHERE id = ?').get(id)!
  return { id, raw: row.snapshot_json as string }
}
function insertLegacy(raw: string | null) {
  data.sqlite
    .prepare('INSERT INTO reports (id, note, snapshot_json, created_at) VALUES (?, ?, ?, ?)')
    .run('legacy', input.note, raw, 1)
}

describe('report snapshots', () => {
  it.each([
    { title: '题目', messages: [{ role: 'player', text: '他活着吗？' }] },
    { commentId: 'comment', body: '被举报的留言', author: { handle: 'reader' } },
  ])('preserves a small snapshot without changing its shape', async (snapshot) => {
    const { raw } = await save(snapshot)
    expect(JSON.parse(raw)).toEqual(snapshot)
    expect((await listReports(data.db))[0]).toMatchObject({ snapshot, snapshotStatus: 'complete' })
  })

  it('stores valid JSON with the latest complete messages when a long game exceeds the limit', async () => {
    const messages = Array.from({ length: 188 }, (_, index) => ({
      role: index % 2 ? 'host' : 'player',
      text: `${index}:引号"和换行\n还有反斜杠\\🦊`,
      debug: { detail: '判读'.repeat(600) },
    }))
    const snapshot = { title: '她记得的那片海', turnCount: 94, messages }
    const original = structuredClone(snapshot)
    const { raw } = await save(snapshot)
    expect(raw.length).toBeLessThanOrEqual(24_000)
    const saved = JSON.parse(raw)
    expect(saved.title).toBe(snapshot.title)
    expect(saved.turnCount).toBe(94)
    expect(saved.messages.length).toBeGreaterThanOrEqual(2)
    expect(saved.messages.at(-1)).toEqual(messages.at(-1))
    expect(saved.messages.map((message: { text: string }) => message.text)).toEqual(
      messages.slice(-saved.messages.length).map((message) => message.text),
    )
    expect(saved.snapshotMeta.omittedMessages).toBe(messages.length - saved.messages.length)
    expect(snapshot).toEqual(original)
    expect((await listReports(data.db))[0]).toMatchObject({
      snapshot: saved,
      snapshotStatus: 'trimmed',
    })
  })

  it('keeps the latest message text when its debug alone exceeds the budget', async () => {
    const { raw } = await save({
      title: '题目',
      messages: [{ role: 'host', text: '不是。', debug: { huge: 'x'.repeat(30_000) } }],
    })
    expect(JSON.parse(raw)).toMatchObject({
      messages: [{ role: 'host', text: '不是。' }],
      snapshotMeta: { omittedMessages: 0, omittedDebugMessages: 1 },
    })
    expect(raw.length).toBeLessThanOrEqual(24_000)
    expect((await listReports(data.db))[0].snapshotStatus).toBe('trimmed')
  })

  it('rejects oversized metadata instead of storing corrupt or empty JSON', async () => {
    await expect(save({ title: 'x'.repeat(30_000), messages: [] })).rejects.toMatchObject({
      status: 400,
    })
    expect(data.sqlite.prepare('SELECT COUNT(*) AS n FROM reports').get()).toEqual({ n: 0 })
  })

  it('recovers only complete fields and messages from a legacy truncated snapshot', async () => {
    const messages = [
      { role: 'player', text: '字面上的 ], { 和 "引号"\\ 不应影响恢复' },
      { role: 'host', text: '是。', debug: { nested: [1, { value: '完整' }] } },
      { role: 'player', text: '这条消息被截断了' },
    ]
    const complete = JSON.stringify({ title: '题目', turnCount: 3, messages })
    const raw = complete.slice(0, complete.indexOf('截断') + 1)
    insertLegacy(raw)
    const report = (await listReports(data.db))[0]
    expect(report).toMatchObject({
      snapshotStatus: 'recovered',
      snapshot: { title: '题目', turnCount: 3, messages: messages.slice(0, 2) },
    })
    expect(data.sqlite.prepare('SELECT snapshot_json FROM reports').get()!.snapshot_json).toBe(raw)
  })

  it.each(['{"title":"unfinished', 'not JSON', '{"messages":[broken,', '{"title":"ok"}junk'])(
    'retains unrecoverable raw content for inspection: %s',
    async (raw) => {
      insertLegacy(raw)
      expect((await listReports(data.db))[0]).toMatchObject({
        snapshot: null,
        snapshotStatus: 'corrupt',
        snapshotRaw: raw,
      })
    },
  )

  it('distinguishes a missing snapshot from a damaged one', async () => {
    insertLegacy(null)
    expect((await listReports(data.db))[0]).toMatchObject({
      snapshot: null,
      snapshotStatus: 'missing',
    })
  })
})
