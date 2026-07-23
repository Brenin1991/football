import { getUserTeam, useGameStore } from '../store/gameStore'
import type { FieldBounds, TeamId, Vec3 } from '../types'
import { BALL_FOOT_OFFSET, getKickoffPlayerId as kickoffId } from '../constants'
import { playerRegistry, setBallPosition, type PlayerRef } from './entityRegistry'
import { syncDribblePossession } from './ballDribble'
import { getBallAtFeet } from './possession'
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

/**
 * Cobrador atrás da bola no centro — bola fica nos pés (domínio),
 * não embaixo do pivô do jogador.
 */
export function getKickoffKickerStand(
  team: TeamId,
  bounds: FieldBounds,
  ballPos: Vec3,
  kickerId: string,
): { x: number; z: number; rotation: number } {
  const rotation = getKickoffAimRotation(team, bounds, kickerId, ballPos)
  const fx = Math.sin(rotation)
  const fz = Math.cos(rotation)
  return {
    x: ballPos.x - fx * BALL_FOOT_OFFSET,
    z: ballPos.z - fz * BALL_FOOT_OFFSET,
    rotation,
  }
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
    // Evita o outro atacante colado; prioriza meio/def (~5–22 m)
    if (dist < 4.5 || dist > 24) continue

    const towardOwn = (dx * toOwn.x + dz * toOwn.z) / dist
    if (towardOwn < 0.2) continue

    const roleBonus =
      mate.role === 'mid' ? 1.35 : mate.role === 'def' ? 0.85 : 0.15
    // Prefere ~8–14 m (meio-campo típico na 4-4-2)
    const idealDist = 11
    const distFit = 1 - Math.min(Math.abs(dist - idealDist) / 10, 1)
    const score = towardOwn * 2.4 + roleBonus + distFit * 1.1
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
    if (mate.role === 'fwd') continue
    const dist = Math.hypot(mate.position.x - kickerPos.x, mate.position.z - kickerPos.z)
    if (dist < minDist && dist >= 4.5) {
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
  const now = performance.now()
  useGameStore.setState({
    kickoffTeam: team,
    phase: 'kickoff',
    ballFrozen: true,
    ballPossession: { playerId: kickerId, team },
    possessionSince: now,
    setPiecePosition: center,
    setPieceKickerId: null,
    setPieceTeam: null,
    passIntent: null,
    lastTouchTeam: team,
    kickoffResetVersion: store.kickoffResetVersion + 1,
    activePlayerId:
      store.controlMode === 'pro'
        ? store.activePlayerId
        : team === getUserTeam()
          ? kickerId
          : store.activePlayerId,
    message: message ?? 'Saída de bola — passe (Espaço / E)',
  })
  syncDribblePossession(kickerId, now)
}

/** Após skip da intro — evita A/passe ainda pressionado iniciar a saída sozinho */
let kickoffInputLockUntil = 0

export function lockKickoffInput(ms = 450) {
  kickoffInputLockUntil = performance.now() + ms
}

export function isKickoffInputLocked() {
  return performance.now() < kickoffInputLockUntil
}

export function startKickoff(): boolean {
  const store = useGameStore.getState()
  if (store.phase !== 'kickoff' || !store.ballFrozen) return false
  if (isKickoffInputLocked()) return false

  const kickerId = getKickoffPlayerId(store.kickoffTeam)
  store.setPossession(kickerId, store.kickoffTeam)
  const since = useGameStore.getState().possessionSince
  syncDribblePossession(kickerId, since)

  // Garante bola nos pés antes de liberar / passar
  const holder = playerRegistry.get(kickerId)
  if (holder) {
    setBallPosition(getBallAtFeet(holder))
  }

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
