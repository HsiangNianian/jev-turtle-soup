import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const app =
  process.argv[2] ||
  path.join(
    root,
    'artifacts/mobile/derived-data/Build/Products/Release-iphonesimulator/TurtleSoup.app',
  )
const output = path.join(root, 'artifacts/mobile/smoke')
const bundle = 'games.mmstudio.turtlesoup.development'
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const run = (...args) => {
  const result = spawnSync('xcrun', ['simctl', ...args], { encoding: 'utf8' })
  if (result.error || result.status !== 0)
    throw new Error(result.stderr || 'simctl failed; full Xcode is required')
  return result.stdout.trim()
}
let device
let fixture
try {
  if (process.platform !== 'darwin' || !existsSync(app))
    throw new Error(
      'Build the iOS simulator app first with --env development --api http://127.0.0.1:8787',
    )
  mkdirSync(output, { recursive: true })
  fixture = spawn(process.execPath, [path.join(root, 'scripts/mobile/fixture-api.mjs')], {
    stdio: 'inherit',
  })
  for (let i = 0; i < 20; i++) {
    await delay(250)
    if (fixture.exitCode !== null) throw new Error('Fixture server failed to start')
    if (
      await fetch('http://127.0.0.1:8787/health')
        .then((r) => r.ok)
        .catch(() => false)
    )
      break
  }
  const runtimes = JSON.parse(run('list', 'runtimes', '-j')).runtimes
  const runtime = runtimes
    .filter((r) => r.isAvailable && r.identifier.includes('.iOS-'))
    .sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }))[0]
  if (!runtime) throw new Error('No available iOS simulator runtime')
  device = run(
    'create',
    `TurtleSoup-Smoke-${Date.now()}`,
    'com.apple.CoreSimulator.SimDeviceType.iPhone-17',
    runtime.identifier,
  )
  run('boot', device)
  run('bootstatus', device, '-b')
  run('install', device, app)
  run('launch', device, bundle)
  let loaded = false
  for (let i = 0; i < 45; i++) {
    await delay(1000)
    const state = await fetch('http://127.0.0.1:8787/health').then((r) => r.json())
    if (state.dailyRequests > 0) {
      loaded = true
      break
    }
  }
  await delay(3000)
  run('io', device, 'screenshot', path.join(output, 'ios-today.png'))
  if (!loaded)
    throw new Error(
      'The native app did not request the fixture daily API; inspect screenshot and simulator logs',
    )
  const processes = run('spawn', device, 'launchctl', 'list')
  if (!processes.split('\n').some((line) => /^\d+\s/.test(line) && line.includes(bundle)))
    throw new Error('App process exited after launch')
  writeFileSync(
    path.join(output, 'ios-result.json'),
    JSON.stringify(
      { bundle, runtime: runtime.version, fixtureLoaded: true, processRunning: true },
      null,
      2,
    ),
  )
  console.log(
    'iOS native startup smoke passed: bundled JS rendered and requested fixture API without Metro',
  )
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
} finally {
  if (device) {
    const logs = spawnSync(
      'xcrun',
      [
        'simctl',
        'spawn',
        device,
        'log',
        'show',
        '--last',
        '3m',
        '--predicate',
        'process == "TurtleSoup"',
      ],
      { encoding: 'utf8' },
    )
    writeFileSync(path.join(output, 'ios-app.log'), logs.stdout || logs.stderr || '')
    spawnSync('xcrun', ['simctl', 'shutdown', device])
    spawnSync('xcrun', ['simctl', 'delete', device])
  }
  fixture?.kill('SIGTERM')
}
