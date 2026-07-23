import type { Database, SqlValue } from 'sql.js'
import { persistDatabase } from './database'
import { deleteEntityImage } from './imageQueries'
import { deletePlayerGlb } from './playerGlbStore'
import { deleteTeamKitShirtsForTeam } from './shirtTextureQueries'
import { normalizeSkinTone } from './migrate'
import {
  clampPlayerAttr,
  clampPlayerAttributes,
  createDefaultPlayerAttributes,
  derivePlayerOverall,
  resolveShirtNumber,
  type PlayerAttributes,
  type PlayerAttrKey,
} from './playerAttributeDefaults'
import {
  DEFAULT_PLAYER_INSTRUCTIONS,
  DEFAULT_TEAM_TACTICS,
  FORMATION_PRESETS,
  MAX_SQUAD_SIZE,
  STARTING_XI_SIZE,
  clampTacticSlider,
  getFormationPreset,
  inferLane,
  roleFromPositionLabel,
  type FormationLane,
  type FormationPresetId,
  type PlayerInstructionsData,
  type TeamTacticsData,
} from '../game/data/formations'
import type { PlayerRole } from '../game/types'
import type { SkinToneId } from './skinTones'
import type {
  Country,
  Edition,
  EditionPlayer,
  League,
  RosterSlot,
  Team,
  TeamFormationSlot,
  TeamKit,
  TeamTactics,
  TeamWithRoster,
} from './types'

function uid(): string {
  return crypto.randomUUID()
}

function rowToEdition(row: Record<string, unknown>): Edition {
  return {
    id: row.id as string,
    name: row.name as string,
    createdAt: row.created_at as number,
  }
}

function rowToLeague(row: Record<string, unknown>): League {
  return {
    id: row.id as string,
    editionId: row.edition_id as string,
    name: row.name as string,
    countryId: (row.country_id as string | null) ?? null,
    sortOrder: row.sort_order as number,
  }
}

function rowToTeam(row: Record<string, unknown>): Team {
  return {
    id: row.id as string,
    editionId: row.edition_id as string,
    leagueId: (row.league_id as string | null) ?? null,
    countryId: (row.country_id as string | null) ?? null,
    name: row.name as string,
    shortName: (row.short_name as string | null) ?? null,
    primaryColor: row.primary_color as string,
    secondaryColor: (row.secondary_color as string | null) ?? null,
    gkColor: row.gk_color as string,
    isNationalTeam: Number(row.is_national_team ?? 0) !== 0,
    nationalTeamLabel: (row.national_team_label as string | null) ?? null,
    sortOrder: row.sort_order as number,
  }
}

function rowToCountry(row: Record<string, unknown>): Country {
  return {
    id: row.id as string,
    editionId: row.edition_id as string,
    name: row.name as string,
    code: (row.code as string | null) ?? null,
    nationalityLabel: (row.nationality_label as string | null) ?? null,
    sortOrder: row.sort_order as number,
  }
}

const ATTR_SQL_COLS: { key: PlayerAttrKey; col: string }[] = [
  { key: 'pace', col: 'pace' },
  { key: 'acceleration', col: 'acceleration' },
  { key: 'stamina', col: 'stamina' },
  { key: 'strength', col: 'strength' },
  { key: 'agility', col: 'agility' },
  { key: 'dribbling', col: 'dribbling' },
  { key: 'passing', col: 'passing' },
  { key: 'shotPower', col: 'shot_power' },
  { key: 'finishing', col: 'finishing' },
  { key: 'tackling', col: 'tackling' },
  { key: 'vision', col: 'vision' },
  { key: 'goalkeeping', col: 'goalkeeping' },
]

function rowToAttributes(row: Record<string, unknown> | null | undefined): PlayerAttributes {
  if (!row) return createDefaultPlayerAttributes()
  const partial: Partial<PlayerAttributes> = {}
  for (const { key, col } of ATTR_SQL_COLS) {
    const raw = row[col] ?? row[key]
    if (typeof raw === 'number') partial[key] = raw
  }
  return clampPlayerAttributes(partial)
}

function insertDefaultPlayerAttributes(db: Database, playerId: string): void {
  runAndPersist(
    db,
    `INSERT OR IGNORE INTO player_attributes (
      player_id, pace, acceleration, stamina, strength, agility, dribbling,
      passing, shot_power, finishing, tackling, vision, goalkeeping
    ) VALUES (?, 65, 65, 65, 65, 65, 65, 65, 65, 65, 65, 65, 65)`,
    [playerId],
  )
}

function getPlayerAttributes(db: Database, playerId: string): PlayerAttributes {
  const rows = queryAll(db, 'SELECT * FROM player_attributes WHERE player_id = ?', [playerId])
  if (!rows[0]) {
    insertDefaultPlayerAttributes(db, playerId)
    return createDefaultPlayerAttributes()
  }
  return rowToAttributes(rows[0])
}

function rowToEditionPlayer(
  row: Record<string, unknown>,
  attributes?: PlayerAttributes,
): EditionPlayer {
  return {
    id: row.id as string,
    editionId: row.edition_id as string,
    name: row.name as string,
    skinTone: normalizeSkinTone(row.skin_tone as string) as SkinToneId,
    countryId: (row.country_id as string | null) ?? null,
    preferredShirtNumber:
      typeof row.preferred_shirt_number === 'number' ? row.preferred_shirt_number : null,
    hasCustomGlb: Number(row.has_custom_glb ?? 0) !== 0,
    createdAt: row.created_at as number,
    attributes: attributes ?? createDefaultPlayerAttributes(),
  }
}

function mapRosterRow(row: Record<string, unknown>): RosterSlot {
  const attributes = rowToAttributes(row)
  const slotIndex = row.slot_index as number
  const positionLabel = row.position_label as string
  const preferred =
    typeof row.preferred_shirt_number === 'number' ? row.preferred_shirt_number : null
  const override = typeof row.shirt_number === 'number' ? row.shirt_number : null
  const instructions: PlayerInstructionsData = {
    supportRuns:
      (row.support_runs as PlayerInstructionsData['supportRuns']) ??
      DEFAULT_PLAYER_INSTRUCTIONS.supportRuns,
    attackingRuns:
      (row.attacking_runs as PlayerInstructionsData['attackingRuns']) ??
      DEFAULT_PLAYER_INSTRUCTIONS.attackingRuns,
    interceptions:
      (row.interceptions as PlayerInstructionsData['interceptions']) ??
      DEFAULT_PLAYER_INSTRUCTIONS.interceptions,
    positioningFreedom:
      (row.positioning_freedom as PlayerInstructionsData['positioningFreedom']) ??
      DEFAULT_PLAYER_INSTRUCTIONS.positioningFreedom,
  }
  return {
    id: row.id as string,
    teamId: row.team_id as string,
    playerId: row.player_id as string,
    slotIndex,
    positionLabel,
    shirtNumberOverride: override,
    shirtNumber: resolveShirtNumber({
      rosterOverride: override,
      preferred,
      slotIndex,
    }),
    name: row.name as string,
    skinTone: normalizeSkinTone(row.skin_tone as string) as SkinToneId,
    hasCustomGlb: Number(row.has_custom_glb ?? 0) !== 0,
    countryId: (row.country_id as string | null) ?? null,
    nationalityLabel: (row.nationality_label as string | null) ?? null,
    countryName: (row.country_name as string | null) ?? null,
    preferredShirtNumber: preferred,
    attributes,
    overall: derivePlayerOverall(attributes, positionLabel),
    instructions,
  }
}

function rowToTeamKit(row: Record<string, unknown>): TeamKit {
  return {
    teamId: row.team_id as string,
    kitNumber: row.kit_number as 1 | 2,
    shirtColor: row.shirt_color as string,
    shortsColor: row.shorts_color as string,
    socksColor: row.socks_color as string,
  }
}

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

function syncTeamLegacyColors(db: Database, teamId: string): void {
  const kits = listTeamKits(db, teamId)
  const kit1 = kits.find((k) => k.kitNumber === 1)
  if (!kit1) return
  runAndPersist(
    db,
    'UPDATE teams SET primary_color = ?, secondary_color = ? WHERE id = ?',
    [kit1.shirtColor, kit1.shortsColor, teamId],
  )
}

function seedTeamKits(
  db: Database,
  teamId: string,
  primary: string,
  secondary: string | null,
): void {
  const kit2Shirt = secondary ?? primary
  const shorts1 = secondary ?? '#1a1a2e'
  runAndPersist(
    db,
    `INSERT INTO team_kits (team_id, kit_number, shirt_color, shorts_color, socks_color)
     VALUES (?, 1, ?, ?, ?)`,
    [teamId, primary, shorts1, primary],
  )
  runAndPersist(
    db,
    `INSERT INTO team_kits (team_id, kit_number, shirt_color, shorts_color, socks_color)
     VALUES (?, 2, ?, ?, ?)`,
    [teamId, kit2Shirt, '#1a1a2e', kit2Shirt],
  )
}

function seedTeamRoster(db: Database, teamId: string, editionId: string, names?: string[]): void {
  const preset = FORMATION_PRESETS['4-4-2']
  for (let i = 0; i < STARTING_XI_SIZE; i++) {
    const playerId = uid()
    const name = names?.[i] ?? `Jogador ${i + 1}`
    const pos = preset.slots[i]?.positionLabel ?? 'CM'
    runAndPersist(
      db,
      'INSERT INTO edition_players (id, edition_id, name, skin_tone, has_custom_glb, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [playerId, editionId, name, 'medium', 0, Date.now()],
    )
    insertDefaultPlayerAttributes(db, playerId)
    runAndPersist(
      db,
      'INSERT INTO team_roster (id, team_id, player_id, slot_index, position_label) VALUES (?, ?, ?, ?, ?)',
      [uid(), teamId, playerId, i, pos],
    )
  }
  ensureTeamTacticsDefaults(db, teamId)
}

export function listEditions(db: Database): Edition[] {
  return queryAll(db, 'SELECT * FROM editions ORDER BY created_at DESC').map(rowToEdition)
}

export function getActiveEditionId(db: Database): string | null {
  const rows = queryAll(db, "SELECT value FROM settings WHERE key = 'active_edition_id'")
  return (rows[0]?.value as string | undefined) ?? null
}

export function setActiveEditionId(db: Database, editionId: string): void {
  runAndPersist(
    db,
    'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
    ['active_edition_id', editionId],
  )
}

export function createEdition(db: Database, name: string): Edition {
  const edition: Edition = { id: uid(), name, createdAt: Date.now() }
  runAndPersist(db, 'INSERT INTO editions (id, name, created_at) VALUES (?, ?, ?)', [
    edition.id,
    edition.name,
    edition.createdAt,
  ])
  return edition
}

export function updateEdition(db: Database, id: string, name: string): void {
  runAndPersist(db, 'UPDATE editions SET name = ? WHERE id = ?', [name, id])
}

export function deleteEdition(db: Database, id: string): void {
  const leagues = listLeagues(db, id)
  const teams = listTeams(db, id)
  const players = listEditionPlayers(db, id)
  const countries = listCountries(db, id)
  for (const p of players) {
    deleteEntityImage(db, 'player', p.id)
    void deletePlayerGlb(p.id)
  }
  for (const t of teams) deleteEntityImage(db, 'team', t.id)
  for (const l of leagues) deleteEntityImage(db, 'league', l.id)
  for (const c of countries) deleteEntityImage(db, 'country', c.id)
  runAndPersist(db, 'DELETE FROM editions WHERE id = ?', [id])
  const active = getActiveEditionId(db)
  if (active === id) {
    const next = listEditions(db)[0]
    if (next) setActiveEditionId(db, next.id)
    else db.run("DELETE FROM settings WHERE key = 'active_edition_id'")
  }
}

export function listLeagues(db: Database, editionId: string): League[] {
  return queryAll(
    db,
    'SELECT * FROM leagues WHERE edition_id = ? ORDER BY sort_order, name',
    [editionId],
  ).map(rowToLeague)
}

export function listCountries(db: Database, editionId: string): Country[] {
  return queryAll(
    db,
    'SELECT * FROM countries WHERE edition_id = ? ORDER BY sort_order, name',
    [editionId],
  ).map(rowToCountry)
}

export function getCountry(db: Database, countryId: string): Country | null {
  const rows = queryAll(db, 'SELECT * FROM countries WHERE id = ?', [countryId])
  return rows[0] ? rowToCountry(rows[0]) : null
}

export function createCountry(
  db: Database,
  editionId: string,
  data: { name: string; code?: string | null; nationalityLabel?: string | null },
): Country {
  const countries = listCountries(db, editionId)
  const country: Country = {
    id: uid(),
    editionId,
    name: data.name.trim(),
    code: data.code?.trim() || null,
    nationalityLabel: data.nationalityLabel?.trim() || null,
    sortOrder: countries.length,
  }
  runAndPersist(
    db,
    `INSERT INTO countries (id, edition_id, name, code, nationality_label, sort_order)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      country.id,
      country.editionId,
      country.name,
      country.code,
      country.nationalityLabel,
      country.sortOrder,
    ],
  )
  return country
}

export function updateCountry(
  db: Database,
  id: string,
  data: { name: string; code?: string | null; nationalityLabel?: string | null; sortOrder?: number },
): void {
  runAndPersist(
    db,
    `UPDATE countries SET name = ?, code = ?, nationality_label = ?, sort_order = COALESCE(?, sort_order)
     WHERE id = ?`,
    [
      data.name.trim(),
      data.code?.trim() || null,
      data.nationalityLabel?.trim() || null,
      data.sortOrder ?? null,
      id,
    ],
  )
}

export function deleteCountry(db: Database, id: string): void {
  deleteEntityImage(db, 'country', id)
  runAndPersist(db, 'UPDATE edition_players SET country_id = NULL WHERE country_id = ?', [id])
  runAndPersist(db, 'DELETE FROM countries WHERE id = ?', [id])
}

export function reorderCountries(db: Database, orderedIds: string[]): void {
  orderedIds.forEach((id, index) => {
    db.run('UPDATE countries SET sort_order = ? WHERE id = ?', [index, id])
  })
  persistDatabase()
}

export function createLeague(db: Database, editionId: string, name: string): League {
  const leagues = listLeagues(db, editionId)
  const league: League = {
    id: uid(),
    editionId,
    name,
    countryId: null,
    sortOrder: leagues.length,
  }
  runAndPersist(
    db,
    'INSERT INTO leagues (id, edition_id, name, sort_order) VALUES (?, ?, ?, ?)',
    [league.id, league.editionId, league.name, league.sortOrder],
  )
  return league
}

export function updateLeague(
  db: Database,
  id: string,
  name: string,
  data?: { countryId?: string | null },
): void {
  runAndPersist(db, 'UPDATE leagues SET name = ? WHERE id = ?', [name, id])
  if (data && data.countryId !== undefined) {
    runAndPersist(db, 'UPDATE leagues SET country_id = ? WHERE id = ?', [data.countryId, id])
  }
}

export function setLeagueCountry(db: Database, id: string, countryId: string | null): void {
  runAndPersist(db, 'UPDATE leagues SET country_id = ? WHERE id = ?', [countryId, id])
}

export function deleteLeague(db: Database, id: string): void {
  deleteEntityImage(db, 'league', id)
  runAndPersist(db, 'UPDATE teams SET league_id = NULL WHERE league_id = ?', [id])
  runAndPersist(db, 'DELETE FROM leagues WHERE id = ?', [id])
}

export function listTeams(db: Database, editionId: string): Team[] {
  return queryAll(
    db,
    'SELECT * FROM teams WHERE edition_id = ? ORDER BY sort_order, name',
    [editionId],
  ).map(rowToTeam)
}

export function listTeamsByLeague(db: Database, leagueId: string): Team[] {
  return queryAll(
    db,
    'SELECT * FROM teams WHERE league_id = ? ORDER BY sort_order, name',
    [leagueId],
  ).map(rowToTeam)
}

export function listTeamsWithoutLeague(db: Database, editionId: string): Team[] {
  return queryAll(
    db,
    'SELECT * FROM teams WHERE edition_id = ? AND league_id IS NULL ORDER BY sort_order, name',
    [editionId],
  ).map(rowToTeam)
}

export function getTeam(db: Database, teamId: string): Team | null {
  const rows = queryAll(db, 'SELECT * FROM teams WHERE id = ?', [teamId])
  return rows[0] ? rowToTeam(rows[0]) : null
}

export function listTeamKits(db: Database, teamId: string): TeamKit[] {
  return queryAll(
    db,
    'SELECT * FROM team_kits WHERE team_id = ? ORDER BY kit_number',
    [teamId],
  ).map(rowToTeamKit)
}

export function upsertTeamKit(
  db: Database,
  teamId: string,
  kitNumber: 1 | 2,
  data: { shirtColor: string; shortsColor: string; socksColor: string },
): void {
  runAndPersist(
    db,
    `INSERT INTO team_kits (team_id, kit_number, shirt_color, shorts_color, socks_color)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(team_id, kit_number) DO UPDATE SET
       shirt_color = excluded.shirt_color,
       shorts_color = excluded.shorts_color,
       socks_color = excluded.socks_color`,
    [teamId, kitNumber, data.shirtColor, data.shortsColor, data.socksColor],
  )
  if (kitNumber === 1) syncTeamLegacyColors(db, teamId)
}

export function listRoster(db: Database, teamId: string): RosterSlot[] {
  return queryAll(
    db,
    `SELECT r.id, r.team_id, r.player_id, r.slot_index, r.position_label, r.shirt_number,
            p.name, p.skin_tone, p.has_custom_glb, p.country_id, p.preferred_shirt_number,
            c.name AS country_name, c.nationality_label,
            a.pace, a.acceleration, a.stamina, a.strength, a.agility, a.dribbling,
            a.passing, a.shot_power, a.finishing, a.tackling, a.vision, a.goalkeeping,
            i.support_runs, i.attacking_runs, i.interceptions, i.positioning_freedom
     FROM team_roster r
     JOIN edition_players p ON p.id = r.player_id
     LEFT JOIN countries c ON c.id = p.country_id
     LEFT JOIN player_attributes a ON a.player_id = p.id
     LEFT JOIN team_player_instructions i ON i.team_id = r.team_id AND i.player_id = r.player_id
     WHERE r.team_id = ?
     ORDER BY r.slot_index`,
    [teamId],
  ).map(mapRosterRow)
}

function rowToFormationSlot(row: Record<string, unknown>): TeamFormationSlot {
  return {
    teamId: row.team_id as string,
    slotIndex: row.slot_index as number,
    x: row.x as number,
    z: row.z as number,
    positionLabel: row.position_label as string,
    role: row.role as PlayerRole,
    lane: (row.lane as FormationLane) ?? inferLane(row.x as number),
  }
}

function rowToTactics(row: Record<string, unknown>, teamId: string): TeamTactics {
  return {
    teamId,
    formationPresetId: (row.formation_preset_id as FormationPresetId) ?? '4-4-2',
    mentality: (row.mentality as TeamTacticsData['mentality']) ?? 'balanced',
    buildUp: (row.build_up as TeamTacticsData['buildUp']) ?? 'mixed',
    chanceCreation: (row.chance_creation as TeamTacticsData['chanceCreation']) ?? 'balanced',
    defensiveStyle: (row.defensive_style as TeamTacticsData['defensiveStyle']) ?? 'balanced',
    width: clampTacticSlider(Number(row.width ?? 50)),
    depth: clampTacticSlider(Number(row.depth ?? 50)),
    pressIntensity: clampTacticSlider(Number(row.press_intensity ?? 50)),
    tempo: clampTacticSlider(Number(row.tempo ?? 50)),
  }
}

export function ensureTeamTacticsDefaults(db: Database, teamId: string): void {
  const preset = FORMATION_PRESETS['4-4-2']
  runAndPersist(
    db,
    `INSERT OR IGNORE INTO team_tactics (
      team_id, formation_preset_id, mentality, build_up, chance_creation,
      defensive_style, width, depth, press_intensity, tempo
    ) VALUES (?, '4-4-2', 'balanced', 'mixed', 'balanced', 'balanced', 50, 50, 50, 50)`,
    [teamId],
  )
  const existing = queryAll(
    db,
    'SELECT slot_index FROM team_formation_slots WHERE team_id = ?',
    [teamId],
  )
  if (existing.length === 0) {
    for (let i = 0; i < preset.slots.length; i++) {
      const s = preset.slots[i]
      runAndPersist(
        db,
        `INSERT INTO team_formation_slots (
          team_id, slot_index, x, z, position_label, role, lane
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [teamId, i, s.x, s.z, s.positionLabel, s.role, s.lane],
      )
    }
  }
}

export function getTeamTactics(db: Database, teamId: string): TeamTactics {
  ensureTeamTacticsDefaults(db, teamId)
  const rows = queryAll(db, 'SELECT * FROM team_tactics WHERE team_id = ?', [teamId])
  if (!rows[0]) {
    return { teamId, ...DEFAULT_TEAM_TACTICS }
  }
  return rowToTactics(rows[0], teamId)
}

export function listFormationSlots(db: Database, teamId: string): TeamFormationSlot[] {
  ensureTeamTacticsDefaults(db, teamId)
  const rows = queryAll(
    db,
    'SELECT * FROM team_formation_slots WHERE team_id = ? ORDER BY slot_index',
    [teamId],
  )
  if (rows.length === 11) return rows.map(rowToFormationSlot)
  const preset = getFormationPreset(getTeamTactics(db, teamId).formationPresetId)
  return preset.slots.map((s, i) => ({
    teamId,
    slotIndex: i,
    x: s.x,
    z: s.z,
    positionLabel: s.positionLabel,
    role: s.role,
    lane: s.lane,
  }))
}

export function getTeamWithRoster(
  db: Database,
  teamId: string,
  matchKit: 1 | 2 = 1,
): TeamWithRoster | null {
  const team = getTeam(db, teamId)
  if (!team) return null
  const tactics = getTeamTactics(db, teamId)
  const formationSlots = listFormationSlots(db, teamId)
  return {
    ...team,
    kits: listTeamKits(db, teamId),
    roster: listRoster(db, teamId),
    matchKit,
    tactics,
    formationSlots,
    formationPresetId: tactics.formationPresetId,
  }
}

/** Alias */
export const getTeamWithPlayers = getTeamWithRoster

export function createTeam(
  db: Database,
  editionId: string,
  data: {
    name: string
    shortName?: string
    primaryColor: string
    secondaryColor?: string
    gkColor: string
    leagueId?: string | null
    countryId?: string | null
    isNationalTeam?: boolean
    nationalTeamLabel?: string | null
    rosterNames?: string[]
  },
): Team {
  const teams = listTeams(db, editionId)
  const team: Team = {
    id: uid(),
    editionId,
    leagueId: data.leagueId ?? null,
    countryId: data.countryId ?? null,
    name: data.name,
    shortName: data.shortName ?? null,
    primaryColor: data.primaryColor,
    secondaryColor: data.secondaryColor ?? null,
    gkColor: data.gkColor,
    isNationalTeam: data.isNationalTeam ?? false,
    nationalTeamLabel: data.nationalTeamLabel ?? null,
    sortOrder: teams.length,
  }
  runAndPersist(
    db,
    `INSERT INTO teams (
       id, edition_id, league_id, country_id, name, short_name,
       primary_color, secondary_color, gk_color,
       is_national_team, national_team_label, sort_order
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      team.id,
      team.editionId,
      team.leagueId,
      team.countryId,
      team.name,
      team.shortName,
      team.primaryColor,
      team.secondaryColor,
      team.gkColor,
      team.isNationalTeam ? 1 : 0,
      team.nationalTeamLabel,
      team.sortOrder,
    ],
  )
  seedTeamKits(db, team.id, data.primaryColor, data.secondaryColor ?? null)
  seedTeamRoster(db, team.id, editionId, data.rosterNames)
  return team
}

export function updateTeam(
  db: Database,
  id: string,
  data: {
    name: string
    shortName?: string | null
    primaryColor: string
    secondaryColor?: string | null
    gkColor: string
    leagueId?: string | null
    countryId?: string | null
    isNationalTeam?: boolean
    nationalTeamLabel?: string | null
  },
): void {
  runAndPersist(
    db,
    `UPDATE teams SET name = ?, short_name = ?, primary_color = ?, secondary_color = ?, gk_color = ?, league_id = ?
     WHERE id = ?`,
    [
      data.name,
      data.shortName ?? null,
      data.primaryColor,
      data.secondaryColor ?? null,
      data.gkColor,
      data.leagueId ?? null,
      id,
    ],
  )
  if (data.countryId !== undefined) {
    runAndPersist(db, 'UPDATE teams SET country_id = ? WHERE id = ?', [data.countryId, id])
  }
  if (data.isNationalTeam !== undefined) {
    runAndPersist(db, 'UPDATE teams SET is_national_team = ? WHERE id = ?', [
      data.isNationalTeam ? 1 : 0,
      id,
    ])
  }
  if (data.nationalTeamLabel !== undefined) {
    runAndPersist(db, 'UPDATE teams SET national_team_label = ? WHERE id = ?', [
      data.nationalTeamLabel,
      id,
    ])
  }
}

/** Seleções nacionais de um país (N variantes: principal, sub-20, etc.). */
export function listNationalTeams(db: Database, countryId: string): Team[] {
  return queryAll(
    db,
    'SELECT * FROM teams WHERE country_id = ? AND is_national_team = 1 ORDER BY sort_order, name',
    [countryId],
  ).map(rowToTeam)
}

export function deleteTeam(db: Database, id: string): void {
  deleteEntityImage(db, 'team', id)
  deleteTeamKitShirtsForTeam(db, id)
  runAndPersist(db, 'DELETE FROM teams WHERE id = ?', [id])
}

export function listEditionPlayers(db: Database, editionId: string): EditionPlayer[] {
  return queryAll(
    db,
    `SELECT p.*, a.pace, a.acceleration, a.stamina, a.strength, a.agility, a.dribbling,
            a.passing, a.shot_power, a.finishing, a.tackling, a.vision, a.goalkeeping
     FROM edition_players p
     LEFT JOIN player_attributes a ON a.player_id = p.id
     WHERE p.edition_id = ?
     ORDER BY p.name`,
    [editionId],
  ).map((row) => rowToEditionPlayer(row, rowToAttributes(row)))
}

export function getEditionPlayer(db: Database, playerId: string): EditionPlayer | null {
  const rows = queryAll(
    db,
    `SELECT p.*, a.pace, a.acceleration, a.stamina, a.strength, a.agility, a.dribbling,
            a.passing, a.shot_power, a.finishing, a.tackling, a.vision, a.goalkeeping
     FROM edition_players p
     LEFT JOIN player_attributes a ON a.player_id = p.id
     WHERE p.id = ?`,
    [playerId],
  )
  return rows[0] ? rowToEditionPlayer(rows[0], rowToAttributes(rows[0])) : null
}

export function createEditionPlayer(
  db: Database,
  editionId: string,
  data: {
    name: string
    skinTone?: SkinToneId
    countryId?: string | null
    preferredShirtNumber?: number | null
    attributes?: Partial<PlayerAttributes>
  },
): EditionPlayer {
  const attributes = clampPlayerAttributes(data.attributes)
  const preferred =
    typeof data.preferredShirtNumber === 'number'
      ? clampPlayerAttr(data.preferredShirtNumber)
      : null
  const player: EditionPlayer = {
    id: uid(),
    editionId,
    name: data.name,
    skinTone: data.skinTone ?? 'medium',
    countryId: data.countryId ?? null,
    preferredShirtNumber: preferred,
    hasCustomGlb: false,
    createdAt: Date.now(),
    attributes,
  }
  runAndPersist(
    db,
    `INSERT INTO edition_players (
      id, edition_id, name, skin_tone, country_id, preferred_shirt_number, has_custom_glb, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      player.id,
      player.editionId,
      player.name,
      player.skinTone,
      player.countryId,
      player.preferredShirtNumber,
      0,
      player.createdAt,
    ],
  )
  runAndPersist(
    db,
    `INSERT INTO player_attributes (
      player_id, pace, acceleration, stamina, strength, agility, dribbling,
      passing, shot_power, finishing, tackling, vision, goalkeeping
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      player.id,
      attributes.pace,
      attributes.acceleration,
      attributes.stamina,
      attributes.strength,
      attributes.agility,
      attributes.dribbling,
      attributes.passing,
      attributes.shotPower,
      attributes.finishing,
      attributes.tackling,
      attributes.vision,
      attributes.goalkeeping,
    ],
  )
  return player
}

export function updateEditionPlayer(
  db: Database,
  id: string,
  data: {
    name: string
    skinTone: SkinToneId
    countryId?: string | null
    preferredShirtNumber?: number | null
    attributes?: Partial<PlayerAttributes>
  },
): void {
  const preferred =
    data.preferredShirtNumber === undefined
      ? undefined
      : data.preferredShirtNumber == null
        ? null
        : clampPlayerAttr(data.preferredShirtNumber)

  if (data.countryId !== undefined && preferred !== undefined) {
    runAndPersist(
      db,
      `UPDATE edition_players SET name = ?, skin_tone = ?, country_id = ?, preferred_shirt_number = ?
       WHERE id = ?`,
      [data.name, data.skinTone, data.countryId, preferred, id],
    )
  } else if (data.countryId !== undefined) {
    runAndPersist(
      db,
      'UPDATE edition_players SET name = ?, skin_tone = ?, country_id = ? WHERE id = ?',
      [data.name, data.skinTone, data.countryId, id],
    )
  } else if (preferred !== undefined) {
    runAndPersist(
      db,
      'UPDATE edition_players SET name = ?, skin_tone = ?, preferred_shirt_number = ? WHERE id = ?',
      [data.name, data.skinTone, preferred, id],
    )
  } else {
    runAndPersist(db, 'UPDATE edition_players SET name = ?, skin_tone = ? WHERE id = ?', [
      data.name,
      data.skinTone,
      id,
    ])
  }
  if (data.attributes) {
    updatePlayerAttributes(db, id, data.attributes)
  }
}

export function updatePlayerAttributes(
  db: Database,
  playerId: string,
  partial: Partial<PlayerAttributes>,
): PlayerAttributes {
  const current = getPlayerAttributes(db, playerId)
  const next = clampPlayerAttributes({ ...current, ...partial })
  runAndPersist(
    db,
    `INSERT INTO player_attributes (
      player_id, pace, acceleration, stamina, strength, agility, dribbling,
      passing, shot_power, finishing, tackling, vision, goalkeeping
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(player_id) DO UPDATE SET
      pace = excluded.pace,
      acceleration = excluded.acceleration,
      stamina = excluded.stamina,
      strength = excluded.strength,
      agility = excluded.agility,
      dribbling = excluded.dribbling,
      passing = excluded.passing,
      shot_power = excluded.shot_power,
      finishing = excluded.finishing,
      tackling = excluded.tackling,
      vision = excluded.vision,
      goalkeeping = excluded.goalkeeping`,
    [
      playerId,
      next.pace,
      next.acceleration,
      next.stamina,
      next.strength,
      next.agility,
      next.dribbling,
      next.passing,
      next.shotPower,
      next.finishing,
      next.tackling,
      next.vision,
      next.goalkeeping,
    ],
  )
  return next
}

export function setEditionPlayerHasCustomGlb(
  db: Database,
  id: string,
  hasCustomGlb: boolean,
): void {
  runAndPersist(db, 'UPDATE edition_players SET has_custom_glb = ? WHERE id = ?', [
    hasCustomGlb ? 1 : 0,
    id,
  ])
}

export function deleteEditionPlayer(db: Database, id: string): void {
  deleteEntityImage(db, 'player', id)
  void deletePlayerGlb(id)
  runAndPersist(db, 'DELETE FROM edition_players WHERE id = ?', [id])
}

export function listPlayerTeamNames(db: Database, playerId: string): string[] {
  return queryAll(
    db,
    `SELECT t.name FROM team_roster r
     JOIN teams t ON t.id = r.team_id
     WHERE r.player_id = ?
     ORDER BY t.name`,
    [playerId],
  ).map((row) => row.name as string)
}

function isShirtNumberTaken(
  db: Database,
  teamId: string,
  shirtNumber: number,
  excludeSlotIndex?: number,
): boolean {
  const roster = listRoster(db, teamId)
  return roster.some(
    (slot) =>
      slot.slotIndex !== excludeSlotIndex &&
      slot.shirtNumber === shirtNumber,
  )
}

export function setRosterSlot(
  db: Database,
  teamId: string,
  slotIndex: number,
  playerId: string,
  positionLabel: string,
  shirtNumber?: number | null,
): void {
  runAndPersist(
    db,
    'DELETE FROM team_roster WHERE team_id = ? AND player_id = ? AND slot_index != ?',
    [teamId, playerId, slotIndex],
  )

  const existing = queryAll(
    db,
    'SELECT id FROM team_roster WHERE team_id = ? AND slot_index = ?',
    [teamId, slotIndex],
  )
  if (existing[0]) {
    runAndPersist(
      db,
      'UPDATE team_roster SET player_id = ?, position_label = ? WHERE team_id = ? AND slot_index = ?',
      [playerId, positionLabel, teamId, slotIndex],
    )
  } else {
    runAndPersist(
      db,
      'INSERT INTO team_roster (id, team_id, player_id, slot_index, position_label) VALUES (?, ?, ?, ?, ?)',
      [uid(), teamId, playerId, slotIndex, positionLabel],
    )
  }
  if (shirtNumber !== undefined) {
    setRosterShirtNumber(db, teamId, slotIndex, shirtNumber)
  }
}

export function setRosterShirtNumber(
  db: Database,
  teamId: string,
  slotIndex: number,
  shirtNumber: number | null,
): void {
  if (shirtNumber != null) {
    const n = clampPlayerAttr(shirtNumber)
    if (isShirtNumberTaken(db, teamId, n, slotIndex)) {
      throw new Error(`Número ${n} já está em uso neste time.`)
    }
    runAndPersist(
      db,
      'UPDATE team_roster SET shirt_number = ? WHERE team_id = ? AND slot_index = ?',
      [n, teamId, slotIndex],
    )
    return
  }
  runAndPersist(
    db,
    'UPDATE team_roster SET shirt_number = NULL WHERE team_id = ? AND slot_index = ?',
    [teamId, slotIndex],
  )
}

export function updateRosterPosition(
  db: Database,
  teamId: string,
  slotIndex: number,
  positionLabel: string,
): void {
  runAndPersist(
    db,
    'UPDATE team_roster SET position_label = ? WHERE team_id = ? AND slot_index = ?',
    [positionLabel, teamId, slotIndex],
  )
}

/** @deprecated use listRoster */
export function listPlayers(db: Database, teamId: string): RosterSlot[] {
  return listRoster(db, teamId)
}

export function updatePlayer(
  db: Database,
  id: string,
  data: { name: string; positionLabel: string },
): void {
  const rosterRow = queryAll(db, 'SELECT player_id FROM team_roster WHERE id = ?', [id])
  if (!rosterRow[0]) return
  runAndPersist(db, 'UPDATE edition_players SET name = ? WHERE id = ?', [
    data.name,
    rosterRow[0].player_id as string,
  ])
  runAndPersist(db, 'UPDATE team_roster SET position_label = ? WHERE id = ?', [
    data.positionLabel,
    id,
  ])
}

export function updateTeamTactics(
  db: Database,
  teamId: string,
  patch: Partial<TeamTacticsData>,
): TeamTactics {
  ensureTeamTacticsDefaults(db, teamId)
  const current = getTeamTactics(db, teamId)
  const next: TeamTacticsData = {
    formationPresetId: patch.formationPresetId ?? current.formationPresetId,
    mentality: patch.mentality ?? current.mentality,
    buildUp: patch.buildUp ?? current.buildUp,
    chanceCreation: patch.chanceCreation ?? current.chanceCreation,
    defensiveStyle: patch.defensiveStyle ?? current.defensiveStyle,
    width: clampTacticSlider(patch.width ?? current.width),
    depth: clampTacticSlider(patch.depth ?? current.depth),
    pressIntensity: clampTacticSlider(patch.pressIntensity ?? current.pressIntensity),
    tempo: clampTacticSlider(patch.tempo ?? current.tempo),
  }
  runAndPersist(
    db,
    `UPDATE team_tactics SET
      formation_preset_id = ?, mentality = ?, build_up = ?, chance_creation = ?,
      defensive_style = ?, width = ?, depth = ?, press_intensity = ?, tempo = ?
     WHERE team_id = ?`,
    [
      next.formationPresetId,
      next.mentality,
      next.buildUp,
      next.chanceCreation,
      next.defensiveStyle,
      next.width,
      next.depth,
      next.pressIntensity,
      next.tempo,
      teamId,
    ],
  )
  return { teamId, ...next }
}

/** Aplica preset sobrescrevendo os 11 postos; sincroniza labels dos titulares. */
export function applyFormationPreset(
  db: Database,
  teamId: string,
  presetId: Exclude<FormationPresetId, 'custom'>,
): void {
  const preset = getFormationPreset(presetId)
  db.run('DELETE FROM team_formation_slots WHERE team_id = ?', [teamId])
  for (let i = 0; i < preset.slots.length; i++) {
    const s = preset.slots[i]
    db.run(
      `INSERT INTO team_formation_slots (
        team_id, slot_index, x, z, position_label, role, lane
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [teamId, i, s.x, s.z, s.positionLabel, s.role, s.lane],
    )
  }
  for (let i = 0; i < preset.slots.length; i++) {
    db.run(
      'UPDATE team_roster SET position_label = ? WHERE team_id = ? AND slot_index = ?',
      [preset.slots[i].positionLabel, teamId, i],
    )
  }
  updateTeamTactics(db, teamId, { formationPresetId: presetId })
  persistDatabase()
}

export function updateFormationSlot(
  db: Database,
  teamId: string,
  slotIndex: number,
  data: {
    x?: number
    z?: number
    positionLabel?: string
    role?: PlayerRole
    lane?: FormationLane
  },
): void {
  ensureTeamTacticsDefaults(db, teamId)
  const slots = listFormationSlots(db, teamId)
  const cur = slots.find((s) => s.slotIndex === slotIndex)
  if (!cur) return
  const x = data.x ?? cur.x
  const z = data.z ?? cur.z
  const positionLabel = data.positionLabel ?? cur.positionLabel
  const role = data.role ?? (data.positionLabel ? roleFromPositionLabel(data.positionLabel) : cur.role)
  const lane = data.lane ?? inferLane(x)
  runAndPersist(
    db,
    `UPDATE team_formation_slots SET x = ?, z = ?, position_label = ?, role = ?, lane = ?
     WHERE team_id = ? AND slot_index = ?`,
    [x, z, positionLabel, role, lane, teamId, slotIndex],
  )
  if (data.positionLabel) {
    runAndPersist(
      db,
      'UPDATE team_roster SET position_label = ? WHERE team_id = ? AND slot_index = ?',
      [positionLabel, teamId, slotIndex],
    )
  }
  updateTeamTactics(db, teamId, { formationPresetId: 'custom' })
}

export function saveFormationSlots(
  db: Database,
  teamId: string,
  slots: Array<{
    slotIndex: number
    x: number
    z: number
    positionLabel: string
    role: PlayerRole
    lane: FormationLane
  }>,
  markCustom = true,
): void {
  db.run('DELETE FROM team_formation_slots WHERE team_id = ?', [teamId])
  for (const s of slots) {
    db.run(
      `INSERT INTO team_formation_slots (
        team_id, slot_index, x, z, position_label, role, lane
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [teamId, s.slotIndex, s.x, s.z, s.positionLabel, s.role, s.lane],
    )
    if (s.slotIndex < STARTING_XI_SIZE) {
      db.run(
        'UPDATE team_roster SET position_label = ? WHERE team_id = ? AND slot_index = ?',
        [s.positionLabel, teamId, s.slotIndex],
      )
    }
  }
  if (markCustom) {
    db.run(`UPDATE team_tactics SET formation_preset_id = 'custom' WHERE team_id = ?`, [teamId])
  }
  persistDatabase()
}

export function updatePlayerInstructions(
  db: Database,
  teamId: string,
  playerId: string,
  patch: Partial<PlayerInstructionsData>,
): PlayerInstructionsData {
  const roster = listRoster(db, teamId)
  const slot = roster.find((r) => r.playerId === playerId)
  const current = slot?.instructions ?? DEFAULT_PLAYER_INSTRUCTIONS
  const next: PlayerInstructionsData = {
    supportRuns: patch.supportRuns ?? current.supportRuns,
    attackingRuns: patch.attackingRuns ?? current.attackingRuns,
    interceptions: patch.interceptions ?? current.interceptions,
    positioningFreedom: patch.positioningFreedom ?? current.positioningFreedom,
  }
  runAndPersist(
    db,
    `INSERT INTO team_player_instructions (
      team_id, player_id, support_runs, attacking_runs, interceptions, positioning_freedom
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(team_id, player_id) DO UPDATE SET
      support_runs = excluded.support_runs,
      attacking_runs = excluded.attacking_runs,
      interceptions = excluded.interceptions,
      positioning_freedom = excluded.positioning_freedom`,
    [
      teamId,
      playerId,
      next.supportRuns,
      next.attackingRuns,
      next.interceptions,
      next.positioningFreedom,
    ],
  )
  return next
}

/**
 * Troca dois slots do elenco de forma segura (UNIQUE player_id).
 * Também troca os jogadores entre postos; labels de formação ficam no slot.
 */
export function swapRosterSlots(
  db: Database,
  teamId: string,
  slotA: number,
  slotB: number,
): void {
  if (slotA === slotB) return
  if (slotA < 0 || slotB < 0 || slotA >= MAX_SQUAD_SIZE || slotB >= MAX_SQUAD_SIZE) {
    throw new Error('Slot inválido.')
  }
  const rows = queryAll(
    db,
    'SELECT id, player_id, slot_index, position_label, shirt_number FROM team_roster WHERE team_id = ? AND slot_index IN (?, ?)',
    [teamId, slotA, slotB],
  )
  const a = rows.find((r) => (r.slot_index as number) === slotA)
  const b = rows.find((r) => (r.slot_index as number) === slotB)
  if (!a && !b) return

  // Move A to temp (-1 - slotA), B to A, A to B
  if (a) {
    db.run('UPDATE team_roster SET slot_index = ? WHERE id = ?', [-1000 - slotA, a.id as string])
  }
  if (b) {
    db.run('UPDATE team_roster SET slot_index = ? WHERE id = ?', [slotA, b.id as string])
  }
  if (a) {
    db.run('UPDATE team_roster SET slot_index = ? WHERE id = ?', [slotB, a.id as string])
  }

  // Sync position labels from formation for starting XI
  const formation = listFormationSlots(db, teamId)
  for (const idx of [slotA, slotB]) {
    if (idx >= STARTING_XI_SIZE) continue
    const fs = formation.find((s) => s.slotIndex === idx)
    if (fs) {
      db.run(
        'UPDATE team_roster SET position_label = ? WHERE team_id = ? AND slot_index = ?',
        [fs.positionLabel, teamId, idx],
      )
    }
  }
  persistDatabase()
}

/** Adiciona jogador ao banco (primeiro slot livre 11..22). */
export function addPlayerToBench(
  db: Database,
  teamId: string,
  playerId: string,
  positionLabel = 'CM',
): number {
  const roster = listRoster(db, teamId)
  if (roster.length >= MAX_SQUAD_SIZE) {
    throw new Error('Elenco cheio (máx. 23).')
  }
  if (roster.some((r) => r.playerId === playerId)) {
    throw new Error('Jogador já está no elenco.')
  }
  let slot = -1
  for (let i = STARTING_XI_SIZE; i < MAX_SQUAD_SIZE; i++) {
    if (!roster.some((r) => r.slotIndex === i)) {
      slot = i
      break
    }
  }
  if (slot < 0) throw new Error('Banco cheio.')
  runAndPersist(
    db,
    'INSERT INTO team_roster (id, team_id, player_id, slot_index, position_label) VALUES (?, ?, ?, ?, ?)',
    [uid(), teamId, playerId, slot, positionLabel],
  )
  return slot
}

export function removeFromRoster(db: Database, teamId: string, slotIndex: number): void {
  runAndPersist(db, 'DELETE FROM team_roster WHERE team_id = ? AND slot_index = ?', [
    teamId,
    slotIndex,
  ])
}
