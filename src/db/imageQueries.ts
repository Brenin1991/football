import type { Database, SqlValue } from 'sql.js'
import { persistDatabase } from './database'
import type { EntityImageType, StoredEntityImage } from './entityImages'

function queryAll(db: Database, sql: string, params: SqlValue[] = []): Record<string, unknown>[] {
  const stmt = db.prepare(sql)
  stmt.bind(params)
  const rows: Record<string, unknown>[] = []
  while (stmt.step()) rows.push(stmt.getAsObject())
  stmt.free()
  return rows
}

function runAndPersist(db: Database, sql: string, params: SqlValue[] = []): void {
  db.run(sql, params)
  persistDatabase()
}

function toUint8Array(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (Array.isArray(value)) return Uint8Array.from(value)
  return new Uint8Array()
}

export function getEntityImage(
  db: Database,
  entityType: EntityImageType,
  entityId: string,
): StoredEntityImage | null {
  const rows = queryAll(
    db,
    'SELECT * FROM entity_images WHERE entity_type = ? AND entity_id = ?',
    [entityType, entityId],
  )
  const row = rows[0]
  if (!row) return null
  return {
    entityType: row.entity_type as EntityImageType,
    entityId: row.entity_id as string,
    mimeType: row.mime_type as string,
    data: toUint8Array(row.data),
    updatedAt: row.updated_at as number,
  }
}

export function hasEntityImage(
  db: Database,
  entityType: EntityImageType,
  entityId: string,
): boolean {
  const rows = queryAll(
    db,
    'SELECT 1 FROM entity_images WHERE entity_type = ? AND entity_id = ? LIMIT 1',
    [entityType, entityId],
  )
  return rows.length > 0
}

export function setEntityImage(
  db: Database,
  entityType: EntityImageType,
  entityId: string,
  mimeType: string,
  data: Uint8Array,
): void {
  runAndPersist(
    db,
    `INSERT INTO entity_images (entity_type, entity_id, mime_type, data, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(entity_type, entity_id) DO UPDATE SET
       mime_type = excluded.mime_type,
       data = excluded.data,
       updated_at = excluded.updated_at`,
    [entityType, entityId, mimeType, data, Date.now()],
  )
}

export function deleteEntityImage(
  db: Database,
  entityType: EntityImageType,
  entityId: string,
): void {
  runAndPersist(db, 'DELETE FROM entity_images WHERE entity_type = ? AND entity_id = ?', [
    entityType,
    entityId,
  ])
}

export function deleteEntityImagesForIds(
  db: Database,
  entityType: EntityImageType,
  entityIds: string[],
): void {
  for (const id of entityIds) deleteEntityImage(db, entityType, id)
}
