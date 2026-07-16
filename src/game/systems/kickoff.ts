import { getUserTeam, useGameStore } from '../store/gameStore'
import type { FieldBounds, TeamId, Vec3 } from '../types'
import { getKickoffPlayerId as kickoffId } from '../constants'
import { playerRegistry, type PlayerRef } from './entityRegistry'
import { narrationSfx } from './narrationSfx'
import { getAttackSign, getDefensiveGoalZ } from './teamField'

export function getKickoffPlayerId(team: TeamId): string {
  return kickoffId(team)
}

/** Saída de bola — olhar para o próprio campo onde estão os companheiros */
export function getKickoffFacingRotation(team: TeamId, bounds: FieldBounds): number {
  const ownGoalZ = getDefensiveGoalZ(team, bounds)
  return Math.atan2(0, ownGoalZ - bounds.center.z)
}

function directionToOwnGoal(team: TeamId, bounds: FieldBounds, from: Vec3): { x: number; z: number } {
  const goalZ = getDefensiveGoalZ(team, bounds)
  const dx = bounds.center.x - from.x
  const dz = goalZ - from.z
  const len = Math.hypot(dx, dz)
  if (len < 0.01) return { x: 0, z: -getAttackSign(team, bounds) }
  return { x: dx / len, z: dz / len }
}

/** Companheiro na direção do gol próprio para receber a saída */
export function findKickoffPassTarget(
  team: TeamId,
  kickerId: string,
  kickerPos: Vec3,
  bounds: FieldBounds,
): PlayerRef | null {
  const toOwn = directionToOwnGoal(team, bounds, kickerPos)
  let best: PlayerRef | null = null
  let bestScore = -Infinity

  for (const mate of playerRegistry.values()) {
    if (mate.team !== team || mate.id === kickerId || mate.role === 'gk') continue

    const dx = mate.position.x - kickerPos.x
    const dz = mate.position.z - kickerPos.z
    const dist = Math.hypot(dx, dz)
    if (dist < 1.2 || dist > 18) continue

    const towardOwn = (dx * toOwn.x + dz * toOwn.z) / dist
    if (towardOwn < 0.25) continue

    const score =
      towardOwn * 3 -
      dist * 0.06 +
      (mate.role === 'mid' ? 0.8 : mate.role === 'def' ? 0.55 : 0.25)
    if (score > bestScore) {
      bestScore = score
      best = mate
    }
  }

  if (best) return best

  let nearest: PlayerRef | null = null
  let minDist = Infinity
  for (const mate of playerRegistry.values()) {
    if (mate.team !== team || mate.id === kickerId || mate.role === 'gk') continue
    const dist = Math.hypot(mate.position.x - kickerPos.x, mate.position.z - kickerPos.z)
    if (dist < minDist && dist >= 1.2) {
      minDist = dist
      nearest = mate
    }
  }
  return nearest
}

export function getKickoffAimRotation(
  team: TeamId,
  bounds: FieldBounds,
  kickerId: string,
  kickerPos: Vec3,
): number {
  const mate = findKickoffPassTarget(team, kickerId, kickerPos, bounds)
  if (mate) {
    return Math.atan2(
      mate.position.x - kickerPos.x,
      mate.position.z - kickerPos.z,
    )
  }
  return getKickoffFacingRotation(team, bounds)
}

export function setupKickoff(team: TeamId, center: Vec3, message?: string) {
  const kickerId = getKickoffPlayerId(team)
  const store = useGameStore.getState()
  useGameStore.setState({
    kickoffTeam: team,
    phase: 'kickoff',
    ballFrozen: true,
    ballPossession: { playerId: kickerId, team },
    setPiecePosition: center,
    setPieceKickerId: null,
    setPieceTeam: null,
    passIntent: null,
    lastTouchTeam: null,
    kickoffResetVersion: store.kickoffResetVersion + 1,
    activePlayerId: team === getUserTeam() ? kickerId : store.activePlayerId,
    message: message ?? 'Saída de bola — passe (Espaço / E)',
  })
}

export function startKickoff(): boolean {
  const store = useGameStore.getState()
  if (store.phase !== 'kickoff' || !store.ballFrozen) return false

  const kickerId = getKickoffPlayerId(store.kickoffTeam)
  store.setPossession(kickerId, store.kickoffTeam)
  store.setPhase('playing')
  store.setBallFrozen(false)
  store.setMessage('')
  if (store.kickoffTeam === getUserTeam()) store.setActivePlayer(kickerId)
  useGameStore.setState({
    kickoffStrikeAnim: { kickerId, at: performance.now() },
  })
  narrationSfx.playKickoff()
  return true
}
