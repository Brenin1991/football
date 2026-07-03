import type { Database, SqlValue } from 'sql.js'
import { cloneShirtUv, DEFAULT_SHIRT_UV, type ShirtUvLayout, type TeamKitShirtRecord } from './shirtTexture'
import { persistDatabase } from './database'

type ShirtRow = {
  mime_type: string | null
  data: unknown
  uv_repeat_x: number
  uv_repeat_y: number
  uv_offset_x: number
  uv_offset_y: number
  flip_horizontal: number | null
}

function toUint8Array(value: unknown): Uint8Array | null {
  if (value == null) return null
  if (value instanceof Uint8Array) return value
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (Array.isArray(value)) return Uint8Array.from(value)
  return null
}

function rowToUv(row: ShirtRow): ShirtUvLayout {
  return {
    uvRepeatX: row.uv_repeat_x,
    uvRepeatY: row.uv_repeat_y,
    uvOffsetX: row.uv_offset_x,
    uvOffsetY: row.uv_offset_y,
    flipHorizontal: row.flip_horizontal == null ? true : row.flip_horizontal !== 0,
  }
}

function queryRow(db: Database, teamId: string, kitNumber: number): ShirtRow | null {
  const stmt = db.prepare(
    `SELECT mime_type, data, uv_repeat_x, uv_repeat_y, uv_offset_x, uv_offset_y, flip_horizontal
     FROM team_kit_shirt WHERE team_id = ? AND kit_number = ?`,
  )
  stmt.bind([teamId, kitNumber])
  if (!stmt.step()) {
    stmt.free()
    return null
  }
  const row = stmt.getAsObject() as ShirtRow
  stmt.free()
  return row
}

export function getTeamKitShirt(
  db: Database,
  teamId: string,
  kitNumber: 1 | 2,
): TeamKitShirtRecord {
  const row = queryRow(db, teamId, kitNumber)
  if (!row) {
    return {
      teamId,
      kitNumber,
      mimeType: null,
      data: null,
      uv: cloneShirtUv(DEFAULT_SHIRT_UV),
    }
  }
  return {
    teamId,
    kitNumber,
    mimeType: row.mime_type,
    data: toUint8Array(row.data),
    uv: rowToUv(row),
  }
}

export function hasTeamKitShirtTexture(
  db: Database,
  teamId: string,
  kitNumber: 1 | 2,
): boolean {
  const row = queryRow(db, teamId, kitNumber)
  const data = row ? toUint8Array(row.data) : null
  return !!data?.byteLength
}

export function saveTeamKitShirtTexture(
  db: Database,
  teamId: string,
  kitNumber: 1 | 2,
  mimeType: string,
  data: Uint8Array,
): void {
  const existing = getTeamKitShirt(db, teamId, kitNumber)
  db.run(
    `INSERT INTO team_kit_shirt (
      team_id, kit_number, mime_type, data,
      uv_repeat_x, uv_repeat_y, uv_offset_x, uv_offset_y, flip_horizontal
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(team_id, kit_number) DO UPDATE SET
      mime_type = excluded.mime_type,
      data = excluded.data`,
    [
      teamId,
      kitNumber,
      mimeType,
      data,
      existing.uv.uvRepeatX,
      existing.uv.uvRepeatY,
      existing.uv.uvOffsetX,
      existing.uv.uvOffsetY,
      existing.uv.flipHorizontal ? 1 : 0,
    ] as SqlValue[],
  )
  persistDatabase()
}

export function saveTeamKitShirtUv(
  db: Database,
  teamId: string,
  kitNumber: 1 | 2,
  uv: ShirtUvLayout,
): void {
  const existing = getTeamKitShirt(db, teamId, kitNumber)
  db.run(
    `INSERT INTO team_kit_shirt (
      team_id, kit_number, mime_type, data,
      uv_repeat_x, uv_repeat_y, uv_offset_x, uv_offset_y, flip_horizontal
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(team_id, kit_number) DO UPDATE SET
      uv_repeat_x = excluded.uv_repeat_x,
      uv_repeat_y = excluded.uv_repeat_y,
      uv_offset_x = excluded.uv_offset_x,
      uv_offset_y = excluded.uv_offset_y,
      flip_horizontal = excluded.flip_horizontal`,
    [
      teamId,
      kitNumber,
      existing.mimeType,
      existing.data,
      uv.uvRepeatX,
      uv.uvRepeatY,
      uv.uvOffsetX,
      uv.uvOffsetY,
      uv.flipHorizontal ? 1 : 0,
    ] as SqlValue[],
  )
  persistDatabase()
}

export function deleteTeamKitShirtTexture(
  db: Database,
  teamId: string,
  kitNumber: 1 | 2,
): void {
  db.run('DELETE FROM team_kit_shirt WHERE team_id = ? AND kit_number = ?', [teamId, kitNumber])
  persistDatabase()
}

export function deleteTeamKitShirtsForTeam(db: Database, teamId: string): void {
  db.run('DELETE FROM team_kit_shirt WHERE team_id = ?', [teamId])
  persistDatabase()
}
