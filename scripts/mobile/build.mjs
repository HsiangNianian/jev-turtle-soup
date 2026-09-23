import { spawnSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import {
  existsSync,
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
import { parseArgs } from 'node:util'
import { configureNative } from './native-config.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const app = path.join(root, 'mobile')
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    env: { type: 'string' },
    api: { type: 'string' },
    'build-number': { type: 'string' },
    output: { type: 'string' },
    'export-method': { type: 'string' },
    bootstrap: { type: 'boolean' },
    help: { type: 'boolean' },
  },
})
const [platform, mode] = positionals
const allowed = {
  android: ['run', 'debug', 'preview', 'release'],
  ios: ['run', 'simulator', 'development', 'device'],
  native: ['sync'],
}
if (values.help) {
  console.log(
    'mobile build <android|ios|native> <mode> [--env development|preview|production] [--api URL] [--build-number N] [--output DIR] [--export-method ad-hoc|app-store] [--bootstrap]',
  )
  console.log(
    'Android signing: MOBILE_KEYSTORE, MOBILE_KEYSTORE_PASSWORD, MOBILE_KEY_ALIAS, MOBILE_KEY_PASSWORD. iOS: IOS_CERTIFICATE_PATH, IOS_CERTIFICATE_PASSWORD, IOS_PROFILE_PATH. No GitHub-specific variables required.',
  )
  process.exit(0)
}
const fail = (message) => {
  throw new Error(message)
}
const environment =
  values.env ??
  process.env.MOBILE_ENV ??
  (mode === 'release'
    ? 'production'
    : ['run', 'debug', 'development', 'sync'].includes(mode)
      ? 'development'
      : 'preview')
const buildNumber = values['build-number'] ?? process.env.MOBILE_BUILD_NUMBER ?? '1'
const api =
  values.api ??
  process.env.EXPO_PUBLIC_API_URL ??
  (environment === 'production' ? 'https://hgt.mmstudio.games' : '')
const output = path.resolve(
  values.output ?? process.env.MOBILE_OUTPUT_DIR ?? path.join(root, 'artifacts/mobile'),
)
const pkg = JSON.parse(readFileSync(path.join(app, 'package.json')))
const env = {
  ...process.env,
  MOBILE_ENV: environment,
  MOBILE_BUILD_NUMBER: buildNumber,
  EXPO_PUBLIC_API_URL: api,
  EXPO_PUBLIC_APP_ENV: environment,
  EXPO_PUBLIC_BUILD_NUMBER: buildNumber,
  EXPO_NO_TELEMETRY: '1',
}
const cleanup = []
function run(command, args = [], { cwd = root, capture = false, extraEnv = {} } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env: { ...env, ...extraEnv },
    encoding: 'utf8',
    stdio: capture ? 'pipe' : 'inherit',
  })
  if (result.error || result.status !== 0)
    fail(
      `${command} failed${result.error ? `: ${result.error.message}` : ` (exit ${result.status})`}${capture ? `\n${result.stderr ?? ''}` : ''}`,
    )
  return result.stdout?.trim() ?? ''
}
function need(command, args, instruction) {
  const r = spawnSync(command, args, { stdio: 'ignore', env })
  if (r.error || r.status !== 0) fail(instruction)
}
function required(name) {
  const value = process.env[name]
  if (!value) fail(`Missing ${name}. See mobile/README.md for signing configuration.`)
  return value
}
function secretFile(name) {
  const value = path.resolve(required(name))
  if (!existsSync(value)) fail(`${name} does not point to an existing file`)
  return value
}
function manifest(artifact, signing, details = {}) {
  const buffer = readFileSync(artifact)
  const record = {
    version: pkg.version,
    buildNumber,
    commit: run('git', ['rev-parse', 'HEAD'], { capture: true }),
    environment,
    api,
    platform,
    mode,
    signing,
    artifact: path.basename(artifact),
    sha256: createHash('sha256').update(buffer).digest('hex'),
    node: process.version,
    ...details,
  }
  writeFileSync(`${artifact}.json`, JSON.stringify(record, null, 2) + '\n')
  writeFileSync(`${artifact}.sha256`, `${record.sha256}  ${record.artifact}\n`)
  console.log(`Artifact: ${artifact}`)
}

async function main() {
  if (!allowed[platform]?.includes(mode)) fail('Unknown platform/mode. Use --help.')
  if (!['development', 'preview', 'production'].includes(environment)) fail('Invalid --env')
  if (mode === 'run' && environment !== 'development')
    fail(
      'Interactive Expo run commands use the development identity; use a build command for preview/production.',
    )
  if (!/^[1-9]\d{0,8}$/.test(buildNumber))
    fail('Build number must be a positive integer (maximum 9 digits)')
  if (mode !== 'sync') {
    if (!api)
      fail(
        'Set EXPO_PUBLIC_API_URL or --api. Non-production builds never silently connect to production.',
      )
    const origin = new URL(api)
    if (origin.origin !== api || !['http:', 'https:'].includes(origin.protocol))
      fail('API URL must be an HTTP(S) origin without a path/trailing slash')
    if (environment !== 'development' && origin.protocol !== 'https:')
      fail('Preview/production requires HTTPS. Use development for local fixture builds.')
  }
  mkdirSync(output, { recursive: true })
  if (platform === 'native') {
    run('npm', ['exec', '--', 'expo', 'prebuild', '--no-install'], { cwd: app })
    configureNative()
    return
  }
  const bundleId = `games.mmstudio.turtlesoup${environment === 'production' ? '' : `.${environment}`}`
  const name = `turtle-soup-${pkg.version}-${buildNumber}-${environment}-${platform}`
  if (platform === 'android') {
    need(
      'java',
      ['-version'],
      'Install the pinned JDK (see mobile/toolchain.json) and set JAVA_HOME.',
    )
    if (
      !process.env.ANDROID_HOME &&
      !process.env.ANDROID_SDK_ROOT &&
      !existsSync(path.join(app, 'android/local.properties'))
    )
      fail(
        'Install Android SDK and set ANDROID_HOME, or configure mobile/android/local.properties.',
      )
    if (!existsSync(path.join(app, 'android/gradlew')))
      fail('Native project missing. Run npm run mobile:native:sync first.')
    if (
      ['run', 'debug'].includes(mode) &&
      !existsSync(path.join(app, 'android/app/debug.keystore'))
    ) {
      run('keytool', [
        '-genkeypair',
        '-keystore',
        path.join(app, 'android/app/debug.keystore'),
        '-alias',
        'androiddebugkey',
        '-storepass',
        'android',
        '-keypass',
        'android',
        '-keyalg',
        'RSA',
        '-keysize',
        '2048',
        '-validity',
        '10000',
        '-storetype',
        'JKS',
        '-dname',
        'CN=Android Debug,O=Android,C=US',
      ])
    }
    if (mode === 'run') {
      run('npm', ['exec', '--', 'expo', 'run:android', '--app-id', bundleId], { cwd: app })
      return
    }
    const signed = mode !== 'debug'
    if (signed) {
      env.MOBILE_KEYSTORE = secretFile('MOBILE_KEYSTORE')
      for (const key of ['MOBILE_KEYSTORE_PASSWORD', 'MOBILE_KEY_ALIAS', 'MOBILE_KEY_PASSWORD'])
        required(key)
    }
    env.MOBILE_APP_VERSION = pkg.version
    const task =
      mode === 'release'
        ? ':app:bundleRelease'
        : signed
          ? ':app:assembleRelease'
          : ':app:assembleDebug'
    run(
      process.platform === 'win32' ? 'gradlew.bat' : './gradlew',
      [task, '--no-daemon', '--console=plain'],
      { cwd: path.join(app, 'android') },
    )
    const extension = mode === 'release' ? 'aab' : 'apk'
    const subdir = mode === 'release' ? 'bundle/release' : `apk/${signed ? 'release' : 'debug'}`
    const artifactDir = path.join(app, 'android/app/build/outputs', subdir)
    const artifactName = readdirSync(artifactDir).find(
      (f) => f.endsWith(`.${extension}`) && !f.includes('unsigned'),
    )
    if (!artifactName) fail(`Missing ${extension} output`)
    const artifact = path.join(output, `${name}.${extension}`)
    const { copyFileSync } = await import('node:fs')
    copyFileSync(path.join(artifactDir, artifactName), artifact)
    if (extension === 'aab') run('jarsigner', ['-verify', artifact])
    else {
      const localProperties = path.join(app, 'android/local.properties')
      const localSdk = existsSync(localProperties)
        ? readFileSync(localProperties, 'utf8')
            .match(/^sdk\.dir=(.+)$/m)?.[1]
            .trim()
            .replace(/\\([\\:])/g, '$1')
        : undefined
      const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT ?? localSdk
      if (!sdk) fail('Set ANDROID_HOME to verify APK signatures')
      const versions = readdirSync(path.join(sdk, 'build-tools')).sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true }),
      )
      run(path.join(sdk, 'build-tools', versions.at(-1), 'apksigner'), [
        'verify',
        '--verbose',
        artifact,
      ])
    }
    manifest(artifact, signed ? 'configured-key' : 'debug', {
      java: run('java', ['--version'], { capture: true }),
    })
    return
  }
  if (process.platform !== 'darwin')
    fail('iOS builds require macOS with Xcode (local Mac or GitHub macOS runner).')
  if (['device', 'development'].includes(mode)) {
    secretFile('IOS_CERTIFICATE_PATH')
    secretFile('IOS_PROFILE_PATH')
    required('IOS_CERTIFICATE_PASSWORD')
    if (mode === 'device' && !['ad-hoc', 'app-store'].includes(values['export-method']))
      fail('iOS device requires --export-method ad-hoc or app-store')
  }
  need(
    'xcodebuild',
    ['-version'],
    'Install full Xcode and select it with xcode-select. Command Line Tools alone cannot build iOS apps.',
  )
  need(
    'bundle',
    ['--version'],
    'Install Ruby/Bundler versions from mobile/toolchain.json and run bundle install in mobile/.',
  )
  run('bundle', ['exec', 'pod', 'install', ...(values.bootstrap ? [] : ['--deployment'])], {
    cwd: path.join(app, 'ios'),
  })
  if (mode === 'run') {
    run('npm', ['exec', '--', 'expo', 'run:ios'], { cwd: app })
    return
  }
  const workspace = readdirSync(path.join(app, 'ios')).find((f) => f.endsWith('.xcworkspace'))
  if (!workspace) fail('Missing iOS workspace; run mobile:native:sync and pod install.')
  const info = JSON.parse(
    run('xcodebuild', ['-list', '-json', '-workspace', workspace], {
      cwd: path.join(app, 'ios'),
      capture: true,
    }),
  )
  const scheme =
    info.workspace.schemes.find((s) => s === 'TurtleSoup') ??
    info.workspace.schemes.find((s) => !s.startsWith('Pods-'))
  if (!scheme) fail('Missing shared application scheme')
  const base = [
    '-workspace',
    path.join(app, 'ios', workspace),
    '-scheme',
    scheme,
    '-configuration',
    mode === 'development' ? 'Debug' : 'Release',
    `PRODUCT_BUNDLE_IDENTIFIER=${bundleId}`,
    `CURRENT_PROJECT_VERSION=${buildNumber}`,
    `MARKETING_VERSION=${pkg.version}`,
    `MOBILE_APP_NAME=${environment === 'production' ? '海龟汤调查局' : '海龟汤 · 开发'}`,
    `MOBILE_APP_SCHEME=${environment === 'production' ? 'turtlesoup' : `turtlesoup-${environment}`}`,
  ]
  if (mode === 'simulator') {
    const derived = path.join(output, 'derived-data')
    run('xcodebuild', [
      ...base,
      '-sdk',
      'iphonesimulator',
      '-destination',
      'generic/platform=iOS Simulator',
      '-derivedDataPath',
      derived,
      'CODE_SIGNING_ALLOWED=NO',
      'build',
    ])
    const products = path.join(derived, 'Build/Products/Release-iphonesimulator')
    const product = readdirSync(products).find((f) => f.endsWith('.app'))
    if (!product) fail('Missing simulator .app')
    const artifact = path.join(output, `${name}-simulator.app.zip`)
    run('ditto', [
      '-c',
      '-k',
      '--sequesterRsrc',
      '--keepParent',
      path.join(products, product),
      artifact,
    ])
    manifest(artifact, 'simulator-unsigned', {
      xcode: run('xcodebuild', ['-version'], { capture: true }),
    })
    return
  }
  const method =
    mode === 'development'
      ? 'debugging'
      : values['export-method'] === 'ad-hoc'
        ? 'release-testing'
        : values['export-method'] === 'app-store'
          ? 'app-store-connect'
          : fail('iOS device requires --export-method ad-hoc or app-store')
  const certificate = secretFile('IOS_CERTIFICATE_PATH')
  const profile = secretFile('IOS_PROFILE_PATH')
  const password = required('IOS_CERTIFICATE_PASSWORD')
  const signing = mkdtempSync(path.join(tmpdir(), 'turtle-sign-'))
  cleanup.push(() => rmSync(signing, { recursive: true, force: true }))
  const profilePlist = path.join(signing, 'profile.plist')
  writeFileSync(profilePlist, run('security', ['cms', '-D', '-i', profile], { capture: true }))
  const field = (key) =>
    run('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, profilePlist], { capture: true })
  const team = field('TeamIdentifier:0')
  const profileId = field('UUID')
  if (field('Entitlements:application-identifier') !== `${team}.${bundleId}`)
    fail(`Provisioning profile does not match ${bundleId}`)
  const keychain = path.join(signing, 'signing.keychain-db')
  const keychainPassword = randomBytes(24).toString('hex')
  const prior = run('security', ['list-keychains', '-d', 'user'], { capture: true })
    .split('\n')
    .map((s) => s.trim().replace(/^"|"$/g, ''))
    .filter(Boolean)
  run('security', ['create-keychain', '-p', keychainPassword, keychain])
  cleanup.push(() => {
    spawnSync('security', ['list-keychains', '-d', 'user', '-s', ...prior])
    spawnSync('security', ['delete-keychain', keychain])
  })
  run('security', ['set-keychain-settings', '-lut', '21600', keychain])
  run('security', ['unlock-keychain', '-p', keychainPassword, keychain])
  run('security', [
    'import',
    certificate,
    '-P',
    password,
    '-k',
    keychain,
    '-T',
    '/usr/bin/codesign',
  ])
  run('security', [
    'set-key-partition-list',
    '-S',
    'apple-tool:,apple:,codesign:',
    '-s',
    '-k',
    keychainPassword,
    keychain,
  ])
  run('security', ['list-keychains', '-d', 'user', '-s', keychain, ...prior])
  const { homedir } = await import('node:os')
  const profiles = path.join(homedir(), 'Library/Developer/Xcode/UserData/Provisioning Profiles')
  mkdirSync(profiles, { recursive: true })
  const targetProfile = path.join(profiles, `${profileId}.mobileprovision`)
  const priorProfile = existsSync(targetProfile) ? readFileSync(targetProfile) : null
  writeFileSync(targetProfile, readFileSync(profile))
  cleanup.push(() =>
    priorProfile
      ? writeFileSync(targetProfile, priorProfile)
      : rmSync(targetProfile, { force: true }),
  )
  const archive = path.join(output, `${name}.xcarchive`)
  const identity = mode === 'development' ? 'Apple Development' : 'Apple Distribution'
  run('xcodebuild', [
    ...base,
    '-destination',
    'generic/platform=iOS',
    '-archivePath',
    archive,
    `DEVELOPMENT_TEAM=${team}`,
    'CODE_SIGN_STYLE=Manual',
    `CODE_SIGN_IDENTITY=${identity}`,
    `PROVISIONING_PROFILE_SPECIFIER=${profileId}`,
    'archive',
  ])
  const exportOptions = path.join(signing, 'ExportOptions.plist')
  writeFileSync(
    exportOptions,
    `<?xml version="1.0"?><plist version="1.0"><dict><key>method</key><string>${method}</string><key>teamID</key><string>${team}</string><key>signingStyle</key><string>manual</string><key>provisioningProfiles</key><dict><key>${bundleId}</key><string>${profileId}</string></dict></dict></plist>`,
  )
  const exported = path.join(output, 'exported')
  run('xcodebuild', [
    '-exportArchive',
    '-archivePath',
    archive,
    '-exportOptionsPlist',
    exportOptions,
    '-exportPath',
    exported,
  ])
  const ipa = readdirSync(exported).find((f) => f.endsWith('.ipa'))
  if (!ipa) fail('Missing signed IPA')
  const artifact = path.join(output, `${name}.ipa`)
  const { copyFileSync } = await import('node:fs')
  copyFileSync(path.join(exported, ipa), artifact)
  const apps = path.join(archive, 'Products/Applications')
  run('codesign', [
    '--verify',
    '--deep',
    '--strict',
    path.join(
      apps,
      readdirSync(apps).find((f) => f.endsWith('.app')),
    ),
  ])
  manifest(artifact, method, { xcode: run('xcodebuild', ['-version'], { capture: true }) })
}

try {
  await main()
} catch (error) {
  console.error(`Mobile build: ${error.message}`)
  process.exitCode = 1
} finally {
  for (const fn of cleanup.reverse()) {
    try {
      fn()
    } catch {
      /* Preserve original build result. */
    }
  }
}
