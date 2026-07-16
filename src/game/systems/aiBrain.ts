import type { FieldBounds, PlayerRole, TeamId, Vec3 } from '../types'
import type { PlayerRef } from './entityRegistry'
import { playerRegistry } from './entityRegistry'
import { isOffsideAtPass } from './offside'
import { isForwardMakingRun, type TeamPhase } from './dynamicFormation'
import { QUICK_PASS_POWER } from './shotPower'
import { distance2D, normalize2D } from './rules'
import {
  getAttackingGoalZ,
  getAttackSign,
  getDefensiveGoalZ,
  isBallInDefensiveThird,
} from './teamField'
import { getCrossSetupDribbleDir, shouldAICross, type CrossKind } from './aiCross'

export type CarrierAction = 'dribble' | 'pass' | 'shoot' | 'cross'

export type AIPassStyle = {
  power: number
  quickPass: boolean
  through: boolean
}

export interface CarrierDecision {
  action: CarrierAction
  dribbleDir: { x: number; z: number }
  passTarget: PlayerRef | null
  crossTarget: PlayerRef | null
  crossKind: CrossKind
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

type PassScoreOpts = {
  preferSafety?: boolean
  underPressure?: boolean
  heavyPressure?: boolean
  holdUpRecycle?: boolean
}

const AI_SHOT_RANGE: Record<PlayerRole, number> = {
  gk: 0,
  def: 10.5,
  mid: 15.5,
  fwd: 18.5,
}

const AI_PASS_MIN = 2
const AI_PASS_MAX = 22
const PRESSURE_DIST = 3.25
const HEAVY_PRESSURE_DIST = 1.95
const MARKED_DIST = 2.0
const OPEN_SPACE_MIN = 2.6
/** Score mínimo absoluto para considerar um alvo de passe */
const MIN_VIABLE_PASS_SCORE = 1.45
const MIN_VIABLE_PASS_SCORE_PRESSURE = 1.15

/** Tempo mínimo com a bola antes de considerar passe (exceto emergência / saída de bola) */
export const MIN_HOLD_BEFORE_PASS_MS = 560
/** Tempo mínimo com a bola antes de chutar (exceto cara-a-cara com o gol) */
export const MIN_HOLD_BEFORE_SHOOT_MS = 380
/** Após esse tempo com a bola, força passe se houver alvo */
const FORCE_PASS_HOLD_MS: Record<PlayerRole, number> = {
  gk: 2200,
  def: 1200,
  mid: 1800,
  fwd: 3000,
}
const ROLE_PASS_HOLD_MS: Record<PlayerRole, number> = {
  gk: 700,
  def: 520,
  mid: 640,
  fwd: 800,
}
const ROLE_PASS_MIN_SCORE: Record<PlayerRole, number> = {
  gk: 2.2,
  def: 0.92,
  mid: 1.05,
  fwd: 1.65,
}
const TAP_IN_SHOOT_DIST = 6.4
const FORCE_SHOOT_DIST: Record<PlayerRole, number> = {
  gk: 0,
  def: 9,
  mid: 13,
  fwd: 16.5,
}
const DRIBBLE_STOP_BEFORE_GOAL = 4

/** Direção de drible filtrada por jogador (evita viradas secas) */
const smoothedDribbleDir = new Map<string, { x: number; z: number }>()

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
  laneWidth = 1.15,
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

function countOpponentsNear(pos: Vec3, opponents: PlayerRef[], radius: number): number {
  let n = 0
  for (const o of opponents) {
    if (distance2D(pos, o.position) < radius) n++
  }
  return n
}

function isMateMarked(mate: PlayerRef, opponents: PlayerRef[], markDist = MARKED_DIST): boolean {
  return spaceAround(mate.position, opponents) < markDist
}

function lateralSpread(from: Vec3, to: Vec3): number {
  return Math.abs(to.x - from.x)
}

export function scorePassTarget(
  ctx: CarrierContext,
  mate: PlayerRef,
  opts: PassScoreOpts = {},
): number {
  const { carrier, opponents, bounds, ball } = ctx
  const { preferSafety = false, underPressure = false, heavyPressure = false } = opts
  const carrierRole = ctx.role
  const dist = distance2D(carrier.position, mate.position)
  if (dist < AI_PASS_MIN || dist > AI_PASS_MAX) return -10

  const fwd = forwardProgress(carrier.team, carrier.position, mate.position, bounds)
  const open = spaceAround(mate.position, opponents)
  const blockers = opponentsOnPassLane(carrier.position, mate.position, opponents)
  const marked = isMateMarked(mate, opponents)
  const carrierOpen = spaceAround(carrier.position, opponents)

  let score = -2.2

  if (isOffsideAtPass(carrier.team, mate, bounds, ball.z)) return -12
  if (marked) return -8

  score += 1.2 + clamp((open - OPEN_SPACE_MIN) * 1.25, 0, 5)

  if (blockers > 0) score -= blockers * 3.2
  else if (open > OPEN_SPACE_MIN + 0.3) score += 1.4

  if (isForwardMakingRun(mate.id, mate.team) && !marked && blockers === 0) score += 3.2

  // Progressão — passe precisa avançar o jogo (exceto reciclagem sob pressão)
  if (fwd > 2.5 && open > OPEN_SPACE_MIN && blockers === 0) {
    score += clamp(fwd * 0.95, 0, 5.5)
  } else if (fwd > 0.8 && open > OPEN_SPACE_MIN && blockers === 0) {
    score += clamp(fwd * 0.45, 0, 2.2)
  } else if (fwd < 0.2 && !preferSafety && !heavyPressure) {
    score -= 3.2
  }

  if (mate.role === 'fwd' && !marked && fwd > 1) score += 1.6
  else if (mate.role === 'mid' && !marked && fwd > 0.5) score += 1
  else if (mate.role === 'def') score += preferSafety || heavyPressure ? 1.6 : -0.6

  // Companheiro aberto à frente — prioridade de jogo coletivo
  if (!marked && blockers === 0 && open > OPEN_SPACE_MIN + 0.35 && fwd > 0.35) {
    score += 1.8
    if (carrierRole !== 'fwd') score += 1.2
  }

  if (dist >= 5 && dist <= 16) score += 0.8
  if (dist < 3.2) score -= 2.8
  if (dist > 18) score -= 1.2

  const goalDist = distToAttackingGoal(carrier.team, mate.position, bounds)
  if (goalDist < 5 && !marked && blockers === 0) score += 1.8

  const carrierGoalDist = distToAttackingGoal(carrier.team, carrier.position, bounds)
  const inOwnThird = isBallInDefensiveThird(carrier.position, carrier.team, bounds)
  if (inOwnThird || carrierGoalDist > 28) {
    if (carrierRole === 'def' && (mate.role === 'mid' || mate.role === 'fwd') && fwd > 0.4) {
      score += 2.6
    }
    if (carrierRole === 'mid' && mate.role === 'fwd' && fwd > 1.2) {
      score += 2
    }
    if (carrierRole === 'def' && mate.role === 'mid' && fwd > 1 && fwd < 14) {
      score += 1.4
    }
    if (fwd > 0.8 && fwd < 16 && !marked && blockers === 0) {
      score += 1.1
    }
  }

  // Passe para trás / reciclagem — inteligente sob pressão
  if (fwd < -0.4) {
    if (preferSafety || heavyPressure || (underPressure && carrierOpen < 2.6)) {
      score += clamp(-fwd * 1.05, 0, 4.2)
      if (mate.role === 'def' || mate.role === 'mid') score += 2.2
      if (open > OPEN_SPACE_MIN + 0.5) score += 2
    } else if (!underPressure) {
      score -= 1.8
    } else {
      score += 0.6
    }
  }

  const lateral = lateralSpread(carrier.position, mate.position)
  const shortSideTap = lateral > 3.5 && dist < 7 && fwd < 1.2

  // Evita toque fraco para o lado quando há espaço para jogar para frente
  if (shortSideTap && !underPressure && !preferSafety) {
    score -= 2.8
  } else if (shortSideTap && underPressure) {
    score += 0.4
  }

  // Troca de lado só sob pressão / reciclagem — não passe lateral curto por padrão
  if (
    lateral > 7 &&
    open > OPEN_SPACE_MIN &&
    !marked &&
    (preferSafety || heavyPressure) &&
    dist >= 8
  ) {
    score += 1.6
  } else if (lateral > 9 && open > OPEN_SPACE_MIN + 0.5 && !marked && fwd > 2.5 && dist >= 10) {
    score += 0.8
  }

  const facing = facingAlignment(carrier, mate.position)
  if (facing < -0.15) score -= 2.4
  else if (facing < 0.25) score -= 1.1
  else score += facing * 1.1

  if (heavyPressure && !marked && open > 2.5 && blockers === 0) score += 1.2

  if (opts.holdUpRecycle && carrierRole === 'fwd' && fwd < 0.2) {
    score += clamp(-fwd * 1.15, 0, 5.5)
    if (mate.role === 'mid') score += 3.2
    else if (mate.role === 'def') score += 2.2
    if (open > OPEN_SPACE_MIN && blockers === 0) score += 2.4
  }

  return score
}

/** Quão bom é seguir conduzindo em vez de passar */
function isDeepBuildUp(ctx: CarrierContext): boolean {
  const { carrier, bounds, role } = ctx
  const goalDist = distToAttackingGoal(carrier.team, carrier.position, bounds)
  const inOwnThird = isBallInDefensiveThird(carrier.position, carrier.team, bounds)
  if (role === 'def' && (inOwnThird || goalDist > 26)) return true
  if (role === 'mid' && (inOwnThird || goalDist > 28)) return true
  if (role === 'mid' && goalDist > 34) return true
  return false
}

function shouldPlayAsTeam(ctx: CarrierContext): boolean {
  const { role, bounds, carrier } = ctx
  if (role === 'def' || role === 'mid') return true
  const goalDist = distToAttackingGoal(carrier.team, carrier.position, bounds)
  return goalDist > 20
}

/** Atacante cercado por marcação — não deve ir sozinho ao gol */
export function isCarrierSurrounded(ctx: CarrierContext): boolean {
  const { carrier, opponents, role } = ctx
  if (role !== 'fwd') return false

  const open = spaceAround(carrier.position, opponents)
  const pressZone = countOpponentsNear(carrier.position, opponents, 3.4)
  const close = countOpponentsNear(carrier.position, opponents, 4.5)

  if (pressZone >= 2 && open < 3.4) return true
  if (close >= 3) return true
  if (close >= 2 && open < 2.5) return true
  return false
}

/** Atacante com espaço — pode ir direto ao gol */
export function isCarrierIsolated(ctx: CarrierContext): boolean {
  const { carrier, opponents, role } = ctx
  if (role !== 'fwd') return false
  const open = spaceAround(carrier.position, opponents)
  const close = countOpponentsNear(carrier.position, opponents, 5.2)
  return open >= 3.6 && close <= 1
}

function findRecyclePassTarget(ctx: CarrierContext): PlayerRef | null {
  const opts: PassScoreOpts = {
    preferSafety: true,
    underPressure: true,
    heavyPressure: true,
    holdUpRecycle: true,
  }
  let best: PlayerRef | null = null
  let bestScore = 0.85

  for (const mate of ctx.teammates) {
    const fwd = forwardProgress(
      ctx.carrier.team,
      ctx.carrier.position,
      mate.position,
      ctx.bounds,
    )
    if (fwd > 1.2) continue
    if (isMateMarked(mate, ctx.opponents)) continue
    if (opponentsOnPassLane(ctx.carrier.position, mate.position, ctx.opponents) > 0) continue

    let score = scorePassTarget(ctx, mate, opts)
    if (mate.role === 'mid') score += 1.4
    if (mate.role === 'def') score += 0.8
    if (fwd < -1.5) score += 1.2

    if (score > bestScore) {
      bestScore = score
      best = mate
    }
  }

  return best
}

function getHoldUpLookDir(ctx: CarrierContext): { x: number; z: number } {
  const { carrier, bounds } = ctx
  const team = carrier.team
  const recycle = findRecyclePassTarget(ctx)
  if (recycle) {
    return normalize2D(
      recycle.position.x - carrier.position.x,
      recycle.position.z - carrier.position.z,
    )
  }
  const sign = getAttackSign(team, bounds)
  return { x: 0, z: -sign }
}

/** Recua com a bola pro meio-campo — não para no lugar */
function getHoldUpMoveDir(ctx: CarrierContext): { x: number; z: number } {
  const { carrier, opponents, bounds } = ctx
  const team = carrier.team
  const goalZ = getAttackingGoalZ(team, bounds)
  const goalX = bounds.center.x
  const toGoal = normalize2D(goalX - carrier.position.x, goalZ - carrier.position.z)
  const lateralX = -toGoal.z
  const lateralZ = toGoal.x
  const backward = { x: -toGoal.x, z: -toGoal.z }

  const recycle = findRecyclePassTarget(ctx)
  if (recycle) {
    const toMate = normalize2D(
      recycle.position.x - carrier.position.x,
      recycle.position.z - carrier.position.z,
    )
    const nearest = getNearestOpponent(carrier, opponents)
    if (nearest) {
      const dodge = pickPressureDodge(carrier, nearest, lateralX, lateralZ)
      return normalize2D(toMate.x * 0.78 + dodge.x * 0.14 + backward.x * 0.08, toMate.z * 0.78 + dodge.z * 0.14 + backward.z * 0.08)
    }
    return toMate
  }

  const nearest = getNearestOpponent(carrier, opponents)
  if (nearest) {
    const dodge = pickPressureDodge(carrier, nearest, lateralX, lateralZ)
    return normalize2D(backward.x * 0.72 + dodge.x * 0.28, backward.z * 0.72 + dodge.z * 0.28)
  }

  const wideX = clamp(
    bounds.center.x + (carrier.position.x < bounds.center.x ? 2.8 : -2.8),
    bounds.minX + 1.2,
    bounds.maxX - 1.2,
  )
  const sign = getAttackSign(team, bounds)
  const dropZ = carrier.position.z - sign * 2.4
  const dropShape = normalize2D(wideX - carrier.position.x, dropZ - carrier.position.z)
  return normalize2D(backward.x * 0.62 + dropShape.x * 0.38, backward.z * 0.62 + dropShape.z * 0.38)
}

function evaluateCarryValue(ctx: CarrierContext): number {
  const { carrier, opponents, bounds, role } = ctx
  const open = spaceAround(carrier.position, opponents)
  const goalDist = distToAttackingGoal(carrier.team, carrier.position, bounds)
  const nearest = getNearestOpponent(carrier, opponents)
  const pressure = nearest?.dist ?? 10
  const heavyPressure = pressure < HEAVY_PRESSURE_DIST
  const underPressure = pressure < PRESSURE_DIST
  const inOwnThird = isBallInDefensiveThird(carrier.position, carrier.team, bounds)

  let score = 0.2

  if (open >= 4.5) score += 1.2
  else if (open >= OPEN_SPACE_MIN + 0.6) score += 0.55
  else if (open < MARKED_DIST) score -= 2.8

  if (!underPressure) score += 0.55
  else if (!heavyPressure) score += 0.15
  else score -= 1.6

  if (role === 'fwd') {
    if (isCarrierSurrounded(ctx)) score -= 4.5
    if (isCarrierIsolated(ctx)) score += 2.2
    if (goalDist < 12) score += 2.6
    else if (goalDist < 18) score += 1.4
    else if (goalDist < 26) score += 0.35
    else score -= 0.8
  } else if (role === 'mid') {
    if (goalDist < 14) score += 0.9
    else if (goalDist < 20) score += 0.25
    if (inOwnThird || goalDist > 22) score -= 4.2
    else if (goalDist > 30) score -= 2.8
  } else if (role === 'def') {
    if (inOwnThird) score -= 6.5
    else if (goalDist > 30) score -= 4.5
    else if (goalDist > 22) score -= 3.2
    else if (goalDist > 16) score -= 1.8
    else if (goalDist > 12) score -= 0.8
  }

  if (inOwnThird && role !== 'fwd') score -= 2
  if (role !== 'fwd' && goalDist > 18) score = Math.min(score, 0.35)
  if (role === 'def' && goalDist > 14) score = Math.min(score, -0.5)

  return score
}

function facingAlignment(carrier: PlayerRef, target: Vec3): number {
  const speed = Math.hypot(carrier.velocity.x, carrier.velocity.z)
  const fx = speed > 0.22 ? carrier.velocity.x / speed : Math.sin(carrier.rotation)
  const fz = speed > 0.22 ? carrier.velocity.z / speed : Math.cos(carrier.rotation)
  const dx = target.x - carrier.position.x
  const dz = target.z - carrier.position.z
  const dist = Math.hypot(dx, dz)
  if (dist < 0.01) return 1
  return (dx * fx + dz * fz) / dist
}

/** Mesmo sistema do jogador: passe rápido (toque) na maioria dos casos */
export function getAIPassParams(
  ctx: CarrierContext,
  target: PlayerRef,
  opts?: { underPressure?: boolean; recycle?: boolean },
): AIPassStyle {
  const { carrier, bounds } = ctx
  const dist = distance2D(carrier.position, target.position)
  const fwd = forwardProgress(carrier.team, carrier.position, target.position, bounds)
  const recycle = opts?.recycle ?? fwd < -0.5
  const runInBehind =
    isForwardMakingRun(target.id, target.team) && fwd > 1.2 && dist >= 5.5 && !recycle

  if (runInBehind && dist >= 6) {
    return {
      power: 0.72 + Math.min(dist * 0.008, 0.18),
      quickPass: false,
      through: true,
    }
  }

  if (dist >= 16) {
    return {
      power: 0.78 + Math.min(dist * 0.012, 0.14),
      quickPass: false,
      through: false,
    }
  }

  if (opts?.underPressure && dist < 7.5) {
    return { power: QUICK_PASS_POWER, quickPass: true, through: false }
  }

  if (recycle && opts?.underPressure) {
    return { power: QUICK_PASS_POWER, quickPass: true, through: false }
  }

  if (recycle) {
    return { power: 0.52, quickPass: false, through: false }
  }

  return { power: 0.54, quickPass: false, through: false }
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
  const lead = Math.min(travelTime * 0.95, 1.55)
  const vx = mate.velocity?.x ?? 0
  const vz = mate.velocity?.z ?? 0
  // Leve lead à frente dos pés do parado — bola não passa atrás do corpo
  const speed2 = Math.hypot(vx, vz)
  const faceX = Math.sin(mate.rotation)
  const faceZ = Math.cos(mate.rotation)
  const stillLead = speed2 < 0.35 ? Math.min(0.22 + travelTime * 0.12, 0.42) : 0
  return {
    x: mate.position.x + vx * lead + faceX * stillLead,
    y: 0,
    z: mate.position.z + vz * lead + faceZ * stillLead,
  }
}

export function findBestPassTarget(ctx: CarrierContext): PlayerRef | null {
  const nearest = getNearestOpponent(ctx.carrier, ctx.opponents)
  const pressure = nearest?.dist ?? 10
  const underPressure = pressure < PRESSURE_DIST
  const heavyPressure = pressure < HEAVY_PRESSURE_DIST
  const crowded = countOpponentsNear(ctx.carrier.position, ctx.opponents, 3.4) >= 2
  const preferSafety = heavyPressure || crowded || (underPressure && isBallInDefensiveThird(ctx.carrier.position, ctx.carrier.team, ctx.bounds))

  const opts: PassScoreOpts = { preferSafety, underPressure, heavyPressure }
  const inOwnThird = isBallInDefensiveThird(ctx.carrier.position, ctx.carrier.team, ctx.bounds)
  const deepCarrier = ctx.role === 'def' || (ctx.role === 'mid' && inOwnThird)
  let best: PlayerRef | null = null
  let bestScore = deepCarrier
    ? 0.85
    : preferSafety
      ? MIN_VIABLE_PASS_SCORE_PRESSURE
      : MIN_VIABLE_PASS_SCORE

  for (const mate of ctx.teammates) {
    const s = scorePassTarget(ctx, mate, opts)
    if (s > bestScore) {
      bestScore = s
      best = mate
    }
  }

  return best
}

export function findOpenPassTarget(ctx: CarrierContext): PlayerRef | null {
  const nearest = getNearestOpponent(ctx.carrier, ctx.opponents)
  const pressure = nearest?.dist ?? 10
  const underPressure = pressure < PRESSURE_DIST
  const heavyPressure = pressure < HEAVY_PRESSURE_DIST
  const crowded = countOpponentsNear(ctx.carrier.position, ctx.opponents, 3.4) >= 2
  const preferSafety = heavyPressure || crowded
  const opts: PassScoreOpts = { preferSafety, underPressure, heavyPressure }

  let best: PlayerRef | null = null
  let bestScore = MIN_VIABLE_PASS_SCORE_PRESSURE + 0.4

  for (const mate of ctx.teammates) {
    if (isMateMarked(mate, ctx.opponents)) continue
    const s = scorePassTarget(ctx, mate, opts)
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

  if (role === 'def' && (dist > 4.5 || isBallInDefensiveThird(carrier.position, team, bounds))) {
    return { shouldShoot: false, score: 0, dir }
  }

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
  score += spaceAround(carrier.position, opponents) * 0.55

  if (role === 'fwd') score += 2.5
  else if (role === 'mid') score += 0.8
  else score -= 1

  if (dist < 6) score += 2
  if (dist < 3.5) score += 3

  const threshold = role === 'fwd' ? 4.2 : role === 'mid' ? 5.1 : 6.4

  return {
    shouldShoot: score >= threshold && dist <= maxRange * 0.92,
    score,
    dir,
  }
}

/** Nunca dribla para trás — no mínimo avança um pouco em direção ao gol */
function ensureForwardDribbleDir(
  team: TeamId,
  bounds: FieldBounds,
  dir: { x: number; z: number },
  toGoal: { x: number; z: number },
  minForward = 0.38,
): { x: number; z: number } {
  const sign = getAttackSign(team, bounds)
  let dx = dir.x
  let dz = dir.z
  const fwd = dz * sign

  if (fwd >= minForward) return normalize2D(dx, dz)

  const need = minForward - Math.max(fwd, -0.05)
  const blend = clamp(need / 0.55, 0.35, 0.82)
  dx = dx * (1 - blend) + toGoal.x * blend
  dz = dz * (1 - blend) + toGoal.z * blend

  if (dz * sign < minForward) {
    dz = sign * minForward
  }

  return normalize2D(dx, dz)
}

function pickPressureDodge(
  carrier: PlayerRef,
  nearest: { opponent: PlayerRef },
  lateralX: number,
  lateralZ: number,
): { x: number; z: number } {
  const away = normalize2D(
    carrier.position.x - nearest.opponent.position.x,
    carrier.position.z - nearest.opponent.position.z,
  )
  const latSign = away.x * lateralX + away.z * lateralZ >= 0 ? 1 : -1
  return normalize2D(lateralX * latSign, lateralZ * latSign)
}

function blendDirTowardMate(
  carrier: PlayerRef,
  base: { x: number; z: number },
  mate: PlayerRef,
  weight: number,
): { x: number; z: number } {
  const toMate = normalize2D(
    mate.position.x - carrier.position.x,
    mate.position.z - carrier.position.z,
  )
  return normalize2D(
    base.x * (1 - weight) + toMate.x * weight,
    base.z * (1 - weight) + toMate.z * weight,
  )
}

export function getDribbleDirection(ctx: CarrierContext): { x: number; z: number } {
  const raw = computeDribbleDirectionRaw(ctx)
  const prev = smoothedDribbleDir.get(ctx.carrier.id)
  if (!prev) {
    smoothedDribbleDir.set(ctx.carrier.id, { x: raw.x, z: raw.z })
    return raw
  }
  // Suaviza viradas do drible (estilo stick) — evita corte seco a cada frame
  const blend = 0.22
  const x = prev.x + (raw.x - prev.x) * blend
  const z = prev.z + (raw.z - prev.z) * blend
  const len = Math.hypot(x, z) || 1
  const out = { x: x / len, z: z / len }
  smoothedDribbleDir.set(ctx.carrier.id, out)
  return out
}

function computeDribbleDirectionRaw(ctx: CarrierContext): { x: number; z: number } {
  const { carrier, opponents, bounds, role } = ctx
  const team = carrier.team
  const sign = getAttackSign(team, bounds)
  const goalZ = getAttackingGoalZ(team, bounds)
  const goalX = bounds.center.x
  const goalDist = distToAttackingGoal(team, carrier.position, bounds)
  const inOwnThird = isBallInDefensiveThird(carrier.position, team, bounds)

  const toGoal = normalize2D(goalX - carrier.position.x, goalZ - carrier.position.z)
  const nearest = getNearestOpponent(carrier, opponents)
  const heavyPressure = (nearest?.dist ?? 10) < HEAVY_PRESSURE_DIST
  const underPressure = (nearest?.dist ?? 10) < PRESSURE_DIST
  const crowded = countOpponentsNear(carrier.position, opponents, 3.2) >= 2
  const surrounded = isCarrierSurrounded(ctx)
  const isolated = isCarrierIsolated(ctx)

  const lateralX = -toGoal.z
  const lateralZ = toGoal.x
  const lateral = normalize2D(lateralX, lateralZ)

  // Atacante cercado: recua com a bola e procura passe — nunca fica parado
  if (role === 'fwd' && surrounded && !isolated) {
    return getHoldUpMoveDir(ctx)
  }

  // Atacante sozinho: vai direto ao gol
  if (role === 'fwd' && isolated) {
    return ensureForwardDribbleDir(team, bounds, toGoal, toGoal, 0.62)
  }

  // Zagueiro/volante atrás: lateraliza na formação — não avança sozinho ao gol
  if ((role === 'def' || (role === 'mid' && goalDist > 28)) && inOwnThird) {
    const wideX = clamp(
      bounds.center.x + (carrier.position.x < bounds.center.x ? -3.5 : 3.5),
      bounds.minX + 1.2,
      bounds.maxX - 1.2,
    )
    const shapeDir = normalize2D(wideX - carrier.position.x, sign * 2.2)
    const dx = lateral.x * 0.52 + shapeDir.x * 0.28 + toGoal.x * 0.2
    const dz = lateral.z * 0.52 + shapeDir.z * 0.28 + toGoal.z * 0.2
    return ensureForwardDribbleDir(team, bounds, normalize2D(dx, dz), toGoal, 0.1)
  }

  if (role === 'mid' && inOwnThird && goalDist > 22) {
    const dx = toGoal.x * 0.32 + lateral.x * 0.48
    const dz = toGoal.z * 0.32 + lateral.z * 0.48
    return ensureForwardDribbleDir(team, bounds, normalize2D(dx, dz), toGoal, 0.16)
  }

  // Pressão: desvia lateralmente mas SEMPRE avança — nunca corre para trás
  if (nearest && (heavyPressure || crowded || underPressure)) {
    const dodge = pickPressureDodge(carrier, nearest, lateralX, lateralZ)
    const lateralWeight = heavyPressure ? 0.38 : crowded ? 0.32 : 0.24
    const dx = toGoal.x * (1 - lateralWeight) + dodge.x * lateralWeight
    const dz = toGoal.z * (1 - lateralWeight) + dodge.z * lateralWeight
    return ensureForwardDribbleDir(
      team,
      bounds,
      normalize2D(dx, dz),
      toGoal,
      heavyPressure ? 0.42 : 0.48,
    )
  }

  let dx = toGoal.x
  let dz = toGoal.z

  if (goalDist < DRIBBLE_STOP_BEFORE_GOAL) {
    const latLen = Math.hypot(lateralX, lateralZ) || 1
    return { x: lateralX / latLen, z: lateralZ / latLen }
  }

  if (goalDist < DRIBBLE_STOP_BEFORE_GOAL + 2.5) {
    const slow = clamp((goalDist - DRIBBLE_STOP_BEFORE_GOAL) / 2.5, 0.25, 1)
    dx *= slow
    dz *= slow
  }

  if (isBallInDefensiveThird(carrier.position, team, bounds)) {
    const ownGoalZ = getDefensiveGoalZ(team, bounds)
    const awayOwnGoal = normalize2D(
      carrier.position.x - bounds.center.x,
      carrier.position.z - (ownGoalZ + sign * 2),
    )
    dx = dx * 0.55 + awayOwnGoal.x * 0.2 + toGoal.x * 0.25
    dz = dz * 0.55 + awayOwnGoal.z * 0.2 + toGoal.z * 0.25
  }

  let dir = ensureForwardDribbleDir(team, bounds, normalize2D(dx, dz), toGoal, 0.3)

  const crossDir = getCrossSetupDribbleDir(ctx)
  if (crossDir && goalDist < 34 && goalDist > 7) {
    const w = crossDir ? 0.44 : 0
    const mixed = normalize2D(
      dir.x * (1 - w) + crossDir.x * w,
      dir.z * (1 - w) + crossDir.z * w,
    )
    dir = ensureForwardDribbleDir(team, bounds, mixed, toGoal, 0.2)
  }

  if (shouldPlayAsTeam(ctx)) {
    const mate = findBestPassTarget(ctx)
    if (mate) {
      const blend =
        role === 'def' ? 0.62 : role === 'mid' ? 0.48 : goalDist > 24 ? 0.28 : 0.12
      const minFwd = role === 'def' ? 0.06 : role === 'mid' ? 0.1 : 0.18
      dir = ensureForwardDribbleDir(
        team,
        bounds,
        blendDirTowardMate(carrier, dir, mate, blend),
        toGoal,
        minFwd,
      )
    }
  }

  return dir
}

/** Portador deve correr com a bola — recuo sob marcação é trote, não parada */
export function shouldCarrierSprint(ctx: CarrierContext, phase: TeamPhase): boolean {
  if (ctx.role === 'gk') return false
  if (phase === 'defense') return false
  if (ctx.role === 'fwd' && isCarrierSurrounded(ctx) && !isCarrierIsolated(ctx)) return false
  if (ctx.role === 'fwd' && isCarrierIsolated(ctx)) return true
  return true
}

export type CarrierMoveIntent = {
  dirX: number
  dirZ: number
  sprint: boolean
  holdUp: boolean
  lookDir: { x: number; z: number } | null
}

export function getCarrierMoveIntent(ctx: CarrierContext, phase: TeamPhase): CarrierMoveIntent {
  const holdUp = ctx.role === 'fwd' && isCarrierSurrounded(ctx) && !isCarrierIsolated(ctx)
  const dir = holdUp ? getHoldUpMoveDir(ctx) : getDribbleDirection(ctx)
  const sprint = holdUp ? false : shouldCarrierSprint(ctx, phase)
  return {
    dirX: dir.x,
    dirZ: dir.z,
    sprint,
    holdUp,
    lookDir: holdUp ? getHoldUpLookDir(ctx) : null,
  }
}

export function getDribbleTarget(
  ctx: CarrierContext,
  lookahead = 3.5,
): { x: number; z: number } {
  const dir = getDribbleDirection(ctx)
  const { carrier, bounds, role } = ctx
  const team = carrier.team
  const sign = getAttackSign(team, bounds)
  const goalZ = getAttackingGoalZ(team, bounds)
  const stopZ = goalZ - sign * DRIBBLE_STOP_BEFORE_GOAL
  const goalDist = distToAttackingGoal(team, carrier.position, bounds)
  const inOwnThird = isBallInDefensiveThird(carrier.position, team, bounds)

  let effectiveLookahead = lookahead
  if (role === 'def' && inOwnThird) effectiveLookahead = 1.5
  else if (role === 'mid' && inOwnThird && goalDist > 22) effectiveLookahead = 2.1
  else if (role === 'def' && goalDist > 28) effectiveLookahead = 2

  let x = carrier.position.x + dir.x * effectiveLookahead
  let z = carrier.position.z + dir.z * effectiveLookahead

  if (sign > 0) z = Math.min(z, stopZ)
  else z = Math.max(z, stopZ)

  // Limita avanço de zagueiros no terço defensivo
  if (role === 'def' && inOwnThird) {
    const maxFwd = carrier.position.z + sign * 4.5
    if (sign > 0) z = Math.min(z, maxFwd)
    else z = Math.max(z, maxFwd)
  }

  const margin = 0.85
  x = clamp(x, bounds.minX + margin, bounds.maxX - margin)
  z = clamp(z, bounds.minZ + margin, bounds.maxZ - margin)

  return { x, z }
}

export function decideCarrierAction(
  ctx: CarrierContext,
  holdMs = 0,
): CarrierDecision {
  const { carrier, role, bounds, opponents } = ctx
  const dribbleDir = getDribbleDirection(ctx)
  const shot = evaluateShot(ctx)
  const nearest = getNearestOpponent(carrier, opponents)
  const pressure = nearest?.dist ?? 10
  const underPressure = pressure < PRESSURE_DIST
  const heavyPressure = pressure < HEAVY_PRESSURE_DIST
  const crowded = countOpponentsNear(carrier.position, opponents, 3.4) >= 2
  const preferSafety = heavyPressure || crowded
  const fwdSurrounded = role === 'fwd' && isCarrierSurrounded(ctx) && !isCarrierIsolated(ctx)
  const recycleTarget = fwdSurrounded ? findRecyclePassTarget(ctx) : null
  const recycleScore = recycleTarget
    ? scorePassTarget(ctx, recycleTarget, {
        preferSafety: true,
        underPressure,
        heavyPressure,
        holdUpRecycle: true,
      })
    : 0

  const carryScore = evaluateCarryValue(ctx)
  const passTarget = findBestPassTarget(ctx)
  const passScore = passTarget
    ? scorePassTarget(ctx, passTarget, { preferSafety, underPressure, heavyPressure })
    : 0
  const openTarget = findOpenPassTarget(ctx)
  const openPassScore = openTarget
    ? scorePassTarget(ctx, openTarget, { preferSafety, underPressure, heavyPressure })
    : 0

  const goalDist = distToAttackingGoal(carrier.team, carrier.position, bounds)
  const tapIn = goalDist < TAP_IN_SHOOT_DIST
  const canShootYet = holdMs >= MIN_HOLD_BEFORE_SHOOT_MS || tapIn

  if (canShootYet && role !== 'gk' && tapIn && shot.shouldShoot) {
    return { action: 'shoot', dribbleDir, passTarget: null, crossTarget: null, crossKind: 'box', shootDir: shot.dir }
  }

  if (shot.shouldShoot && canShootYet && goalDist <= FORCE_SHOOT_DIST[role] * 0.88) {
    return { action: 'shoot', dribbleDir, passTarget: null, crossTarget: null, crossKind: 'box', shootDir: shot.dir }
  }

  // Só troca para openTarget se for claramente melhor que o melhor passe
  let chosenPass =
    openTarget &&
    openPassScore >= passScore + 1.0 &&
    !isMateMarked(openTarget, opponents)
      ? openTarget
      : passTarget

  if (
    fwdSurrounded &&
    recycleTarget &&
    recycleScore >= Math.max(passScore, openPassScore) - 0.35
  ) {
    chosenPass = recycleTarget
  }
  const chosenScore = chosenPass
    ? scorePassTarget(ctx, chosenPass, { preferSafety, underPressure, heavyPressure })
    : 0
  const mateOpen = chosenPass != null && !isMateMarked(chosenPass, opponents)
  const recycle =
    chosenPass != null &&
    forwardProgress(carrier.team, carrier.position, chosenPass.position, bounds) < -0.5

  const inOwnThird = isBallInDefensiveThird(carrier.position, carrier.team, bounds)
  const deepBuildUp = isDeepBuildUp(ctx)
  const teamPlay = shouldPlayAsTeam(ctx)

  const emergencyHold = heavyPressure && holdMs >= 400
  const pressureHold = underPressure && holdMs >= 520
  const normalHold = holdMs >= MIN_HOLD_BEFORE_PASS_MS
  const buildUpHold = role === 'def' ? 520 : role === 'mid' ? 620 : MIN_HOLD_BEFORE_PASS_MS
  const roleHold = holdMs >= ROLE_PASS_HOLD_MS[role]

  if (role === 'gk') {
    if (passTarget && passScore >= 2.4 && holdMs >= 700) {
      return { action: 'pass', dribbleDir, passTarget, crossTarget: null, crossKind: 'box', shootDir: shot.dir }
    }
    if (holdMs >= 2200 && passTarget && passScore >= 1.8) {
      return { action: 'pass', dribbleDir, passTarget, crossTarget: null, crossKind: 'box', shootDir: shot.dir }
    }
    return { action: 'dribble', dribbleDir, passTarget: null, crossTarget: null, crossKind: 'box', shootDir: shot.dir }
  }

  let passThreshold =
    role === 'def' ? 1.45 : role === 'mid' ? 1.65 : 2.35

  if (heavyPressure) passThreshold -= 0.4
  else if (underPressure) passThreshold -= 0.22
  if (deepBuildUp) passThreshold -= 0.55
  if (teamPlay) passThreshold -= 0.25

  let beatCarryBy = heavyPressure ? 0.15 : preferSafety ? 0.25 : 0.35
  if (deepBuildUp) beatCarryBy += role === 'def' ? 3.5 : 2.2
  else if (role === 'def' && goalDist > 20) beatCarryBy += 3
  else if (role === 'mid' && goalDist > 24) beatCarryBy += 1.8
  else if (teamPlay) beatCarryBy += 1.2

  const chosenOpen = chosenPass ? spaceAround(chosenPass.position, opponents) : 0

  const roleReleasePass =
    roleHold &&
    chosenPass &&
    mateOpen &&
    chosenScore >= ROLE_PASS_MIN_SCORE[role] &&
    blockersOnPass(chosenPass, ctx) === 0

  const defExitPass =
    role === 'def' &&
    inOwnThird &&
    holdMs >= 520 &&
    chosenPass &&
    mateOpen &&
    chosenScore >= 0.88 &&
    blockersOnPass(chosenPass, ctx) === 0

  const buildUpPass =
    deepBuildUp &&
    holdMs >= buildUpHold &&
    chosenPass &&
    mateOpen &&
    chosenScore >= (role === 'def' ? 0.95 : 1.15) &&
    blockersOnPass(chosenPass, ctx) === 0

  const linkPass =
    role === 'mid' &&
    goalDist > 20 &&
    holdMs >= 600 &&
    chosenPass &&
    mateOpen &&
    chosenScore >= 1.35 &&
    forwardProgress(carrier.team, carrier.position, chosenPass!.position, bounds) > 0.35 &&
    blockersOnPass(chosenPass, ctx) === 0

  const comboPass =
    role === 'fwd' &&
    !fwdSurrounded &&
    holdMs >= 680 &&
    chosenPass &&
    mateOpen &&
    chosenScore >= 1.75 &&
    (isForwardMakingRun(chosenPass.id, chosenPass.team) ||
      chosenOpen > OPEN_SPACE_MIN + 0.9) &&
    blockersOnPass(chosenPass, ctx) === 0

  const holdUpRecyclePass =
    fwdSurrounded &&
    recycleTarget &&
    chosenPass === recycleTarget &&
    mateOpen &&
    holdMs >= 380 &&
    recycleScore >= 1.0 &&
    blockersOnPass(chosenPass, ctx) === 0

  const fwdMarkedPass =
    role === 'fwd' &&
    fwdSurrounded &&
    holdMs >= 520 &&
    chosenPass &&
    mateOpen &&
    chosenScore >= 1.2 &&
    (recycle || chosenOpen > OPEN_SPACE_MIN - 0.2) &&
    blockersOnPass(chosenPass, ctx) === 0

  const teamBuildingPass =
    chosenPass &&
    (role === 'def' || role === 'mid') &&
    holdMs >= (role === 'def' ? 520 : 620) &&
    mateOpen &&
    chosenScore >= (role === 'def' ? 0.98 : 1.12) &&
    blockersOnPass(chosenPass, ctx) === 0

  const emergencyPass =
    emergencyHold &&
    mateOpen &&
    chosenScore >= MIN_VIABLE_PASS_SCORE_PRESSURE &&
    blockersOnPass(chosenPass, ctx) === 0

  const pressurePass =
    pressureHold &&
    mateOpen &&
    chosenScore >= passThreshold - 0.35 &&
    blockersOnPass(chosenPass, ctx) === 0

  const openMatePass =
    normalHold &&
    mateOpen &&
    chosenOpen > OPEN_SPACE_MIN + 0.7 &&
    chosenScore >= passThreshold - 0.25 &&
    blockersOnPass(chosenPass, ctx) === 0

  const buildingPass =
    normalHold &&
    mateOpen &&
    chosenScore >= passThreshold &&
    chosenScore >= carryScore + beatCarryBy &&
    blockersOnPass(chosenPass, ctx) === 0 &&
    (forwardProgress(carrier.team, carrier.position, chosenPass!.position, bounds) > 0.25 || recycle || chosenOpen > OPEN_SPACE_MIN + 0.5)

  const safetyRecycle =
    preferSafety &&
    normalHold &&
    recycle &&
    mateOpen &&
    chosenScore >= (fwdSurrounded ? 1.05 : 2.2) &&
    blockersOnPass(chosenPass, ctx) === 0

  const forcePass =
    holdMs >= FORCE_PASS_HOLD_MS[role] &&
    mateOpen &&
    chosenScore >= (role === 'def' ? 0.95 : role === 'mid' ? 1.1 : 2.0) &&
    blockersOnPass(chosenPass, ctx) === 0

  const crossChance = shouldAICross(ctx, holdMs, chosenScore)
  if (crossChance?.target) {
    return {
      action: 'cross',
      dribbleDir,
      passTarget: null,
      crossTarget: crossChance.target,
      crossKind: crossChance.kind,
      shootDir: shot.dir,
    }
  }

  if (
    roleReleasePass ||
    defExitPass ||
    buildUpPass ||
    linkPass ||
    comboPass ||
    holdUpRecyclePass ||
    fwdMarkedPass ||
    teamBuildingPass ||
    emergencyPass ||
    pressurePass ||
    openMatePass ||
    buildingPass ||
    safetyRecycle ||
    forcePass
  ) {
    return {
      action: 'pass',
      dribbleDir,
      passTarget: chosenPass,
      crossTarget: null,
      crossKind: 'box',
      shootDir: shot.dir,
    }
  }

  return {
    action: 'dribble',
    dribbleDir,
    passTarget: null,
    crossTarget: null,
    crossKind: 'box',
    shootDir: shot.dir,
  }
}

function blockersOnPass(target: PlayerRef | null, ctx: CarrierContext): number {
  if (!target) return 99
  return opponentsOnPassLane(ctx.carrier.position, target.position, ctx.opponents)
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
    if (fwd < 0.5) continue

    const covered = opponentsOnPassLane(carrierPos, mate.position, defenders, 1.05)
    if (covered > 0) continue

    const cutT = 0.38
    const laneX = carrierPos.x + (mate.position.x - carrierPos.x) * cutT
    const laneZ = carrierPos.z + (mate.position.z - carrierPos.z) * cutT
    const laneOpen = spaceAround({ x: laneX, y: 0, z: laneZ }, defenders)
    const runBonus = isForwardMakingRun(mate.id, mate.team) ? 1.4 : 0
    const score = fwd + laneOpen + runBonus

    if (score > bestScore) {
      bestScore = score
      bestLane = { x: laneX, z: laneZ }
    }
  }

  return bestLane
}
