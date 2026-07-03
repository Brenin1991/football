import type { Database } from 'sql.js'
import { persistDatabase } from './database'
import { SCHEMA_VERSION } from './schema'
import { isSkinToneId } from './skinTones'

function uid(): string {
  return crypto.randomUUID()
}

function queryAll(db: Database, sql: string, params: (string | number)[] = []) {
  const stmt = db.prepare(sql)
  stmt.bind(params)
  const rows: Record<string, unknown>[] = []
  while (stmt.step()) rows.push(stmt.getAsObject())
  stmt.free()
  return rows
}

function tableExists(db: Database, name: string): boolean {
  return queryAll(
    db,
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    [name],
  ).length > 0
}

function getSchemaVersion(db: Database): number {
  if (!tableExists(db, 'settings')) return 0
  const rows = queryAll(db, "SELECT value FROM settings WHERE key = 'schema_version'")
  const raw = rows[0]?.value
  if (typeof raw === 'number') return raw
  if (typeof raw === 'string') return parseInt(raw, 10) || 0
  return 0
}

function setSchemaVersion(db: Database, version: number): void {
  db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [
    'schema_version',
    String(version),
  ])
}

function ensureV2Tables(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS edition_players (
      id TEXT PRIMARY KEY,
      edition_id TEXT NOT NULL REFERENCES editions(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      skin_tone TEXT NOT NULL DEFAULT 'medium',
      created_at INTEGER NOT NULL
    )
  `)
  db.run(`
    CREATE TABLE IF NOT EXISTS team_roster (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      player_id TEXT NOT NULL REFERENCES edition_players(id) ON DELETE CASCADE,
      slot_index INTEGER NOT NULL,
      position_label TEXT NOT NULL DEFAULT 'CM',
      UNIQUE(team_id, slot_index),
      UNIQUE(team_id, player_id)
    )
  `)
  db.run(`
    CREATE TABLE IF NOT EXISTS team_kits (
      team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      kit_number INTEGER NOT NULL CHECK(kit_number IN (1, 2)),
      shirt_color TEXT NOT NULL,
      shorts_color TEXT NOT NULL,
      socks_color TEXT NOT NULL,
      PRIMARY KEY (team_id, kit_number)
    )
  `)
}

function seedDefaultKitsForTeam(
  db: Database,
  teamId: string,
  primary: string,
  secondary: string | null,
): void {
  const kit2Shirt = secondary ?? primary
  const shorts1 = secondary ?? '#1a1a2e'
  const shorts2 = '#1a1a2e'
  db.run(
    `INSERT OR IGNORE INTO team_kits (team_id, kit_number, shirt_color, shorts_color, socks_color)
     VALUES (?, 1, ?, ?, ?)`,
    [teamId, primary, shorts1, primary],
  )
  db.run(
    `INSERT OR IGNORE INTO team_kits (team_id, kit_number, shirt_color, shorts_color, socks_color)
     VALUES (?, 2, ?, ?, ?)`,
    [teamId, kit2Shirt, shorts2, kit2Shirt],
  )
}

function migratePlayersTable(db: Database): void {
  if (!tableExists(db, 'players')) return

  const legacy = queryAll(db, 'SELECT * FROM players ORDER BY team_id, slot_index')
  for (const row of legacy) {
    const teamId = row.team_id as string
    const teamRows = queryAll(db, 'SELECT edition_id, primary_color, secondary_color FROM teams WHERE id = ?', [
      teamId,
    ])
    if (!teamRows[0]) continue
    const editionId = teamRows[0].edition_id as string

    const playerId = uid()
    db.run(
      'INSERT INTO edition_players (id, edition_id, name, skin_tone, created_at) VALUES (?, ?, ?, ?, ?)',
      [playerId, editionId, row.name as string, 'medium', Date.now()],
    )
    db.run(
      'INSERT INTO team_roster (id, team_id, player_id, slot_index, position_label) VALUES (?, ?, ?, ?, ?)',
      [uid(), teamId, playerId, row.slot_index as number, row.position_label as string],
    )
  }

  db.run('DROP TABLE players')
}

function migrateToV2(db: Database): void {
  ensureV2Tables(db)
  migratePlayersTable(db)

  const teams = queryAll(db, 'SELECT id, primary_color, secondary_color FROM teams')
  for (const team of teams) {
    seedDefaultKitsForTeam(
      db,
      team.id as string,
      team.primary_color as string,
      (team.secondary_color as string | null) ?? null,
    )
  }
}

function migrateToV3(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS entity_images (
      entity_type TEXT NOT NULL CHECK(entity_type IN ('league', 'team', 'player')),
      entity_id TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      data BLOB NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (entity_type, entity_id)
    )
  `)
}

function migrateToV4(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS team_crest_layout (
      team_id TEXT PRIMARY KEY REFERENCES teams(id) ON DELETE CASCADE,
      shirt_enabled INTEGER NOT NULL DEFAULT 1,
      uv_repeat_x REAL NOT NULL DEFAULT 0.2,
      uv_repeat_y REAL NOT NULL DEFAULT 0.2,
      uv_offset_x REAL NOT NULL DEFAULT 0.4,
      uv_offset_y REAL NOT NULL DEFAULT 0.38,
      emissive_intensity REAL NOT NULL DEFAULT 0.72,
      bone_enabled INTEGER NOT NULL DEFAULT 1,
      bone_size REAL NOT NULL DEFAULT 0.14,
      bone_x REAL NOT NULL DEFAULT 0,
      bone_y REAL NOT NULL DEFAULT 0.05,
      bone_z REAL NOT NULL DEFAULT -0.2,
      bone_rot_y REAL NOT NULL DEFAULT 3.141592653589793
    )
  `)
}

function migrateToV5(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS team_kit_shirt (
      team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      kit_number INTEGER NOT NULL CHECK(kit_number IN (1, 2)),
      mime_type TEXT,
      data BLOB,
      uv_repeat_x REAL NOT NULL DEFAULT 1,
      uv_repeat_y REAL NOT NULL DEFAULT 1,
      uv_offset_x REAL NOT NULL DEFAULT 0,
      uv_offset_y REAL NOT NULL DEFAULT 0,
      flip_horizontal INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (team_id, kit_number)
    )
  `)
}

function migrateToV6(db: Database): void {
  if (!tableExists(db, 'team_kit_shirt')) return
  const cols = queryAll(db, 'PRAGMA table_info(team_kit_shirt)')
  const hasFlip = cols.some((c) => c.name === 'flip_horizontal')
  if (!hasFlip) {
    db.run('ALTER TABLE team_kit_shirt ADD COLUMN flip_horizontal INTEGER NOT NULL DEFAULT 1')
  }
}

export function runMigrations(db: Database): void {
  const current = getSchemaVersion(db)
  if (current < 2) migrateToV2(db)
  if (getSchemaVersion(db) < 3) migrateToV3(db)
  if (getSchemaVersion(db) < 4) migrateToV4(db)
  if (getSchemaVersion(db) < 5) migrateToV5(db)
  if (getSchemaVersion(db) < 6) migrateToV6(db)
  if (getSchemaVersion(db) < SCHEMA_VERSION) setSchemaVersion(db, SCHEMA_VERSION)
  persistDatabase()
}

export function normalizeSkinTone(value: string): string {
  return isSkinToneId(value) ? value : 'medium'
}
