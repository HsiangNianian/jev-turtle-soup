import { chromium } from 'playwright'
import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
const fixture = JSON.parse(await readFile('.build/rooms/preview.json', 'utf8'))
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
})
const errors = []
const connections = new WeakMap()
async function user(uid, width) {
  const c = await browser.newContext({
    viewport: { width, height: 844 },
    locale: 'zh-CN',
    serviceWorkers: 'block',
  })
  await c.addCookies([{ name: 'ts_session', value: fixture.cookies[uid], url: fixture.url }])
  await c.addInitScript(() => {
    if (!localStorage.getItem('turtle-soup.locale'))
      localStorage.setItem('turtle-soup.locale', 'zh-CN')
  })
  const p = await c.newPage()
  const sockets = { total: 0, open: new Set() }
  connections.set(p, sockets)
  p.on('websocket', (ws) => {
    sockets.total++
    sockets.open.add(ws)
    ws.on('close', () => sockets.open.delete(ws))
  })
  p.on('pageerror', (e) => errors.push(e.message))
  return p
}
try {
  const a = await user('alice', 390),
    b = await user('bob', 1365)
  await a.goto(fixture.url + '/rooms/new?puzzle=' + fixture.puzzleId)
  await a.getByRole('button', { name: '开一桌，邀请朋友' }).click()
  await a.getByRole('heading', { name: '空着的座位，留给朋友' }).waitFor()
  assert.equal(await a.getByRole('textbox', { name: '桌内讨论' }).count(), 1)
  const timeline = a.getByTestId('room-timeline')
  assert.ok(
    (await timeline.boundingBox()).height > 450,
    'Waiting lobby stays inside a spacious conversation',
  )
  await a.getByRole('button', { name: '查看汤面' }).click()
  await a.getByRole('dialog', { name: '汤面' }).waitFor()
  await a.getByRole('dialog').getByRole('button', { name: '关闭' }).click()
  assert.ok(
    (await timeline.boundingBox()).height > 450,
    'Closing the premise restores the conversation',
  )
  await a.screenshot({ path: '.build/rooms/waiting-mobile.png' })
  const id = new URL(a.url()).pathname.split('/').at(-1)
  const state = await a.evaluate(async (id) => (await fetch('/api/rooms/' + id)).json(), id)
  await b.goto(fixture.url + '/rooms/join?code=' + state.snapshot.inviteCode)
  await b.getByRole('button', { name: '入座', exact: true }).click()
  await b.getByRole('heading', { name: '空着的座位，留给朋友' }).waitFor()
  await a.getByRole('button', { name: '开始同桌' }).click()
  await a.getByRole('button', { name: '问砚', exact: true }).click()
  await a.getByRole('textbox', { name: '向砚提问' }).fill('有人特意把电梯留在这一层吗？')
  await a.getByRole('button', { name: '发送', exact: true }).click()
  await a.getByText('是。', { exact: true }).waitFor()
  await a.getByRole('button', { name: '问答记录', exact: true }).click()
  const ledgerDialog = a.getByRole('dialog', { name: '问答记录' })
  await ledgerDialog.locator('[data-verdict="yes"]').waitFor()
  assert.equal(await ledgerDialog.locator('li').count(), 1)
  assert.ok((await ledgerDialog.textContent()).includes('有人特意把电梯留在这一层吗？'))
  await a.screenshot({ path: '.build/rooms/ledger-mobile.png' })
  await ledgerDialog.getByRole('button', { name: '关闭' }).click()
  await b.locator('[data-room-ledger] [data-verdict="yes"]').waitFor()
  assert.equal(await b.locator('[data-room-ledger] li').count(), 1)
  assert.equal(
    await b.getByRole('textbox').count(),
    2,
    'Desktop has independent question and discussion composers',
  )
  await b
    .getByRole('textbox', { name: '桌内讨论' })
    .fill('我猜是每天同一时间出门的邻居。大家觉得呢？')
  await b.getByRole('button', { name: '发送讨论', exact: true }).click()
  await a.getByText('我猜是每天同一时间出门的邻居。大家觉得呢？', { exact: true }).waitFor()
  assert.equal(
    await a.getByText('是。', { exact: true }).count(),
    1,
    'Questions, answers and discussion share the mobile timeline',
  )
  await a.getByRole('textbox', { name: '向砚提问' }).fill('留下这条提问草稿')
  await a.getByRole('button', { name: '和大家聊', exact: true }).click()
  await a.getByRole('textbox', { name: '桌内讨论' }).fill('先聊两句，问题草稿稍后再发')
  assert.equal(
    await a.getByText('是。', { exact: true }).count(),
    1,
    'Changing send mode never filters the timeline',
  )
  await a.getByRole('button', { name: '发送', exact: true }).click()
  await b.getByText('先聊两句，问题草稿稍后再发', { exact: true }).waitFor()
  await a.screenshot({ path: '.build/rooms/discussion-mobile.png' })
  await a.getByRole('button', { name: '问砚', exact: true }).click()
  assert.equal(await a.getByRole('textbox', { name: '向砚提问' }).inputValue(), '留下这条提问草稿')
  await a.getByRole('textbox', { name: '向砚提问' }).fill('')
  await a.screenshot({ path: '.build/rooms/playing-mobile.png' })
  await b.screenshot({ path: '.build/rooms/playing-desktop.png' })
  // Resizing preserves drafts and changes layout without opening another socket.
  await b.getByRole('textbox', { name: '桌内讨论' }).fill('桌边的草稿')
  await b.setViewportSize({ width: 390, height: 844 })
  await b.getByRole('button', { name: '和大家聊', exact: true }).click()
  assert.equal(await b.getByRole('textbox', { name: '桌内讨论' }).inputValue(), '桌边的草稿')
  await b.setViewportSize({ width: 1365, height: 844 })
  assert.equal(await b.getByRole('textbox', { name: '桌内讨论' }).inputValue(), '桌边的草稿')
  b.once('dialog', (dialog) => dialog.accept())
  await b.getByRole('button', { name: '离开同桌', exact: true }).click()
  await b.getByText('已离开同桌', { exact: true }).waitFor()
  const beforeRefresh = connections.get(b).total
  await a.getByRole('button', { name: '和大家聊', exact: true }).click()
  await a.getByRole('textbox', { name: '桌内讨论' }).fill('离座后按需刷新这条记录')
  await a.getByRole('button', { name: '发送', exact: true }).click()
  await a.getByText('离座后按需刷新这条记录', { exact: true }).waitFor()
  assert.equal(await b.getByText('离座后按需刷新这条记录', { exact: true }).count(), 0)
  await b.getByRole('button', { name: '刷新记录', exact: true }).click()
  await b.getByText('离座后按需刷新这条记录', { exact: true }).waitFor()
  assert.equal(
    connections.get(b).total,
    beforeRefresh,
    'Refreshing an archive never opens a socket',
  )
  assert.equal(connections.get(b).open.size, 0, 'Leaving closes the socket')
  await b.screenshot({ path: '.build/rooms/left-desktop.png' })
  await b.getByRole('button', { name: '再次入座', exact: true }).click()
  await b.getByRole('button', { name: '离开同桌', exact: true }).waitFor()
  await a.getByRole('button', { name: '问砚', exact: true }).click()
  await a.getByRole('button', { name: '提议揭晓', exact: true }).click()
  await b.getByRole('button', { name: '同意揭晓', exact: true }).waitFor()
  await a.screenshot({ path: '.build/rooms/vote-mobile.png' })
  await b.getByRole('button', { name: '同意揭晓', exact: true }).click()
  await a.getByRole('heading', { name: '共同揭晓', exact: true }).waitFor()
  await a.getByText('共同案卷已保存', { exact: true }).waitFor()
  await b.getByText('共同案卷已保存', { exact: true }).waitFor()
  const completedConnections = connections.get(a).total
  await a.reload()
  await a.getByText('共同案卷已保存', { exact: true }).waitFor()
  await a.getByRole('button', { name: '问答记录', exact: true }).click()
  await a.getByRole('dialog').locator('[data-verdict="yes"]').waitFor()
  assert.equal(
    await a.getByRole('dialog').locator('li').count(),
    1,
    'Archive keeps its question ledger',
  )
  await a.getByRole('dialog').getByRole('button', { name: '关闭' }).click()
  assert.equal(
    connections.get(a).total,
    completedConnections,
    'Reopening a completed archive uses HTTP only',
  )
  await a.screenshot({ path: '.build/rooms/report-mobile.png' })
  for (const [width, theme, locale] of [
    [320, 'light', 'en'],
    [390, 'dark', 'zh-CN'],
    [768, 'light', 'ja'],
  ]) {
    await a.setViewportSize({ width, height: 844 })
    await a.evaluate(
      ({ theme, locale }) => {
        localStorage.setItem('turtle-soup.theme', theme)
        localStorage.setItem('turtle-soup.locale', locale)
      },
      { theme, locale },
    )
    await a.reload()
    await a.getByTestId('room-timeline').waitFor()
    await a.waitForFunction(() => !document.querySelector('.animate-spin'))
    await a.screenshot({ path: `.build/rooms/report-${width}-${theme}-${locale}.png` })
    if (await a.evaluate(() => document.documentElement.scrollWidth > innerWidth))
      throw new Error(`Overflow at ${width}/${locale}`)
  }
  await a.setViewportSize({ width: 390, height: 844 })
  await a.evaluate(() => {
    localStorage.setItem('turtle-soup.locale', 'zh-CN')
    localStorage.setItem('turtle-soup.theme', 'dark')
  })
  await a.goto(fixture.url + '/rooms/new?puzzle=' + fixture.longPuzzleId)
  await a.getByRole('button', { name: '开一桌，邀请朋友' }).click()
  await a.getByRole('heading', { name: 'The Woman at the Edge of the Frame' }).waitFor()
  assert.ok(
    (await a.getByTestId('room-timeline').boundingBox()).height > 450,
    'Long English premise never expands the header',
  )
  await a.screenshot({ path: '.build/rooms/long-premise-mobile.png' })
  await a.getByRole('button', { name: '查看汤面' }).click()
  const dialog = a.getByRole('dialog', { name: '汤面' })
  await dialog.waitFor()
  assert.ok(
    await dialog.evaluate((el) => el.scrollHeight > el.clientHeight),
    'Long premise scrolls in its own sheet',
  )
  await dialog.evaluate((el) => {
    el.scrollTop = el.scrollHeight
  })
  await a.keyboard.press('Escape')
  assert.ok(
    await a
      .getByRole('button', { name: '查看汤面' })
      .evaluate((el) => el === document.activeElement),
    'Closing sheet returns focus',
  )
  // Exercise the Safari visual viewport resize path independently of layout viewport size.
  await a.evaluate(() => {
    Object.defineProperty(visualViewport, 'height', { configurable: true, value: 420 })
    visualViewport.dispatchEvent(new Event('resize'))
  })
  const send = await a.getByRole('button', { name: '发送', exact: true }).boundingBox()
  assert.ok(send.y + send.height <= 420, 'Composer stays above the keyboard')
  await a.evaluate(() => {
    delete visualViewport.height
    visualViewport.dispatchEvent(new Event('resize'))
  })
  await a.setViewportSize({ width: 320, height: 568 })
  assert.equal(await a.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  const overflow = await a.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  if (errors.length || overflow) throw new Error(JSON.stringify({ errors, overflow }))
  console.log(JSON.stringify({ roomId: id, errors, overflow, screenshots: 11 }))
} finally {
  await browser.close()
}
