import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import type { D1Like, D1PreparedStatementLike, KVLike } from '../shared/auth'

/** Execute actual production SQL; only the D1 transport is replaced. */
export function database() {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec(readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8'))
  const db: D1Like = {
    prepare(query) {
      const statement = sqlite.prepare(query)
      let values: SQLInputValue[] = []
      const prepared: D1PreparedStatementLike = {
        bind(...args) {
          values = args as SQLInputValue[]
          return prepared
        },
        async first<T>() {
          return (statement.get(...values) as T) ?? null
        },
        async all<T>() {
          return { results: statement.all(...values) as T[], success: true }
        },
        async run() {
          return statement.run(...values)
        },
      }
      return prepared
    },
  }
  return { db, sqlite }
}

export function kvStore(): KVLike {
  const data = new Map<string, string>()
  return {
    async get(key) {
      return data.get(key) ?? null
    },
    async put(key, value) {
      data.set(key, value)
    },
    async delete(key) {
      data.delete(key)
    },
  }
}
