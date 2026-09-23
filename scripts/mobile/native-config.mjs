import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../mobile')

/** Reapplied after an explicit prebuild; normal compilation never regenerates native projects. */
export function configureNative() {
  const gradlePath = path.join(app, 'android/app/build.gradle')
  let gradle = readFileSync(gradlePath, 'utf8')
  if (!gradle.includes('// Turtle Soup build inputs')) {
    gradle = gradle.replace(
      'android {',
      `// Turtle Soup build inputs (shared by local npm scripts and GitHub CI).
def mobileEnvironment = System.getenv('MOBILE_ENV') ?: 'development'
def mobileSuffix = mobileEnvironment == 'production' ? '' : '.' + mobileEnvironment
def mobileSigningKey = System.getenv('MOBILE_KEYSTORE')
def wantsRelease = gradle.startParameter.taskNames.any { it.toLowerCase().contains('release') }
if (wantsRelease && (!mobileSigningKey || !System.getenv('MOBILE_KEYSTORE_PASSWORD') || !System.getenv('MOBILE_KEY_ALIAS') || !System.getenv('MOBILE_KEY_PASSWORD'))) {
    throw new GradleException('Release builds require configured signing credentials; debug signing is never used as a fallback.')
}

android {`,
    )
    gradle = gradle.replace(
      "applicationId 'games.mmstudio.turtlesoup'",
      "applicationId 'games.mmstudio.turtlesoup' + mobileSuffix\n        resValue 'string', 'app_name', mobileEnvironment == 'production' ? '海龟汤调查局' : '海龟汤 · 开发'\n        manifestPlaceholders = [mobileScheme: mobileEnvironment == 'production' ? 'turtlesoup' : 'turtlesoup-' + mobileEnvironment, mobileCleartext: mobileEnvironment == 'development' ? 'true' : 'false']",
    )
    gradle = gradle.replace(
      'versionCode 1',
      "versionCode Integer.parseInt(System.getenv('MOBILE_BUILD_NUMBER') ?: '1')",
    )
    gradle = gradle.replace(
      'signingConfigs {',
      `signingConfigs {
        release {
            if (mobileSigningKey) {
                storeFile file(mobileSigningKey)
                storePassword System.getenv('MOBILE_KEYSTORE_PASSWORD')
                keyAlias System.getenv('MOBILE_KEY_ALIAS')
                keyPassword System.getenv('MOBILE_KEY_PASSWORD')
            }
        }`,
    )
    gradle = gradle.replace(
      /(release \{\n\s*\/\/ Caution![\s\S]*?)signingConfig signingConfigs.debug/,
      '$1signingConfig signingConfigs.release',
    )
  }
  gradle = gradle.replace(
    'versionName "0.1.0"',
    "versionName System.getenv('MOBILE_APP_VERSION') ?: '0.1.0'",
  )
  writeFileSync(gradlePath, gradle)
  const stringsPath = path.join(app, 'android/app/src/main/res/values/strings.xml')
  writeFileSync(
    stringsPath,
    readFileSync(stringsPath, 'utf8').replace(/\s*<string name="app_name">[^<]*<\/string>/, ''),
  )
  const manifestPath = path.join(app, 'android/app/src/main/AndroidManifest.xml')
  let manifest = readFileSync(manifestPath, 'utf8').replace(
    'android:scheme="turtlesoup"',
    'android:scheme="${mobileScheme}"',
  )
  if (!manifest.includes('android:usesCleartextTraffic='))
    manifest = manifest.replace(
      '<application ',
      '<application android:usesCleartextTraffic="${mobileCleartext}" ',
    )
  writeFileSync(manifestPath, manifest)
  const plist = path.join(app, 'ios/TurtleSoup/Info.plist')
  writeFileSync(
    plist,
    readFileSync(plist, 'utf8')
      .replace('<string>turtlesoup</string>', '<string>$(MOBILE_APP_SCHEME)</string>')
      .replace(
        '<string>games.mmstudio.turtlesoup</string>',
        '<string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>',
      )
      .replace(
        /(<key>CFBundleDisplayName<\/key>\s*)<string>[^<]*<\/string>/,
        '$1<string>$(MOBILE_APP_NAME)</string>',
      )
      .replace(
        /(<key>CFBundleVersion<\/key>\s*)<string>[^<]*<\/string>/,
        '$1<string>$(CURRENT_PROJECT_VERSION)</string>',
      )
      .replace(
        /(<key>CFBundleShortVersionString<\/key>\s*)<string>[^<]*<\/string>/,
        '$1<string>$(MARKETING_VERSION)</string>',
      ),
  )
  const project = path.join(app, 'ios/TurtleSoup.xcodeproj/project.pbxproj')
  let text = readFileSync(project, 'utf8')
  if (!text.includes('MOBILE_APP_NAME ='))
    text = text.replaceAll(
      'CURRENT_PROJECT_VERSION = 1;',
      'CURRENT_PROJECT_VERSION = 1;\n\t\t\t\tMOBILE_APP_NAME = "海龟汤调查局";\n\t\t\t\tMARKETING_VERSION = "0.1.0";',
    )
  if (!text.includes('MOBILE_APP_SCHEME ='))
    text = text.replaceAll(
      'CURRENT_PROJECT_VERSION = 1;',
      'CURRENT_PROJECT_VERSION = 1;\n\t\t\t\tMOBILE_APP_SCHEME = "turtlesoup-development";',
    )
  // The first application configuration is Debug; release identity is overridden by the build script.
  const debugStart = text.indexOf('/* Debug */ = {')
  const debugEnd = text.indexOf('name = Debug;', debugStart)
  const debug = text
    .slice(debugStart, debugEnd)
    .replace(
      'PRODUCT_BUNDLE_IDENTIFIER = "games.mmstudio.turtlesoup";',
      'PRODUCT_BUNDLE_IDENTIFIER = "games.mmstudio.turtlesoup.development";',
    )
  text = text.slice(0, debugStart) + debug + text.slice(debugEnd)
  writeFileSync(project, text)
}
