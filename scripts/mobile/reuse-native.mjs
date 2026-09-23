// Explicit CI-only smoke reruns. Reuse is rejected if application/build sources changed.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const [platform, runId] = process.argv.slice(2)
if (
  !['ios', 'android'].includes(platform) ||
  !/^\d+$/.test(runId ?? '') ||
  !process.env.GITHUB_REPOSITORY
)
  throw new Error('Use reuse-native.mjs <ios|android> <run-id> in GitHub Actions')
const run = (command, args) => {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8' })
  if (result.error || result.status !== 0) throw new Error(result.stderr || `${command} failed`)
  return result.stdout.trim()
}
const source = JSON.parse(
  run('gh', ['api', `repos/${process.env.GITHUB_REPOSITORY}/actions/runs/${runId}`]),
)
if (
  source.status !== 'completed' ||
  source.path !== '.github/workflows/mobile-checks.yml' ||
  source.head_repository?.full_name !== process.env.GITHUB_REPOSITORY
)
  throw new Error('Reuse requires a completed Mobile checks run from this repository')
const changed = run('git', ['diff', '--name-only', source.head_sha, 'HEAD'])
  .split('\n')
  .filter(Boolean)
const allowed =
  /^(?:docs\/|mobile\/README\.md$|\.github\/workflows\/mobile-checks\.yml$|scripts\/mobile\/(?:smoke-(?:ios|android)|fixture-client|reuse-native)\.mjs$)/
const unsafe = changed.filter((file) => !allowed.test(file))
if (unsafe.length)
  throw new Error(`Application/build inputs changed; compile a fresh package: ${unsafe.join(', ')}`)
const temp = mkdtempSync(path.join(tmpdir(), 'turtle-native-reuse-'))
const output = path.join(root, 'artifacts/mobile')
const files = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? files(path.join(dir, entry.name)) : [path.join(dir, entry.name)],
  )
try {
  const name = `${platform === 'ios' ? 'ios-simulator' : 'android-emulator'}-${source.head_sha}`
  run('gh', ['run', 'download', runId, '--name', name, '--dir', temp])
  const artifact = files(temp).find((file) =>
    file.endsWith(platform === 'ios' ? '.app.zip' : '.apk'),
  )
  if (!artifact) throw new Error('Native build did not produce a reusable application')
  const manifest = JSON.parse(readFileSync(`${artifact}.json`, 'utf8'))
  const digest = createHash('sha256').update(readFileSync(artifact)).digest('hex')
  if (
    manifest.commit !== source.head_sha ||
    manifest.environment !== 'development' ||
    manifest.api !== process.env.EXPO_PUBLIC_API_URL ||
    manifest.mode !== (platform === 'ios' ? 'simulator' : 'emulator') ||
    manifest.sha256 !== digest
  )
    throw new Error('Artifact provenance, environment or checksum does not match the smoke build')
  mkdirSync(output, { recursive: true })
  for (const suffix of ['', '.json', '.sha256'])
    copyFileSync(`${artifact}${suffix}`, path.join(output, path.basename(artifact) + suffix))
  if (platform === 'ios') {
    const products = path.join(output, 'derived-data/Build/Products/Release-iphonesimulator')
    mkdirSync(products, { recursive: true })
    run('ditto', ['-x', '-k', artifact, products])
  } else {
    const apkDir = path.join(root, 'mobile/android/app/build/outputs/apk/release')
    mkdirSync(apkDir, { recursive: true })
    copyFileSync(artifact, path.join(apkDir, 'app-release.apk'))
  }
  writeFileSync(
    path.join(output, `reused-${platform}.json`),
    JSON.stringify(
      {
        sourceRun: runId,
        sourceCommit: source.head_sha,
        smokeCommit: run('git', ['rev-parse', 'HEAD']),
        changed,
        sha256: digest,
      },
      null,
      2,
    ),
  )
  console.log(
    `Reusing verified ${platform} package from ${source.head_sha}; application sources unchanged`,
  )
} finally {
  rmSync(temp, { recursive: true, force: true })
}
