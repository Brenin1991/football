import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js'
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url'
import { SCHEMA_SQL } from './schema'
import { seedDefaultEdition } from './seed'
import { runMigrations, ensureSchemaPatches } from './migrate'
import { invalidateEntityImageCache } from '../lib/entityImageCache'
import { invalidateShirtTextures } from '../game/psx/shirtTextureApply'
import { getEditionDbBytes, putEditionDbBytes } from './editionDbStore'

/** Legado — JSON de bytes no localStorage (estoura quota com texturas). */
const LEGACY_STORAGE_KEY = 'futebol-edition-db'

let sqlModule: SqlJsStatic | null = null
let db: Database | null = null

/** Fila de gravação no IndexedDB (API sync pra callers). */
let persistChain: Promise<void> = Promise.resolve()

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

function loadFromLegacyLocalStorage(SQL: SqlJsStatic): Database | null {
  const raw = localStorage.getItem(LEGACY_STORAGE_KEY)
  if (!raw) return null
  try {
    const bytes = Uint8Array.from(JSON.parse(raw) as number[])
    return new SQL.Database(bytes)
  } catch {
    return null
  }
}

function clearLegacyLocalStorage() {
  try {
    localStorage.removeItem(LEGACY_STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

function vacuumDatabase(database: Database) {
  try {
    database.run('VACUUM')
  } catch {
    /* ignore */
  }
}

function enqueuePersist(vacuumFirst: boolean) {
  persistChain = persistChain
    .then(async () => {
      if (!db) return
      if (vacuumFirst) vacuumDatabase(db)
      await putEditionDbBytes(db.export())
      clearLegacyLocalStorage()
    })
    .catch((err) => {
      console.error('[edition-db] Falha ao persistir no IndexedDB:', err)
    })
}

/**
 * Persiste o SQLite no IndexedDB (binário).
 * Mantém assinatura sync — gravação é enfileirada em background.
 */
export function persistDatabase(): void {
  if (!db) return
  enqueuePersist(false)
}

/** Aguarda a fila de persistência (útil em export/download). */
export function flushPersistDatabase(): Promise<void> {
  return persistChain
}

export async function initDatabase(): Promise<Database> {
  const SQL = await loadSql()
  if (!db) {
    const fromIdb = await getEditionDbBytes()
    if (fromIdb && fromIdb.byteLength > 0) {
      db = new SQL.Database(fromIdb)
    } else {
      const legacy = loadFromLegacyLocalStorage(SQL)
      if (legacy) {
        db = legacy
        // Migra pro IndexedDB (com VACUUM) e limpa o localStorage inchado
        enqueuePersist(true)
      } else {
        db = createFreshDatabase(SQL)
        enqueuePersist(false)
      }
    }
  }
  // Sempre reaplica migrações (HMR / coluna nova sem reload completo)
  runMigrations(db)
  persistDatabase()
  await flushPersistDatabase()
  return db
}

export function getDatabase(): Database {
  if (!db) throw new Error('Database not initialized')
  ensureSchemaPatches(db)
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
  const database = getDatabase()
  vacuumDatabase(database)
  return database.export()
}

export function downloadDatabase(filename = 'futebol-edicao.sqlite'): void {
  const bytes = exportDatabaseBytes()
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  const blob = new Blob([copy.buffer], { type: 'application/x-sqlite3' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}
