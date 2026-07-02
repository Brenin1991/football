import { useGameStore } from '../store/gameStore'
import type { FieldBounds, FormationSlot, TeamId, Vec3 } from '../types'

function sidesSwapped(): boolean {
  return useGameStore.getState().half === 2
}

/** Quem marca ao entrar na zona física do gol (1T: zona casa = casa; 2T: invertido) */
export function getScoringTeamForGoalZone(zoneTeam: TeamId): TeamId {
  if (!sidesSwapped()) return zoneTeam
  return zoneTeam === 'home' ? 'away' : 'home'
}

/** Time que ataca a linha de gol física (home = end homeScoringGoalZ) no tempo atual */
export function getAttackingTeamAtGoalLine(physicalLine: 'home' | 'away'): TeamId {
  if (!sidesSwapped()) return physicalLine
  return physicalLine === 'home' ? 'away' : 'home'
}

export function getAttackingGoalZ(team: TeamId, bounds: FieldBounds): number {
  const homeGoal = bounds.homeScoringGoalZ
  const awayGoal = bounds.awayScoringGoalZ
  if (!sidesSwapped()) {
    return team === 'home' ? homeGoal : awayGoal
  }
  return team === 'home' ? awayGoal : homeGoal
}

export function getDefensiveGoalZ(team: TeamId, bounds: FieldBounds): number {
  const homeGoal = bounds.homeScoringGoalZ
  const awayGoal = bounds.awayScoringGoalZ
  if (!sidesSwapped()) {
    return team === 'home' ? awayGoal : homeGoal
  }
  return team === 'home' ? homeGoal : awayGoal
}

export function getAttackSign(team: TeamId, _bounds: FieldBounds): number {
  const base = team === 'home' ? 1 : -1
  return sidesSwapped() ? -base : base
}

/** Converte slot 4-4-2 (x: -1..1, z: 0..1) em posição no campo */
export function getFormationSpawn(
  team: TeamId,
  slot: FormationSlot,
  bounds: FieldBounds,
): Vec3 {
  const halfW = (bounds.maxX - bounds.minX) / 2 - 0.55
  const halfL = (bounds.maxZ - bounds.minZ) / 2 - 0.45
  const towardOwnGoal =
    getDefensiveGoalZ(team, bounds) > bounds.center.z ? 1 : -1

  return {
    x: bounds.center.x + slot.x * halfW,
    y: bounds.center.y,
    z: bounds.center.z + towardOwnGoal * slot.z * halfL,
  }
}

export function getGoalKickPosition(defendingTeam: TeamId, bounds: FieldBounds): Vec3 {
  const goalZ = getDefensiveGoalZ(defendingTeam, bounds)
  const intoField = getAttackSign(defendingTeam, bounds)
  return {
    x: bounds.center.x,
    y: bounds.center.y,
    z: goalZ + intoField * 1.2,
  }
}

export function getFieldFacingRotation(team: TeamId, bounds: FieldBounds): number {
  return getAttackSign(team, bounds) > 0 ? 0 : Math.PI
}

export function getGoalKickImpulse(team: TeamId, bounds: FieldBounds, power: number) {
  const sign = getAttackSign(team, bounds)
  return { vx: 0, vy: 0.35, vz: sign * power }
}

export function getGoalLineSide(pos: Vec3, bounds: FieldBounds): 'home' | 'away' | null {
  const homeAtMaxZ = bounds.homeScoringGoalZ > bounds.center.z
  if (homeAtMaxZ) {
    if (pos.z > bounds.maxZ) return 'home'
    if (pos.z < bounds.minZ) return 'away'
  } else {
    if (pos.z < bounds.minZ) return 'home'
    if (pos.z > bounds.maxZ) return 'away'
  }
  return null
}

export function directionToCenter(from: Vec3, bounds: FieldBounds) {
  return {
    x: bounds.center.x - from.x,
    z: bounds.center.z - from.z,
  }
}

export function isBallInDefensiveThird(
  ball: Vec3,
  team: TeamId,
  bounds: FieldBounds,
): boolean {
  const defZ = getDefensiveGoalZ(team, bounds)
  const distFromDefGoal = Math.abs(ball.z - defZ)
  const pitchLen = bounds.maxZ - bounds.minZ
  return distFromDefGoal < pitchLen / 3
}

/** Grande área — mesma escala do escanteio em setPiece.ts */
export const PENALTY_BOX_DEPTH = 5.4
export const PENALTY_BOX_HALF_WIDTH = 4.5
export const PENALTY_SPOT_DIST = 3.6

export function isInPenaltyArea(
  pos: Vec3,
  defendingTeam: TeamId,
  bounds: FieldBounds,
): boolean {
  const goalZ = getDefensiveGoalZ(defendingTeam, bounds)
  const intoField = getAttackSign(defendingTeam, bounds)
  const distFromGoalLine = (pos.z - goalZ) * intoField
  if (distFromGoalLine < 0 || distFromGoalLine > PENALTY_BOX_DEPTH) return false
  if (Math.abs(pos.x - bounds.center.x) > PENALTY_BOX_HALF_WIDTH) return false
  return true
}

/** Marca do pênalti (11 m proporcional) */
export function getPenaltySpot(kickingTeam: TeamId, bounds: FieldBounds): Vec3 {
  const goalZ = getAttackingGoalZ(kickingTeam, bounds)
  const intoField = getAttackSign(kickingTeam, bounds)
  return {
    x: bounds.center.x,
    y: bounds.center.y,
    z: goalZ + intoField * PENALTY_SPOT_DIST,
  }
}
