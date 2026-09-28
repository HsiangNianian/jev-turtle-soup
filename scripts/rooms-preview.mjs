// Isolated local UI QA. Uses fake accounts, in-memory D1/KV and an outbound fake host.
// No production credentials, data, Jev requests, or diagnostic production routes.
import { build } from 'esbuild'
import { Miniflare, convertV4MiniflareOptions, Response } from 'miniflare'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
const bundle = await build({
  entryPoints: ['worker/entry.ts'],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'neutral',
  conditions: ['workerd', 'browser'],
  external: ['cloudflare:workers'],
})
const authBundle = await build({
  entryPoints: ['shared/auth.ts'],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
})
const { createSession } = await import(
  `data:text/javascript;base64,${Buffer.from(authBundle.outputFiles[0].text).toString('base64')}`
)
const secret = 'local-room-preview-only'
const mf = new Miniflare(
  convertV4MiniflareOptions({
    name: 'room-preview',
    host: '127.0.0.1',
    port: 8799,
    modules: true,
    script: bundle.outputFiles[0].text,
    compatibilityDate: '2026-09-20',
    durableObjects: {
      ROOMS: { className: 'SoupRoom', useSQLite: true },
      ROOM_LIMITS: { className: 'RoomLimit', useSQLite: true },
    },
    kvNamespaces: ['AUTH_KV'],
    d1Databases: ['DB'],
    bindings: { AUTH_SECRET: secret, ROOMS_ENABLED: '1', TYPESAFE_API_KEY: 'preview-fake-only' },
    assets: {
      directory: 'dist',
      binding: 'ASSETS',
      run_worker_first: true,
      routerConfig: { has_user_worker: true },
      assetConfig: { not_found_handling: 'single-page-application' },
    },
    outboundService: async (req) => {
      if (!req.url.startsWith('https://api.typesafe.ai/'))
        return new Response('External requests disabled', { status: 502 })
      const body = await req.json()
      const solve = body.state?.latest_player_message === '大家一起解开了'
      const reveal = body.state?.latest_player_message === '揭晓答案'
      const choice = (c) => ({ choice: c, confidence: 1, probabilities: { [c]: 1 } })
      return Response.json({
        model: 'local-fixture',
        answers: {
          intent: choice(reveal ? 'meta' : solve ? 'guess' : 'yes_no_question'),
          verdict: choice('yes'),
          solved: { noul: solve ? 1 : 0 },
          motive_correct: { noul: 0.6 },
          method_correct: { noul: 0.7 },
          twist_correct: { noul: 0.5 },
          meta_request: choice(reveal ? 'full_answer' : 'none'),
        },
      })
    },
  }),
)
const db = await mf.getD1Database('DB')
for (const statement of (await readFile('db/schema.sql', 'utf8'))
  .replace(/--[^\n]*/g, '')
  .split(';')
  .filter((s) => s.trim()))
  await db.prepare(statement).run()
const kv = await mf.getKVNamespace('AUTH_KV')
const users = { alice: '阿简', bob: '晚风', carol: '小岛', author: '编辑部' }
const cookies = {}
for (const [id, name] of Object.entries(users)) {
  await db
    .prepare('INSERT INTO users(id,email,display_name,handle,created_at) VALUES(?,?,?,?,?)')
    .bind(id, `${id}@example.test`, name, id, Date.now())
    .run()
  cookies[id] = await createSession(kv, secret, { id, email: `${id}@example.test` })
}
await db
  .prepare(
    'INSERT INTO puzzles(id,owner_id,title,surface,truth,hint,difficulty,visibility,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
  )
  .bind(
    'room-preview-puzzle',
    'author',
    '八点半的电梯',
    '每天八点半出门，电梯总空停在十六层，门一按就开，像有人提前替她按好了。',
    '她的邻居每天提早几分钟出门，把电梯留在这一层。这是他没有说出口的关照。',
    '注意电梯为什么总停在这一层。',
    '中等',
    'public',
    Date.now(),
  )
  .run()
// Long English text exercises the compact header and scrollable premise sheets.
await db
  .prepare(
    'INSERT INTO puzzles(id,owner_id,title,surface,truth,hint,difficulty,visibility,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
  )
  .bind(
    'room-preview-long',
    'author',
    'The Woman at the Edge of the Frame',
    'After my father died, I opened a painted-over cupboard and found a hidden room filled with numbered photographs. In every picture, a woman stood at the edge of the frame. Why had nobody told me who she was?\n\n'.repeat(
      8,
    ),
    'The photographer had arranged the pictures as a family history.',
    'Look at the edges.',
    '中等',
    'public',
    Date.now(),
  )
  .run()
await mkdir('.build/rooms', { recursive: true })
await writeFile(
  '.build/rooms/preview.json',
  JSON.stringify({
    url: (await mf.ready).origin,
    cookies,
    puzzleId: 'room-preview-puzzle',
    longPuzzleId: 'room-preview-long',
  }),
)
console.log(
  `Local room preview: ${(await mf.ready).origin}; fixture session data in .build/rooms/preview.json`,
)
process.on('SIGINT', async () => {
  await mf.dispose()
  process.exit(0)
})
process.on('SIGTERM', async () => {
  await mf.dispose()
  process.exit(0)
})
