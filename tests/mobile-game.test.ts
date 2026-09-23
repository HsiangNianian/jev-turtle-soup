import { expect, it, vi } from 'vitest'
import {
  newGame,
  beginTurn,
  failTurn,
  finishTurn,
  isDailyLocked,
  turnInput,
} from '../packages/client-core/src/game'
import { createClient } from '../packages/client-core/src/transport'
import { buildLedger } from '../packages/client-core/src/archive'
import type { LibraryPuzzle } from '../packages/client-core/src/public-types'
import type { HostTurn } from '../packages/client-core/src/types'

const puzzle: LibraryPuzzle = {
  id: 'library-one',
  title: '题',
  surface: '面',
  difficulty: '普通',
  tags: [],
  plays: 0,
  solves: 0,
  createdAt: 0,
  genreScore: 50,
  owner: { handle: 'test', displayName: 'Test' },
  official: false,
  featured: false,
}
const uuid = () => crypto.randomUUID()
it('restores interrupted questions and retries without adding another message or turn', () => {
  const original = newGame(puzzle, 'hello', uuid)
  const sending = beginTurn(original, 'why', uuid)
  const interrupted = failTurn(JSON.parse(JSON.stringify(sending)), sending.pendingAsk!.id)
  const retry = beginTurn(interrupted, '', uuid, true)
  expect(retry.messages).toEqual(sending.messages)
  expect(retry.turnCount).toBe(1)
  expect(turnInput(retry)).toEqual({ message: 'why', history: original.messages })
  expect(retry.pendingAsk!.id).not.toBe(sending.pendingAsk!.id)
  const turn = {
    solved: false,
    revealed: false,
    verdict: 'cannot_answer',
    reply: 'please clarify',
    closeness: null,
    replyLocale: 'ja',
    debug: {},
  } as HostTurn
  expect(finishTurn(retry, sending.pendingAsk!.id, turn, uuid)).toBe(retry)
  const answered = finishTurn(retry, retry.pendingAsk!.id, turn, uuid)
  expect(answered.messages.at(-1)).toMatchObject({ tone: 'normal', replyLocale: 'ja' })
  expect(buildLedger(answered.messages)).toEqual([])
  expect(answered.pendingAsk).toBeUndefined()
})
it('keeps the UTC reveal boundary and terminal games closed', () => {
  expect(
    isDailyLocked(
      { source: 'daily', dailyDate: '2026-09-23' },
      new Date('2026-09-24T07:59:59+08:00'),
    ),
  ).toBe(true)
  expect(
    isDailyLocked(
      { source: 'daily', dailyDate: '2026-09-23' },
      new Date('2026-09-24T08:00:00+08:00'),
    ),
  ).toBe(false)
  for (const status of ['solved', 'revealed', 'abandoned'] as const)
    expect(() => beginTurn({ ...newGame(puzzle, '', uuid), status }, 'why', uuid)).toThrow()
})
it('uses the correct source route, filters history, and preserves native save identity', async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValue(new Response(JSON.stringify({ items: [] })))
  const client = createClient({
    baseUrl: 'https://api.test',
    getToken: () => 'native-session',
    fetch,
  })
  const game = newGame(puzzle, '', uuid)
  await client.ask({ ...game, sessionId: game.id }, 'why', game.messages, {
    locale: 'ja',
    playerKey: 'device',
    seq: 1,
  })
  expect(fetch.mock.calls[0][0]).toBe('https://api.test/api/library/puzzles/library-one/ask')
  expect(new Headers(fetch.mock.calls[0][1]!.headers).get('Authorization')).toBe(
    'Bearer native-session',
  )
  expect(fetch.mock.calls[0][1]!.redirect).toBe('error')
  expect(JSON.parse(fetch.mock.calls[0][1]!.body as string).history).toEqual([
    { role: 'host', text: '' },
  ])
  fetch.mockResolvedValue(new Response(JSON.stringify({ items: [] })))
  await client.listSaves({ owner: 'account-a', signal: new AbortController().signal })
  expect(new Headers(fetch.mock.calls[1][1]!.headers).get('X-Save-Owner')).toBe('account-a')
  expect(() => createClient({ baseUrl: 'https://api.test/other' })).toThrow()
})
