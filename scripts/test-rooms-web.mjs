import { chromium } from 'playwright'
import { readFile } from 'node:fs/promises'
const fixture = JSON.parse(await readFile('.build/rooms/preview.json', 'utf8'))
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
})
const errors = []
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
  p.on('pageerror', (e) => errors.push(e.message))
  return p
}
try {
  const a = await user('alice', 390),
    b = await user('bob', 1365)
  await a.goto(fixture.url + '/rooms/new?puzzle=' + fixture.puzzleId)
  await a.getByRole('button', { name: '开一桌，邀请朋友' }).click()
  await a.getByRole('heading', { name: '空着的座位，留给朋友' }).waitFor()
  await a.screenshot({ path: '.build/rooms/waiting-mobile.png' })
  const id = new URL(a.url()).pathname.split('/').at(-1)
  const state = await a.evaluate(async (id) => (await fetch('/api/rooms/' + id)).json(), id)
  await b.goto(fixture.url + '/rooms/join?code=' + state.snapshot.inviteCode)
  await b.getByRole('button', { name: '入座', exact: true }).click()
  await b.getByRole('heading', { name: '空着的座位，留给朋友' }).waitFor()
  await a.getByRole('button', { name: '开始同桌' }).click()
  await a.getByRole('textbox', { name: '向砚提问' }).fill('有人特意把电梯留在这一层吗？')
  await a.getByRole('button', { name: '发送', exact: true }).click()
  await a.getByText('是。', { exact: true }).waitFor()
  await b.getByRole('tab', { name: '桌内讨论' }).click()
  await b
    .getByRole('textbox', { name: '桌内讨论' })
    .fill('我猜是每天同一时间出门的邻居。大家觉得呢？')
  await b.getByRole('button', { name: '发送', exact: true }).click()
  await a.getByRole('tab', { name: /桌内讨论/ }).click()
  await a.getByText('我猜是每天同一时间出门的邻居。大家觉得呢？', { exact: true }).waitFor()
  await a.screenshot({ path: '.build/rooms/discussion-mobile.png' })
  await a.getByRole('tab', { name: '问砚', exact: true }).click()
  await a.screenshot({ path: '.build/rooms/playing-mobile.png' })
  await b.getByRole('tab', { name: '问砚', exact: true }).click()
  await b.screenshot({ path: '.build/rooms/playing-desktop.png' })
  await a.getByRole('button', { name: '提议揭晓', exact: true }).click()
  await b.getByRole('button', { name: '同意揭晓', exact: true }).waitFor()
  await a.screenshot({ path: '.build/rooms/vote-mobile.png' })
  await b.getByRole('button', { name: '同意揭晓', exact: true }).click()
  await a.getByRole('heading', { name: '共同揭晓', exact: true }).waitFor()
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
    await a.getByRole('tab').first().waitFor()
    await a.waitForFunction(() => !document.querySelector('.animate-spin'))
    await a.screenshot({ path: `.build/rooms/report-${width}-${theme}-${locale}.png` })
    if (await a.evaluate(() => document.documentElement.scrollWidth > innerWidth))
      throw new Error(`Overflow at ${width}/${locale}`)
  }
  const overflow = await a.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  if (errors.length || overflow) throw new Error(JSON.stringify({ errors, overflow }))
  console.log(JSON.stringify({ roomId: id, errors, overflow, screenshots: 9 }))
} finally {
  await browser.close()
}
