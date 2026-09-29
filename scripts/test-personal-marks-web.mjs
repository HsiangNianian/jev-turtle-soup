// Run against `npm run rooms:preview`; all users and rooms are local fixtures.
import { chromium } from 'playwright'
import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'

const f = JSON.parse(await readFile('.build/rooms/preview.json', 'utf8'))
const browser = await chromium.launch({ headless: true })
const errors = []
const markKey = (owner, kind, id) => `turtle-soup.marks.v1:${JSON.stringify([owner, kind, id])}`
const filter = (root) => root.getByRole('combobox', { name: '筛选我的标记' })
const action = (root, id, name = '有用') =>
  root.locator(`[data-personal-mark="${id}"]`).getByRole('button', { name, exact: true })
const until = async (read, expected) => {
  for (let i = 0; i < 100; i++) {
    if ((await read()) === expected) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  assert.equal(await read(), expected)
}
async function pageFor(uid, width = 1365) {
  const c = await browser.newContext({
    viewport: { width, height: 844 },
    locale: 'zh-CN',
    serviceWorkers: 'block',
  })
  if (uid) await c.addCookies([{ name: 'ts_session', value: f.cookies[uid], url: f.url }])
  await c.addInitScript(() => {
    localStorage.setItem('turtle-soup.locale', 'zh-CN')
    localStorage.setItem('turtle-soup.theme', 'light')
  })
  const p = await c.newPage()
  p.on('pageerror', (e) => errors.push(e.message))
  return p
}
try {
  const solo = await pageFor(null)
  const game = {
    id: 'personal-marks-solo',
    title: '本机标记测试',
    surface: '电梯每天都停在十六层。',
    difficulty: '中等',
    source: 'library',
    libraryId: f.puzzleId,
    hostGreeting: '可以提问了。',
    hint: '',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    revealed: false,
    truth: null,
    solved: false,
    closeness: 0.3,
    turnCount: 3,
    status: 'active',
    messages: [
      { id: 'g', role: 'host', text: '可以提问了。' },
      { id: 'q1', role: 'player', text: '是邻居把电梯留给她的吗？' },
      { id: 'a1', role: 'host', text: '是。', tone: 'verdict', verdict: 'yes' },
      { id: 'q2', role: 'player', text: '她认识这位邻居吗？' },
      { id: 'a2', role: 'host', text: '不是。', tone: 'verdict', verdict: 'no' },
      { id: 'q3', role: 'player', text: '邻居想帮她省下等电梯的时间吗？' },
      { id: 'a3', role: 'host', text: '是。', tone: 'verdict', verdict: 'yes' },
    ],
  }
  await solo.addInitScript((game) => {
    if (!localStorage.getItem('turtle-soup.archive.v2'))
      localStorage.setItem(
        'turtle-soup.archive.v2',
        JSON.stringify({
          version: 2,
          spaces: { guest: { games: [game], pending: [] } },
        }),
      )
  }, game)
  await solo.goto(f.url + '/play')
  const soloMain = solo.locator('main > section').last()
  await action(soloMain, 'q1').click()
  await action(soloMain, 'q2', '暂时无用').click()
  await filter(soloMain).selectOption('useful')
  await soloMain.getByText(game.messages[1].text, { exact: true }).waitFor()
  assert.equal(await soloMain.locator('[data-personal-mark]').count(), 1)
  assert.equal(await soloMain.getByText('是', { exact: true }).count(), 1)
  assert.equal(await soloMain.getByText(game.messages[3].text, { exact: true }).count(), 0)
  assert.equal(
    await solo.locator('main > section').first().locator('li').count(),
    1,
    'Ledger shares the filter',
  )
  await filter(soloMain).selectOption('not-useful')
  await soloMain.getByText(game.messages[3].text, { exact: true }).waitFor()
  await filter(soloMain).selectOption('marked')
  assert.equal(await soloMain.locator('[data-personal-mark]').count(), 2)
  await solo.screenshot({ path: '.build/rooms/marks-solo-desktop.png' })
  await solo.reload()
  await until(() => action(soloMain, 'q1').getAttribute('aria-pressed'), 'true')
  await solo.goto(f.url + '/archive/' + game.id)
  await until(() => action(soloMain, 'q1').getAttribute('aria-pressed'), 'true')
  // Another tab sees changes without a reload; no marks are added to cloud saves.
  const other = await solo.context().newPage()
  await other.goto(f.url + '/archive/' + game.id)
  const otherMain = other.locator('main > section').last()
  await action(otherMain, 'q1', '暂时无用').click()
  await until(() => action(soloMain, 'q1', '暂时无用').getAttribute('aria-pressed'), 'true')
  await other.close()
  await solo.setViewportSize({ width: 390, height: 844 })
  await filter(soloMain).selectOption('marked')
  await solo.screenshot({ path: '.build/rooms/marks-solo-mobile.png' })
  await action(soloMain, 'q1', '暂时无用').click()
  await action(soloMain, 'q2', '暂时无用').click()
  await soloMain.getByText('当前记录中没有符合筛选的问答。', { exact: true }).waitFor()
  await soloMain.getByRole('button', { name: '查看全部记录' }).click()
  assert.equal(await soloMain.locator('[data-personal-mark]').count(), 3)
  assert.equal(
    await solo.evaluate((key) => localStorage.getItem(key), markKey(null, 'solo', game.id)),
    null,
  )
  assert.ok(
    !(await solo.evaluate(() => localStorage.getItem('turtle-soup.archive.v2'))).includes('useful'),
  )
  await solo.evaluate(() => {
    const write = Storage.prototype.setItem
    window.restoreMarksWrite = () => {
      Storage.prototype.setItem = write
    }
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith('turtle-soup.marks.v1:')) throw new Error('QuotaExceededError')
      return write.call(this, key, value)
    }
  })
  await action(soloMain, 'q1').click()
  await soloMain.getByRole('alert').waitFor()
  assert.equal(await action(soloMain, 'q1').getAttribute('aria-pressed'), 'false')
  await solo.evaluate(() => window.restoreMarksWrite())
  await action(soloMain, 'q1').click()
  assert.equal(await action(soloMain, 'q1').getAttribute('aria-pressed'), 'true')
  assert.equal(await soloMain.getByRole('alert').count(), 0)

  const a = await pageFor('alice'),
    b = await pageFor('bob', 390)
  await a.goto(f.url + '/rooms/new?puzzle=' + f.puzzleId)
  await a.getByRole('button', { name: '开一桌，邀请朋友' }).click()
  await a.getByRole('heading', { name: '空着的座位，留给朋友' }).waitFor()
  const roomId = new URL(a.url()).pathname.split('/').at(-1)
  const state = await a.evaluate(async (id) => (await fetch('/api/rooms/' + id)).json(), roomId)
  await b.goto(f.url + '/rooms/join?code=' + state.snapshot.inviteCode)
  await b.getByRole('button', { name: '入座', exact: true }).click()
  await b.getByRole('heading', { name: '空着的座位，留给朋友' }).waitFor()
  await a.getByRole('button', { name: '开始同桌' }).click()
  const main = a.locator('.room-main-column')
  const timeline = a.getByTestId('room-timeline')
  for (const text of ['有人帮她留住电梯吗？', '是同一位邻居吗？']) {
    await a.getByRole('textbox', { name: '向砚提问' }).fill(text)
    await a.getByRole('button', { name: '发送', exact: true }).click()
    await until(
      () => timeline.locator('[data-event-type="answer"]').count(),
      text.startsWith('有人') ? 1 : 2,
    )
  }
  const ids = await timeline
    .locator('[data-event-type="answer"] [data-personal-mark]')
    .evaluateAll((els) => els.map((el) => el.dataset.personalMark))
  const requests = []
  a.on('request', (req) => {
    if (req.method() !== 'GET') requests.push(req.url())
  })
  await action(timeline, ids[0]).click()
  await action(timeline, ids[1], '暂时无用').click()
  await filter(main).selectOption('useful')
  assert.equal(await timeline.locator('[data-event-type="question"]').count(), 1)
  assert.equal(await timeline.locator('[data-event-type="answer"]').count(), 1)
  assert.equal(await a.locator('[data-room-ledger] li').count(), 1)
  assert.equal(
    await action(b.getByTestId('room-timeline'), ids[0]).getAttribute('aria-pressed'),
    'false',
    'Other players do not see my marks',
  )
  await b.getByRole('button', { name: '和大家聊', exact: true }).click()
  await b.getByRole('textbox', { name: '桌内讨论' }).fill('这条讨论不受问答筛选影响')
  await b.getByRole('button', { name: '发送', exact: true }).click()
  await a
    .locator('.room-discussion-column')
    .getByText('这条讨论不受问答筛选影响', { exact: true })
    .waitFor()
  assert.deepEqual(requests, [], 'Marking and filtering make no API writes')
  await a.screenshot({ path: '.build/rooms/marks-room-desktop.png' })
  await a.reload()
  await until(() => action(timeline, ids[0]).getAttribute('aria-pressed'), 'true')
  await a.setViewportSize({ width: 390, height: 844 })
  await filter(main).selectOption('marked')
  await a.screenshot({ path: '.build/rooms/marks-room-mobile.png' })
  await a.getByRole('button', { name: '问答记录', exact: true }).click()
  const sheet = a.getByRole('dialog', { name: '问答记录' })
  assert.equal(await filter(sheet).inputValue(), 'marked')
  await filter(sheet).selectOption('not-useful')
  assert.equal(await sheet.locator('li').count(), 1)
  await sheet.getByRole('button', { name: '关闭' }).click()
  assert.equal(await timeline.locator('[data-event-type="question"]').count(), 1)
  await a.evaluate(() => document.documentElement.classList.add('dark'))
  await a.screenshot({ path: '.build/rooms/marks-room-mobile-dark.png' })
  await a.setViewportSize({ width: 320, height: 640 })
  assert.ok(
    await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    'No narrow-screen horizontal overflow',
  )
  await a.getByRole('textbox', { name: '向砚提问' }).fill('筛选时也能继续提问吗？')
  await a.getByRole('button', { name: '发送', exact: true }).click()
  assert.equal(
    await filter(main).inputValue(),
    'all',
    'New questions restore the full conversation',
  )
  await until(() => timeline.locator('[data-event-type="answer"]').count(), 3)
  // Read-only archives work with incomplete history, without opening a WebSocket.
  const oldQuestion = {
    seq: 1,
    id: 'old-q',
    at: Date.now(),
    type: 'question',
    actorId: 'alice',
    questionId: 'old',
    text: '更早的提问',
  }
  const oldAnswer = {
    seq: 2,
    id: 'old-a',
    at: Date.now(),
    type: 'answer',
    questionId: 'old',
    text: '是。',
    turn: { verdict: 'yes', solved: false },
  }
  const snapshot = { ...state.snapshot, phase: 'abandoned', readOnly: true, eventSeq: 2 }
  await a.route(`**/api/rooms/${roomId}`, (route) =>
    route.fulfill({ json: { snapshot, events: [oldAnswer], hasMore: true } }),
  )
  await a.route(`**/api/rooms/${roomId}/events?before=2`, (route) =>
    route.fulfill({ json: { snapshot, events: [oldQuestion], hasMore: false } }),
  )
  await a.reload()
  await action(timeline, 'old').click()
  await filter(main).selectOption('useful')
  await timeline.getByRole('button', { name: '查看更早的记录' }).click()
  await timeline.getByText('更早的提问', { exact: true }).waitFor()
  assert.equal(await timeline.locator('[data-event-type="question"]').count(), 1)
  assert.equal(await timeline.locator('[data-event-type="answer"]').count(), 1)
  // Same browser, same room, different account: Alice's marks stay private.
  snapshot.meId = 'bob'
  await a.context().addCookies([{ name: 'ts_session', value: f.cookies.bob, url: f.url }])
  await a.reload()
  await until(() => action(timeline, 'old').getAttribute('aria-pressed'), 'false')
  await filter(main).selectOption('marked')
  await timeline.getByText('当前记录中没有符合筛选的问答。', { exact: true }).waitFor()
  assert.deepEqual(errors, [])
  console.log(
    'PASS: solo/live/archive, paired filters, persistence, cross-tab changes, cancel, real WS rooms, private accounts, mobile sheet, pagination, narrow layouts, no API writes.',
  )
} finally {
  await browser.close()
}
