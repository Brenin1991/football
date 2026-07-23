import type { RapierRigidBody } from '@react-three/rapier'
import type { PassIntent } from '../store/gameStore'
import type { TeamId, Vec3 } from '../types'
import { BALL_MASS, BALL_RADIUS, PASS_SPEED_BASE, PLAYER_SPRINT_SPEED, WORLD_SCALE } from '../constants'
import { clearDribbleState, getDribbleTarget } from './ballDribble'
import { applyBallVelocity, ensureBallDynamic, getLiveBallState, kickBall, syncBallFromBody } from './ballPhysics'
import { ballBodyRef, ballRef, playerRegistry } from './entityRegistry'
import { ballRestY, getPitchGroundY } from './fieldData'
import { distance2D, normalize2D } from './rules'
import { getAttackingGoalZ } from './teamField'
import { getPlayerStrikePoints, updatePlayerBonePositions } from './playerSkeleton'
import { tryCallOffsideOnReceive } from './referee'
import {
  passLoftFromPower,
  passSpeedFromPower,
  shotLoftFromPower,
  shotSpeedFromPower,
  ACTION_BUFFER_WINDOW_MS,
  CROSS_VOLLEY_BUFFER_MS,
} from './shotPower'
import { clearAICrossVolleyState } from './aiCrossVolley'
import { useGameStore, getUserTeam } from '../store/gameStore'
import { replaySystem } from './replaySystem'
import { sfx } from './sfx'
import {
  getReceiveInterceptorId,
  clearReceiveRoutes,
  isReceiveInterceptor,
  planReceiveMovement,
  refreshCrossReceiveRoutes,
  reassignCrossVolleyToBall,
  type ReceiveRunPlan,
} from './receiveRoutes'

export { getReceiveInterceptorId }
export type { ReceiveRunPlan }

const GRAVITY = -9.81
const REST_Y = ballRestY(BALL_RADIUS)

export type CrossTouchPart = 'head' | 'chest' | 'foot'

const lastTouchByPlayer = new Map<string, number>()

type CrossTrapState = {
  playerId: string
  team: TeamId
  since: number
}

let crossTrap: CrossTrapState | null = null
let crossReceiveControlUntil = 0
const volleyShooterShieldUntil = new Map<string, number>()

/** Bloqueia colisores do chutador por um instante após o voleio — evita bola grudar no pé. */
export function isCrossVolleyShooterShielded(playerId: string): boolean {
  return performance.now() < (volleyShooterShieldUntil.get(playerId) ?? 0)
}

function shieldVolleyShooter(playerId: string, ms = 520) {
  volleyShooterShieldUntil.set(playerId, performance.now() + ms)
}

function prepareCrossVolleyKick(
  playerId: string,
  dirX: number,
  dirZ: number,
): void {
  const store = useGameStore.getState()
  clearCrossTrap()
  clearCrossAssistCache()
  clearDribbleState()
  store.clearPossession()
  store.setPassIntent(null)
  store.blockPasserClaim(playerId, 460)
  store.freezeDistanceBallClaims(280)
  shieldVolleyShooter(playerId)
  useGameStore.setState({ pendingUserShot: null, pendingUserPass: null })

  const n = normalize2D(dirX, dirZ)
  const body = ballBodyRef.current as RapierRigidBody | null
  if (body) {
    ensureBallDynamic()
    body.wakeUp()
    const t = body.translation()
    const push = 0.16 * WORLD_SCALE
    body.setTranslation(
      { x: t.x + n.x * push, y: Math.max(t.y, ballRestY(BALL_RADIUS)), z: t.z + n.z * push },
      true,
    )
    syncBallFromBody(body)
  }
}

export function isCrossReceiveControlActive(playerId: string): boolean {
  if (performance.now() >= crossReceiveControlUntil) return false
  const store = useGameStore.getState()
  return store.activePlayerId === playerId
}

function grantCrossReceiveControl(_playerId: string) {
  crossReceiveControlUntil = performance.now() + 1800
}

const TRAP_SPRING = 52
const TRAP_DAMP = 6.2
const TRAP_COMMIT_DIST = 0.34
const TRAP_COMMIT_SPEED = 1.65
const TRAP_TIMEOUT_MS = 2800

export function isCrossTrapActive(playerId?: string): boolean {
  if (!crossTrap) return false
  if (playerId) return crossTrap.playerId === playerId
  return true
}

export function beginCrossTrap(playerId: string, team: TeamId) {
  const store = useGameStore.getState()
  if (store.ballPossession) return
  if (anyTeammateCrossVolleyIntent(team)) return
  crossTrap = { playerId, team, since: performance.now() }
  ensureBallDynamic()
  if (team === getUserTeam()) {
    store.setActivePlayer(playerId)
    if (!hasCrossVolleyIntent(playerId)) {
      store.setShotCharge(0, false)
      store.setCrossOneTouchActive(false)
      store.setStrikeAim(null)
      useGameStore.setState({ pendingUserShot: null, pendingUserPass: null })
      grantCrossReceiveControl(playerId)
    }
  }
}

export function clearCrossTrap() {
  crossTrap = null
}

/** Bola dinâmica puxada suavemente aos pés — sem teleporte */
export function tickCrossTrap(
  body: RapierRigidBody,
  delta: number,
  restY: number,
): boolean {
  if (!crossTrap) return false
  if (hasCrossVolleyIntent(crossTrap.playerId)) {
    clearCrossTrap()
    return false
  }

  const player = playerRegistry.get(crossTrap.playerId)
  const store = useGameStore.getState()
  if (!player || store.ballPossession) {
    clearCrossTrap()
    return false
  }

  ensureBallDynamic()
  body.wakeUp()

  const target = getDribbleTarget(player)
  const t = body.translation()
  const v = body.linvel()

  const dx = target.x - t.x
  const dz = target.z - t.z
  const dist = Math.hypot(dx, dz)

  let fx = dx * TRAP_SPRING - v.x * TRAP_DAMP
  let fz = dz * TRAP_SPRING - v.z * TRAP_DAMP

  const holderSpeed = Math.hypot(player.velocity.x, player.velocity.z)
  const maxAccel = Math.max(holderSpeed * 1.6, 3.8)
  const accel = Math.hypot(fx, fz)
  if (accel > maxAccel && accel > 1e-6) {
    const s = maxAccel / accel
    fx *= s
    fz *= s
  }

  body.applyImpulse({ x: fx * BALL_MASS * delta, y: 0, z: fz * BALL_MASS * delta }, true)

  const tv = body.linvel()
  const steerT = 1 - Math.exp(-12 * delta)
  body.setLinvel(
    {
      x: tv.x + (player.velocity.x - tv.x) * steerT * 0.42,
      y: tv.y,
      z: tv.z + (player.velocity.z - tv.z) * steerT * 0.42,
    },
    true,
  )

  if (t.y > restY + 0.02 && Math.abs(tv.y) < 0.6) {
    body.setLinvel({ x: tv.x, y: tv.y * 0.82 - 1.2 * delta, z: tv.z }, true)
  }

  syncBallFromBody(body)

  const ballSpeed = Math.hypot(tv.x, tv.z)
  const elapsed = performance.now() - crossTrap.since
  const heightOk = t.y <= restY + 0.42
  const ready =
    elapsed > 100 &&
    dist < TRAP_COMMIT_DIST &&
    ballSpeed < TRAP_COMMIT_SPEED &&
    heightOk &&
    Math.abs(tv.y) < 0.45

  if (ready) {
    const trap = crossTrap
    if (hasCrossVolleyIntent(trap.playerId)) {
      clearCrossTrap()
      return false
    }
    const passIntent = store.passIntent
    if (
      passIntent?.offsideFlag &&
      tryCallOffsideOnReceive(passIntent.offsideFlag, trap.playerId)
    ) {
      clearCrossTrap()
      return true
    }
    clearCrossTrap()
    clearCrossAssistCache()
    store.setPassIntent(null)
    if (trap.team === getUserTeam() && !hasCrossVolleyIntent(trap.playerId)) {
      store.setShotCharge(0, false)
      store.setCrossOneTouchActive(false)
      store.setStrikeAim(null)
      useGameStore.setState({ pendingUserShot: null, pendingUserPass: null })
      grantCrossReceiveControl(trap.playerId)
    }
    store.setPossession(trap.playerId, trap.team)
    return true
  }

  if (elapsed > TRAP_TIMEOUT_MS || dist > 2.8) {
    clearCrossTrap()
  }

  return true
}

/** Persegue bola já lenta após toque ou quase no pé */
export function tryMaintainCrossTrap(
  playerId: string,
  team: TeamId,
  playerPos: { x: number; z: number },
  ball: Vec3,
  ballVel: Vec3,
  passIntent: PassIntent,
): void {
  if (crossTrap || useGameStore.getState().ballPossession) return
  if (anyTeammateCrossVolleyIntent(team)) return
  if (hasCrossVolleyIntent(playerId)) return
  if (passIntent.passType !== 'cross') return
  if (!isCrossInterceptor(playerId, team, passIntent, ball, ballVel)) return
  if (!useGameStore.getState().canPlayerClaimBall(playerId)) return

  const dist = distance2D({ x: playerPos.x, y: 0, z: playerPos.z }, ball)
  const ballSpeed = Math.hypot(ballVel.x, ballVel.z)
  const height = (ball.y ?? REST_Y) - REST_Y
  if (ballSpeed > 3.2 || dist > 0.95 || height > 0.55) return

  beginCrossTrap(playerId, team)
}

export function predictAerialBallPosition(
  ball: Vec3,
  velocity: Vec3,
  t: number,
): Vec3 {
  const y0 = ball.y ?? REST_Y
  return {
    x: ball.x + velocity.x * t,
    y: y0 + velocity.y * t + 0.5 * GRAVITY * t * t,
    z: ball.z + velocity.z * t,
  }
}

/** Ponto de interceptação 3D projetado no chão — receptor corre até aqui */
export function getCrossReceiveTarget(
  receiverPos: { x: number; z: number },
  ball: Vec3,
  velocity: Vec3,
  passIntent: Pick<PassIntent, 'targetX' | 'targetZ'>,
): { x: number; z: number } {
  const receiverVec = { x: receiverPos.x, y: 0, z: receiverPos.z }
  const distToBall = distance2D(receiverVec, ball)
  const ballSpeed = Math.hypot(velocity.x, velocity.z)
  const chaseSpeed = Math.max(PLAYER_SPRINT_SPEED * 0.94, 2.6)

  if (ballSpeed > 0.35) {
    let bestT = 0.35
    let bestScore = -Infinity

    for (let i = 1; i <= 14; i++) {
      const t = (i / 14) * 1.35
      const pred = predictAerialBallPosition(ball, velocity, t)
      const runDist = distance2D(receiverVec, { x: pred.x, y: 0, z: pred.z })
      const runTime = runDist / chaseSpeed
      const margin = runTime - t

      let score = -Math.abs(margin) * 2.8
      if (margin <= 0.06 && margin >= -0.28) score += 5.5
      else if (margin < 0.4) score += 1.8
      score -= runDist * 0.06

      if (score > bestScore) {
        bestScore = score
        bestT = t
      }
    }

    const pred = predictAerialBallPosition(ball, velocity, bestT)
    const mix = distToBall > 10 ? 0.06 : distToBall > 5 ? 0.02 : 0
    return {
      x: pred.x * (1 - mix) + passIntent.targetX * mix,
      z: pred.z * (1 - mix) + passIntent.targetZ * mix,
    }
  }

  if (distToBall > 2.5) {
    const mix = Math.min(1, distToBall / 14) * 0.28
    return {
      x: ball.x * (1 - mix) + passIntent.targetX * mix,
      z: ball.z * (1 - mix) + passIntent.targetZ * mix,
    }
  }

  return { x: ball.x, z: ball.z }
}

/** Jogador mais apto a interceptar o cruzamento */
export function resolveCrossInterceptor(
  team: TeamId,
  passIntent: PassIntent,
  _ball: Vec3,
  _velocity: Vec3,
): string {
  return getReceiveInterceptorId(team, passIntent)
}

export function isCrossInterceptor(
  playerId: string,
  team: TeamId,
  passIntent: PassIntent,
  _ball: Vec3,
  _velocity: Vec3,
): boolean {
  return isReceiveInterceptor(playerId, team, passIntent)
}

/** Movimento de recepção — delega ao planejador cinemático */
export function planReceiveRun(
  playerId: string,
  receiverPos: { x: number; z: number },
  ball: Vec3,
  velocity: Vec3,
  passIntent: PassIntent,
  _anchor: { x: number; z: number } | null,
  options?: { crossInterceptor?: boolean },
): { plan: ReceiveRunPlan; anchor: null } {
  return {
    plan: planReceiveMovement(
      playerId,
      receiverPos,
      ball,
      velocity,
      passIntent,
      options,
    ),
    anchor: null,
  }
}

export function clearReceiveRunLocks(playerId?: string) {
  if (!playerId) clearReceiveRoutes()
}

export function pickCrossTouchPart(
  ball: { y?: number },
  ballVel: { y: number },
): CrossTouchPart {
  const height = (ball.y ?? REST_Y) - REST_Y
  if (height > 0.55 || (ballVel.y > 0.25 && height > 0.38)) return 'head'
  if (height > 0.26) return 'chest'
  return 'foot'
}

function isCrossVolleyBufferedContext(
  store: ReturnType<typeof useGameStore.getState> = useGameStore.getState(),
): boolean {
  return store.passIntent?.passType === 'cross' || store.crossOneTouchActive
}

export function anyCrossVolleyBuffered(): boolean {
  const store = useGameStore.getState()
  const now = performance.now()
  const shot = store.pendingUserShot
  const pass = store.pendingUserPass
  if (
    shot?.buffered &&
    shot.crossVolley &&
    now - shot.queuedAt <= CROSS_VOLLEY_BUFFER_MS
  ) {
    return true
  }
  if (!isCrossVolleyBufferedContext(store)) return false
  return !!(
    pass?.buffered && now - pass.queuedAt <= CROSS_VOLLEY_BUFFER_MS
  )
}

export function isCrossVolleyArmed(
  store: ReturnType<typeof useGameStore.getState>,
  playerId?: string,
): boolean {
  const id = playerId ?? store.activePlayerId
  return (
    store.crossOneTouchActive &&
    store.shotChargeActive &&
    store.powerBarMode === 'shot' &&
    store.activePlayerId === id
  )
}

export function isCrossVolleyContext(
  store: ReturnType<typeof useGameStore.getState> = useGameStore.getState(),
): boolean {
  return isCrossVolleyBufferedContext(store)
}

let volleyIntentFrame = -1
const volleyIntentPlayers = new Set<string>()
const teamHasCrossVolleyIntent = new Map<TeamId, boolean>()

function computeCrossVolleyIntentUncached(playerId: string): boolean {
  const store = useGameStore.getState()
  const now = performance.now()

  if (isCrossVolleyArmed(store, playerId)) {
    if (crossTrap?.playerId === playerId) clearCrossTrap()
    return true
  }

  const shot = store.pendingUserShot
  if (
    shot?.buffered &&
    shot.crossVolley &&
    shot.playerId === playerId &&
    now - shot.queuedAt <= CROSS_VOLLEY_BUFFER_MS
  ) {
    if (crossTrap?.playerId === playerId) clearCrossTrap()
    return true
  }

  if (!isCrossVolleyContext(store)) return false

  const pass = store.pendingUserPass
  const passQueued =
    !!(
      pass?.buffered &&
      pass.playerId === playerId &&
      now - pass.queuedAt <= CROSS_VOLLEY_BUFFER_MS
    )
  if (passQueued && crossTrap?.playerId === playerId) {
    clearCrossTrap()
  }
  return passQueued
}

/** Cache de intent por frame — evita dezenas de leituras no store */
export function refreshCrossVolleyIntentCache(frame: number) {
  if (frame === volleyIntentFrame) return
  volleyIntentFrame = frame
  volleyIntentPlayers.clear()
  teamHasCrossVolleyIntent.clear()

  const store = useGameStore.getState()
  const now = performance.now()

  for (const player of playerRegistry.values()) {
    if (isCrossVolleyArmed(store, player.id)) {
      volleyIntentPlayers.add(player.id)
    }
  }

  const shot = store.pendingUserShot
  if (
    shot?.buffered &&
    shot.crossVolley &&
    now - shot.queuedAt <= CROSS_VOLLEY_BUFFER_MS
  ) {
    volleyIntentPlayers.add(shot.playerId)
  }

  if (isCrossVolleyContext(store)) {
    const pass = store.pendingUserPass
    if (pass?.buffered && now - pass.queuedAt <= CROSS_VOLLEY_BUFFER_MS) {
      volleyIntentPlayers.add(pass.playerId)
    }
  }

  for (const playerId of volleyIntentPlayers) {
    const player = playerRegistry.get(playerId)
    if (player) teamHasCrossVolleyIntent.set(player.team, true)
  }
}

export function hasCrossVolleyIntent(playerId: string): boolean {
  if (volleyIntentFrame >= 0) {
    return volleyIntentPlayers.has(playerId)
  }
  return computeCrossVolleyIntentUncached(playerId)
}

function anyTeammateCrossVolleyIntent(team: TeamId): boolean {
  if (volleyIntentFrame >= 0) {
    return teamHasCrossVolleyIntent.get(team) ?? false
  }
  for (const p of playerRegistry.values()) {
    if (p.team === team && computeCrossVolleyIntentUncached(p.id)) return true
  }
  return false
}

function notifyCrossBallDeflected(intent: PassIntent) {
  refreshCrossReceiveRoutes(intent)
  reassignCrossVolleyToBall(intent)
}

function contactPointY(part: CrossTouchPart): number {
  switch (part) {
    case 'head':
      return REST_Y + 0.48
    case 'chest':
      return REST_Y + 0.27
    case 'foot':
      return REST_Y + 0.06
  }
}

function canReachCrossPart(
  playerPos: { x: number; z: number },
  ball: Vec3,
  ballVel: Vec3,
  part: CrossTouchPart,
  volley: boolean,
): { ok: boolean; dist3d: number } {
  const ballY = ball.y ?? REST_Y
  const contactY = contactPointY(part)
  const dx = ball.x - playerPos.x
  const dy = ballY - contactY
  const dz = ball.z - playerPos.z
  const dist3d = Math.hypot(dx, dy, dz)
  const height = ballY - REST_Y
  const horiz = Math.hypot(dx, dz)
  const ballSpeed = Math.hypot(ballVel.x, ballVel.z)

  const maxReach = volley
    ? part === 'head'
      ? 1.08
      : part === 'chest'
        ? 0.95
        : 0.78
    : part === 'head'
      ? 0.72
      : part === 'chest'
        ? 0.62
        : 0.52

  if (dist3d > maxReach) {
    if (!volley) {
      if (horiz > 1.05 || Math.abs(dy) > 0.55) return { ok: false, dist3d }
      if (horiz > maxReach * 1.15) return { ok: false, dist3d }
    } else if (dist3d > maxReach * 1.18) {
      return { ok: false, dist3d }
    }
  }

  if (volley) {
    if (part === 'foot' && height > 0.58) return { ok: false, dist3d }
    if (part === 'chest' && (height < 0.04 || height > 0.78)) return { ok: false, dist3d }
    if (part === 'head' && height < 0.12) return { ok: false, dist3d }
    if (part === 'head' && ballVel.y > 1.35) return { ok: false, dist3d }
  } else {
    if (part === 'foot' && height > 0.42) return { ok: false, dist3d }
    if (part === 'chest' && (height < 0.12 || height > 0.58)) return { ok: false, dist3d }
    if (part === 'head' && height < 0.24) return { ok: false, dist3d }
    if (part === 'head' && ballVel.y > 0.85) return { ok: false, dist3d }
  }

  if (horiz > 0.08 && ballSpeed > 0.25) {
    const toPx = playerPos.x - ball.x
    const toPz = playerPos.z - ball.z
    const closing =
      -(toPx * ballVel.x + toPz * ballVel.z) /
      (horiz * Math.max(ballSpeed, 0.35) + 0.001)
    const closingMin = volley ? -0.48 : -0.22
    if (closing < closingMin && horiz > (volley ? 0.75 : 0.55)) {
      return { ok: false, dist3d }
    }
  }

  const approachSpeed = Math.hypot(ballSpeed, Math.abs(ballVel.y))
  const timingWindow = volley ? 0.92 : 0.58
  if (approachSpeed > 0.45 && dist3d / approachSpeed > timingWindow) {
    return { ok: false, dist3d }
  }
  if (ballSpeed > (volley ? 19.5 : 16.5)) return { ok: false, dist3d }

  return { ok: true, dist3d }
}

/** Só libera voleio com bola no corpo — alcance real, não zona de 3 m */
function canStrikeCrossVolley(
  playerId: string,
  playerPos: { x: number; z: number },
  ball: Vec3,
  ballVel: Vec3,
): { ok: boolean; part: CrossTouchPart } {
  const horiz = Math.hypot(ball.x - playerPos.x, ball.z - playerPos.z)
  if (horiz > 1.55) {
    return { ok: false, part: 'chest' }
  }

  const preferred = pickCrossTouchPart(ball, ballVel)
  const parts: CrossTouchPart[] = [preferred, 'foot', 'chest', 'head']
  for (const part of parts) {
    const reach = canReachCrossPart(playerPos, ball, ballVel, part, true)
    if (reach.ok) return { ok: true, part }
  }

  updatePlayerBonePositions(playerId)
  const strikePoints = getPlayerStrikePoints(playerId, playerPos)
  const ballY = ball.y ?? getPitchGroundY()
  let bestDist = Infinity
  let bestPart: CrossTouchPart = preferred
  for (const sp of strikePoints) {
    const d = Math.hypot(
      ball.x - sp.point.x,
      ballY - sp.point.y,
      ball.z - sp.point.z,
    )
    if (d < bestDist) {
      bestDist = d
      bestPart = sp.part
    }
  }

  // Contato real no osso/parte — sem teleporte de chute longe
  if (bestDist < 0.92) {
    return { ok: true, part: bestPart }
  }

  return { ok: false, part: bestPart }
}

/** Só libera voleio quando a bola está no corpo do jogador — não por distância 2D */
function canContactBallForCrossVolley(
  playerId: string,
  playerPos: { x: number; z: number },
  ball: Vec3,
  ballVel: Vec3,
  volley = false,
): { ok: boolean; part: CrossTouchPart } {
  if (volley) {
    return canStrikeCrossVolley(playerId, playerPos, ball, ballVel)
  }

  const part = pickCrossTouchPart(ball, ballVel)
  const reach = canReachCrossPart(playerPos, ball, ballVel, part, false)
  return { ok: reach.ok, part }
}

function consumeCrossVolleyIntent(playerId: string):
  | { kind: 'shot'; power: number; dirX: number; dirZ: number }
  | { kind: 'pass'; type: 'pass' | 'through' | 'cross'; power: number; dirX?: number; dirZ?: number }
  | null {
  const store = useGameStore.getState()

  const shot = store.pendingUserShot
  if (
    shot?.buffered &&
    shot.playerId === playerId &&
    (shot.crossVolley || store.passIntent?.passType === 'cross')
  ) {
    if (performance.now() - shot.queuedAt > CROSS_VOLLEY_BUFFER_MS) {
      useGameStore.setState({ pendingUserShot: null })
      return null
    }
    useGameStore.setState({ pendingUserShot: null })
    return { kind: 'shot', power: shot.power, dirX: shot.dirX, dirZ: shot.dirZ }
  }

  const pass = store.pendingUserPass
  if (pass?.buffered && pass.playerId === playerId) {
    if (performance.now() - pass.queuedAt > CROSS_VOLLEY_BUFFER_MS) {
      useGameStore.setState({ pendingUserPass: null })
      return null
    }
    useGameStore.setState({ pendingUserPass: null })
    return {
      kind: 'pass',
      type: pass.type,
      power: pass.power,
      dirX: pass.dirX,
      dirZ: pass.dirZ,
    }
  }

  return null
}

function executeCrossVolleyShot(
  playerId: string,
  power: number,
  dirX: number,
  dirZ: number,
  part: CrossTouchPart,
): boolean {
  const player = playerRegistry.get(playerId)
  const store = useGameStore.getState()
  if (!player) return false

  const n = normalize2D(dirX, dirZ)
  const bounds = store.fieldBounds
  const goalDist =
    bounds != null
      ? Math.abs(getAttackingGoalZ(player.team, bounds) - player.position.z)
      : undefined
  const speed = shotSpeedFromPower(power, goalDist)
  const loftBase = shotLoftFromPower(power, goalDist)
  const loft =
    part === 'head'
      ? loftBase * 0.85
      : part === 'chest'
        ? loftBase * 0.55
        : loftBase * 0.4

  prepareCrossVolleyKick(playerId, n.x, n.z)
  store.setLastTouch(player.team)
  replaySystem.notifyShot(player.team, playerId)

  ensureBallDynamic()
  sfx.playKick()
  kickBall({ dirX: n.x, dirZ: n.z, speed, loft })
  return true
}

function executeCrossVolleyPass(
  playerId: string,
  type: 'pass' | 'through' | 'cross',
  power: number,
  dirX: number | undefined,
  dirZ: number | undefined,
  part: CrossTouchPart,
): boolean {
  const player = playerRegistry.get(playerId)
  const store = useGameStore.getState()
  if (!player) return false

  let dx = dirX ?? Math.sin(player.rotation)
  let dz = dirZ ?? Math.cos(player.rotation)
  const n = normalize2D(dx, dz)
  const speed = passSpeedFromPower(PASS_SPEED_BASE * 1.35, power)
  const loft =
    part === 'head'
      ? passLoftFromPower(power, false) * 0.7
      : passLoftFromPower(power, type === 'through')

  prepareCrossVolleyKick(playerId, n.x, n.z)
  store.setLastTouch(player.team)

  ensureBallDynamic()
  kickBall({ dirX: n.x, dirZ: n.z, speed, loft })
  return true
}

/** Solta o botão no cruzamento — buffera o chute e dispara no contato (ou na hora se já estiver no corpo). */
export function releaseCrossVolleyShot(
  playerId: string,
  power: number,
  dirX: number,
  dirZ: number,
): boolean {
  const player = playerRegistry.get(playerId)
  if (!player) return false

  const store = useGameStore.getState()
  store.setPendingBufferedShot(playerId, power, dirX, dirZ, true)

  const { ball, velocity: ballVel } = getLiveBallState()
  return tryCrossBallContact(playerId, player.position, ball, ballVel)
}

/** Tenta finalizar voleio buffered a cada frame — só no contato real */
export function tickBufferedCrossVolleys(): void {
  const store = useGameStore.getState()
  if (store.phase !== 'playing' || store.ballFrozen) return

  const now = performance.now()
  const shot = store.pendingUserShot
  if (shot?.buffered && now - shot.queuedAt > CROSS_VOLLEY_BUFFER_MS) {
    useGameStore.setState({ pendingUserShot: null })
    return
  }
  const pass = store.pendingUserPass
  if (pass?.buffered && now - pass.queuedAt > CROSS_VOLLEY_BUFFER_MS) {
    useGameStore.setState({ pendingUserPass: null })
    return
  }

  if (store.ballPossession) return

  const { ball, velocity: ballVel } = getLiveBallState()
  const pendingId =
    shot?.buffered && shot.crossVolley
      ? shot.playerId
      : pass?.buffered
        ? pass.playerId
        : null
  if (!pendingId || !hasCrossVolleyIntent(pendingId)) return

  const player = playerRegistry.get(pendingId)
  if (!player) return

  tryCrossBallContact(pendingId, player.position, ball, ballVel)
}

/** Limpa chute/passe antecipado expirado ou órfão (bola não chegou) */
export function clearExpiredAnticipationBuffers(): void {
  const store = useGameStore.getState()
  const now = performance.now()
  const shot = store.pendingUserShot
  const pass = store.pendingUserPass
  let nextShot = shot
  let nextPass = pass

  if (shot?.buffered) {
    const bufferMs = shot.crossVolley
      ? CROSS_VOLLEY_BUFFER_MS
      : ACTION_BUFFER_WINDOW_MS * 3
    if (now - shot.queuedAt > bufferMs) nextShot = null
    // Passe acabou e não é voleio — perdeu a bola
    else if (!shot.crossVolley && !store.passIntent) nextShot = null
  }
  if (pass?.buffered) {
    const bufferMs =
      store.passIntent?.passType === 'cross'
        ? CROSS_VOLLEY_BUFFER_MS
        : ACTION_BUFFER_WINDOW_MS * 3
    if (now - pass.queuedAt > bufferMs) nextPass = null
    else if (!store.passIntent) nextPass = null
  }

  if (nextShot !== shot || nextPass !== pass) {
    useGameStore.setState({
      pendingUserShot: nextShot,
      pendingUserPass: nextPass,
    })
  }
}

/** Contato no cruzamento — voleio/passe first-time ou domínio natural */
export function tryCrossBallContact(
  playerId: string,
  playerPos: { x: number; z: number },
  ball: Vec3,
  ballVel: Vec3,
): boolean {
  const store = useGameStore.getState()
  const player = playerRegistry.get(playerId)
  const pos = player?.position ?? playerPos
  const volley = hasCrossVolleyIntent(playerId)

  if (!volley) {
    if (!store.passIntent || store.passIntent.passType !== 'cross') return false
    return tryNaturalCrossProximityTouch(playerId, pos, ball, ballVel)
  }

  const groundY = getPitchGroundY()
  const ballY = ball.y ?? groundY
  const horiz = Math.hypot(ball.x - pos.x, ball.z - pos.z)
  const ballHeight = ballY - groundY
  // Precisa estar no corpo — se não chega, não chuta
  if (horiz > 1.55 || ballHeight < -0.15 || ballHeight > 4.5) return false

  updatePlayerBonePositions(playerId)

  const contact = canContactBallForCrossVolley(
    playerId,
    pos,
    ball,
    ballVel,
    true,
  )
  if (!contact.ok) return false

  const intent = consumeCrossVolleyIntent(playerId)
  if (!intent) return false

  const part = contact.part

  if (intent.kind === 'shot') {
    return executeCrossVolleyShot(
      playerId,
      intent.power,
      intent.dirX,
      intent.dirZ,
      part,
    )
  }
  return executeCrossVolleyPass(
    playerId,
    intent.type,
    intent.power,
    intent.dirX,
    intent.dirZ,
    part,
  )
}

/** Primeiro toque por proximidade — sem animação de recebimento */
export function tryNaturalCrossProximityTouch(
  playerId: string,
  playerPos: { x: number; z: number },
  ball: Vec3,
  ballVel: Vec3,
): boolean {
  const store = useGameStore.getState()
  const passIntent = store.passIntent
  if (!passIntent || passIntent.passType !== 'cross') return false

  const player = playerRegistry.get(playerId)
  if (!player) return false
  if (anyTeammateCrossVolleyIntent(player.team)) return false

  const horizDist = distance2D({ x: playerPos.x, y: 0, z: playerPos.z }, ball)
  const ballSpeed = Math.hypot(ballVel.x, ballVel.z)
  if (ballSpeed > 11.5) return false

  const contact = canContactBallForCrossVolley(playerId, playerPos, ball, ballVel)
  if (!contact.ok) return false

  const toPx = playerPos.x - ball.x
  const toPz = playerPos.z - ball.z
  const closing =
    ballSpeed > 0.2
      ? -(toPx * ballVel.x + toPz * ballVel.z) / (horizDist * ballSpeed + 0.001)
      : 1
  if (closing < -0.12) return false

  const result = applyNaturalCrossFirstTouch(playerId, contact.part)
  return result !== 'missed'
}

/** Primeiro toque natural — desvia a bola em vez de grudar no pé */
export function applyNaturalCrossFirstTouch(
  playerId: string,
  part: CrossTouchPart,
): 'trapped' | 'deflected' | 'missed' {
  const now = performance.now()
  const last = lastTouchByPlayer.get(playerId) ?? 0
  if (now - last < 180) return 'missed'
  lastTouchByPlayer.set(playerId, now)

  const player = playerRegistry.get(playerId)
  const store = useGameStore.getState()
  const passIntent = store.passIntent
  if (!player || !passIntent || passIntent.passType !== 'cross') return 'missed'
  if (hasCrossVolleyIntent(playerId)) return 'missed'

  const vel = ballRef.velocity
  const ballSpeed = Math.hypot(vel.x, vel.z)
  const faceX = Math.sin(player.rotation)
  const faceZ = Math.cos(player.rotation)

  let outVx = vel.x
  let outVz = vel.z
  let outVy = vel.y

  switch (part) {
    case 'head': {
      const spd = ballSpeed * 0.32 + 1.1
      outVx = faceX * spd * 0.65 + vel.x * 0.22
      outVz = faceZ * spd * 0.65 + vel.z * 0.22
      outVy = -Math.abs(vel.y) * 0.35 + 0.12
      break
    }
    case 'chest': {
      const spd = ballSpeed * 0.26 + 0.75
      outVx = faceX * spd * 0.5 + vel.x * 0.18
      outVz = faceZ * spd * 0.5 + vel.z * 0.18
      outVy = -vel.y * 0.55 - 0.08
      break
    }
    case 'foot': {
      const spd = ballSpeed * 0.4 + 1.35
      outVx = faceX * spd * 0.78 + vel.x * 0.28
      outVz = faceZ * spd * 0.78 + vel.z * 0.28
      outVy = Math.max(0, vel.y * 0.15)
      break
    }
  }

  const body = ballBodyRef.current as RapierRigidBody | null
  ensureBallDynamic()

  if (body) {
    body.wakeUp()
    const mass = body.mass()
    const dvx = outVx - vel.x
    const dvy = outVy - vel.y
    const dvz = outVz - vel.z
    body.applyImpulse({ x: dvx * mass, y: dvy * mass, z: dvz * mass }, true)
    syncBallFromBody(body)
  } else {
    applyBallVelocity(outVx, outVy, outVz)
  }

  store.clearPossession()
  store.setLastTouch(player.team)

  const finalHoriz = Math.hypot(outVx, outVz)
  const trapped = finalHoriz < 3.2 && Math.abs(outVy) < 1.2
  if (trapped || finalHoriz < 5.2) {
    beginCrossTrap(playerId, player.team)
  } else {
    notifyCrossBallDeflected(passIntent)
  }
  return trapped ? 'trapped' : 'deflected'
}

/** Cruzamentos nunca usam claim por distância — só trap físico */
export function shouldCrossDistanceClaim(): boolean {
  return false
}

export function clearCrossAssistCache() {
  lastTouchByPlayer.clear()
  clearReceiveRoutes()
  clearCrossTrap()
  clearAICrossVolleyState()
  crossReceiveControlUntil = 0
}
