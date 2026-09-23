// CI only injects temporary signing files. All compilation uses the local npm commands.
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const platform = process.env.TARGET_PLATFORM
const mode = process.env.PACKAGE_MODE
if (!['android', 'ios'].includes(platform) || !['development', 'preview', 'release'].includes(mode))
  throw new Error('Invalid package platform or mode')
const directory = mkdtempSync(path.join(tmpdir(), 'turtle-package-'))
const env = { ...process.env }
function decode(key, filename) {
  const value = process.env[key]
  if (!value) throw new Error(`Missing signing secret: ${key}`)
  const file = path.join(directory, filename)
  writeFileSync(file, Buffer.from(value, 'base64'), { mode: 0o600 })
  return file
}
try {
  if (!env.MOBILE_BUILD_NUMBER)
    throw new Error('Set build_number, or MOBILE_RELEASE_BUILD_NUMBER for a tag build')
  if (!env.EXPO_PUBLIC_API_URL) delete env.EXPO_PUBLIC_API_URL
  if (platform === 'android' && mode !== 'development')
    env.MOBILE_KEYSTORE = decode('MOBILE_KEYSTORE_BASE64', 'signing.keystore')
  if (platform === 'ios') {
    env.IOS_CERTIFICATE_PATH = decode('IOS_CERTIFICATE_BASE64', 'signing.p12')
    env.IOS_PROFILE_PATH = decode('IOS_PROFILE_BASE64', 'signing.mobileprovision')
  }
  const target =
    platform === 'android'
      ? mode === 'development'
        ? 'debug'
        : mode
      : mode === 'development'
        ? 'development'
        : 'device'
  const args = ['run', `mobile:build:${platform}:${target}`]
  if (platform === 'ios' && target === 'device')
    args.push('--', '--export-method', mode === 'release' ? 'app-store' : 'ad-hoc')
  const result = spawnSync('npm', args, { env, stdio: 'inherit' })
  if (result.error) throw result.error
  process.exitCode = result.status ?? 1
} finally {
  rmSync(directory, { recursive: true, force: true })
}
