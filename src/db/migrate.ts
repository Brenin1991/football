import type { Database } from 'sql.js'
import { persistDatabase } from './database'
import { SCHEMA_VERSION } from './schema'
import { isSkinToneId } from './skinTones'
import { FORMATION_PRESETS } from '../game/data/formations'

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

function migrateToV7(db: Database): void {
  ensureEditionPlayerCustomGlbColumn(db)
}

function columnExists(db: Database, table: string, column: string): boolean {
  if (!tableExists(db, table)) return false
  const cols = queryAll(db, `PRAGMA table_info(${table})`)
  return cols.some((c) => String(c.name) === column)
}

function ensureEditionPlayerCustomGlbColumn(db: Database): void {
  if (!tableExists(db, 'edition_players')) return
  if (!columnExists(db, 'edition_players', 'has_custom_glb')) {
    db.run('ALTER TABLE edition_players ADD COLUMN has_custom_glb INTEGER NOT NULL DEFAULT 0')
  }
}

function ensureCountryEntityImages(db: Database): void {
  if (!tableExists(db, 'entity_images')) return
  const sqlRows = queryAll(
    db,
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'entity_images'",
  )
  const createSql = String(sqlRows[0]?.sql ?? '')
  if (createSql.includes("'country'")) return

  db.run(`
    CREATE TABLE entity_images_v8 (
      entity_type TEXT NOT NULL CHECK(entity_type IN ('league', 'team', 'player', 'country')),
      entity_id TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      data BLOB NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (entity_type, entity_id)
    )
  `)
  db.run(`
    INSERT INTO entity_images_v8 (entity_type, entity_id, mime_type, data, updated_at)
    SELECT entity_type, entity_id, mime_type, data, updated_at FROM entity_images
  `)
  db.run('DROP TABLE entity_images')
  db.run('ALTER TABLE entity_images_v8 RENAME TO entity_images')
}

function ensurePlayerIdentityColumns(db: Database): void {
  if (!tableExists(db, 'edition_players')) return
  if (!columnExists(db, 'edition_players', 'country_id')) {
    db.run('ALTER TABLE edition_players ADD COLUMN country_id TEXT REFERENCES countries(id) ON DELETE SET NULL')
  }
  if (!columnExists(db, 'edition_players', 'preferred_shirt_number')) {
    db.run('ALTER TABLE edition_players ADD COLUMN preferred_shirt_number INTEGER')
  }
}

function ensureRosterShirtNumberColumn(db: Database): void {
  if (!tableExists(db, 'team_roster')) return
  if (!columnExists(db, 'team_roster', 'shirt_number')) {
    db.run('ALTER TABLE team_roster ADD COLUMN shirt_number INTEGER')
  }
}

function ensureCountriesTable(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS countries (
      id TEXT PRIMARY KEY,
      edition_id TEXT NOT NULL REFERENCES editions(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      code TEXT,
      nationality_label TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0
    )
  `)
}

function ensurePlayerAttributesTable(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS player_attributes (
      player_id TEXT PRIMARY KEY REFERENCES edition_players(id) ON DELETE CASCADE,
      pace INTEGER NOT NULL DEFAULT 65,
      acceleration INTEGER NOT NULL DEFAULT 65,
      stamina INTEGER NOT NULL DEFAULT 65,
      strength INTEGER NOT NULL DEFAULT 65,
      agility INTEGER NOT NULL DEFAULT 65,
      dribbling INTEGER NOT NULL DEFAULT 65,
      passing INTEGER NOT NULL DEFAULT 65,
      shot_power INTEGER NOT NULL DEFAULT 65,
      finishing INTEGER NOT NULL DEFAULT 65,
      tackling INTEGER NOT NULL DEFAULT 65,
      vision INTEGER NOT NULL DEFAULT 65,
      goalkeeping INTEGER NOT NULL DEFAULT 65
    )
  `)
  if (!tableExists(db, 'edition_players')) return
  const players = queryAll(db, 'SELECT id FROM edition_players')
  for (const p of players) {
    db.run(
      `INSERT OR IGNORE INTO player_attributes (
        player_id, pace, acceleration, stamina, strength, agility, dribbling,
        passing, shot_power, finishing, tackling, vision, goalkeeping
      ) VALUES (?, 65, 65, 65, 65, 65, 65, 65, 65, 65, 65, 65, 65)`,
      [p.id as string],
    )
  }
}

function migrateToV8(db: Database): void {
  ensureCountriesTable(db)
  ensurePlayerIdentityColumns(db)
  ensureRosterShirtNumberColumn(db)
  ensurePlayerAttributesTable(db)
  ensureCountryEntityImages(db)
}

function ensureLeagueCountryColumn(db: Database): void {
  if (!tableExists(db, 'leagues')) return
  if (!columnExists(db, 'leagues', 'country_id')) {
    db.run('ALTER TABLE leagues ADD COLUMN country_id TEXT REFERENCES countries(id) ON DELETE SET NULL')
  }
}

function ensureTeamNationalColumns(db: Database): void {
  if (!tableExists(db, 'teams')) return
  if (!columnExists(db, 'teams', 'country_id')) {
    db.run('ALTER TABLE teams ADD COLUMN country_id TEXT REFERENCES countries(id) ON DELETE SET NULL')
  }
  if (!columnExists(db, 'teams', 'is_national_team')) {
    db.run('ALTER TABLE teams ADD COLUMN is_national_team INTEGER NOT NULL DEFAULT 0')
  }
  if (!columnExists(db, 'teams', 'national_team_label')) {
    db.run('ALTER TABLE teams ADD COLUMN national_team_label TEXT')
  }
}

function migrateToV9(db: Database): void {
  ensureLeagueCountryColumn(db)
  ensureTeamNationalColumns(db)
}

function ensureTeamTacticsTable(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS team_tactics (
      team_id TEXT PRIMARY KEY REFERENCES teams(id) ON DELETE CASCADE,
      formation_preset_id TEXT NOT NULL DEFAULT '4-4-2',
      mentality TEXT NOT NULL DEFAULT 'balanced',
      build_up TEXT NOT NULL DEFAULT 'mixed',
      chance_creation TEXT NOT NULL DEFAULT 'balanced',
      defensive_style TEXT NOT NULL DEFAULT 'balanced',
      width INTEGER NOT NULL DEFAULT 50,
      depth INTEGER NOT NULL DEFAULT 50,
      press_intensity INTEGER NOT NULL DEFAULT 50,
      tempo INTEGER NOT NULL DEFAULT 50
    )
  `)
}

function ensureTeamFormationSlotsTable(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS team_formation_slots (
      team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      slot_index INTEGER NOT NULL,
      x REAL NOT NULL,
      z REAL NOT NULL,
      position_label TEXT NOT NULL,
      role TEXT NOT NULL,
      lane TEXT NOT NULL DEFAULT 'C',
      PRIMARY KEY (team_id, slot_index)
    )
  `)
}

function ensureTeamPlayerInstructionsTable(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS team_player_instructions (
      team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      player_id TEXT NOT NULL REFERENCES edition_players(id) ON DELETE CASCADE,
      support_runs TEXT NOT NULL DEFAULT 'balanced',
      attacking_runs TEXT NOT NULL DEFAULT 'mixed',
      interceptions TEXT NOT NULL DEFAULT 'normal',
      positioning_freedom TEXT NOT NULL DEFAULT 'balanced',
      PRIMARY KEY (team_id, player_id)
    )
  `)
}

/** Seeds táticas + postos 4-4-2 para times sem dados. */
function seedDefaultTacticsForAllTeams(db: Database): void {
  if (!tableExists(db, 'teams')) return
  const preset = FORMATION_PRESETS['4-4-2']
  const teams = queryAll(db, 'SELECT id FROM teams')
  for (const t of teams) {
    const teamId = t.id as string
    db.run(
      `INSERT OR IGNORE INTO team_tactics (
        team_id, formation_preset_id, mentality, build_up, chance_creation,
        defensive_style, width, depth, press_intensity, tempo
      ) VALUES (?, '4-4-2', 'balanced', 'mixed', 'balanced', 'balanced', 50, 50, 50, 50)`,
      [teamId],
    )
    const existingSlots = queryAll(
      db,
      'SELECT slot_index FROM team_formation_slots WHERE team_id = ?',
      [teamId],
    )
    if (existingSlots.length === 0) {
      for (let i = 0; i < preset.slots.length; i++) {
        const s = preset.slots[i]
        db.run(
          `INSERT INTO team_formation_slots (
            team_id, slot_index, x, z, position_label, role, lane
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [teamId, i, s.x, s.z, s.positionLabel, s.role, s.lane],
        )
      }
    }
  }
}

function migrateToV10(db: Database): void {
  ensureTeamTacticsTable(db)
  ensureTeamFormationSlotsTable(db)
  ensureTeamPlayerInstructionsTable(db)
  seedDefaultTacticsForAllTeams(db)
}

export function runMigrations(db: Database): void {
  const current = getSchemaVersion(db)
  if (current < 2) migrateToV2(db)
  if (getSchemaVersion(db) < 3) migrateToV3(db)
  if (getSchemaVersion(db) < 4) migrateToV4(db)
  if (getSchemaVersion(db) < 5) migrateToV5(db)
  if (getSchemaVersion(db) < 6) migrateToV6(db)
  if (getSchemaVersion(db) < 7) migrateToV7(db)
  if (getSchemaVersion(db) < 8) migrateToV8(db)
  if (getSchemaVersion(db) < 9) migrateToV9(db)
  if (getSchemaVersion(db) < 10) migrateToV10(db)
  // Sempre garante patches (HMR / DB com version bump sem ALTER)
  ensureEditionPlayerCustomGlbColumn(db)
  ensureCountriesTable(db)
  ensurePlayerIdentityColumns(db)
  ensureRosterShirtNumberColumn(db)
  ensurePlayerAttributesTable(db)
  ensureCountryEntityImages(db)
  ensureLeagueCountryColumn(db)
  ensureTeamNationalColumns(db)
  ensureTeamTacticsTable(db)
  ensureTeamFormationSlotsTable(db)
  ensureTeamPlayerInstructionsTable(db)
  seedDefaultTacticsForAllTeams(db)
  if (getSchemaVersion(db) < SCHEMA_VERSION) setSchemaVersion(db, SCHEMA_VERSION)
  persistDatabase()
}

/** Garante colunas críticas sem depender só do número de versão. */
export function ensureSchemaPatches(db: Database): void {
  ensureEditionPlayerCustomGlbColumn(db)
  ensureCountriesTable(db)
  ensurePlayerIdentityColumns(db)
  ensureRosterShirtNumberColumn(db)
  ensurePlayerAttributesTable(db)
  ensureCountryEntityImages(db)
  ensureLeagueCountryColumn(db)
  ensureTeamNationalColumns(db)
  ensureTeamTacticsTable(db)
  ensureTeamFormationSlotsTable(db)
  ensureTeamPlayerInstructionsTable(db)
  seedDefaultTacticsForAllTeams(db)
}

export function normalizeSkinTone(value: string): string {
  return isSkinToneId(value) ? value : 'medium'
}
