import type { FieldBounds, GoalZone, OutType, TeamId, Vec3 } from '../types'
import { BALL_RADIUS } from '../constants'
import { getOpponent } from '../store/gameStore'
import { getBallSpawnPosition } from './fieldData'
import {
  getAttackingGoalZ,
  getAttackingTeamAtGoalLine,
  getDefensiveGoalZ,
  getGoalKickPosition,
  getGoalLineSide,
  getScoringTeamForGoalZone,
} from './teamField'

const SIDELINE_MARGIN = 0.02
const GOAL_LINE_MARGIN = 0.05

export function isBallInBounds(
  pos: Vec3,
  bounds: FieldBounds,
): boolean {
  return (
    pos.x >= bounds.minX - SIDELINE_MARGIN &&
    pos.x <= bounds.maxX + SIDELINE_MARGIN &&
    pos.z >= bounds.minZ - GOAL_LINE_MARGIN &&
    pos.z <= bounds.maxZ + GOAL_LINE_MARGIN
  )
}

export function isBallInGoal(pos: Vec3, goals: GoalZone[]): TeamId | null {
  for (const goal of goals) {
    if (pos.x < goal.minX || pos.x > goal.maxX) continue
    if (pos.y < goal.minY || pos.y > goal.maxY) continue
    if (pos.z < goal.minZ || pos.z > goal.maxZ) continue

    const lineZ = goal.team === 'home' ? goal.minZ : goal.maxZ
    const crossed =
      goal.team === 'home'
        ? pos.z - BALL_RADIUS > lineZ
        : pos.z + BALL_RADIUS < lineZ
    if (!crossed) continue

    return getScoringTeamForGoalZone(goal.team)
  }
  return null
}

export function detectOutOfBounds(
  pos: Vec3,
  bounds: FieldBounds,
): { out: boolean; type?: OutType; side?: 'left' | 'right' | 'home' | 'away' } {
  const outLeft = pos.x < bounds.minX - SIDELINE_MARGIN
  const outRight = pos.x > bounds.maxX + SIDELINE_MARGIN

  if (outLeft) return { out: true, type: 'sideline', side: 'left' }
  if (outRight) return { out: true, type: 'sideline', side: 'right' }

  const outMinZ = pos.z < bounds.minZ - GOAL_LINE_MARGIN
  const outMaxZ = pos.z > bounds.maxZ + GOAL_LINE_MARGIN

  if (outMinZ || outMaxZ) {
    const goalSide = getGoalLineSide(pos, bounds)
    if (goalSide) {
      return { out: true, type: 'goal-line', side: goalSide }
    }
  }

  return { out: false }
}

export function resolveThrowIn(
  pos: Vec3,
  bounds: FieldBounds,
): Vec3 {
  const BALL_INSET = 0.38
  const outLeft = pos.x < bounds.center.x
  const x = outLeft ? bounds.minX + BALL_INSET : bounds.maxX - BALL_INSET
  const z = clamp(pos.z, bounds.minZ + 0.8, bounds.maxZ - 0.8)
  return { x, y: 0.11, z }
}

export function resolveCorner(
  pos: Vec3,
  bounds: FieldBounds,
  attackingTeam: TeamId,
): Vec3 {
  const attackGoalZ = getAttackingGoalZ(attackingTeam, bounds)
  const defendGoalZ = getDefensiveGoalZ(attackingTeam, bounds)

  const attackCorners = bounds.corners.filter(
    (c) => Math.abs(c.z - attackGoalZ) < Math.abs(c.z - defendGoalZ),
  )

  let best = attackCorners[0] ?? bounds.corners[0]
  let minDist = Infinity
  for (const c of attackCorners) {
    const d = distance2D(pos, c)
    if (d < minDist) {
      minDist = d
      best = c
    }
  }

  const INSET = 0.28
  const signX = best.x >= bounds.center.x ? -INSET : INSET
  const signZ = best.z >= bounds.center.z ? -INSET : INSET

  return { x: best.x + signX, y: 0.11, z: best.z + signZ }
}

export function resolveGoalKick(bounds: FieldBounds, defendingTeam: TeamId): Vec3 {
  return getGoalKickPosition(defendingTeam, bounds)
}

export function getKickoffPosition(bounds: FieldBounds): Vec3 {
  return getBallSpawnPosition(bounds)
}

export function determineSetPieceTeam(
  outType: OutType,
  lastTouch: TeamId | null,
  side: 'left' | 'right' | 'home' | 'away',
): { phase: 'throw-in' | 'corner' | 'goal-kick'; team: TeamId } {
  if (outType === 'sideline') {
    return {
      phase: 'throw-in',
      team: lastTouch ? getOpponent(lastTouch) : 'home',
    }
  }

  // side = linha de gol física (home = end homeScoringGoalZ)
  const attackingTeam =
    side === 'home' || side === 'away'
      ? getAttackingTeamAtGoalLine(side)
      : (side as TeamId)
  const defendingTeam = getOpponent(attackingTeam)

  if (lastTouch === defendingTeam) {
    return { phase: 'corner', team: attackingTeam }
  }
  return { phase: 'goal-kick', team: defendingTeam }
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v))
}

export function distance2D(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x
  const dz = a.z - b.z
  return Math.sqrt(dx * dx + dz * dz)
}

export function normalize2D(x: number, z: number): { x: number; z: number } {
  const len = Math.sqrt(x * x + z * z)
  if (len < 0.0001) return { x: 0, z: 1 }
  return { x: x / len, z: z / len }
}

export function lerpAngle(a: number, b: number, t: number): number {
  let diff = b - a
  while (diff > Math.PI) diff -= Math.PI * 2
  while (diff < -Math.PI) diff += Math.PI * 2
  return a + diff * t
}

/** Diferença angular assinada em [-π, π] */
export function shortestAngleDelta(from: number, to: number): number {
  let d = to - from
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return d
}

/** Gira em direção ao alvo com velocidade constante (rad/s), independente do FPS */
export function rotateTowardAngle(
  current: number,
  target: number,
  maxRadiansPerSec: number,
  delta: number,
): number {
  const diff = shortestAngleDelta(current, target)
  const step = maxRadiansPerSec * delta
  if (Math.abs(diff) <= step) return target
  return current + Math.sign(diff) * step
}
