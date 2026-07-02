import type { FieldBounds, PlayerRole, TeamId, Vec3 } from '../types'
import type { PlayerRef } from './entityRegistry'
import { playerRegistry } from './entityRegistry'
import { isOffsideAtPass } from './offside'
import { isForwardMakingRun } from './dynamicFormation'
import { distance2D, normalize2D } from './rules'
import {
  getAttackingGoalZ,
  getAttackSign,
  getDefensiveGoalZ,
  isBallInDefensiveThird,
} from './teamField'

export type CarrierAction = 'dribble' | 'pass' | 'shoot'

export interface CarrierDecision {
  action: CarrierAction
  dribbleDir: { x: number; z: number }
  passTarget: PlayerRef | null
  shootDir: { x: number; z: number }
}

export interface CarrierContext {
  carrier: PlayerRef
  teammates: PlayerRef[]
  opponents: PlayerRef[]
  bounds: FieldBounds
  ball: Vec3
  role: PlayerRole
}

const AI_SHOT_RANGE: Record<PlayerRole, number> = {
  gk: 0,
  def: 6,
  mid: 9.5,
  fwd: 12.5,
}

const AI_PASS_MIN = 2.2
const AI_PASS_MAX = 18
const PRESSURE_DIST = 2.4
const HEAVY_PRESSURE_DIST = 1.5
/** Tempo mínimo com a bola antes de considerar passe (exceto pressão forte) */
export const MIN_HOLD_BEFORE_PASS_MS = 950
/** Tempo mínimo com a bola antes de chutar (exceto cara-a-cara com o gol) */
export const MIN_HOLD_BEFORE_SHOOT_MS = 850
/** Após esse tempo com a bola, força passe se houver alvo */
const FORCE_PASS_HOLD_MS = 3200
const TAP_IN_SHOOT_DIST = 5.5
/** Distância máxima para forçar finalização (por função) */
const FORCE_SHOOT_DIST: Record<PlayerRole, number> = {
  gk: 0,
  def: 8,
  mid: 11,
  fwd: 14,
}
/** Drible para este lado da linha do gol */
const DRIBBLE_STOP_BEFORE_GOAL = 4

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v))
}

export function getCarrierContext(
  carrierId: string,
  role: PlayerRole,
  bounds: FieldBounds,
  ball: Vec3,
): CarrierContext | null {
  const carrier = playerRegistry.get(carrierId)
  if (!carrier) return null

  const teammates: PlayerRef[] = []
  const opponents: PlayerRef[] = []

  for (const p of playerRegistry.values()) {
    if (p.id === carrierId) continue
    if (p.team === carrier.team) {
      if (p.role !== 'gk') teammates.push(p)
    } else if (p.role !== 'gk') {
      opponents.push(p)
    }
  }

  return { carrier, teammates, opponents, bounds, ball, role }
}

export function getNearestOpponent(
  carrier: PlayerRef,
  opponents: PlayerRef[],
): { opponent: PlayerRef; dist: number } | null {
  let best: PlayerRef | null = null
  let min = Infinity
  for (const o of opponents) {
    const d = distance2D(carrier.position, o.position)
    if (d < min) {
      min = d
      best = o
    }
  }
  return best ? { opponent: best, dist: min } : null
}

function distToAttackingGoal(team: TeamId, pos: Vec3, bounds: FieldBounds): number {
  const sign = getAttackSign(team, bounds)
  const goalZ = getAttackingGoalZ(team, bounds)
  return (goalZ - pos.z) * sign
}

function forwardProgress(
  team: TeamId,
  from: Vec3,
  to: Vec3,
  bounds: FieldBounds,
): number {
  const sign = getAttackSign(team, bounds)
  return (to.z - from.z) * sign
}

function opponentsOnPassLane(
  from: Vec3,
  to: Vec3,
  opponents: PlayerRef[],
  laneWidth = 1.1,
): number {
  const dx = to.x - from.x
  const dz = to.z - from.z
  const len = Math.hypot(dx, dz)
  if (len < 0.5) return 0

  let blockers = 0
  for (const o of opponents) {
    const ox = o.position.x - from.x
    const oz = o.position.z - from.z
    const t = clamp((ox * dx + oz * dz) / (len * len), 0, 1)
    const px = from.x + dx * t
    const pz = from.z + dz * t
    const lateral = Math.hypot(o.position.x - px, o.position.z - pz)
    if (lateral < laneWidth) blockers++
  }
  return blockers
}

function spaceAround(pos: Vec3, opponents: PlayerRef[]): number {
  let min = Infinity
  for (const o of opponents) {
    const d = distance2D(pos, o.position)
    if (d < min) min = d
  }
  return min === Infinity ? 10 : min
}

export function scorePassTarget(
  ctx: CarrierContext,
  mate: PlayerRef,
): number {
  const { carrier, opponents, bounds, ball } = ctx
  const dist = distance2D(carrier.position, mate.position)
  if (dist < AI_PASS_MIN || dist > AI_PASS_MAX) return -10

  const ballZ = ball.z

  const fwd = forwardProgress(carrier.team, carrier.position, mate.position, bounds)
  const open = spaceAround(mate.position, opponents)
  const blockers = opponentsOnPassLane(carrier.position, mate.position, opponents)

  let score = 1.2
  if (isOffsideAtPass(carrier.team, mate, bounds, ballZ)) score -= 4
  if (isForwardMakingRun(mate.id, mate.team)) score += 2.2
  score += clamp(fwd * 1.4, -2, 5)
  score += clamp(open * 1.0, 0, 4)
  score -= blockers * 1.8

  if (mate.role === 'fwd') score += 1.8
  else if (mate.role === 'mid') score += 1.4
  else score += 0.6

  if (dist >= 4 && dist <= 13) score += 1.5
  if (dist < 3.5) score -= 1.8
  if (dist < 2.8) score -= 2.5

  const goalDist = distToAttackingGoal(carrier.team, mate.position, bounds)
  if (goalDist < 5) score += 1.8
  if (goalDist < 3) score += 1.2

  if (fwd < -0.5) score -= 3.2

  const facing = facingAlignment(carrier, mate.position)
  if (facing < 0.1) score -= 2.8
  else if (facing < 0.4) score -= 1.2
  else score += facing * 1.4

  return score
}

function facingAlignment(carrier: PlayerRef, target: Vec3): number {
  const fx = Math.sin(carrier.rotation)
  const fz = Math.cos(carrier.rotation)
  const dx = target.x - carrier.position.x
  const dz = target.z - carrier.position.z
  const dist = Math.hypot(dx, dz)
  if (dist < 0.01) return 1
  return (dx * fx + dz * fz) / dist
}

export function getPassLeadPosition(
  mate: PlayerRef,
  from: Vec3,
  passSpeed: number,
  _bounds?: FieldBounds,
): Vec3 {
  const dx = mate.position.x - from.x
  const dz = mate.position.z - from.z
  const dist = Math.hypot(dx, dz)
  const travelTime = dist / Math.max(passSpeed, 4)
  const lead = Math.min(travelTime * 0.75, 1.2)
  const vx = mate.velocity?.x ?? 0
  const vz = mate.velocity?.z ?? 0
  return {
    x: mate.position.x + vx * lead,
    y: 0,
    z: mate.position.z + vz * lead,
  }
}

export function findBestPassTarget(ctx: CarrierContext): PlayerRef | null {
  let best: PlayerRef | null = null
  let bestScore = 1.35

  for (const mate of ctx.teammates) {
    const s = scorePassTarget(ctx, mate)
    if (s > bestScore) {
      bestScore = s
      best = mate
    }
  }

  return best
}

export function evaluateShot(ctx: CarrierContext): {
  shouldShoot: boolean
  score: number
  dir: { x: number; z: number }
} {
  const { carrier, opponents, bounds, role } = ctx
  const team = carrier.team
  const goalZ = getAttackingGoalZ(team, bounds)
  const goalX = bounds.center.x
  const dist = distToAttackingGoal(team, carrier.position, bounds)
  const dir = normalize2D(goalX - carrier.position.x, goalZ - carrier.position.z)

  const maxRange = AI_SHOT_RANGE[role]
  if (dist > maxRange || role === 'gk') {
    return { shouldShoot: false, score: 0, dir }
  }

  // Cara a cara / dentro da área — sempre finaliza (não dribla para dentro do gol)
  if (dist <= TAP_IN_SHOOT_DIST) {
    return { shouldShoot: true, score: 99, dir }
  }

  const blockers = opponentsOnPassLane(
    carrier.position,
    { x: goalX, y: 0, z: goalZ },
    opponents,
    1.4,
  )

  let score = 0
  score += clamp((maxRange - dist) * 1.4, 0, 8)
  score -= blockers * 4
  score += spaceAround(carrier.position, opponents) * 0.6

  if (role === 'fwd') score += 2.5
  else if (role === 'mid') score += 0.8
  else score -= 1

  if (dist < 6) score += 2
  if (dist < 3.5) score += 3
  if (dist < 2) score += 2

  const threshold = role === 'fwd' ? 3.2 : role === 'mid' ? 4.5 : 6

  return {
    shouldShoot: score >= threshold,
    score,
    dir,
  }
}

export function getDribbleDirection(ctx: CarrierContext): { x: number; z: number } {
  const { carrier, opponents, bounds } = ctx
  const team = carrier.team
  const sign = getAttackSign(team, bounds)
  const goalZ = getAttackingGoalZ(team, bounds)
  const goalX = bounds.center.x
  const goalDist = distToAttackingGoal(team, carrier.position, bounds)

  const toGoal = normalize2D(goalX - carrier.position.x, goalZ - carrier.position.z)
  let dx = toGoal.x
  let dz = toGoal.z

  // Perto do gol: não avança mais — espera a decisão de chute
  if (goalDist < DRIBBLE_STOP_BEFORE_GOAL) {
    const lateralX = -toGoal.z
    const lateralZ = toGoal.x
    const latLen = Math.hypot(lateralX, lateralZ) || 1
    return { x: lateralX / latLen, z: lateralZ / latLen }
  }

  if (goalDist < DRIBBLE_STOP_BEFORE_GOAL + 2.5) {
    const slow = clamp((goalDist - DRIBBLE_STOP_BEFORE_GOAL) / 2.5, 0.2, 1)
    dx *= slow
    dz *= slow
  }

  const nearest = getNearestOpponent(carrier, opponents)
  if (nearest && nearest.dist < PRESSURE_DIST) {
    const away = normalize2D(
      carrier.position.x - nearest.opponent.position.x,
      carrier.position.z - nearest.opponent.position.z,
    )
    const lateralX = -toGoal.z
    const lateralZ = toGoal.x
    const latSign = away.x * lateralX + away.z * lateralZ >= 0 ? 1 : -1

    const pressureWeight = clamp(1 - nearest.dist / PRESSURE_DIST, 0.35, 1)
    const dodgeX = lateralX * latSign
    const dodgeZ = lateralZ * latSign

    dx = toGoal.x * (1 - pressureWeight * 0.45) + (away.x * 0.35 + dodgeX * 0.65) * pressureWeight
    dz = toGoal.z * (1 - pressureWeight * 0.45) + (away.z * 0.35 + dodgeZ * 0.65) * pressureWeight
  }

  if (isBallInDefensiveThird(carrier.position, team, bounds)) {
    const ownGoalZ = getDefensiveGoalZ(team, bounds)
    const awayOwnGoal = normalize2D(
      carrier.position.x - bounds.center.x,
      carrier.position.z - (ownGoalZ + sign * 2),
    )
    dx = dx * 0.55 + awayOwnGoal.x * 0.25 + toGoal.x * 0.2
    dz = dz * 0.55 + awayOwnGoal.z * 0.25 + toGoal.z * 0.2
  }

  return normalize2D(dx, dz)
}

export function getDribbleTarget(
  ctx: CarrierContext,
  lookahead = 3.5,
): { x: number; z: number } {
  const dir = getDribbleDirection(ctx)
  const { carrier, bounds } = ctx
  const team = carrier.team
  const sign = getAttackSign(team, bounds)
  const goalZ = getAttackingGoalZ(team, bounds)
  const stopZ = goalZ - sign * DRIBBLE_STOP_BEFORE_GOAL

  let x = carrier.position.x + dir.x * lookahead
  let z = carrier.position.z + dir.z * lookahead

  if (sign > 0) z = Math.min(z, stopZ)
  else z = Math.max(z, stopZ)

  return { x, z }
}

export function decideCarrierAction(
  ctx: CarrierContext,
  holdMs = 0,
): CarrierDecision {
  const { carrier, role, bounds } = ctx
  const dribbleDir = getDribbleDirection(ctx)
  const shot = evaluateShot(ctx)
  const passTarget = findBestPassTarget(ctx)
  const passScore = passTarget ? scorePassTarget(ctx, passTarget) : 0
  const nearest = getNearestOpponent(carrier, ctx.opponents)
  const pressure = nearest?.dist ?? 10
  const goalDist = distToAttackingGoal(carrier.team, carrier.position, bounds)
  const tapIn = goalDist < TAP_IN_SHOOT_DIST
  const canShootYet = holdMs >= MIN_HOLD_BEFORE_SHOOT_MS || tapIn
  const forceShootDist = FORCE_SHOOT_DIST[role]

  if (
    canShootYet &&
    role !== 'gk' &&
    goalDist <= forceShootDist &&
    (shot.shouldShoot || goalDist <= TAP_IN_SHOOT_DIST || (goalDist < 8 && role === 'fwd') || (goalDist < 6.5 && role === 'mid'))
  ) {
    return {
      action: 'shoot',
      dribbleDir,
      passTarget: null,
      shootDir: shot.dir,
    }
  }

  if (shot.shouldShoot && canShootYet) {
    return {
      action: 'shoot',
      dribbleDir,
      passTarget: null,
      shootDir: shot.dir,
    }
  }

  const underPressure = pressure < PRESSURE_DIST
  const heavyPressure = pressure < HEAVY_PRESSURE_DIST
  const canPassYet = holdMs >= MIN_HOLD_BEFORE_PASS_MS || heavyPressure
  const forcePass = holdMs >= FORCE_PASS_HOLD_MS && passTarget && passScore > 0.8

  let passThreshold =
    role === 'def' ? 2.0 : role === 'mid' ? 2.5 : role === 'gk' ? 0.5 : 3.0

  if (heavyPressure) passThreshold -= 1.0
  else if (underPressure) passThreshold -= 0.45

  if (role === 'gk') {
    if (holdMs >= 380 && passTarget && passScore >= 0.45) {
      return { action: 'pass', dribbleDir, passTarget, shootDir: shot.dir }
    }
    const gkThreshold = heavyPressure ? 0.5 : underPressure ? 0.62 : 1.05
    if (passTarget && passScore >= gkThreshold && (canPassYet || holdMs >= 600)) {
      return { action: 'pass', dribbleDir, passTarget, shootDir: shot.dir }
    }
    if (holdMs >= 1800 && passTarget && passScore > 0.25) {
      return { action: 'pass', dribbleDir, passTarget, shootDir: shot.dir }
    }
    return { action: 'dribble', dribbleDir, passTarget: null, shootDir: shot.dir }
  }

  if (passTarget && canPassYet && (forcePass || passScore >= passThreshold)) {
    return {
      action: 'pass',
      dribbleDir,
      passTarget,
      shootDir: shot.dir,
    }
  }

  return {
    action: 'dribble',
    dribbleDir,
    passTarget: null,
    shootDir: shot.dir,
  }
}

/** Posição para cortar linha de passe adversária */
export function getPassLaneBlockTarget(
  team: TeamId,
  bounds: FieldBounds,
  carrier: PlayerRef,
  _ball: Vec3,
): { x: number; z: number } | null {
  const oppTeammates = [...playerRegistry.values()].filter(
    (p) => p.team === carrier.team && p.role !== 'gk' && p.id !== carrier.id,
  )
  const defenders = [...playerRegistry.values()].filter(
    (p) => p.team === team && p.role !== 'gk',
  )
  if (oppTeammates.length === 0) return null

  const carrierPos = carrier.position
  let bestLane: { x: number; z: number } | null = null
  let bestScore = 0

  for (const mate of oppTeammates) {
    const fwd = forwardProgress(carrier.team, carrierPos, mate.position, bounds)
    if (fwd < 1) continue

    const covered = opponentsOnPassLane(carrierPos, mate.position, defenders, 1.1)
    if (covered > 0) continue

    const midX = (carrierPos.x + mate.position.x) * 0.5
    const midZ = (carrierPos.z + mate.position.z) * 0.5
    const laneOpen = spaceAround({ x: midX, y: 0, z: midZ }, defenders)
    const score = fwd + laneOpen

    if (score > bestScore) {
      bestScore = score
      bestLane = { x: midX, z: midZ }
    }
  }

  return bestLane
}
