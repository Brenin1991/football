import type { TeamId } from '../types'

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
  const names = team === 'home' ? HOME_NAMES : AWAY_NAMES
  return names[index] ?? `Jogador ${index + 1}`
}

export function getPlayerPositionLabel(index: number): string {
  return FORMATION_POSITION_LABELS[index] ?? 'CM'
}

/** Só visual — substituir por stamina real depois */
export function mockStamina(playerId: string): number {
  let h = 0
  for (let i = 0; i < playerId.length; i++) {
    h = (h * 31 + playerId.charCodeAt(i)) >>> 0
  }
  return 0.42 + (h % 53) / 100
}

export function getPlayerCardInfo(playerId: string) {
  const team = playerId.startsWith('away-') ? 'away' : 'home'
  const index = parsePlayerIndex(playerId)
  return {
    team,
    index,
    name: getPlayerDisplayName(team, index),
    position: getPlayerPositionLabel(index),
    stamina: mockStamina(playerId),
  }
}
