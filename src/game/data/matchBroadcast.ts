import type { TeamId } from '../types'
import { TEAM_NAMES } from '../constants'
import {
  getPlayerDisplayName,
  getPlayerPositionLabel,
} from './playerRoster'

export const STADIUM_NAME = 'Arena Municipal'
export const MATCH_TYPE_LABEL = 'AMISTOSO INTERNACIONAL'
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
    number: index + 1,
    name: getPlayerDisplayName(team, index),
    position: getPlayerPositionLabel(index),
  }))
}

export function getTeamBroadcastName(team: TeamId): string {
  return TEAM_NAMES[team].toUpperCase()
}
