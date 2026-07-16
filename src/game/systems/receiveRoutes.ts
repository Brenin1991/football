import type { PassIntent } from '../store/gameStore'
import type { TeamId, Vec3 } from '../types'
import { PLAYER_SPEED, PLAYER_SPRINT_SPEED, BALL_RADIUS } from '../constants'
import { ballRef, playerRegistry } from './entityRegistry'
import { ballRestY } from './fieldData'
import { distance2D } from './rules'
import { getUserTeam, useGameStore } from '../store/gameStore'

const GRAVITY = -9.81
const REST_Y = ballRestY(BALL_RADIUS)

const V_RUN = PLAYER_SPRINT_SPEED
const V_JOG = PLAYER_SPEED * 0.92

export type ReceiveRunPlan = {
  targetX: number
  targetZ: number
  sprint: boolean
  moveScale: number
  hardStop: boolean
  arriveDist: number
  approachDist: number
  targetSpeed: number
  dirX: number
  dirZ: number
  phase: 'approach' | 'settle' | 'wait' | 'contact'
}

type PassFlight = {
  intentKey: number
  x0: number
  y0: number
  z0: number
  vx: number
  vy: number
  vz: number
  startedAt: number
  isCross: boolean
}

type ReceiveRoute = {
  playerId: string
  interceptX: number
  interceptZ: number
  tIntercept: number
  score: number
}

const flights = new Map<number, PassFlight>()
const routesByIntent = new Map<number, Map<string, ReceiveRoute>>()
const runTargetSmooth = new Map<string, { x: number; z: number; intentKey: number }>()
const lockedInterceptorByIntent = new Map<number, string>()

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v))
}

function ballAt(flight: PassFlight, t: number): Vec3 {
  return {
    x: flight.x0 + flight.vx * t,
    y: flight.y0 + flight.vy * t + 0.5 * GRAVITY * t * t,
    z: flight.z0 + flight.vz * t,
  }
}

function predictFromNow(ball: Vec3, velocity: Vec3, t: number): Vec3 {
  const y0 = ball.y ?? REST_Y
  return {
    x: ball.x + velocity.x * t,
    y: y0 + velocity.y * t + 0.5 * GRAVITY * t * t,
    z: ball.z + velocity.z * t,
  }
}

function sprintPlan(
  receiverPos: { x: number; z: number },
  targetX: number,
  targetZ: number,
  phase: ReceiveRunPlan['phase'] = 'approach',
): ReceiveRunPlan {
  const dx = targetX - receiverPos.x
  const dz = targetZ - receiverPos.z
  const dist = Math.hypot(dx, dz)

  if (dist < 0.22) {
    const bx = ballRef.current.x - receiverPos.x
    const bz = ballRef.current.z - receiverPos.z
    const bd = Math.hypot(bx, bz)
    if (bd > 0.18) {
      const inv = 1 / bd
      return {
        targetX: ballRef.current.x + bx * inv * 0.16,
        targetZ: ballRef.current.z + bz * inv * 0.16,
        dirX: bx * inv,
        dirZ: bz * inv,
        targetSpeed: V_RUN * 0.95,
        sprint: true,
        moveScale: 1.05,
        hardStop: false,
        arriveDist: 0.12,
        approachDist: bd,
        phase: 'settle',
      }
    }
    const fallbackX = dist > 0.02 ? dx / dist : 0
    const fallbackZ = dist > 0.02 ? dz / dist : 1
    return {
      targetX,
      targetZ,
      dirX: fallbackX,
      dirZ: fallbackZ,
      targetSpeed: V_RUN * 0.7,
      sprint: true,
      moveScale: 0.95,
      hardStop: false,
      arriveDist: 0.14,
      approachDist: dist,
      phase: 'contact',
    }
  }

  const dirX = dx / dist
  const dirZ = dz / dist
  return {
    targetX,
    targetZ,
    dirX,
    dirZ,
    targetSpeed: V_RUN,
    sprint: true,
    moveScale: 1.05,
    hardStop: false,
    arriveDist: 0.2,
    approachDist: dist,
    phase,
  }
}

function solveRoute(
  playerPos: { x: number; z: number },
  flight: PassFlight,
  maxT: number,
): ReceiveRoute | null {
  let bestT = 0.5
  let bestScore = -Infinity
  let bestX = flight.x0
  let bestZ = flight.z0

  const steps = Math.ceil(maxT / 0.06)
  for (let i = 2; i <= steps; i++) {
    const t = (i / steps) * maxT
    const b = ballAt(flight, t)
    if ((b.y ?? REST_Y) < REST_Y - 0.06) continue

    const runDist = Math.hypot(playerPos.x - b.x, playerPos.z - b.z)
    const runTime = runDist / V_RUN
    if (runTime > t + 0.15) continue

    const eta = t - runTime
    let score = -Math.abs(eta - 0.1) * 6
    if (eta >= 0.02 && eta <= 0.22) score += 8
    score -= runDist * 0.012

    if (score > bestScore) {
      bestScore = score
      bestT = t
      bestX = b.x
      bestZ = b.z
    }
  }

  if (bestScore === -Infinity) return null

  return {
    playerId: '',
    interceptX: bestX,
    interceptZ: bestZ,
    tIntercept: bestT,
    score: bestScore,
  }
}

function collectCandidates(intent: PassIntent, team: TeamId): string[] {
  const out = new Set<string>()
  out.add(intent.receiverId)
  for (const id of intent.runnerIds ?? []) out.add(id)

  if (intent.passType !== 'cross') return [...out]

  for (const p of playerRegistry.values()) {
    if (p.team !== team || p.role === 'gk') continue
    const d = distance2D(p.position, { x: intent.targetX, y: 0, z: intent.targetZ })
    if (d < 20) out.add(p.id)
  }
  return [...out]
}

function buildRoutesOnce(intent: PassIntent, flight: PassFlight) {
  if (routesByIntent.has(intent.startedAt)) return

  const routes = new Map<string, ReceiveRoute>()
  const team = intent.passingTeam
  const maxT = flight.isCross ? 3.4 : 1.75

  for (const id of collectCandidates(intent, team)) {
    const p = playerRegistry.get(id)
    if (!p || p.team !== team) continue
    const route = solveRoute(p.position, flight, maxT)
    if (!route) continue
    route.playerId = id
    if (id === intent.receiverId) route.score += 1.5
    routes.set(id, route)
  }
  routesByIntent.set(intent.startedAt, routes)

  let bestId = intent.receiverId
  let bestScore = -Infinity
  for (const [id, route] of routes) {
    if (route.score > bestScore) {
      bestScore = route.score
      bestId = id
    }
  }
  lockedInterceptorByIntent.set(intent.startedAt, bestId)
}

/** Antecipa corrida ao armar o cruzamento */
export function primeCrossReceive(intent: PassIntent) {
  if (intent.passType !== 'cross' || flights.has(intent.startedAt)) return

  const ball = ballRef.current
  const dx = intent.targetX - ball.x
  const dz = intent.targetZ - ball.z
  const len = Math.hypot(dx, dz) || 1
  const estSpeed = clamp(len * 0.82, 11, 19)

  const flight: PassFlight = {
    intentKey: intent.startedAt,
    x0: ball.x,
    y0: ball.y ?? REST_Y,
    z0: ball.z,
    vx: (dx / len) * estSpeed,
    vy: 5.8,
    vz: (dz / len) * estSpeed,
    startedAt: performance.now(),
    isCross: true,
  }
  flights.set(intent.startedAt, flight)
  buildRoutesOnce(intent, flight)
}

/** Atualiza voo real no chute — rotas NÃO são recalculadas */
export function bootstrapReceiveRoutes(intent: PassIntent) {
  const ball = ballRef.current
  const vel = ballRef.velocity
  const prev = flights.get(intent.startedAt)

  const flight: PassFlight = {
    intentKey: intent.startedAt,
    x0: ball.x,
    y0: ball.y ?? REST_Y,
    z0: ball.z,
    vx: vel.x,
    vy: vel.y,
    vz: vel.z,
    startedAt: prev?.startedAt ?? performance.now(),
    isCross: intent.passType === 'cross',
  }
  flights.set(intent.startedAt, flight)

  if (!routesByIntent.has(intent.startedAt)) {
    buildRoutesOnce(intent, flight)
  }
}

export function getReceiveInterceptorId(team: TeamId, intent: PassIntent): string {
  const locked = lockedInterceptorByIntent.get(intent.startedAt)
  if (locked) {
    const p = playerRegistry.get(locked)
    if (p && p.team === team) return locked
  }
  return intent.receiverId
}

export function isReceiveInterceptor(
  playerId: string,
  team: TeamId,
  intent: PassIntent,
): boolean {
  return getReceiveInterceptorId(team, intent) === playerId
}

function smoothRunTarget(
  playerId: string,
  intentKey: number,
  rawX: number,
  rawZ: number,
): { x: number; z: number } {
  const key = playerId
  let sm = runTargetSmooth.get(key)
  if (!sm || sm.intentKey !== intentKey) {
    sm = { x: rawX, z: rawZ, intentKey }
  } else {
    const blend = 0.22
    sm.x += (rawX - sm.x) * blend
    sm.z += (rawZ - sm.z) * blend
  }
  runTargetSmooth.set(key, sm)
  return sm
}

function planCrossMovement(
  playerId: string,
  receiverPos: { x: number; z: number },
  ball: Vec3,
  velocity: Vec3,
  intent: PassIntent,
  _route: ReceiveRoute | undefined,
): ReceiveRunPlan {
  const ballInAir = (ball.y ?? REST_Y) > REST_Y + 0.12
  const ballSpeed = Math.hypot(velocity.x, velocity.z)
  const lookT = ballInAir ? clamp(0.28 + ballSpeed * 0.012, 0.28, 0.42) : 0.2
  const live = predictFromNow(ball, velocity, lookT)
  const target = smoothRunTarget(playerId, intent.startedAt, live.x, live.z)
  return sprintPlan(receiverPos, target.x, target.z, ballInAir ? 'settle' : 'approach')
}

function planPassMovement(
  _playerId: string,
  receiverPos: { x: number; z: number },
  ball: Vec3,
  velocity: Vec3,
  intent: PassIntent,
  route: ReceiveRoute | undefined,
): ReceiveRunPlan {
  const distToBall = distance2D({ x: receiverPos.x, y: 0, z: receiverPos.z }, ball)
  const ballSpeed = Math.hypot(velocity.x, velocity.z)

  // Ponto base: rota / alvo do passe
  let spotX = intent.targetX
  let spotZ = intent.targetZ
  if (route) {
    spotX = route.interceptX
    spotZ = route.interceptZ
  }

  // Antecipação viva: ponto onde a bola vai estar
  const lookT = clamp(distToBall / Math.max(ballSpeed, 1.4), 0.05, 0.42)
  const live = predictFromNow(ball, velocity, lookT)
  const liveBlend =
    ballSpeed >= 5.2
      ? clamp(0.55 + (ballSpeed - 5.2) * 0.08, 0.55, 0.92)
      : distToBall < 3.4
        ? clamp(0.4 + (3.4 - distToBall) * 0.12, 0.4, 0.85)
        : 0.28
  spotX = live.x * liveBlend + spotX * (1 - liveBlend)
  spotZ = live.z * liveBlend + spotZ * (1 - liveBlend)

  const dx = spotX - receiverPos.x
  const dz = spotZ - receiverPos.z
  const distSpot = Math.hypot(dx, dz)

  const toSpotX = spotX - ball.x
  const toSpotZ = spotZ - ball.z
  const distBallToSpot = Math.hypot(toSpotX, toSpotZ)
  const closing =
    ballSpeed > 0.25 && distBallToSpot > 0.05
      ? (toSpotX * velocity.x + toSpotZ * velocity.z) / (distBallToSpot * ballSpeed)
      : 0

  const ballEta =
    ballSpeed > 0.4 && closing > 0.4
      ? distBallToSpot / Math.max(ballSpeed * closing, 0.5)
      : distToBall / Math.max(ballSpeed, 0.85)

  const timeToArrive = distSpot / Math.max(V_RUN * 0.92, 0.5)
  const late = timeToArrive + 0.12 >= ballEta || closing < 0.25

  // Contato / bola já perto: sempre vai na bola (sem plantado esperando)
  if (distSpot < 0.85 || distToBall < 1.15) {
    const bx = ball.x - receiverPos.x
    const bz = ball.z - receiverPos.z
    const bd = Math.hypot(bx, bz)
    if (bd < 0.18) {
      return {
        targetX: ball.x,
        targetZ: ball.z,
        dirX: 0,
        dirZ: 0,
        targetSpeed: 0,
        sprint: false,
        moveScale: 0,
        hardStop: false,
        arriveDist: 0.2,
        approachDist: distToBall,
        phase: 'contact',
      }
    }
    const inv = bd > 1e-4 ? 1 / bd : 1
    const lead = clamp(ballSpeed * 0.05, 0.1, 0.32)
    const speed = clamp(bd / Math.max(0.12, ballEta * 0.35), V_JOG * 0.85, V_RUN)
    return {
      targetX: ball.x + velocity.x * 0.08 + bx * inv * lead,
      targetZ: ball.z + velocity.z * 0.08 + bz * inv * lead,
      dirX: bx * inv,
      dirZ: bz * inv,
      targetSpeed: speed,
      sprint: speed > V_JOG * 0.98 || ballSpeed > 4.5,
      moveScale: clamp(speed / PLAYER_SPEED, 0.85, 1.08),
      hardStop: false,
      arriveDist: 0.12,
      approachDist: distToBall,
      phase: 'contact',
    }
  }

  // Sprint / corrida pro ponto vivo
  const inv = distSpot > 1e-4 ? 1 / distSpot : 1
  const haste = late || ballSpeed >= 4.85 ? 0.72 : 0.88
  const speed = clamp(distSpot / Math.max(ballEta * haste, 0.14), V_JOG, V_RUN)
  const mustSprint = late || ballSpeed >= 4.5 || speed > V_JOG * 1.02
  return {
    targetX: spotX,
    targetZ: spotZ,
    dirX: dx * inv,
    dirZ: dz * inv,
    targetSpeed: mustSprint ? Math.max(speed, V_RUN * 0.92) : speed,
    sprint: mustSprint,
    moveScale: clamp((mustSprint ? V_RUN : speed) / PLAYER_SPEED, 0.8, 1.08),
    hardStop: false,
    arriveDist: 0.22,
    approachDist: distSpot,
    phase: distSpot < 1.4 ? 'settle' : 'approach',
  }
}

export function planReceiveMovement(
  playerId: string,
  receiverPos: { x: number; z: number },
  ball: Vec3,
  velocity: Vec3,
  intent: PassIntent,
  options?: { crossInterceptor?: boolean },
): ReceiveRunPlan {
  const isCross = intent.passType === 'cross'
  const chase = options?.crossInterceptor !== false
  const routes = routesByIntent.get(intent.startedAt)
  const route = routes?.get(playerId)

  if (isCross && chase) {
    return planCrossMovement(playerId, receiverPos, ball, velocity, intent, route)
  }

  if (!chase) {
    return sprintPlan(receiverPos, intent.targetX, intent.targetZ)
  }

  return planPassMovement(playerId, receiverPos, ball, velocity, intent, route)
}

export function refreshCrossReceiveRoutes(intent: PassIntent) {
  if (intent.passType !== 'cross') return

  lockedInterceptorByIntent.delete(intent.startedAt)
  routesByIntent.delete(intent.startedAt)

  const ball = ballRef.current
  const vel = ballRef.velocity
  const flight: PassFlight = {
    intentKey: intent.startedAt,
    x0: ball.x,
    y0: ball.y ?? REST_Y,
    z0: ball.z,
    vx: vel.x,
    vy: vel.y,
    vz: vel.z,
    startedAt: performance.now(),
    isCross: true,
  }
  flights.set(intent.startedAt, flight)
  buildRoutesOnce(intent, flight)
}

export function reassignCrossVolleyToBall(intent: PassIntent) {
  if (intent.passType !== 'cross') return

  const store = useGameStore.getState()
  const shot = store.pendingUserShot
  const pass = store.pendingUserPass
  const pending = shot?.buffered ? shot : pass?.buffered ? pass : null
  if (!pending) return

  if (
    pending.playerId === store.activePlayerId &&
    intent.passingTeam === getUserTeam()
  ) {
    return
  }

  const team = intent.passingTeam
  const ball = ballRef.current
  let bestId = pending.playerId
  let bestDist = Infinity

  for (const p of playerRegistry.values()) {
    if (p.team !== team || p.role === 'gk') continue
    const d = distance2D(p.position, ball)
    if (d < bestDist) {
      bestDist = d
      bestId = p.id
    }
  }

  if (bestId === pending.playerId) return

  if (shot?.buffered) {
    useGameStore.setState({
      pendingUserShot: { ...shot, playerId: bestId },
    })
  } else if (pass?.buffered) {
    useGameStore.setState({
      pendingUserPass: { ...pass, playerId: bestId },
    })
  }
}

export function clearReceiveRoutes(intentKey?: number) {
  if (intentKey != null) {
    flights.delete(intentKey)
    routesByIntent.delete(intentKey)
    lockedInterceptorByIntent.delete(intentKey)
  } else {
    flights.clear()
    routesByIntent.clear()
    lockedInterceptorByIntent.clear()
    runTargetSmooth.clear()
  }
}

// compat
export function resolveReceiveInterceptor(team: TeamId, intent: PassIntent): string {
  return getReceiveInterceptorId(team, intent)
}
