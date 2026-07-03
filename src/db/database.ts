import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js'
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url'
import { SCHEMA_SQL } from './schema'
import { seedDefaultEdition } from './seed'
import { runMigrations } from './migrate'
import { invalidateEntityImageCache } from '../lib/entityImageCache'
import { invalidateShirtTextures } from '../game/psx/shirtTextureApply'

const DB_STORAGE_KEY = 'futebol-edition-db'

let sqlModule: SqlJsStatic | null = null
let db: Database | null = null

async function loadSql(): Promise<SqlJsStatic> {
  if (sqlModule) return sqlModule
  sqlModule = await initSqlJs({ locateFile: () => wasmUrl })
  return sqlModule
}

function createFreshDatabase(SQL: SqlJsStatic): Database {
  const instance = new SQL.Database()
  instance.run(SCHEMA_SQL)
  seedDefaultEdition(instance)
  runMigrations(instance)
  return instance
}

function loadFromStorage(SQL: SqlJsStatic): Database | null {
  const raw = localStorage.getItem(DB_STORAGE_KEY)
  if (!raw) return null
  try {
    const bytes = Uint8Array.from(JSON.parse(raw) as number[])
    return new SQL.Database(bytes)
  } catch {
    return null
  }
}

export function persistDatabase(): void {
  if (!db) return
  const data = db.export()
  localStorage.setItem(DB_STORAGE_KEY, JSON.stringify(Array.from(data)))
}

export async function initDatabase(): Promise<Database> {
  if (db) return db
  const SQL = await loadSql()
  db = loadFromStorage(SQL) ?? createFreshDatabase(SQL)
  runMigrations(db)
  persistDatabase()
  return db
}

export function getDatabase(): Database {
  if (!db) throw new Error('Database not initialized')
  return db
}

export function replaceDatabase(bytes: Uint8Array): Database {
  if (!sqlModule) throw new Error('SQL module not loaded')
  db?.close()
  invalidateEntityImageCache()
  invalidateShirtTextures()
  db = new sqlModule.Database(bytes)
  runMigrations(db)
  persistDatabase()
  return db
}

export function exportDatabaseBytes(): Uint8Array {
  return getDatabase().export()
}

export function downloadDatabase(filename = 'futebol-edicao.sqlite'): void {
  const bytes = exportDatabaseBytes()
  const blob = new Blob([bytes], { type: 'application/x-sqlite3' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}
