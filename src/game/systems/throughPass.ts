import * as THREE from 'three'
import {
  PASS_SPEED_BASE,
  PASS_SPEED_MAX,
} from '../constants'
import type { FieldBounds, TeamId, Vec3 } from '../types'
import type { PlayerRef } from './entityRegistry'
import { getPassLeadPosition } from './aiBrain'
import { isForwardMakingRun } from './dynamicFormation'
import { isOffsideAtZ } from './offside'
import { normalize2D } from './rules'
import { getAttackingGoalZ, getAttackSign } from './teamField'

/** Passe em profundidade — mais rápido que o passe curto */
export const THROUGH_RECEIVE_MAX_SPEED_MUL = 1.28

export function throughPassSpeedForDistance(dist: number): number {
  return THREE.MathUtils.clamp(
    dist * 0.9 + PASS_SPEED_BASE * 1.2,
    PASS_SPEED_MAX * 0.95,
    PASS_SPEED_MAX * 1.48,
  )
}

/** Alvo à frente do companheiro, em direção ao gol */
export function getThroughPassLead(
  mate: PlayerRef,
  from: Vec3,
  passSpeed: number,
  bounds: FieldBounds,
  team: TeamId,
): Vec3 {
  const attackSign = getAttackSign(team, bounds)
  const base = getPassLeadPosition(mate, from, passSpeed, bounds)
  const depth = isForwardMakingRun(mate.id, mate.team) ? 7.5 : 5.5
  const lateral = mate.position.x * 0.12

  return {
    x: base.x + lateral,
    y: 0,
    z: base.z + attackSign * depth,
  }
}

/** Companheiro à frente na direção do corpo — ideal para corrida em profundidade */
export function findThroughPassTarget(
  from: PlayerRef,
  teammates: PlayerRef[],
  bounds: FieldBounds,
  team: TeamId,
  ballZ: number,
): PlayerRef | null {
  const fx = Math.sin(from.rotation)
  const fz = Math.cos(from.rotation)
  const attackSign = getAttackSign(team, bounds)
  const goalZ = getAttackingGoalZ(team, bounds)

  let best: PlayerRef | null = null
  let bestScore = -Infinity

  for (const p of teammates) {
    if (p.id === from.id || p.role === 'gk') continue

    const dx = p.position.x - from.position.x
    const dz = p.position.z - from.position.z
    const dist = Math.hypot(dx, dz)
    if (dist < 2.5 || dist > 34) continue

    const forward = dx * fx + dz * fz
    if (forward < 1.5) continue

    const dot = forward / dist
    if (dot < 0.52) continue

    const lateral = Math.abs(dx * fz - dz * fx)
    if (lateral / forward > 0.55 && lateral > 2) continue

    if (isOffsideAtZ(team, p.position.z, bounds, ballZ)) continue

    const dzToGoal = (goalZ - p.position.z) * attackSign
    const runBonus = isForwardMakingRun(p.id, p.team) ? 5 : 0
    const roleBonus = p.role === 'fwd' ? 3.5 : p.role === 'mid' ? 1.2 : 0
    const depthBonus = Math.min(Math.max(dzToGoal, 0) / 6, 2.5)
    const facingBonus = dot * 4

    const score = forward * 0.35 + facingBonus + runBonus + roleBonus + depthBonus

    if (score > bestScore) {
      bestScore = score
      best = p
    }
  }

  return best
}

/** Direção do gol para fallback sem alvo */
export function throughPassFallbackDir(
  from: PlayerRef,
  bounds: FieldBounds,
  team: TeamId,
): { x: number; z: number; dist: number } {
  const goalZ = getAttackingGoalZ(team, bounds)
  const n = normalize2D(0 - from.position.x, goalZ - from.position.z)
  return { x: n.x, z: n.z, dist: 14 }
}
