import type { FieldBounds, TeamId, Vec3 } from '../types'
import type { PlayerRef } from './entityRegistry'
import type { CarrierContext } from './aiBrain'
import { findCrossTarget } from './cross'
import { isForwardMakingRun } from './dynamicFormation'
import { isOffsideAtPass } from './offside'
import { distance2D, normalize2D } from './rules'
import {
  getAttackingGoalZ,
  getAttackSign,
  isInPenaltyArea,
} from './teamField'
import { getAICrossThresholdMul } from './difficulty'

export type CrossKind = 'box' | 'switch' | 'early'

export interface AICrossEval {
  target: PlayerRef | null
  score: number
  kind: CrossKind
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v))
}

function isInAttackingBox(pos: Vec3, attackingTeam: TeamId, bounds: FieldBounds): boolean {
  const defendingTeam: TeamId = attackingTeam === 'home' ? 'away' : 'home'
  return isInPenaltyArea(pos, defendingTeam, bounds)
}

function attackingDepth(team: TeamId, pos: Vec3, bounds: FieldBounds): number {
  const goalZ = getAttackingGoalZ(team, bounds)
  const sign = getAttackSign(team, bounds)
  return (goalZ - pos.z) * sign
}

function spaceAround(pos: Vec3, opponents: PlayerRef[]): number {
  let min = Infinity
  for (const o of opponents) {
    const d = distance2D(pos, o.position)
    if (d < min) min = d
  }
  return min === Infinity ? 10 : min
}

function opponentsOnLane(
  from: Vec3,
  to: Vec3,
  opponents: PlayerRef[],
  laneWidth = 1.35,
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
    if (Math.hypot(o.position.x - px, o.position.z - pz) < laneWidth) blockers++
  }
  return blockers
}

function countCentralCongestion(
  carrier: PlayerRef,
  opponents: PlayerRef[],
  bounds: FieldBounds,
): number {
  const halfW = (bounds.maxX - bounds.minX) * 0.25
  let n = 0
  for (const o of opponents) {
    if (Math.abs(o.position.x - bounds.center.x) < halfW) {
      if (distance2D(carrier.position, o.position) < 14) n++
    }
  }
  return n
}

export function isWideCarrier(carrier: PlayerRef, bounds: FieldBounds): boolean {
  const halfW = (bounds.maxX - bounds.minX) * 0.5
  return Math.abs(carrier.position.x - bounds.center.x) > halfW * 0.34
}

/** Avalia se vale cruzar — área, inversão de jogo, cruzamento cedo */
export function evaluateAICross(ctx: CarrierContext): AICrossEval {
  const { carrier, teammates, opponents, bounds, ball, role } = ctx
  const team = carrier.team
  const halfW = (bounds.maxX - bounds.minX) * 0.5
  const depth = attackingDepth(team, carrier.position, bounds)
  const wing = isWideCarrier(carrier, bounds)
  const finalThird = depth > 16
  const nearByline = depth > 26

  if (role === 'gk') return { target: null, score: -99, kind: 'box' }
  // Laterais precisam poder cruzar assim que chegam no terço
  if (role === 'def' && depth < 14) return { target: null, score: -99, kind: 'box' }
  if (depth < 10) return { target: null, score: -99, kind: 'box' }

  const target = findCrossTarget(carrier, teammates, bounds, team, ball.z)
  if (!target) return { target: null, score: -99, kind: 'box' }
  if (isOffsideAtPass(team, target, bounds, ball.z)) {
    return { target: null, score: -99, kind: 'box' }
  }

  const targetDepth = attackingDepth(team, target.position, bounds)
  const targetInBox =
    isInAttackingBox(target.position, team, bounds) ||
    (targetDepth > 3 && targetDepth < 17 && Math.abs(target.position.x) < halfW * 0.46)
  // Aceita alvo perto da área (ainda entrando) — senão nunca corre pro fundo
  const targetNearBox =
    targetDepth > 2 &&
    targetDepth < 22 &&
    Math.abs(target.position.x - bounds.center.x) < halfW * 0.55

  if (!targetInBox && !targetNearBox) return { target: null, score: -99, kind: 'box' }

  let score = targetInBox ? 0 : -1
  let kind: CrossKind = 'box'

  if (wing && finalThird) score += 3.4
  else if (wing) score += 2.1
  else if (depth > 18 && Math.abs(carrier.position.x) > halfW * 0.22) score += 1.3
  else score -= 0.8

  if (nearByline) score += 1.35
  if (role === 'fwd' && wing) score += 0.9
  if (role === 'mid' && wing && depth > 14) score += 0.7
  if (role === 'def' && wing && depth > 14) score += 1.1

  const targetOpen = spaceAround(target.position, opponents)
  if (targetOpen < 1.85) score -= 3.2
  else score += clamp((targetOpen - 2) * 0.7, 0, 2.6)

  if (target.role === 'fwd') score += 1.5
  if (isForwardMakingRun(target.id, target.team)) score += 2.4

  const centralCrowd = countCentralCongestion(carrier, opponents, bounds)
  score += centralCrowd * 0.75

  const carrierSide = Math.sign(carrier.position.x - bounds.center.x)
  const targetSide = Math.sign(target.position.x - bounds.center.x)
  const lateralSpread = Math.abs(target.position.x - carrier.position.x)
  if (
    carrierSide !== 0 &&
    targetSide !== 0 &&
    carrierSide !== targetSide &&
    lateralSpread > halfW * 0.5 &&
    depth > 14
  ) {
    score += 2.6
    kind = 'switch'
  }

  const nearestOpp = opponents.reduce<{ d: number } | null>((best, o) => {
    const d = distance2D(carrier.position, o.position)
    return !best || d < best.d ? { d } : best
  }, null)
  if (wing && depth < 25 && (nearestOpp?.d ?? 9) > 3.2) {
    score += 1.15
    if (kind === 'box') kind = 'early'
  }

  const crossBlockers = opponentsOnLane(carrier.position, target.position, opponents, 2.1)
  score -= crossBlockers * 2.4

  const dist = distance2D(carrier.position, target.position)
  if (dist < 5.5) score -= 2.8
  if (dist > 28) score -= 1.6

  return { target, score, kind }
}

export function shouldAICross(
  ctx: CarrierContext,
  holdMs: number,
  passScore: number,
): AICrossEval | null {
  const cross = evaluateAICross(ctx)
  const threshMul = getAICrossThresholdMul(ctx.carrier.team)
  const minScore = 2.85 * threshMul
  if (!cross.target || cross.score < minScore) return null

  const minHold =
    (cross.kind === 'switch' ? 420 : cross.kind === 'early' ? 380 : 480) *
    (threshMul < 1 ? 0.82 : 1)
  if (holdMs < minHold) return null

  const wing = isWideCarrier(ctx.carrier, ctx.bounds)
  const depth = attackingDepth(ctx.carrier.team, ctx.carrier.position, ctx.bounds)
  const beatsPass = cross.score >= passScore + (wing ? 0.15 : 0.65) * threshMul
  const wingDelivery = wing && depth > 12 && cross.score >= 2.9 * threshMul
  const switchPlay = cross.kind === 'switch' && cross.score >= 3.8 * threshMul
  const bylineServe = depth > 22 && wing && cross.score >= 2.95 * threshMul

  if (beatsPass || wingDelivery || switchPlay || bylineServe) {
    return cross
  }
  return null
}

export function getAICrossParams(
  _ctx: CarrierContext,
  target: PlayerRef,
  kind: CrossKind,
): { power: number } {
  const dist = distance2D(_ctx.carrier.position, target.position)
  const base =
    kind === 'switch' ? 0.76 : kind === 'early' ? 0.6 : 0.68
  const power = base + Math.min(dist * 0.007, 0.14)
  return { power: clamp(power, 0.55, 0.88) }
}

/** Condução para abrir ângulo de cruzamento na ponta */
export function getCrossSetupDribbleDir(ctx: CarrierContext): { x: number; z: number } | null {
  const { carrier, bounds, role } = ctx
  if (role === 'gk') return null

  const team = carrier.team
  const sign = getAttackSign(team, bounds)
  const goalZ = getAttackingGoalZ(team, bounds)
  const halfW = (bounds.maxX - bounds.minX) * 0.5
  const depth = attackingDepth(team, carrier.position, bounds)
  const wing = isWideCarrier(carrier, bounds)

  // Lateral/ponta larga: corre pro fundo mesmo antes do score de cruzamento estar alto
  if (wing && role === 'def' && depth > 10 && depth < 34) {
    const wideSign = Math.sign(carrier.position.x - bounds.center.x) || sign
    if (depth < 18) {
      const wideX = bounds.center.x + wideSign * halfW * 0.84
      return normalize2D(wideX - carrier.position.x, sign * 3.6)
    }
    const bylineZ = goalZ - sign * 6.2
    return normalize2D(wideSign * 0.28, bylineZ - carrier.position.z)
  }

  const cross = evaluateAICross(ctx)
  if (!cross.target || cross.score < 2.2) return null
  if (role === 'def' && !wing) return null

  if (depth < 8 || depth > 34) return null

  const wideSign = Math.sign(carrier.position.x - bounds.center.x) || sign
  const onWing = Math.abs(carrier.position.x - bounds.center.x) > halfW * 0.3

  if (!onWing && cross.kind !== 'switch') {
    const wideX = bounds.center.x + wideSign * halfW * 0.78
    return normalize2D(wideX - carrier.position.x, sign * 2.4)
  }

  if (depth < 18) {
    const wideX = bounds.center.x + wideSign * halfW * 0.82
    return normalize2D(wideX - carrier.position.x, sign * 3.2)
  }

  const bylineZ = goalZ - sign * 7.5
  return normalize2D(wideSign * 0.42, bylineZ - carrier.position.z)
}
