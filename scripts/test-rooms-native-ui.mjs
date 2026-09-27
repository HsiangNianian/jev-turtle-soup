// Run after scripts/rooms-preview.mjs. Fixture sessions stay local to child processes.
import { readFile } from 'node:fs/promises'
import { spawn, execFileSync } from 'node:child_process'
import WebSocket from 'ws'
const f = JSON.parse(await readFile('.build/rooms/preview.json', 'utf8'))
async function request(uid, path, body) {
  const r = await fetch(f.url + path, {
    method: body ? 'POST' : 'GET',
    headers: {
      Cookie: `ts_session=${f.cookies[uid]}`,
      'Content-Type': 'application/json',
      'X-Room-Protocol': '1',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  if (!r.ok) throw new Error(`${path}: ${r.status}`)
  return r.json()
}
const room = await request('carol', '/api/rooms', {
  puzzleId: f.puzzleId,
  requestId: crypto.randomUUID(),
})
await request('bob', '/api/rooms/join', { code: room.inviteCode })
const sockets = []
async function connect(uid) {
  const { ticket } = await request(uid, `/api/rooms/${room.roomId}/ticket`, {})
  const ws = new WebSocket(
    f.url.replace('http', 'ws') + `/api/rooms/${room.roomId}/ws`,
    ['soup-room-v1', `ticket.${ticket}`],
    { headers: { Cookie: `ts_session=${f.cookies[uid]}` } },
  )
  await new Promise((resolve, reject) => {
    ws.once('message', resolve)
    ws.once('error', reject)
  })
  sockets.push(ws)
  return ws
}
const host = await connect('carol')
await connect('bob')
host.send(JSON.stringify({ type: 'start', commandId: crypto.randomUUID() }))
for (let i = 0; i < 40; i++) {
  if ((await request('carol', `/api/rooms/${room.roomId}`)).snapshot.phase === 'playing') break
  await new Promise((r) => setTimeout(r, 50))
}
const timer = setInterval(() => sockets.forEach((s) => s.send('ping')), 20_000)
const env = {
  ...process.env,
  TEST_RUNNER_NATIVE_ROOMS_ID: room.roomId,
  TEST_RUNNER_NATIVE_ROOMS_COOKIE: f.cookies.carol,
}
const devices = JSON.parse(
  execFileSync('xcrun', ['simctl', 'list', 'devices', 'booted', '--json'], { encoding: 'utf8' }),
)
const simulator =
  process.env.IOS_SIMULATOR_ID ??
  Object.values(devices.devices)
    .flat()
    .find((d) => d.name.includes('iPhone'))?.udid
if (!simulator) throw new Error('Boot an iPhone simulator first')
const args = [
  'test',
  '-project',
  'ios/TurtleSoup.xcodeproj',
  '-scheme',
  'TurtleSoup',
  '-destination',
  `platform=iOS Simulator,id=${simulator}`,
  '-derivedDataPath',
  '.build/rooms/ios-ui',
  '-resultBundlePath',
  `.build/rooms/native-ui-${Date.now()}.xcresult`,
  '-parallel-testing-enabled',
  'NO',
  '-only-testing:TurtleSoupUITests/NativeFlowTests/testRoomsOnLocalRuntime',
  'CODE_SIGNING_ALLOWED=NO',
]
try {
  const code = await new Promise((resolve, reject) => {
    const child = spawn('xcodebuild', args, { env, stdio: 'inherit' })
    child.on('error', reject)
    child.on('exit', resolve)
  })
  process.exitCode = code ?? 1
} finally {
  clearInterval(timer)
  for (const s of sockets) s.close()
}
