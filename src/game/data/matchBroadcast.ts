import type { TeamId } from '../types'
import { getTeamName, getMatchStadium, getMatchTypeLabel } from '../matchRuntime'
import { getShirtNumberFromSession } from '../systems/playerAttributes'
import {
  getPlayerDisplayName,
  getPlayerPositionLabel,
} from './playerRoster'

export function getStadiumName(): string {
  return getMatchStadium()
}

export function getMatchType(): string {
  return getMatchTypeLabel()
}
export const FORMATION_LABEL = '4-4-2'

export const MATCH_OFFICIALS = {
  referee: 'Carlos Silva',
  assistant1: 'João Santos',
  assistant2: 'Pedro Lima',
  fourth: 'Marcos Costa',
} as const

export type LineupEntry = {
  number: number
  name: string
  position: string
}

export function getTeamLineup(team: TeamId): LineupEntry[] {
  return Array.from({ length: 11 }, (_, index) => ({
    number: getShirtNumberFromSession(team, index),
    name: getPlayerDisplayName(team, index),
    position: getPlayerPositionLabel(team, index),
  }))
}

export function getTeamBroadcastName(team: TeamId): string {
  return getTeamName(team).toUpperCase()
}
