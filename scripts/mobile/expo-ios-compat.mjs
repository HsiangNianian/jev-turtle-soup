import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(new URL('../../mobile/package.json', import.meta.url))

/**
 * Expo #49120 added constructor ownership annotations for Xcode 27. Xcode 26's
 * Swift importer rejects them (expo/expo#50067). Keep the current SDK's fixes
 * and restore its pre-27 annotation behavior only when building with Xcode 26.
 * Remove this workaround when upgrading to a version with an upstream fix.
 */
export function applyExpoIosCompatibility(xcodeVersion) {
  const major = Number(xcodeVersion.match(/^Xcode (\d+)/m)?.[1])
  if (!major) throw new Error('Cannot determine Xcode version for Expo compatibility')
  const packageFile = require.resolve('expo-modules-jsi/package.json')
  const { version } = JSON.parse(readFileSync(packageFile, 'utf8'))
  if (version !== '57.1.0')
    throw new Error(`Review the Expo iOS compatibility patch for expo-modules-jsi ${version}`)
  const file = path.join(
    path.dirname(packageFile),
    'apple/Sources/ExpoModulesJSI-Cxx/include/RuntimeScheduler.h',
  )
  const source = readFileSync(file, 'utf8')
  const original = source.replaceAll(
    /^  RuntimeScheduler\((void \*scheduler, ScheduleFn fn|)\)/gm,
    '  SWIFT_RETURNS_RETAINED RuntimeScheduler($1)',
  )
  // Fail on dependency drift instead of applying a broad patch to unknown code.
  const digest = createHash('sha256').update(original).digest('hex')
  if (digest !== 'ab3e6488b7e527210ecc1c8c58318c1e0ac5db3a489ddcc8ed5a11eaf6f7e5fb')
    throw new Error('expo-modules-jsi RuntimeScheduler.h changed; review the iOS patch')
  const desired =
    major < 27
      ? original.replaceAll('SWIFT_RETURNS_RETAINED RuntimeScheduler(', 'RuntimeScheduler(')
      : original
  if (source !== desired) writeFileSync(file, desired)
  console.log(
    `Expo iOS compatibility: Xcode ${major}, constructor annotations ${major < 27 ? 'removed' : 'preserved'}`,
  )
}
