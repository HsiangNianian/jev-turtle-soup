import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import worker, { type Env } from '../worker/index'
import { recordPlay } from '../shared/library'
import { database } from './sqlite'

let data: ReturnType<typeof database>
let env: Env

function addPuzzle(id: string, owner: string, visibility = 'public') {
  data.sqlite
    .prepare(
      `INSERT INTO puzzles (id, owner_id, title, surface, truth, visibility, created_at)
       VALUES (?, ?, '一碗汤', '奇怪的事', '完整答案', ?, 1)`,
    )
    .run(id, owner, visibility)
}

async function get(path: string) {
  const response = await worker.fetch(new Request(`http://localhost${path}`), env)
  expect(response.status).toBe(200)
  return response.json() as Promise<Record<string, unknown>>
}

beforeEach(() => {
  data = database()
  env = { DB: data.db }
})
afterEach(() => data.sqlite.close())

describe('public solve-turn records', () => {
  it('shows only successful non-author runs in list and detail, without exposing identities', async () => {
    addPuzzle('community-bowl', 'author-id')
    addPuzzle('author-only-bowl', 'author-id')
    addPuzzle('past-daily', '', 'daily')
    data.sqlite
      .prepare(
        "INSERT INTO dailies (date, puzzle_id, story, created_at) VALUES ('2000-01-01', 'past-daily', '故事', 1)",
      )
      .run()

    await recordPlay(data.db, 'community-bowl', 'author-id', true)
    for (let turn = 1; turn <= 3; turn++) {
      await recordPlay(data.db, 'community-bowl', 'reader-fast', turn === 3)
    }
    for (let turn = 1; turn <= 7; turn++) {
      await recordPlay(data.db, 'community-bowl', 'reader-slow', turn === 7)
    }
    for (let turn = 0; turn < 12; turn++) {
      await recordPlay(data.db, 'community-bowl', 'still-solving', false)
    }
    await recordPlay(data.db, 'community-bowl', 'anon', true)
    data.sqlite
      .prepare(
        `INSERT INTO attempts (id, puzzle_id, player_key, solved, turns, created_at, updated_at)
         VALUES ('missing-key', 'community-bowl', NULL, 1, 2, 1, 1)`,
      )
      .run()
    await recordPlay(data.db, 'author-only-bowl', 'author-id', true)
    for (let turn = 1; turn <= 5; turn++) {
      await recordPlay(data.db, 'past-daily', 'daily-reader', turn === 5)
    }

    const { items } = (await get('/api/library/puzzles')) as {
      items: Record<string, unknown>[]
    }
    expect(items.find((item) => item.id === 'community-bowl')).toMatchObject({
      shortestSolveTurns: 3,
      longestSolveTurns: 7,
    })
    expect(items.find((item) => item.id === 'author-only-bowl')).toMatchObject({
      shortestSolveTurns: null,
      longestSolveTurns: null,
    })
    expect(items.find((item) => item.id === 'past-daily')).toMatchObject({
      shortestSolveTurns: 5,
      longestSolveTurns: 5,
    })
    const detail = await get('/api/library/puzzles/community-bowl')
    expect(detail).toMatchObject({ shortestSolveTurns: 3, longestSolveTurns: 7 })
    expect(JSON.stringify({ items, detail })).not.toContain('reader-fast')
  })

  it('freezes the question count when a player first solves the puzzle', async () => {
    addPuzzle('solved-bowl', 'author-id')
    await recordPlay(data.db, 'solved-bowl', 'reader', false)
    await recordPlay(data.db, 'solved-bowl', 'reader', true)
    await recordPlay(data.db, 'solved-bowl', 'reader', false)
    await recordPlay(data.db, 'solved-bowl', 'reader', true)

    expect(
      data.sqlite
        .prepare("SELECT turns, solved FROM attempts WHERE puzzle_id = 'solved-bowl'")
        .get(),
    ).toEqual({ turns: 2, solved: 1 })
    expect(
      data.sqlite.prepare("SELECT plays, solves FROM puzzles WHERE id = 'solved-bowl'").get(),
    ).toEqual({ plays: 1, solves: 1 })
    expect(await get('/api/library/puzzles/solved-bowl')).toMatchObject({
      shortestSolveTurns: 2,
      longestSolveTurns: 2,
    })
  })

  it('repairs a historical count only when its complete turn log proves the first solve', async () => {
    addPuzzle('legacy-bowl', 'author-id')
    addPuzzle('incomplete-log-bowl', 'author-id')
    const attempt = data.sqlite.prepare(
      `INSERT INTO attempts (id, puzzle_id, player_key, solved, turns, created_at, updated_at)
       VALUES (?, ?, ?, 1, ?, 1, 10)`,
    )
    attempt.run('complete', 'legacy-bowl', 'reader', 4)
    attempt.run('incomplete', 'incomplete-log-bowl', 'reader', 5)
    const log = data.sqlite.prepare(
      `INSERT INTO turn_logs (id, puzzle_id, kind, seq, player_key, message, reply, solved, created_at)
       VALUES (?, ?, 'library', ?, 'reader', '问', '答', ?, ?)`,
    )
    for (let turn = 1; turn <= 4; turn++) {
      log.run(`complete-${turn}`, 'legacy-bowl', turn, turn === 2 ? 1 : 0, turn)
    }
    for (let turn = 1; turn <= 2; turn++) {
      log.run(`incomplete-${turn}`, 'incomplete-log-bowl', turn, turn === 2 ? 1 : 0, turn)
    }

    const migration = readFileSync(
      new URL('../db/migrations/019-solve-turn-records.sql', import.meta.url),
      'utf8',
    )
    data.sqlite.exec(migration)
    data.sqlite.exec(migration)
    expect(data.sqlite.prepare("SELECT turns FROM attempts WHERE id = 'complete'").get()).toEqual({
      turns: 2,
    })
    expect(data.sqlite.prepare("SELECT turns FROM attempts WHERE id = 'incomplete'").get()).toEqual(
      {
        turns: 5,
      },
    )
    expect(await get('/api/library/puzzles/legacy-bowl')).toMatchObject({
      shortestSolveTurns: 2,
      longestSolveTurns: 2,
    })
  })
})
