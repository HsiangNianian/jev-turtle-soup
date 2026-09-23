import type { ArchivedGame } from './archive'
import type { ArchiveData, StoragePort } from './archive-store'

export interface SyncDatabase {
  execSync(sql: string): void
  runSync(sql: string, params: (string | number | null)[]): unknown
  getAllSync<T>(sql: string, params: (string | number | null)[]): T[]
}

/** All game/queue/ownership changes commit in one transaction; only changed games serialize. */
export function sqliteArchiveStorage(db: SyncDatabase, legacy: StoragePort): StoragePort {
  db.execSync(`
    CREATE TABLE IF NOT EXISTS native_archive_meta (id INTEGER PRIMARY KEY CHECK(id = 1), payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS native_archive_spaces (owner TEXT PRIMARY KEY, pending TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS native_archive_games (owner TEXT NOT NULL, id TEXT NOT NULL, position INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(owner,id));
  `)
  let previous: ArchiveData = { version: 2, spaces: {} }
  return {
    getItem: (key) => legacy.getItem(key),
    setItem: (key, value) => legacy.setItem(key, value),
    readArchive() {
      const header = db.getAllSync<{ payload: string }>(
        'SELECT payload FROM native_archive_meta WHERE id = 1',
        [],
      )[0]
      if (!header) return null
      const meta = JSON.parse(header.payload) as Omit<ArchiveData, 'spaces'>
      const spaces: ArchiveData['spaces'] = {}
      for (const row of db.getAllSync<{ owner: string; pending: string }>(
        'SELECT owner,pending FROM native_archive_spaces',
        [],
      ))
        spaces[row.owner] = { pending: JSON.parse(row.pending), games: [] }
      for (const row of db.getAllSync<{ owner: string; payload: string }>(
        'SELECT owner,payload FROM native_archive_games ORDER BY position',
        [],
      )) {
        if (!spaces[row.owner]) throw new Error('Archive game has no owner space')
        spaces[row.owner].games.push(JSON.parse(row.payload) as ArchivedGame)
      }
      previous = { ...meta, spaces }
      return { ...previous, spaces: { ...previous.spaces } }
    },
    writeArchive(data) {
      db.execSync('BEGIN IMMEDIATE')
      try {
        for (const owner of Object.keys(previous.spaces))
          if (!data.spaces[owner]) {
            db.runSync('DELETE FROM native_archive_games WHERE owner = ?', [owner])
            db.runSync('DELETE FROM native_archive_spaces WHERE owner = ?', [owner])
          }
        for (const [owner, space] of Object.entries(data.spaces)) {
          const old = previous.spaces[owner]
          if (old === space) continue
          const oldGames = new Map(
            (old?.games ?? []).map((game, index) => [game.id, { game, index }]),
          )
          space.games.forEach((game, index) => {
            const prior = oldGames.get(game.id)
            if (prior?.game !== game)
              db.runSync(
                'INSERT INTO native_archive_games (owner,id,position,payload) VALUES (?,?,?,?) ON CONFLICT(owner,id) DO UPDATE SET position=excluded.position,payload=excluded.payload',
                [owner, game.id, index, JSON.stringify(game)],
              )
            else if (prior.index !== index)
              db.runSync(
                'UPDATE native_archive_games SET position = ? WHERE owner = ? AND id = ?',
                [index, owner, game.id],
              )
            oldGames.delete(game.id)
          })
          for (const id of oldGames.keys())
            db.runSync('DELETE FROM native_archive_games WHERE owner = ? AND id = ?', [owner, id])
          db.runSync(
            'INSERT INTO native_archive_spaces (owner,pending) VALUES (?,?) ON CONFLICT(owner) DO UPDATE SET pending=excluded.pending',
            [owner, JSON.stringify(space.pending)],
          )
        }
        db.runSync(
          'INSERT INTO native_archive_meta (id,payload) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload',
          [JSON.stringify({ version: data.version, guestClaimedBy: data.guestClaimedBy })],
        )
        db.execSync('COMMIT')
        // Snapshot containers: retryStorage may replace an in-memory owner's space on failure.
        previous = { ...data, spaces: { ...data.spaces } }
      } catch (error) {
        db.execSync('ROLLBACK')
        throw error
      }
    },
  }
}
