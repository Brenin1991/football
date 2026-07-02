import * as THREE from 'three'
import type { FieldBounds, TeamId } from '../types'
import type { PlayerRef } from './entityRegistry'
import { PASS_SPEED_BASE, PASS_SPEED_MAX, PASS_RECEIVE_MAX_SPEED } from '../constants'
import { distance2D } from './rules'
import { getAttackingGoalZ, getAttackSign } from './teamField'
import { isOffsideAtZ } from './offside'

/** Loft alto — cruzamento parabólico */
export const CROSS_LOFT = 0.94

/** Deve ser >= crossSpeedForDistance max / PASS_RECEIVE_MAX_SPEED */
export const CROSS_RECEIVE_MAX_SPEED_MUL = 1.48

export function maxCrossBallSpeed(): number {
  return PASS_RECEIVE_MAX_SPEED * CROSS_RECEIVE_MAX_SPEED_MUL * 0.98
}

export function crossSpeedForDistance(dist: number): number {
  return THREE.MathUtils.clamp(
    dist * 0.82 + PASS_SPEED_BASE,
    PASS_SPEED_MAX * 0.92,
    maxCrossBallSpeed(),
  )
}

/** Companheiro na área / segundo poste para cruzamento */
export function findCrossTarget(
  from: PlayerRef,
  teammates: PlayerRef[],
  bounds: FieldBounds,
  team: TeamId,
  ballZ: number,
): PlayerRef | null {
  const attackSign = getAttackSign(team, bounds)
  const goalZ = getAttackingGoalZ(team, bounds)
  const fx = Math.sin(from.rotation)
  const fz = Math.cos(from.rotation)
  const halfW = (bounds.maxX - bounds.minX) * 0.5

  let best: PlayerRef | null = null
  let bestScore = -Infinity

  for (const p of teammates) {
    if (p.id === from.id || p.role === 'gk') continue

    const dzToGoal = (goalZ - p.position.z) * attackSign
    if (dzToGoal < 1 || dzToGoal > 20) continue

    const dx = p.position.x - from.position.x
    const dz = p.position.z - from.position.z
    const forward = dx * fx + dz * fz
    if (forward < 2.5) continue

    if (isOffsideAtZ(team, p.position.z, bounds, ballZ)) continue

    const inBox =
      dzToGoal > 2 &&
      dzToGoal < 15 &&
      Math.abs(p.position.x) < halfW * 0.44
    const central = 1 - Math.min(Math.abs(p.position.x) / (halfW * 0.5), 1)
    const depth = Math.min(dzToGoal / 12, 1)
    const roleBonus = p.role === 'fwd' ? 1.4 : p.role === 'mid' ? 0.35 : 0

    const score =
      (inBox ? 5 : 0.5) +
      central * 2.2 +
      depth * 1.5 +
      roleBonus -
      Math.abs(p.position.x - from.position.x) * 0.04

    if (score > bestScore) {
      bestScore = score
      best = p
    }
  }

  return best
}

export function getCrossReceiveLead(
  target: PlayerRef,
  bounds: FieldBounds,
  team: TeamId,
): { x: number; z: number } {
  const attackSign = getAttackSign(team, bounds)
  const towardGoal = attackSign * 1.8
  return {
    x: target.position.x * 0.85,
    z: target.position.z + towardGoal,
  }
}

export function shouldVolleyCross(
  playerPos: { x: number; y?: number; z: number },
  ball: { x: number; y?: number; z: number },
  ballVel: { x: number; y: number; z: number },
): boolean {
  const dist = distance2D(
    { x: playerPos.x, y: playerPos.y ?? 0, z: playerPos.z },
    { x: ball.x, y: ball.y ?? 0, z: ball.z },
  )
  if (dist > 2.75) return false
  const horiz = Math.hypot(ballVel.x, ballVel.z)
  if (horiz < 1.2) return false
  const toBallX = ball.x - playerPos.x
  const toBallZ = ball.z - playerPos.z
  const closing = (toBallX * ballVel.x + toBallZ * ballVel.z) / (dist * horiz + 0.001)
  return closing > -0.15
}
