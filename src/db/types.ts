import type { SkinToneId } from './skinTones'
import type { PlayerAttributes } from './playerAttributeDefaults'
import type {
  FormationLane,
  FormationPresetId,
  MentalityId,
  BuildUpId,
  ChanceCreationId,
  DefensiveStyleId,
  PlayerInstructionsData,
  TeamTacticsData,
} from '../game/data/formations'
import type { PlayerRole } from '../game/types'

export type Edition = {
  id: string
  name: string
  createdAt: number
}

export type League = {
  id: string
  editionId: string
  name: string
  countryId: string | null
  sortOrder: number
}

export type Country = {
  id: string
  editionId: string
  name: string
  code: string | null
  nationalityLabel: string | null
  sortOrder: number
}

export type Team = {
  id: string
  editionId: string
  leagueId: string | null
  countryId: string | null
  name: string
  shortName: string | null
  primaryColor: string
  secondaryColor: string | null
  gkColor: string
  /** É uma seleção nacional? */
  isNationalTeam: boolean
  /** Variante da seleção (ex.: Principal, Sub-20, Clássica). */
  nationalTeamLabel: string | null
  sortOrder: number
}

export type TeamKit = {
  teamId: string
  kitNumber: 1 | 2
  shirtColor: string
  shortsColor: string
  socksColor: string
}

export type EditionPlayer = {
  id: string
  editionId: string
  name: string
  skinTone: SkinToneId
  countryId: string | null
  preferredShirtNumber: number | null
  /** GLB personalizado no IndexedDB (rosto/mesh do Blender). */
  hasCustomGlb: boolean
  createdAt: number
  attributes: PlayerAttributes
}

export type RosterSlot = {
  id: string
  teamId: string
  playerId: string
  slotIndex: number
  positionLabel: string
  /** Número específico do elenco (override). */
  shirtNumberOverride: number | null
  /** Número exibido na partida / HUD. */
  shirtNumber: number
  name: string
  skinTone: SkinToneId
  hasCustomGlb: boolean
  countryId: string | null
  nationalityLabel: string | null
  countryName: string | null
  preferredShirtNumber: number | null
  attributes: PlayerAttributes
  overall: number
  instructions: PlayerInstructionsData
}

export type TeamFormationSlot = {
  teamId: string
  slotIndex: number
  x: number
  z: number
  positionLabel: string
  role: PlayerRole
  lane: FormationLane
}

export type TeamTactics = TeamTacticsData & {
  teamId: string
}

/** @deprecated use RosterSlot — kept for HUD/roster lookups */
export type Player = RosterSlot

export type TeamWithRoster = Team & {
  kits: TeamKit[]
  roster: RosterSlot[]
  /** Uniforme usado na partida (mandante 1, visitante 2) */
  matchKit: 1 | 2
  tactics: TeamTactics
  formationSlots: TeamFormationSlot[]
  /** Preset efetivo ou custom se o desenho foi editado. */
  formationPresetId: FormationPresetId
}

export type TeamWithPlayers = TeamWithRoster

export type {
  MentalityId,
  BuildUpId,
  ChanceCreationId,
  DefensiveStyleId,
  FormationPresetId,
  FormationLane,
  PlayerInstructionsData,
  TeamTacticsData,
}
