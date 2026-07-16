import { STANDING_STEAL_AI_MAX_DIST } from '../constants'
import { getOpponent, useGameStore } from '../store/gameStore'
import type { TeamId } from '../types'
import { getCachedTeamMarker } from './dynamicFormation'
import { playerRegistry } from './entityRegistry'
import { getDuelOpponentId } from './playerPhysicalDuel'
import { getBallAtFeet } from './possession'
import { distance2D, normalize2D } from './rules'

export type MarkerPressure = {
  level: number
  markerId: string | null
  dist: number
  fromFront: boolean
}

const NONE: MarkerPressure = {
  level: 0,
  markerId: null,
  dist: Infinity,
  fromFront: false,
}

function pressureFromDist(dist: number, roleMul = 1): number {
  if (dist > STANDING_STEAL_AI_MAX_DIST + 0.32) return 0
  let level = 0
  if (dist < 0.55) level = 1
  else if (dist < 0.8) level = 0.9
  else if (dist < 1.02) level = 0.74
  else if (dist < 1.22) level = 0.56
  else level = 0.3
  return level * roleMul
}

function holderFacesMarker(holderRot: number, markerPos: { x: number; z: number }, holderPos: { x: number; z: number }) {
  const toMarker = normalize2D(
    markerPos.x - holderPos.x,
    markerPos.z - holderPos.z,
  )
  const faceX = Math.sin(holderRot)
  const faceZ = Math.cos(holderRot)
  return toMarker.x * faceX + toMarker.z * faceZ > 0.1
}

/** Pressão do marcador colado — usada por UI/IA; não desvia mira. */
export function getCarrierMarkerPressure(holderId: string): MarkerPressure {
  const holder = playerRegistry.get(holderId)
  if (!holder || holder.role === 'gk') return NONE

  const store = useGameStore.getState()
  if (store.ballPossession?.playerId !== holderId) return NONE

  const oppTeam: TeamId = getOpponent(holder.team)
  const foot = getBallAtFeet(holder)
  let best: MarkerPressure = { ...NONE }

  const consider = (markerId: string | null, roleMul = 1) => {
    if (!markerId || markerId === holderId) return
    const marker = playerRegistry.get(markerId)
    if (!marker || marker.team !== oppTeam || marker.role === 'gk') return

    const dist = distance2D(marker.position, foot)
    const level = pressureFromDist(dist, roleMul)
    if (level <= best.level) return

    best = {
      level,
      markerId,
      dist,
      fromFront: holderFacesMarker(holder.rotation, marker.position, holder.position),
    }
  }

  consider(getCachedTeamMarker(oppTeam))
  consider(getDuelOpponentId(holderId), 1.05)

  for (const p of playerRegistry.values()) {
    if (p.team !== oppTeam || p.role === 'gk') continue
    const roleMul = p.role === 'def' ? 1.08 : p.role === 'mid' ? 1 : 0.72
    consider(p.id, roleMul)
  }

  if (getDuelOpponentId(holderId) && best.level < 0.8) {
    best = { ...best, level: Math.max(best.level, 0.8) }
  }

  return best
}

export type KickReleaseKind = 'pass' | 'through' | 'cross' | 'shot' | 'setpiece'

/** Mira e direção saem limpas — pressão não desvia o toque. */
export function applyMarkerPressureToKick(
  holderId: string,
  dirX: number,
  dirZ: number,
  speed: number,
  _kind: KickReleaseKind,
  loft = 0,
): { dirX: number; dirZ: number; speed: number; loft: number } {
  void holderId
  return { dirX, dirZ, speed, loft }
}

/** Carga da barra — sem freio por marcação (mira fluida). */
export function getMarkerChargeSpeedMul(
  _holderId: string,
  _mode: 'shot' | 'pass' | 'through' | 'cross' | null = null,
): number {
  return 1
}

/** Mantido por compat — não treme mais a mira. */
export function wobbleAimUnderPressure(
  _holderId: string,
  dirX: number,
  dirZ: number,
  _forShot = false,
): { x: number; z: number } {
  return { x: dirX, z: dirZ }
}
