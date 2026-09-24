import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = fileURLToPath(new URL('..', import.meta.url))
const project = path.join(root, 'ios/TurtleSoup.xcodeproj')
const derivedData = path.join(root, '.build/ios')
const args = process.argv.slice(2)
const command = args.shift()
const options = {}

function run(executable, arguments_) {
  const result = spawnSync(executable, arguments_, { cwd: root, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

function capture(executable, arguments_) {
  return execFileSync(executable, arguments_, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  })
}

function help() {
  console.log(`Usage: node scripts/ios.mjs <open|doctor|test|build|install> [options]

  open       Open the Xcode project
  doctor     Show Xcode, signing identities, and connected devices
  test       Check native API contracts, daily metadata, and archive isolation
  build      Compile an unsigned iPhone app without an Apple account
  install    Sign, install, and launch on a connected iPhone

Options for install:
  --team ID          Personal Team ID (or IOS_DEVELOPMENT_TEAM / local xcconfig)
  --device ID|NAME   iPhone UDID or name; auto-selects if exactly one is available
  --bundle-id ID     Override the app ID if the default is already registered

Personal Team setup: ios/README.md`)
}

try {
  while (args.length) {
    const flag = args.shift()
    if (
      !['--team', '--device', '--bundle-id'].includes(flag) ||
      !args[0] ||
      args[0].startsWith('--')
    ) {
      throw new Error(`Unknown or incomplete option: ${flag}`)
    }
    options[flag.slice(2)] = args.shift()
  }
  if (!command || command === 'help' || command === '--help') {
    help()
    process.exit(0)
  }
  if (!['open', 'doctor', 'test', 'build', 'install'].includes(command)) {
    throw new Error(`Unknown command: ${command}`)
  }
  if (process.platform !== 'darwin') throw new Error('The iOS tools require macOS and Xcode.')
  if (command === 'open') {
    run('open', [project])
  } else if (command === 'doctor') {
    run('xcodebuild', ['-version'])
    run('security', ['find-identity', '-v', '-p', 'codesigning'])
    run('xcrun', ['devicectl', 'list', 'devices'])
  } else if (command === 'test') {
    mkdirSync(path.join(root, '.build'), { recursive: true })
    const checks = path.join(root, '.build/native-contract-checks')
    run('xcrun', [
      'swiftc',
      'ios/TurtleSoup/NativeModels.swift',
      'ios/TurtleSoup/CommunityModels.swift',
      'ios/TurtleSoup/CommunityStore.swift',
      'ios/TurtleSoup/SoupStore.swift',
      'ios/TurtleSoup/CaseArchive.swift',
      'ios/TurtleSoup/SoupAPI.swift',
      'ios/Tests/NativeContractChecks.swift',
      '-o',
      checks,
    ])
    run(checks, [])
  } else {
    const buildArgs = [
      '-project',
      project,
      command === 'install' ? '-scheme' : '-target',
      'TurtleSoup',
      '-configuration',
      'Debug',
      '-sdk',
      'iphoneos',
      ...(command === 'build' ? ['-arch', 'arm64'] : []),
      `SYMROOT=${path.join(derivedData, 'Build/Products')}`,
      `OBJROOT=${path.join(derivedData, 'Build/Intermediates.noindex')}`,
    ]
    if (options['bundle-id']) {
      if (!/^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(options['bundle-id'])) {
        throw new Error('Invalid --bundle-id; use a reverse-DNS identifier.')
      }
      buildArgs.push(`PRODUCT_BUNDLE_IDENTIFIER=${options['bundle-id']}`)
    }
    if (command === 'build') {
      run('xcodebuild', [...buildArgs, 'CODE_SIGNING_ALLOWED=NO', 'build'])
      console.log(
        `Unsigned app: ${path.join(derivedData, 'Build/Products/Debug-iphoneos/TurtleSoup.app')}`,
      )
    } else {
      const devices = JSON.parse(capture('xcrun', ['xcdevice', 'list', '--timeout', '5'])).filter(
        (device) =>
          !device.simulator &&
          device.platform === 'com.apple.platform.iphoneos' &&
          device.available,
      )
      const matches = options.device
        ? devices.filter(
            (device) => device.identifier === options.device || device.name === options.device,
          )
        : devices
      if (matches.length !== 1) {
        throw new Error(
          matches.length > 1
            ? 'Several iPhones are connected. Select one with --device UDID (see npm run ios:doctor).'
            : 'No matching iPhone is available. Connect and unlock it, trust this Mac, and enable Developer Mode.',
        )
      }
      const device = matches[0]
      const team = options.team || process.env.IOS_DEVELOPMENT_TEAM
      if (team) {
        if (!/^[A-Z0-9]{10}$/.test(team))
          throw new Error('The Personal Team ID must contain 10 uppercase letters or digits.')
        buildArgs.push(`DEVELOPMENT_TEAM=${team}`)
      }
      const settings = JSON.parse(
        capture('xcodebuild', [
          ...buildArgs,
          '-destination',
          `id=${device.identifier}`,
          '-showBuildSettings',
          '-json',
        ]),
      ).find((target) => target.target === 'TurtleSoup')?.buildSettings
      if (!settings?.DEVELOPMENT_TEAM) {
        throw new Error(
          'No signing team is set. Sign in under Xcode > Settings > Apple Accounts, then use --team TEAM_ID or ios/Signing.local.xcconfig.',
        )
      }
      console.log(`Signing for ${device.name} using team ${settings.DEVELOPMENT_TEAM}`)
      run('xcodebuild', [
        ...buildArgs,
        '-destination',
        `id=${device.identifier}`,
        '-allowProvisioningUpdates',
        '-allowProvisioningDeviceRegistration',
        'build',
      ])
      const app = path.join(settings.TARGET_BUILD_DIR, settings.FULL_PRODUCT_NAME)
      run('codesign', ['--verify', '--deep', '--strict', app])
      run('xcrun', ['devicectl', 'device', 'install', 'app', '--device', device.identifier, app])
      run('xcrun', [
        'devicectl',
        'device',
        'process',
        'launch',
        '--device',
        device.identifier,
        settings.PRODUCT_BUNDLE_IDENTIFIER,
      ])
      console.log(`Installed and launched ${settings.PRODUCT_BUNDLE_IDENTIFIER} on ${device.name}`)
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
}
