import type { SkinToneId } from './skinTones'

export type Edition = {
  id: string
  name: string
  createdAt: number
}

export type League = {
  id: string
  editionId: string
  name: string
  sortOrder: number
}

export type Team = {
  id: string
  editionId: string
  leagueId: string | null
  name: string
  shortName: string | null
  primaryColor: string
  secondaryColor: string | null
  gkColor: string
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
  createdAt: number
}

export type RosterSlot = {
  id: string
  teamId: string
  playerId: string
  slotIndex: number
  positionLabel: string
  name: string
  skinTone: SkinToneId
}

/** @deprecated use RosterSlot — kept for HUD/roster lookups */
export type Player = RosterSlot

export type TeamWithRoster = Team & {
  kits: TeamKit[]
  roster: RosterSlot[]
  /** Uniforme usado na partida (mandante 1, visitante 2) */
  matchKit: 1 | 2
}

export type TeamWithPlayers = TeamWithRoster
