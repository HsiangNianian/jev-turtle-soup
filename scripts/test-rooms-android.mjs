// Isolated local emulator QA. Requires assembled debug + androidTest APKs.
import { readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
const f = JSON.parse(await readFile('.build/rooms/preview.json', 'utf8'))
const adb = process.env.ADB ?? 'adb'
function run(args) {
  const r = spawnSync(adb, args, { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(r.stderr || r.stdout)
  return r.stdout
}
run(['reverse', 'tcp:8799', 'tcp:8799'])
run(['install', '-r', 'android/app/build/outputs/apk/debug/app-debug.apk'])
run(['install', '-r', 'android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk'])
const result = run([
  'shell',
  'am',
  'instrument',
  '-w',
  '-r',
  '-e',
  'class',
  'games.mmstudio.turtlesoup.RoomRuntimeTest',
  '-e',
  'alice',
  f.cookies.alice,
  '-e',
  'bob',
  f.cookies.bob,
  'games.mmstudio.turtlesoup.test/androidx.test.runner.AndroidJUnitRunner',
])
console.log(result)
if (!/OK \(1 test\)/.test(result)) process.exitCode = 1
else
  run([
    'pull',
    '/sdcard/Android/data/games.mmstudio.turtlesoup/files/rooms-native-answer.png',
    '.build/rooms/android-native-answer.png',
  ])
