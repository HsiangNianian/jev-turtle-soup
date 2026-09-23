import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { fixtureState } from './fixture-client.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const apk =
  process.argv[2] || path.join(root, 'mobile/android/app/build/outputs/apk/release/app-release.apk')
const output = path.join(root, 'artifacts/mobile/smoke')
const bundle = 'games.mmstudio.turtlesoup.development'
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
let serial
let fixture
let reversed = false
function adb(...args) {
  const result = spawnSync('adb', [...(serial ? ['-s', serial] : []), ...args], {
    encoding: 'utf8',
    timeout: 30000,
  })
  if (result.error || result.status !== 0) throw new Error(result.stderr || 'adb failed')
  return result.stdout.trim()
}
function screen() {
  adb('shell', 'uiautomator', 'dump', '/sdcard/turtle-smoke.xml')
  return adb('shell', 'cat', '/sdcard/turtle-smoke.xml')
}
async function until(check, description) {
  console.log(`Android smoke: ${description}`)
  for (let i = 0; i < 30; i++) {
    if (fixture?.exitCode !== null) throw new Error('Fixture server exited during smoke')
    if (await check()) return
    await delay(1000)
  }
  throw new Error(`Timed out: ${description}`)
}
function tap(id) {
  const node = screen()
    .match(/<node\b[^>]*>/g)
    ?.find((entry) => {
      const resource = entry.match(/resource-id="([^"]*)"/)?.[1]
      return resource === id || resource?.endsWith(`:id/${id}`)
    })
  const bounds = node?.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/)
  if (!bounds) throw new Error(`Element not visible: ${id}`)
  const [, x1, y1, x2, y2] = bounds.map(Number)
  adb('shell', 'input', 'tap', String(Math.round((x1 + x2) / 2)), String(Math.round((y1 + y2) / 2)))
}
function screenshot(name) {
  const result = spawnSync('adb', ['-s', serial, 'exec-out', 'screencap', '-p'])
  if (result.status !== 0) throw new Error('Android screenshot failed')
  writeFileSync(path.join(output, name), result.stdout)
}
try {
  if (!existsSync(apk))
    throw new Error('Build mobile:build:android:emulator with --api http://127.0.0.1:8787 first')
  const devices = adb('devices')
    .split('\n')
    .filter((line) => /^emulator-\d+\s+device$/.test(line.trim()))
    .map((line) => line.split(/\s+/)[0])
  serial = process.env.ANDROID_SERIAL || (devices.length === 1 ? devices[0] : undefined)
  if (!serial || !devices.includes(serial))
    throw new Error(
      'Start an Android emulator (set ANDROID_SERIAL if more than one); physical devices are not used by this smoke test',
    )
  mkdirSync(output, { recursive: true })
  fixture = spawn(process.execPath, [path.join(root, 'scripts/mobile/fixture-api.mjs')], {
    stdio: 'inherit',
  })
  await until(async () => {
    if (fixture.exitCode !== null) throw new Error('Fixture server failed to start')
    return fixtureState()
      .then((state) => state.ready)
      .catch(() => false)
  }, 'fixture API ready')
  adb('reverse', 'tcp:8787', 'tcp:8787')
  reversed = true
  adb('install', '-r', apk)
  // This command intentionally resets only this emulator's development app.
  adb('shell', 'pm', 'clear', bundle)
  const launch = () =>
    adb('shell', 'am', 'start', '-W', '-n', `${bundle}/games.mmstudio.turtlesoup.MainActivity`)
  launch()
  await until(
    async () => (await fixtureState()).dailyRequests > 0,
    'bundled JS requests daily fixture',
  )
  await until(() => screen().includes('The Silent Bell'), 'daily puzzle rendered')
  screenshot('android-today.png')
  tap('start-today')
  await until(() => screen().includes('question-input'), 'game composer visible')
  tap('question-input')
  adb('shell', 'input', 'text', 'Was%sthe%sbell%svisible?')
  adb('shell', 'input', 'keyevent', '111')
  tap('send-question')
  await until(async () => (await fixtureState()).askRequests === 1, 'one question submitted')
  await until(() => screen().includes('host-verdict'), 'answer rendered')
  screenshot('android-game.png')
  adb('shell', 'am', 'force-stop', bundle)
  launch()
  await until(() => screen().includes('continue-game'), 'archive recovered after cold restart')
  tap('continue-game')
  await until(
    () => screen().includes('Was the bell visible?') && screen().includes('host-verdict'),
    'question and answer restored from SQLite',
  )
  screenshot('android-recovered.png')
  const pid = adb('shell', 'pidof', bundle)
  if (!pid) throw new Error('Android app process exited')
  const state = await fixtureState()
  if (state.askRequests !== 1) throw new Error('A cold restart unexpectedly resent a question')
  writeFileSync(
    path.join(output, 'android-result.json'),
    JSON.stringify(
      {
        bundle,
        serial,
        fixtureLoaded: true,
        askedOnce: true,
        coldRestartRecovered: true,
        processRunning: true,
      },
      null,
      2,
    ),
  )
  console.log(
    'Android native smoke passed: bundled JS, daily, question/answer, SQLite cold restart without resending',
  )
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
} finally {
  if (serial) {
    try {
      writeFileSync(path.join(output, 'android-final.xml'), screen())
    } catch {
      /* Preserve original failure. */
    }
    const logs = spawnSync('adb', ['-s', serial, 'logcat', '-d', '-t', '1500'], {
      encoding: 'utf8',
    })
    writeFileSync(path.join(output, 'android-app.log'), logs.stdout || logs.stderr || '')
    try {
      screenshot('android-final.png')
    } catch {
      /* Preserve original failure. */
    }
    if (reversed) spawnSync('adb', ['-s', serial, 'reverse', '--remove', 'tcp:8787'])
  }
  fixture?.kill('SIGTERM')
}
