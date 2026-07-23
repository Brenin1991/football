import type { TeamId } from '../types'
import { getPlayerNameFromSession, getPlayerPositionFromSession, getEditionPlayerId } from '../matchRuntime'
import { getPlayerStamina } from '../systems/playerStamina'
import {
  getPlayerNationalityLabel,
  getPlayerOverallRuntime,
  getPlayerShirtNumber,
} from '../systems/playerAttributes'

export const FORMATION_POSITION_LABELS = [
  'GK',
  'LB',
  'CB',
  'CB',
  'RB',
  'LM',
  'CM',
  'CM',
  'RM',
  'CF',
  'SS',
] as const

const HOME_NAMES = [
  'Alisson',
  'Alex',
  'Marquinhos',
  'Breno',
  'Dani',
  'Casemiro',
  'Oscar',
  'Lucas',
  'Rodrygo',
  'Neymar',
  'Rivaldo',
]

const AWAY_NAMES = [
  'Martinez',
  'Garcia',
  'Santos',
  'Lima',
  'Costa',
  'Silva',
  'Souza',
  'Pereira',
  'Alves',
  'Torres',
  'Bojinov',
]

export function parsePlayerIndex(id: string): number {
  const dash = id.lastIndexOf('-')
  if (dash < 0) return 0
  const n = parseInt(id.slice(dash + 1), 10)
  return Number.isFinite(n) ? n : 0
}

export function getPlayerDisplayName(team: TeamId, index: number): string {
  const fromSession = getPlayerNameFromSession(team, index)
  if (fromSession) return fromSession
  const names = team === 'home' ? HOME_NAMES : AWAY_NAMES
  return names[index] ?? `Jogador ${index + 1}`
}

export function getPlayerPositionLabel(team: TeamId, index: number): string {
  const fromSession = getPlayerPositionFromSession(team, index)
  if (fromSession) return fromSession
  return FORMATION_POSITION_LABELS[index] ?? 'CM'
}

export function getPlayerRoleAbbrev(position: string): string {
  if (position === 'GK') return 'GK'
  if (position === 'LB' || position === 'CB' || position === 'RB') return 'DF'
  if (position === 'LM' || position === 'CM' || position === 'RM') return 'MF'
  return 'FW'
}

export function getPlayerRoleGroup(position: string): 'gk' | 'df' | 'mf' | 'fw' {
  const abbr = getPlayerRoleAbbrev(position)
  return abbr.toLowerCase() as 'gk' | 'df' | 'mf' | 'fw'
}

/** @deprecated use getPlayerStamina — mantido por compat */
export function mockStamina(playerId: string): number {
  return getPlayerStamina(playerId)
}

export function getPlayerCardInfo(playerId: string) {
  const team = playerId.startsWith('away-') ? 'away' : 'home'
  const index = parsePlayerIndex(playerId)
  return {
    team,
    index,
    name: getPlayerDisplayName(team, index),
    position: getPlayerPositionLabel(team, index),
    stamina: getPlayerStamina(playerId),
    editionPlayerId: getEditionPlayerId(team, index),
    shirtNumber: getPlayerShirtNumber(playerId),
    nationality: getPlayerNationalityLabel(playerId),
    overall: getPlayerOverallRuntime(playerId),
  }
}
