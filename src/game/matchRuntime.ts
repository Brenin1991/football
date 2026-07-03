import type { TeamId, PlayerRole } from './types'
import { GK_COLORS, TEAM_COLORS, TEAM_NAMES } from './constants'
import { getSkinToneColor } from '../db/skinTones'
import type { TeamKit } from '../db/types'
import { useMatchSetupStore } from '../store/matchSetupStore'

export type KitColors = {
  shirt: string
  shorts: string
  socks: string
}

export type PlayerAppearance = {
  skinColor: string
  kit: KitColors
}

function getSessionTeam(team: TeamId) {
  const session = useMatchSetupStore.getState().session
  if (!session) return null
  return team === 'home' ? session.home : session.away
}

function pickKit(kits: TeamKit[], kitNumber: 1 | 2): KitColors {
  const kit = kits.find((k) => k.kitNumber === kitNumber) ?? kits[0]
  if (!kit) {
    return { shirt: '#3b82f6', shorts: '#1a1a2e', socks: '#3b82f6' }
  }
  return {
    shirt: kit.shirtColor,
    shorts: kit.shortsColor,
    socks: kit.socksColor,
  }
}

export function getTeamName(team: TeamId): string {
  const data = getSessionTeam(team)
  if (!data) return TEAM_NAMES[team]
  return data.name
}

export function getTeamPrimaryColor(team: TeamId): string {
  const data = getSessionTeam(team)
  if (!data) return TEAM_COLORS[team]
  return pickKit(data.kits, data.matchKit).shirt
}

export function getTeamGkColor(team: TeamId): string {
  const data = getSessionTeam(team)
  if (!data) return GK_COLORS[team]
  return data.gkColor
}

export function getMatchStadium(): string {
  return useMatchSetupStore.getState().session?.stadium ?? 'Arena Municipal'
}

export function getMatchTypeLabel(): string {
  return useMatchSetupStore.getState().session?.matchType ?? 'AMISTOSO INTERNACIONAL'
}

export function getPlayerNameFromSession(team: TeamId, index: number): string | null {
  const data = getSessionTeam(team)
  if (!data) return null
  const slot = data.roster.find((p) => p.slotIndex === index)
  return slot?.name ?? null
}

export function getTeamAbbr(team: TeamId): string {
  const data = getSessionTeam(team)
  if (data) {
    if (data.shortName) return data.shortName.toUpperCase()
    return data.name.slice(0, 3).toUpperCase()
  }
  return team === 'home' ? 'BRA' : 'VIS'
}

export function getPlayerPositionFromSession(team: TeamId, index: number): string | null {
  const data = getSessionTeam(team)
  if (!data) return null
  const slot = data.roster.find((p) => p.slotIndex === index)
  return slot?.positionLabel ?? null
}

export function getEditionPlayerId(team: TeamId, slotIndex: number): string | null {
  const data = getSessionTeam(team)
  if (!data) return null
  return data.roster.find((p) => p.slotIndex === slotIndex)?.playerId ?? null
}

export function getTeamMatchKit(team: TeamId): 1 | 2 {
  return getSessionTeam(team)?.matchKit ?? 1
}

export function getTeamDbId(team: TeamId): string | null {
  return getSessionTeam(team)?.id ?? null
}

export function getPlayerAppearance(
  team: TeamId,
  slotIndex: number,
  role: PlayerRole,
): PlayerAppearance {
  const data = getSessionTeam(team)
  const slot = data?.roster.find((p) => p.slotIndex === slotIndex)
  const skinTone = slot?.skinTone ?? 'medium'
  const kit = data ? pickKit(data.kits, data.matchKit) : {
    shirt: TEAM_COLORS[team],
    shorts: '#1a1a2e',
    socks: TEAM_COLORS[team],
  }

  if (role === 'gk') {
    return {
      skinColor: getSkinToneColor(skinTone),
      kit: {
        shirt: data?.gkColor ?? GK_COLORS[team],
        shorts: kit.shorts,
        socks: kit.socks,
      },
    }
  }

  return {
    skinColor: getSkinToneColor(skinTone),
    kit,
  }
}
