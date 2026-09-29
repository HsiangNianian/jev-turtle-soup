// Compact play UI QA against the isolated rooms preview. Never uses production.
import { chromium } from 'playwright'
import { readFile, mkdir } from 'node:fs/promises'
import assert from 'node:assert/strict'
const { url } = JSON.parse(await readFile('.build/rooms/preview.json', 'utf8'))
const out = '.build/play-density'
await mkdir(out, { recursive: true })
const browser = await chromium.launch()
const errors = []
try {
  const page = await browser.newPage({
    viewport: { width: 1365, height: 844 },
    serviceWorkers: 'block',
    locale: 'zh-CN',
  })
  page.on('pageerror', (error) => errors.push(error.message))
  await page.addInitScript(() => {
    localStorage.setItem('turtle-soup.locale', 'zh-CN')
    localStorage.setItem('turtle-soup.theme', 'light')
    const pairs = [
      ['她住在十六层吗？', '是。', 'yes'],
      ['电梯出了故障吗？', '不是。电梯一直正常运行。', 'no'],
      ['有人特意把电梯留在这一层吗？', '是。', 'yes'],
      ['是她认识的人吗？', '是，也不是。她见过那个人，却并不熟悉。', 'partly'],
      ['那天的天气重要吗？', '无关。', 'irrelevant'],
      ['这个人每天比她更早出门吗？', '是。可以留意两个人出门的时间。', 'yes'],
      ['他想让她少等一会儿吗？', '是。', 'yes'],
    ]
    const game = {
      id: 'compact-play-preview',
      title: '八点半的电梯',
      surface: '每天八点半出门，电梯总空停在十六层，门一按就开，像有人提前替她按好了。',
      difficulty: '中等',
      source: 'library',
      libraryId: 'room-preview-puzzle',
      hostGreeting: '可以提问了。',
      hint: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      revealed: false,
      truth: null,
      solved: false,
      closeness: 0.3,
      turnCount: pairs.length,
      status: 'active',
      messages: pairs.flatMap(([q, a, verdict], index) => [
        { id: `q${index + 1}`, role: 'player', text: q },
        { id: `a${index + 1}`, role: 'host', text: a, verdict, tone: 'verdict' },
      ]),
    }
    if (!localStorage.getItem('turtle-soup.archive.v2'))
      localStorage.setItem(
        'turtle-soup.archive.v2',
        JSON.stringify({ version: 2, spaces: { guest: { games: [game], pending: [] } } }),
      )
  })
  await page.goto(url + '/play')
  await page.locator('.play-pair').last().waitFor()
  await page.evaluate(() => document.fonts.ready)
  const ledger = page.locator('[data-play-ledger]')
  const bar = page.locator('.play-transcript-bar')
  await bar
    .getByRole('button')
    .filter({ has: page.locator('[data-verdict="yes"]') })
    .click()
  assert.equal(await page.locator('.play-pair').count(), 4)
  await ledger.locator('button').nth(1).click()
  await page.waitForFunction(() => document.activeElement?.id === 'play-question-q2')
  assert.equal(
    await page.locator('.play-pair').count(),
    7,
    'Ledger jumps restore hidden question groups',
  )
  await page
    .locator('[data-personal-mark="q3"]')
    .getByRole('button', { name: '有用', exact: true })
    .click()
  await page
    .locator('.play-pair')
    .first()
    .evaluate((el) => {
      el.closest('.chat-scroll').scrollTop = 0
      document.activeElement?.blur()
    })
  await page.screenshot({ path: `${out}/web-solo-desktop.png` })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: `${out}/web-solo-mobile.png` })
  const input = page.getByRole('textbox', { name: '向砚提问' })
  const short = (await input.boundingBox()).height
  const longQuestion =
    '她的邻居是不是每天都提早几分钟出门，因为不想让她等电梯，所以按下十六层之后再从楼梯离开？'
  await input.fill(longQuestion)
  assert.ok(
    (await input.boundingBox()).height > short,
    'Long questions expand the compact composer',
  )
  let asks = 0
  page.on('request', (r) => {
    if (r.url().endsWith('/ask')) asks++
  })
  await input.dispatchEvent('keydown', { key: 'Enter', isComposing: true })
  assert.equal(await input.inputValue(), longQuestion, 'IME confirmation must not send a question')
  assert.equal(asks, 0)
  await page.evaluate(() => {
    Object.defineProperty(visualViewport, 'height', { configurable: true, value: 420 })
    visualViewport.dispatchEvent(new Event('resize'))
  })
  const send = await page.getByRole('button', { name: '发送', exact: true }).boundingBox()
  assert.ok(send.y + send.height <= 420, 'Solo composer stays above the mobile keyboard')
  await page.evaluate(() => {
    delete visualViewport.height
    visualViewport.dispatchEvent(new Event('resize'))
  })
  await input.fill('')
  await page.evaluate(() => {
    document.documentElement.classList.add('dark')
    document.activeElement?.blur()
  })
  await page.screenshot({ path: `${out}/web-solo-mobile-dark.png` })
  await page.setViewportSize({ width: 320, height: 568 })
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  assert.deepEqual(errors, [])
  console.log(
    'PASS: paired density, verdict filters, ledger navigation, long input, IME, keyboard viewport, narrow screens, dark mode.',
  )
} finally {
  await browser.close()
}
