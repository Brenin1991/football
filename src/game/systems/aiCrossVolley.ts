import type { FieldBounds, TeamId, Vec3 } from '../types'
import type { PassIntent } from '../store/gameStore'
import { ballRef, playerRegistry, type PlayerRef } from './entityRegistry'
import { adjustCrossVolleyScore } from './difficulty'
import { distance2D, normalize2D } from './rules'
import {
  getAttackingGoalZ,
  getAttackSign,
  isInPenaltyArea,
} from './teamField'
import { getReceiveInterceptorId } from './receiveRoutes'
import {
  hasCrossVolleyIntent,
  pickCrossTouchPart,
  predictAerialBallPosition,
} from './crossAssist'
import { useGameStore } from '../store/gameStore'

const VOLLEY_REEVAL_MS = 200

const lastVolleyQueuedAt = new Map<string, number>()

export type CrossVolleyEval = {
  shouldVolley: boolean
  power: number
  dirX: number
  dirZ: number
  score: number
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v))
}

function distToAttackingGoal(team: TeamId, pos: Vec3, bounds: FieldBounds): number {
  const goalZ = getAttackingGoalZ(team, bounds)
  const goalX = bounds.center.x
  return distance2D(pos, { x: goalX, y: 0, z: goalZ })
}

function opponentsOnShotLane(
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

function spaceAround(pos: Vec3, opponents: PlayerRef[]): number {
  let min = Infinity
  for (const o of opponents) {
    const d = distance2D(pos, o.position)
    if (d < min) min = d
  }
  return min === Infinity ? 10 : min
}

function getOpponents(team: TeamId): PlayerRef[] {
  const out: PlayerRef[] = []
  for (const p of playerRegistry.values()) {
    if (p.team !== team && p.role !== 'gk') out.push(p)
  }
  return out
}

/** Decide se o interceptor deve finalizar de voleio no cruzamento. */
export function evaluateAICrossVolley(
  playerId: string,
  team: TeamId,
  playerPos: { x: number; z: number },
  ball: Vec3,
  ballVel: Vec3,
  passIntent: PassIntent,
  bounds: FieldBounds,
): CrossVolleyEval | null {
  if (passIntent.passType !== 'cross' || passIntent.passingTeam !== team) return null
  if (getReceiveInterceptorId(team, passIntent) !== playerId) return null
  if (hasCrossVolleyIntent(playerId)) return null

  const player = playerRegistry.get(playerId)
  if (!player) return null

  const opponents = getOpponents(team)
  const goalZ = getAttackingGoalZ(team, bounds)
  const goalX = bounds.center.x
  const pos = { x: playerPos.x, y: 0, z: playerPos.z }
  const goalPos = { x: goalX, y: 0, z: goalZ }
  const distToGoal = distToAttackingGoal(team, pos, bounds)
  const sign = getAttackSign(team, bounds)
  const depth = (goalZ - playerPos.z) * sign

  if (depth > 24) return null

  const distToBall = distance2D(pos, ball)
  if (distToBall > 15) return null

  const tArrive = clamp(distToBall / 7.2, 0.18, 1.15)
  const predBall = predictAerialBallPosition(ball, ballVel, tArrive)
  const part = pickCrossTouchPart(predBall, ballVel)
  const ballSpeed = Math.hypot(ballVel.x, ballVel.z)

  const defendingTeam: TeamId = team === 'home' ? 'away' : 'home'
  const inBox = isInPenaltyArea(pos, defendingTeam, bounds)

  let score = 0
  if (inBox) score += 4.2
  if (depth < 16) score += 2.2
  if (depth < 10) score += 2.4
  if (depth < 6) score += 1.6

  if (part === 'head') score += 3.2
  else if (part === 'chest') score += 2.1
  else if (part === 'foot') {
    if (ballSpeed > 9) score += 0.8
    else score -= 2.4
  }

  const dir = normalize2D(goalX - playerPos.x, goalZ - playerPos.z)
  score -= opponentsOnShotLane(pos, goalPos, opponents) * 3.1
  score += clamp((spaceAround(pos, opponents) - 1.8) * 0.55, -1.2, 2.4)

  if (player.role === 'fwd') score += 2.2
  else if (player.role === 'mid') score += 0.7
  else score -= 1.8

  if (distToGoal < 7) score += 3.4
  else if (distToGoal < 11) score += 1.8
  else if (distToGoal > 18) score -= 1.5

  if (tArrive > 0.95 && distToBall > 8) score -= 1.2

  score = adjustCrossVolleyScore(score, team)

  const threshold =
    player.role === 'fwd' ? 4.4 : player.role === 'mid' ? 5.3 : 6.8

  if (score < threshold) return null

  const power = clamp(
    0.52 + distToGoal * 0.028 + (part === 'head' ? 0.1 : part === 'chest' ? 0.05 : 0),
    0.5,
    0.9,
  )

  return {
    shouldVolley: true,
    power,
    dirX: dir.x,
    dirZ: dir.z,
    score,
  }
}

/** Enfileira chute buffered no mesmo pipeline do jogador (contato no cruzamento). */
export function tickAICrossVolleyAnticipation(
  playerId: string,
  team: TeamId,
  playerPos: { x: number; z: number },
  bounds: FieldBounds,
): void {
  const store = useGameStore.getState()
  const passIntent = store.passIntent
  if (!passIntent || passIntent.passType !== 'cross') return
  if (passIntent.passingTeam !== team) return
  if (store.ballPossession) return
  if (hasCrossVolleyIntent(playerId)) return

  const now = performance.now()
  const last = lastVolleyQueuedAt.get(playerId) ?? 0
  if (now - last < VOLLEY_REEVAL_MS) return

  const evalResult = evaluateAICrossVolley(
    playerId,
    team,
    playerPos,
    ballRef.current,
    ballRef.velocity,
    passIntent,
    bounds,
  )
  if (!evalResult?.shouldVolley) return

  lastVolleyQueuedAt.set(playerId, now)
  store.setPendingBufferedShot(
    playerId,
    evalResult.power,
    evalResult.dirX,
    evalResult.dirZ,
    true,
  )
}

export function clearAICrossVolleyState() {
  lastVolleyQueuedAt.clear()
}
