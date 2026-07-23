import type { PassIntent } from '../store/gameStore'
import type { TeamId, Vec3 } from '../types'
import { PLAYER_SPRINT_SPEED, BALL_RADIUS } from '../constants'
import { ballRef, playerRegistry } from './entityRegistry'
import { ballRestY } from './fieldData'
import { distance2D } from './rules'
import { getUserTeam, useGameStore } from '../store/gameStore'

const GRAVITY = -9.81
const REST_Y = ballRestY(BALL_RADIUS)

const V_RUN = PLAYER_SPRINT_SPEED

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

/** Vá NA BOLA. Sem lead, sem ponto, sem mix — só a bola. */
function chaseBallHard(
  receiverPos: { x: number; z: number },
  ball: Vec3,
): ReceiveRunPlan {
  const bx = ball.x - receiverPos.x
  const bz = ball.z - receiverPos.z
  const bd = Math.hypot(bx, bz)

  if (bd < 0.12) {
    return {
      targetX: ball.x,
      targetZ: ball.z,
      dirX: bd > 1e-4 ? bx / bd : 0,
      dirZ: bd > 1e-4 ? bz / bd : 1,
      targetSpeed: V_RUN,
      sprint: true,
      moveScale: 1.08,
      hardStop: false,
      arriveDist: 0.08,
      approachDist: bd,
      phase: 'contact',
    }
  }

  const inv = 1 / bd
  return {
    targetX: ball.x,
    targetZ: ball.z,
    dirX: bx * inv,
    dirZ: bz * inv,
    targetSpeed: V_RUN,
    sprint: true,
    moveScale: 1.08,
    hardStop: false,
    arriveDist: 0.08,
    approachDist: bd,
    phase: bd < 1.5 ? 'contact' : 'approach',
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

export function planReceiveMovement(
  _playerId: string,
  receiverPos: { x: number; z: number },
  ball: Vec3,
  _velocity: Vec3,
  _intent: PassIntent,
  _options?: { crossInterceptor?: boolean },
): ReceiveRunPlan {
  return chaseBallHard(receiverPos, ball)
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
  }
}

// compat
export function resolveReceiveInterceptor(team: TeamId, intent: PassIntent): string {
  return getReceiveInterceptorId(team, intent)
}
