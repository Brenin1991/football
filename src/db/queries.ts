import type { Database, SqlValue } from 'sql.js'
import { persistDatabase } from './database'
import { deleteEntityImage } from './imageQueries'
import { deleteTeamKitShirtsForTeam } from './shirtTextureQueries'
import { normalizeSkinTone } from './migrate'
import type { SkinToneId } from './skinTones'
import type {
  Edition,
  EditionPlayer,
  League,
  RosterSlot,
  Team,
  TeamKit,
  TeamWithRoster,
} from './types'

const FORMATION_SLOTS = ['GK', 'LB', 'CB', 'CB', 'RB', 'LM', 'CM', 'CM', 'RM', 'CF', 'SS']

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
    sortOrder: row.sort_order as number,
  }
}

function rowToTeam(row: Record<string, unknown>): Team {
  return {
    id: row.id as string,
    editionId: row.edition_id as string,
    leagueId: (row.league_id as string | null) ?? null,
    name: row.name as string,
    shortName: (row.short_name as string | null) ?? null,
    primaryColor: row.primary_color as string,
    secondaryColor: (row.secondary_color as string | null) ?? null,
    gkColor: row.gk_color as string,
    sortOrder: row.sort_order as number,
  }
}

function rowToEditionPlayer(row: Record<string, unknown>): EditionPlayer {
  return {
    id: row.id as string,
    editionId: row.edition_id as string,
    name: row.name as string,
    skinTone: normalizeSkinTone(row.skin_tone as string) as SkinToneId,
    createdAt: row.created_at as number,
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
  for (let i = 0; i < 11; i++) {
    const playerId = uid()
    const name = names?.[i] ?? `Jogador ${i + 1}`
    runAndPersist(
      db,
      'INSERT INTO edition_players (id, edition_id, name, skin_tone, created_at) VALUES (?, ?, ?, ?, ?)',
      [playerId, editionId, name, 'medium', Date.now()],
    )
    runAndPersist(
      db,
      'INSERT INTO team_roster (id, team_id, player_id, slot_index, position_label) VALUES (?, ?, ?, ?, ?)',
      [uid(), teamId, playerId, i, FORMATION_SLOTS[i] ?? 'CM'],
    )
  }
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
  for (const p of players) deleteEntityImage(db, 'player', p.id)
  for (const t of teams) deleteEntityImage(db, 'team', t.id)
  for (const l of leagues) deleteEntityImage(db, 'league', l.id)
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

export function createLeague(db: Database, editionId: string, name: string): League {
  const leagues = listLeagues(db, editionId)
  const league: League = {
    id: uid(),
    editionId,
    name,
    sortOrder: leagues.length,
  }
  runAndPersist(
    db,
    'INSERT INTO leagues (id, edition_id, name, sort_order) VALUES (?, ?, ?, ?)',
    [league.id, league.editionId, league.name, league.sortOrder],
  )
  return league
}

export function updateLeague(db: Database, id: string, name: string): void {
  runAndPersist(db, 'UPDATE leagues SET name = ? WHERE id = ?', [name, id])
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
    `SELECT r.id, r.team_id, r.player_id, r.slot_index, r.position_label,
            p.name, p.skin_tone
     FROM team_roster r
     JOIN edition_players p ON p.id = r.player_id
     WHERE r.team_id = ?
     ORDER BY r.slot_index`,
    [teamId],
  ).map((row) => ({
    id: row.id as string,
    teamId: row.team_id as string,
    playerId: row.player_id as string,
    slotIndex: row.slot_index as number,
    positionLabel: row.position_label as string,
    name: row.name as string,
    skinTone: normalizeSkinTone(row.skin_tone as string) as SkinToneId,
  }))
}

export function getTeamWithRoster(
  db: Database,
  teamId: string,
  matchKit: 1 | 2 = 1,
): TeamWithRoster | null {
  const team = getTeam(db, teamId)
  if (!team) return null
  return {
    ...team,
    kits: listTeamKits(db, teamId),
    roster: listRoster(db, teamId),
    matchKit,
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
    rosterNames?: string[]
  },
): Team {
  const teams = listTeams(db, editionId)
  const team: Team = {
    id: uid(),
    editionId,
    leagueId: data.leagueId ?? null,
    name: data.name,
    shortName: data.shortName ?? null,
    primaryColor: data.primaryColor,
    secondaryColor: data.secondaryColor ?? null,
    gkColor: data.gkColor,
    sortOrder: teams.length,
  }
  runAndPersist(
    db,
    `INSERT INTO teams (id, edition_id, league_id, name, short_name, primary_color, secondary_color, gk_color, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      team.id,
      team.editionId,
      team.leagueId,
      team.name,
      team.shortName,
      team.primaryColor,
      team.secondaryColor,
      team.gkColor,
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
}

export function deleteTeam(db: Database, id: string): void {
  deleteEntityImage(db, 'team', id)
  deleteTeamKitShirtsForTeam(db, id)
  runAndPersist(db, 'DELETE FROM teams WHERE id = ?', [id])
}

export function listEditionPlayers(db: Database, editionId: string): EditionPlayer[] {
  return queryAll(
    db,
    'SELECT * FROM edition_players WHERE edition_id = ? ORDER BY name',
    [editionId],
  ).map(rowToEditionPlayer)
}

export function getEditionPlayer(db: Database, playerId: string): EditionPlayer | null {
  const rows = queryAll(db, 'SELECT * FROM edition_players WHERE id = ?', [playerId])
  return rows[0] ? rowToEditionPlayer(rows[0]) : null
}

export function createEditionPlayer(
  db: Database,
  editionId: string,
  data: { name: string; skinTone?: SkinToneId },
): EditionPlayer {
  const player: EditionPlayer = {
    id: uid(),
    editionId,
    name: data.name,
    skinTone: data.skinTone ?? 'medium',
    createdAt: Date.now(),
  }
  runAndPersist(
    db,
    'INSERT INTO edition_players (id, edition_id, name, skin_tone, created_at) VALUES (?, ?, ?, ?, ?)',
    [player.id, player.editionId, player.name, player.skinTone, player.createdAt],
  )
  return player
}

export function updateEditionPlayer(
  db: Database,
  id: string,
  data: { name: string; skinTone: SkinToneId },
): void {
  runAndPersist(db, 'UPDATE edition_players SET name = ?, skin_tone = ? WHERE id = ?', [
    data.name,
    data.skinTone,
    id,
  ])
}

export function deleteEditionPlayer(db: Database, id: string): void {
  deleteEntityImage(db, 'player', id)
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

export function setRosterSlot(
  db: Database,
  teamId: string,
  slotIndex: number,
  playerId: string,
  positionLabel: string,
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
    return
  }
  runAndPersist(
    db,
    'INSERT INTO team_roster (id, team_id, player_id, slot_index, position_label) VALUES (?, ?, ?, ?, ?)',
    [uid(), teamId, playerId, slotIndex, positionLabel],
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
