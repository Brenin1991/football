import {
  BALL_AIR_DRAG,
  BALL_RADIUS,
  CLAIM_DISTANCE,
  GK_BODY_SAVE_STEP,
  GK_CATCH_MAX_SPEED,
  GK_CLAIM_BOX_SPEED,
  GK_CLOSE_ATTACKER_DIST,
  GK_DISTRIBUTE_DELAY_MS,
  GK_FACING_CLAMP,
  GK_FEET_CLAIM_MAX_HEIGHT,
  GK_FEET_CLAIM_MAX_SPEED,
  GK_HAND_RADIUS,
  GK_HOLD_MS,
  GK_MAX_STEP_FROM_LINE,
  GK_MIN_FROM_LINE,
  GK_REACH_HEIGHT,
  GK_SAVE_COOLDOWN_MS,
  GK_REACH_DIVE,
  GK_REACH_STANDING,
  SHOT_SPEED,
  WORLD_SCALE,
  KICK_LOFT_HEIGHT,
  KICK_PASS_LOFT_BASE,
} from '../constants'
import { ballRef, ballBodyRef, playerRegistry, type PlayerRef } from './entityRegistry'
import { distance2D } from './rules'
import { useGameStore, type BallPossession } from '../store/gameStore'
import { getAttackSign, getDefensiveGoalZ, getFieldFacingRotation, isInPenaltyArea } from './teamField'
import { ballRestY } from './fieldData'
import { getPlayerAttrMultipliers } from './playerAttributes'
import type { FieldBounds, GoalkeeperAnim, GoalZone, TeamId, Vec3 } from '../types'
import { minGkHandDist, getGkCatchAnchor } from './goalkeeperHands'
import {
  getGkCommitWindow,
  PLAYER_SHOOT_CONTACT_SEC,
  rollGkCommitJitter,
} from './gkAnimTiming'
import { shotLoftFromPower, shotSpeedFromPower, SHOT_POWER_CHARGE_DURATION_SEC } from './shotPower'

export type GkSaveKind = 'catch' | 'parry' | 'foot'
export type GkMode = 'idle' | 'save' | 'hold' | 'distribute'

export type GkRuntime = {
  mode: GkMode
  saveAnim: GoalkeeperAnim | null
  saveKind: GkSaveKind | null
  saveSide: 'left' | 'right' | null
  interceptTarget: { x: number; z: number } | null
  holdUntil: number
  saveLockedUntil: number
  lastSaveAt: number
  handContactResolved: boolean
  allowStep: boolean
  stepDepth: number
  faceAngle: number | null
  distributing: boolean
  /** Jitter de timing por ameaça (positivo = reage mais cedo) */
  commitJitter: number
  threatKey: string | null
}

const gkRuntimes = new Map<string, GkRuntime>()

// Nunca deixamos o goleiro travado numa animação/estado que "esqueceram" de
// terminar. Isso é só uma rede de segurança — bem maior que qualquer defesa
// real — pra garantir que ele sempre volte a reagir.
const GK_SAVE_FAILSAFE_MS = 1500
const GK_DISTRIBUTE_FAILSAFE_MS = GK_DISTRIBUTE_DELAY_MS + 4000
/** Zona central — chute no corpo (um pouco mais larga pra pegar com as mãos) */
const GK_CENTRAL_ZONE = GK_REACH_STANDING * 0.52
/** Body save — se joga no chão (joelho / cintura baixa) */
const GK_BODY_SAVE_MAX_Y = 1.05
/** Diving save — bolas de peito pra cima */
const GK_DIVING_MIN_Y = 1.12

function isCentralToGk(gkX: number, targetX: number): boolean {
  return Math.abs(targetX - gkX) < GK_CENTRAL_ZONE
}

/** Abaixo disso = defesa baixa (body save), NÃO pulo */
const GK_MIDDLE_JUMP_MIN_Y = 1.05

function isLowSaveHeight(predictedY: number): boolean {
  return predictedY < GK_MIDDLE_JUMP_MIN_Y
}

function gkMeetBallDepth(predictedY: number, _urgency: number): number {
  if (predictedY < GK_FEET_CLAIM_MAX_HEIGHT + 0.4) {
    return GK_MIN_FROM_LINE + 0.22
  }
  if (isLowSaveHeight(predictedY)) {
    return GK_MIN_FROM_LINE + 0.3
  }
  return GK_MIN_FROM_LINE + 0.38 + _urgency * 0.22
}

function gkLowShotCoverPoint(
  team: TeamId,
  bounds: FieldBounds,
  interceptX: number,
  maxDepth = GK_MAX_STEP_FROM_LINE,
): { x: number; z: number } {
  const goalZ = getDefensiveGoalZ(team, bounds)
  const intoField = getAttackSign(team, bounds)
  return clampGkPosition(
    { x: interceptX, y: 0, z: goalZ + intoField * (GK_MIN_FROM_LINE + 0.24) },
    team,
    bounds,
    maxDepth,
  )
}

function isLowBallThreat(threat: ShotThreat): boolean {
  if (threat.interceptYGk != null) {
    return threat.interceptYGk < GK_MIDDLE_JUMP_MIN_Y
  }
  return threat.interceptY < GK_MIDDLE_JUMP_MIN_Y
}

function defaultRuntime(): GkRuntime {
  return {
    mode: 'idle',
    saveAnim: null,
    saveKind: null,
    saveSide: null,
    interceptTarget: null,
    holdUntil: 0,
    saveLockedUntil: 0,
    lastSaveAt: 0,
    handContactResolved: false,
    allowStep: false,
    stepDepth: GK_MAX_STEP_FROM_LINE,
    faceAngle: null,
    distributing: false,
    commitJitter: 0,
    threatKey: null,
  }
}

export function getGkRuntime(gkId: string): GkRuntime | undefined {
  return gkRuntimes.get(gkId)
}

/** Colisores físicos no corpo inteiro — sempre ativos exceto com bola na mão ou pós-contato na defesa */
export function areGkPhysicsCollidersActive(gkId: string): boolean {
  const store = useGameStore.getState()
  if (store.phase === 'replay') return false

  const rt = gkRuntimes.get(gkId)
  if (!rt) return true
  if (rt.mode === 'hold' || rt.mode === 'distribute') return false
  if (rt.mode === 'save' && rt.handContactResolved) return false
  return true
}

/** @deprecated use areGkPhysicsCollidersActive */
export function areGkBodyBoneCollidersActive(gkId: string): boolean {
  return areGkPhysicsCollidersActive(gkId)
}

/** @deprecated use areGkPhysicsCollidersActive */
export function areGkHandsPhysicsActive(gkId: string): boolean {
  return areGkPhysicsCollidersActive(gkId)
}

/** Goleiro com bola agarrada — ninguém disputa; jogadores se afastam. */
export function isGkBallProtected(possession: BallPossession | null): boolean {
  if (!possession) return false
  const holder = playerRegistry.get(possession.playerId)
  if (!holder || holder.role !== 'gk') return false
  const rt = gkRuntimes.get(holder.id)
  return rt?.mode === 'hold' || rt?.mode === 'distribute'
}

/** Alvo de recuo quando jogador está colado no goleiro com a bola. */
export function getGkHoldClearTarget(
  playerPos: Vec3,
  gkPos: Vec3,
  minDist = 4.2 * WORLD_SCALE,
): { x: number; z: number } {
  const dx = playerPos.x - gkPos.x
  const dz = playerPos.z - gkPos.z
  const dist = Math.hypot(dx, dz)
  if (dist >= minDist) return { x: playerPos.x, z: playerPos.z }
  const len = dist > 0.05 ? dist : 1
  return {
    x: gkPos.x + (dx / len) * minDist,
    z: gkPos.z + (dz / len) * minDist,
  }
}

export function isGkBodyLocked(gkId: string): boolean {
  const rt = gkRuntimes.get(gkId)
  if (!rt) return false
  if (rt.mode === 'distribute') return true
  if (rt.mode === 'save' && rt.saveAnim) return true
  return performance.now() < rt.saveLockedUntil
}

export type ShotThreat = {
  defendingTeam: TeamId
  goalZ: number
  goalMinX: number
  goalMaxX: number
  interceptX: number
  interceptY: number
  /** Altura prevista no plano do goleiro (não na linha do gol) */
  interceptYGk?: number
  timeToGoal: number
  urgency: number
  ballSpeed: number
  /** Distância da bola (ou atacante) até a linha do gol, ao longo do campo */
  shotDistance: number
  /** Ameaça prevista antes da bola sair (windup / carga) */
  preShot?: boolean
  /** Windup/carga ativos — commit de defesa permitido */
  preShotImminent?: boolean
}

export function assessShotThreat(
  ball: Vec3,
  vel: Vec3,
  bounds: FieldBounds,
  zones: GoalZone[],
): ShotThreat | null {
  const speed = Math.hypot(vel.x, vel.z)
  const lowShot = ball.y < GK_FEET_CLAIM_MAX_HEIGHT
  if (lowShot && speed < GK_FEET_CLAIM_MAX_SPEED) return null
  const minSpeed = lowShot ? 1.35 : 3.2
  if (speed < minSpeed) return null
  // Lob alto sem perigo — ignora; chutes fortes por cima do gol ainda geram ameaça
  if (ball.y > GK_REACH_HEIGHT + 1.35 && speed < 5.5 && vel.y > 0.2) return null

  let best: ShotThreat | null = null

  for (const zone of zones) {
    const defendingTeam = zone.team === 'home' ? 'away' : 'home'
    const goalZ = getDefensiveGoalZ(defendingTeam, bounds)
    const intoField = getAttackSign(defendingTeam, bounds)

    const toGoal = (ball.z - goalZ) * intoField
    if (toGoal < 0.35 || toGoal > (lowShot ? 24 : 32)) continue

    const closingSpeed = -(vel.z * intoField)
    if (closingSpeed < (lowShot ? 0.55 : 1.05)) continue

    const timeToGoal = toGoal / Math.max(closingSpeed, 0.35)
    if (timeToGoal > (lowShot ? 3.2 : 2.6)) continue

    const atGoal = predictBallFlight(ball, vel, goalZ, { maxTime: 3.4 })
    const predictX = atGoal?.x ?? ball.x + vel.x * timeToGoal
    const predictY = atGoal?.y ?? ballRestY(BALL_RADIUS)
    const margin = lowShot ? 1.35 : 1.05
    if (predictX < zone.minX - margin || predictX > zone.maxX + margin) continue

    const interceptX = Math.max(zone.minX + 0.12, Math.min(zone.maxX - 0.12, predictX))
    const urgency = Math.min(1, (speed / SHOT_SPEED) * (1.4 / Math.max(timeToGoal, 0.18)))
    const gkPlaneZ = goalZ + intoField * GK_MIN_FROM_LINE
    const atGk = predictBallFlight(ball, vel, gkPlaneZ, { maxTime: 3.4 })

    const threat: ShotThreat = {
      defendingTeam,
      goalZ,
      goalMinX: zone.minX,
      goalMaxX: zone.maxX,
      interceptX,
      interceptY: Math.max(ballRestY(BALL_RADIUS), predictY),
      interceptYGk: atGk ? Math.max(ballRestY(BALL_RADIUS), atGk.y) : undefined,
      timeToGoal: atGk?.t ?? timeToGoal,
      urgency,
      ballSpeed: speed,
      shotDistance: toGoal,
    }

    if (!best || threat.urgency > best.urgency) best = threat
  }

  return best
}

function estimateShotVelocity(
  dirX: number,
  dirZ: number,
  power: number,
): Vec3 {
  const horiz = Math.hypot(dirX, dirZ)
  const nx = horiz > 0.001 ? dirX / horiz : 0
  const nz = horiz > 0.001 ? dirZ / horiz : 1
  const speed = shotSpeedFromPower(power)
  const loft = shotLoftFromPower(power)
  let vy: number
  let horizMul = 1
  if (loft > 0.045) {
    const peak = KICK_LOFT_HEIGHT * (0.2 + loft * 0.95)
    vy = Math.sqrt(Math.max(0.06, 2 * 9.81 * peak)) + speed * 0.028 * loft
    if (loft > 0.28) {
      horizMul = Math.max(0.72, 1 - (loft - 0.28) * 0.28)
    }
  } else {
    vy = KICK_PASS_LOFT_BASE + speed * 0.012
  }
  return { x: nx * speed * horizMul, y: vy, z: nz * speed * horizMul }
}

function isFacingGoal(
  shooter: PlayerRef,
  defendingTeam: TeamId,
  bounds: FieldBounds,
): boolean {
  const goalZ = getDefensiveGoalZ(defendingTeam, bounds)
  const intoField = getAttackSign(defendingTeam, bounds)
  const fx = Math.sin(shooter.rotation)
  const fz = Math.cos(shooter.rotation)
  const toGoalX = bounds.center.x - shooter.position.x
  const toGoalZ = goalZ + intoField * 1.8 - shooter.position.z
  const len = Math.hypot(toGoalX, toGoalZ)
  if (len < 0.12) return true
  return (fx * toGoalX + fz * toGoalZ) / len > 0.42
}

function isInShootingZone(
  pos: Vec3,
  defendingTeam: TeamId,
  bounds: FieldBounds,
): boolean {
  if (isInPenaltyArea(pos, defendingTeam, bounds)) return true
  const goalZ = getDefensiveGoalZ(defendingTeam, bounds)
  const intoField = getAttackSign(defendingTeam, bounds)
  const distToGoal = (pos.z - goalZ) * intoField
  return distToGoal > 0.25 && distToGoal < 24
}

function buildThreatFromZones(
  defendingTeam: TeamId,
  bounds: FieldBounds,
  zones: GoalZone[],
  interceptX: number,
  interceptY: number,
  timeToGoal: number,
  ballSpeed: number,
  shotDistance: number,
  preShot = false,
  preShotImminent = false,
  interceptYGk?: number,
): ShotThreat | null {
  const zone = zones.find((z) => (z.team === 'home' ? 'away' : 'home') === defendingTeam)
  if (!zone) return null

  const margin = preShot ? 1.25 : 0.95
  if (interceptX < zone.minX - margin || interceptX > zone.maxX + margin) return null

  const goalZ = getDefensiveGoalZ(defendingTeam, bounds)
  const low = (interceptYGk ?? interceptY) < GK_MIDDLE_JUMP_MIN_Y
  const urgency = Math.min(
    1,
    (ballSpeed / SHOT_SPEED) * (1.55 / Math.max(timeToGoal, 0.14)) +
      (preShotImminent ? 0.22 : preShot ? 0.08 : 0) -
      (low && shotDistance > 10 ? 0.12 : 0),
  )

  return {
    defendingTeam,
    goalZ,
    goalMinX: zone.minX,
    goalMaxX: zone.maxX,
    interceptX: Math.max(zone.minX + 0.12, Math.min(zone.maxX - 0.12, interceptX)),
    interceptY: Math.max(0.06, interceptY),
    interceptYGk: interceptYGk != null ? Math.max(0.06, interceptYGk) : undefined,
    timeToGoal,
    urgency: Math.max(0.06, urgency),
    ballSpeed,
    shotDistance,
    preShot,
    preShotImminent,
  }
}

/** Lê windup / carga do chute e prevê trajetória antes da bola sair */
export function assessPreShotThreat(
  gkTeam: TeamId,
  bounds: FieldBounds,
  zones: GoalZone[],
  possession: BallPossession | null,
): ShotThreat | null {
  if (!possession || possession.team === gkTeam || zones.length === 0) return null

  const shooter = playerRegistry.get(possession.playerId)
  if (!shooter || shooter.role === 'gk') return null
  if (!isInShootingZone(shooter.position, gkTeam, bounds)) return null
  if (!isFacingGoal(shooter, gkTeam, bounds)) return null

  const store = useGameStore.getState()
  const winding =
    shooter.anim === 'player_shoot' ||
    shooter.anim === 'player_kick' ||
    shooter.anim === 'player_kick_high' ||
    shooter.anim === 'player_kick_medium' ||
    shooter.anim === 'player_kick_low'
  const aimForShooter =
    store.strikeAim && store.ballPossession?.playerId === shooter.id
      ? store.strikeAim
      : null
  const charging =
    !!aimForShooter?.charging &&
    store.shotChargeActive &&
    store.powerBarMode === 'shot'
  const preShotImminent = winding || charging
  const inBox = isInPenaltyArea(shooter.position, gkTeam, bounds)
  const goalZ = getDefensiveGoalZ(gkTeam, bounds)
  const intoField = getAttackSign(gkTeam, bounds)
  const shotDistance = Math.max(0.35, (shooter.position.z - goalZ) * intoField)

  if (!preShotImminent && !(inBox && shotDistance < 11)) return null

  let power = 0.68
  if (aimForShooter && aimForShooter.power > 0.12) power = aimForShooter.power
  else if (store.shotChargeActive && store.shotChargePower > 0.12) {
    power = store.shotChargePower
  }

  let dirX = Math.sin(shooter.rotation)
  let dirZ = Math.cos(shooter.rotation)
  if (aimForShooter && Math.hypot(aimForShooter.dirX, aimForShooter.dirZ) > 0.18) {
    dirX = aimForShooter.dirX
    dirZ = aimForShooter.dirZ
  }
  const horiz = Math.hypot(dirX, dirZ)
  if (horiz < 0.05) return null
  dirX /= horiz
  dirZ /= horiz

  let timeToStrike = inBox ? 0.52 : 0.68
  if (winding) {
    timeToStrike = Math.max(0.03, PLAYER_SHOOT_CONTACT_SEC - (shooter.animTime ?? 0))
  } else if (charging) {
    timeToStrike =
      PLAYER_SHOOT_CONTACT_SEC +
      0.12 +
      (1 - power) * SHOT_POWER_CHARGE_DURATION_SEC * 0.45
  } else if (inBox && shotDistance > 8) {
    timeToStrike = 1.85 + (shotDistance - 8) * 0.04
  }

  const ball = ballRef.current
  const vel = estimateShotVelocity(dirX, dirZ, power)
  const lineZ = gkLineZ(gkTeam, bounds)
  const closing = -(vel.z * intoField)
  if (closing < 0.45) return null

  const flightTime = Math.abs(lineZ - ball.z) / Math.max(Math.abs(vel.z), 0.35)
  if (flightTime > 2.4) return null

  const predicted = predictBallAtZ(ball, vel, lineZ)
  if (!predicted) return null

  return buildThreatFromZones(
    gkTeam,
    bounds,
    zones,
    predicted.x,
    predicted.y,
    timeToStrike + flightTime,
    Math.hypot(vel.x, vel.z),
    shotDistance,
    true,
    preShotImminent,
    predicted.y,
  )
}

function resolveGkThreat(
  gkTeam: TeamId,
  ballThreat: ShotThreat | null,
  preShotThreat: ShotThreat | null,
): ShotThreat | null {
  const ball = ballThreat?.defendingTeam === gkTeam ? ballThreat : null
  const pre = preShotThreat?.defendingTeam === gkTeam ? preShotThreat : null
  if (!ball && !pre) return null
  if (!ball) return pre
  if (!pre) return ball
  return pre.timeToGoal <= ball.timeToGoal ? pre : ball
}

function refreshGkThreatJitter(rt: GkRuntime, threat: ShotThreat) {
  const key = `${threat.interceptX.toFixed(1)}:${threat.interceptY.toFixed(2)}:${threat.preShot ? 1 : 0}`
  if (rt.threatKey !== key) {
    rt.threatKey = key
    rt.commitJitter = rollGkCommitJitter()
  }
}

function commitWindowForThreat(
  threat: ShotThreat,
  plan: SaveDecision,
  jitter: number,
): number {
  return getGkCommitWindow(plan.anim, {
    lowBall: isLowBallThreat(threat),
    shotDistance: threat.shotDistance,
    preShot: threat.preShot,
    preShotImminent: threat.preShotImminent,
    jitter,
  })
}

function shouldCommitGkSave(
  threat: ShotThreat,
  plan: SaveDecision,
  inReach: boolean,
  lateralError: number,
  distToBall: number,
  centralShot: boolean,
  easyCatch: boolean,
  jitter: number,
): boolean {
  const t = threat.timeToGoal
  const close = threat.shotDistance < 6.5
  const window = commitWindowForThreat(threat, plan, jitter)
  const closeBoost = close ? 1.14 : 1

  if (inReach) return true

  if (isLowBallThreat(threat)) {
    // Sem animação = domínio/posicionamento; com animação = commit na janela normal
    if (!plan.anim) {
      return t <= (close ? 0.55 : 0.34) || distToBall < 2.4
    }
    return t <= window * closeBoost || distToBall < 2.8
  }

  if (t <= window * closeBoost) return true

  if (plan.anim === 'gk_miss_middle') {
    return t <= window + 0.18
  }

  if (plan.anim === 'gk_catch' || easyCatch) {
    return t <= window + 0.1 || distToBall < (centralShot ? 4.2 : 2.6)
  }

  if (plan.anim?.includes('diving')) {
    return (
      t <= window + 0.12 ||
      (threat.urgency >= 0.48 && t <= window + 0.22)
    )
  }

  if (plan.anim?.includes('body_save')) {
    return t <= window + 0.08 || lateralError < GK_REACH_DIVE * 0.42
  }

  return centralShot && t <= window + 0.12
}

function pickSaveSide(gkX: number, targetX: number, velX: number): 'left' | 'right' {
  const dx = targetX - gkX
  if (Math.abs(dx) > 0.04) return dx > 0 ? 'right' : 'left'
  return velX >= 0 ? 'right' : 'left'
}

const BALL_GRAVITY = 9.81

export type BallFlightHit = {
  x: number
  y: number
  z: number
  /** Tempo até cruzar o plano Z (s) */
  t: number
  /** Já rolando no chão no momento do cruzamento */
  grounded: boolean
}

/**
 * Prediz onde a bola cruza um plano Z — gravidade real (Rapier 9.81), drag e piso.
 * Antes usava g*0.012 e o GK “via” bola alta enquanto ela já vinha rasteira.
 */
export function predictBallFlight(
  ball: Vec3,
  vel: Vec3,
  targetZ: number,
  opts?: { maxTime?: number },
): BallFlightHit | null {
  const maxTime = opts?.maxTime ?? 3.6
  if (Math.abs(vel.z) < 0.04) return null

  const tApprox = (targetZ - ball.z) / vel.z
  if (tApprox < 0.015 || tApprox > maxTime) return null

  const groundY = ballRestY(BALL_RADIUS)
  const dt = 1 / 90
  let x = ball.x
  let y = Math.max(groundY, ball.y)
  let z = ball.z
  let vx = vel.x
  let vy = vel.y
  let vz = vel.z
  let t = 0
  let grounded = y <= groundY + 0.02 && Math.abs(vy) < 0.35
  const toward = Math.sign(targetZ - ball.z) || Math.sign(vz) || 1
  let prevZ = z

  while (t < maxTime) {
    const speed = Math.hypot(vx, vy, vz)
    const airScale = Math.exp(-BALL_AIR_DRAG * dt)
    const vertScale = Math.exp(-BALL_AIR_DRAG * 0.55 * dt)
    if (!grounded && speed > 0.08) {
      vx *= airScale
      vz *= airScale
      vy = vy * vertScale - BALL_GRAVITY * dt
    } else if (grounded) {
      // Rolagem: mantém direção, perde um pouco
      const roll = Math.exp(-0.22 * dt)
      vx *= roll
      vz *= roll
      vy = 0
      y = groundY
    } else {
      vy -= BALL_GRAVITY * dt
    }

    prevZ = z
    x += vx * dt
    y += vy * dt
    z += vz * dt
    t += dt

    if (y <= groundY) {
      y = groundY
      if (vy < 0) {
        // Quique amortecido — depois cola no chão pra previsão de defesa
        vy *= -0.42
        if (Math.abs(vy) < 1.1) {
          vy = 0
          grounded = true
        }
      } else {
        grounded = Math.abs(vy) < 0.35
      }
    }

    const crossed =
      toward > 0 ? prevZ < targetZ && z >= targetZ : prevZ > targetZ && z <= targetZ
    if (crossed) {
      const span = z - prevZ
      const u = Math.abs(span) > 1e-6 ? (targetZ - prevZ) / span : 1
      return {
        x: x - vx * dt * (1 - u),
        y: Math.max(groundY, y - vy * dt * (1 - u)),
        z: targetZ,
        t: Math.max(0.02, t - dt * (1 - u)),
        grounded: grounded || y <= groundY + 0.08,
      }
    }

    if (Math.hypot(vx, vz) < 0.12 && grounded) break
  }

  return null
}

/** @deprecated use predictBallFlight — mantido pra callers antigos */
export function predictBallAtZ(ball: Vec3, vel: Vec3, targetZ: number): Vec3 | null {
  const hit = predictBallFlight(ball, vel, targetZ)
  if (!hit) return null
  return { x: hit.x, y: hit.y, z: hit.z }
}

function gkThreatSweepDepth(
  threat: ShotThreat,
  maxDepth = GK_MAX_STEP_FROM_LINE,
  gkX?: number,
): number {
  if (threat.interceptY < 0.72) {
    return Math.min(maxDepth, gkMeetBallDepth(threat.interceptY, threat.urgency))
  }

  const lateralToAim = gkX != null ? Math.abs(gkX - threat.interceptX) : 0
  const centralClose =
    gkX != null &&
    lateralToAim < GK_CENTRAL_ZONE &&
    threat.timeToGoal < 1.4 &&
    threat.interceptY >= GK_MIDDLE_JUMP_MIN_Y

  if (centralClose) {
    return GK_MIN_FROM_LINE + 0.2
  }

  const span = Math.max(0.12, maxDepth - GK_MIN_FROM_LINE)
  const urgencyBoost = Math.min(1, threat.urgency * 0.68)
  const timeBoost =
    threat.timeToGoal < 0.5 ? 0.14 : threat.timeToGoal < 0.9 ? 0.08 : 0
  return GK_MIN_FROM_LINE + span * Math.min(1, urgencyBoost + timeBoost)
}

function gkThreatPosition(
  team: TeamId,
  bounds: FieldBounds,
  threat: ShotThreat,
  maxDepth = GK_MAX_STEP_FROM_LINE,
  gkX?: number,
): { x: number; z: number } {
  const goalZ = getDefensiveGoalZ(team, bounds)
  const intoField = getAttackSign(team, bounds)
  const sweep = gkThreatSweepDepth(threat, maxDepth, gkX)
  return clampGkPosition(
    { x: threat.interceptX, y: 0, z: goalZ + intoField * sweep },
    team,
    bounds,
    maxDepth,
  )
}

function gkLineZ(team: TeamId, bounds: FieldBounds, depth = GK_MIN_FROM_LINE): number {
  const goalZ = getDefensiveGoalZ(team, bounds)
  return goalZ + getAttackSign(team, bounds) * depth
}

/** Bola baixa e lenta — domínio com os pés, sem defesa de mãos */
export function isWeakLowBall(ball: Vec3, vel: Vec3): boolean {
  const speed = Math.hypot(vel.x, vel.z)
  return ball.y < GK_FEET_CLAIM_MAX_HEIGHT && speed < GK_FEET_CLAIM_MAX_SPEED
}

/** Pega vs espalma — rasteira forte = body/parry; fraca = pé */
function chooseSaveKind(
  predictedY: number,
  ballSpeed: number,
  distToGk: number,
  close1v1: boolean,
  grounded = false,
): GkSaveKind {
  if (
    !grounded &&
    predictedY < GK_FEET_CLAIM_MAX_HEIGHT &&
    ballSpeed < GK_FEET_CLAIM_MAX_SPEED * 1.15
  ) {
    return 'foot'
  }

  // Rasteira/baixa rápida — pega com o corpo no chão (catch nas mãos no contato)
  if (grounded || predictedY <= GK_BODY_SAVE_MAX_Y) {
    if (ballSpeed < GK_CATCH_MAX_SPEED * 1.05) return 'catch'
    return 'parry'
  }

  if (
    ballSpeed < GK_CLAIM_BOX_SPEED &&
    predictedY >= GK_FEET_CLAIM_MAX_HEIGHT &&
    predictedY <= GK_REACH_HEIGHT + 0.28
  ) {
    return 'catch'
  }

  if (predictedY < 0.38) return 'parry'
  if (ballSpeed < 6.2 && predictedY < 0.48) return 'parry'
  if (close1v1 && predictedY < 0.5) return 'parry'

  const tooFast = ballSpeed > GK_CATCH_MAX_SPEED
  const overhead = predictedY > GK_REACH_HEIGHT + 0.22

  const highCatchBand =
    predictedY >= 0.95 && predictedY <= GK_REACH_HEIGHT + 0.16
  if (highCatchBand && distToGk < 3.6 && !overhead) {
    if (!tooFast) return 'catch'
    if (ballSpeed <= GK_CATCH_MAX_SPEED * 1.04 && distToGk < 3.0) return 'catch'
  }

  if (
    !tooFast &&
    !overhead &&
    predictedY >= 0.55 &&
    predictedY <= 1.75 &&
    distToGk < 3.6
  ) {
    return 'catch'
  }

  if (close1v1 && predictedY < 0.72) return 'parry'
  if (tooFast || overhead) return 'parry'

  return predictedY >= 0.55 ? 'catch' : 'parry'
}

type SaveDecision = {
  kind: GkSaveKind
  side: 'left' | 'right'
  anim: GoalkeeperAnim | null
  target: Vec3
  lateralError: number
  central: boolean
  commitLeadSec: number
}

function getSaveCommitLead(
  anim: GoalkeeperAnim | null,
  opts?: { lowBall?: boolean; shotDistance?: number },
): number {
  return getGkCommitWindow(anim, opts)
}

/**
 * Escolhe animação pela altura REAL prevista no plano do goleiro.
 * Bola rasteira/joelho → body_save (se joga). Nunca miss_middle / pulo nisso.
 */
function pickSaveAnim(
  kind: GkSaveKind,
  side: 'left' | 'right',
  predictedYAtGkLine: number,
  lateralError: number,
  _ballSpeed: number,
  _goalHeight: number,
  grounded = false,
): GoalkeeperAnim | null {
  if (kind === 'foot') return null

  const central = lateralError < GK_CENTRAL_ZONE
  const bodyL = side === 'left' ? 'gk_body_save_left' : 'gk_body_save_right'
  const diveL = side === 'left' ? 'gk_diving_save_left' : 'gk_diving_save_right'

  // Chão / baixa — SEMPRE se joga (anim que o user pediu)
  if (grounded || predictedYAtGkLine <= GK_BODY_SAVE_MAX_Y) {
    return bodyL
  }

  // Por cima do alcance de braço — só aí “miss” / travessão
  if (predictedYAtGkLine > GK_REACH_HEIGHT + 0.2) {
    return central ? 'gk_miss_middle' : diveL
  }

  // Peito / cabeça — catch no meio ou diving lateral
  if (central) {
    if (
      kind === 'catch' &&
      predictedYAtGkLine >= 0.95 &&
      predictedYAtGkLine <= GK_REACH_HEIGHT
    ) {
      return 'gk_catch'
    }
    if (predictedYAtGkLine >= GK_DIVING_MIN_Y) return diveL
    return bodyL
  }

  if (predictedYAtGkLine >= GK_DIVING_MIN_Y) return diveL
  return bodyL
}

function evaluateGkSave(
  gk: PlayerRef,
  ball: Vec3,
  vel: Vec3,
  bounds: FieldBounds,
  opts?: {
    force1v1?: boolean
    aim?: Vec3
    estimatedVel?: Vec3
    shotDistance?: number
  },
): SaveDecision {
  const meetZ = gk.position.z
  const shotVel = opts?.estimatedVel ?? vel
  const flight = predictBallFlight(ball, shotVel, meetZ, { maxTime: 3.6 })
  const lineFlight =
    flight ??
    predictBallFlight(ball, shotVel, gkLineZ(gk.team, bounds), { maxTime: 3.6 })
  const predicted = {
    x: opts?.aim?.x ?? lineFlight?.x ?? ball.x,
    y: lineFlight?.y ?? Math.min(ball.y, ballRestY(BALL_RADIUS) + 0.05),
    z: lineFlight?.z ?? meetZ,
  }
  const grounded =
    lineFlight?.grounded === true || predicted.y <= ballRestY(BALL_RADIUS) + 0.12
  const speed = Math.hypot(shotVel.x, shotVel.z)
  const dist = distance2D(gk.position, ball)
  const side = pickSaveSide(gk.position.x, predicted.x, shotVel.x)
  const kind = chooseSaveKind(
    predicted.y,
    speed,
    dist,
    opts?.force1v1 ?? false,
    grounded,
  )
  const lateralError = Math.abs(gk.position.x - predicted.x)
  const central = lateralError < GK_CENTRAL_ZONE
  const anim = pickSaveAnim(
    kind,
    side,
    predicted.y,
    lateralError,
    speed,
    bounds.goalHeight,
    grounded,
  )
  const lowBall = grounded || predicted.y < GK_MIDDLE_JUMP_MIN_Y
  return {
    kind,
    side,
    anim,
    target: { x: predicted.x, y: predicted.y, z: predicted.z },
    lateralError,
    central,
    commitLeadSec: getSaveCommitLead(anim, {
      lowBall,
      shotDistance: opts?.shotDistance ?? lineFlight?.t,
    }),
  }
}

function isEasyCatchShot(threat: ShotThreat, gk: PlayerRef): boolean {
  if (threat.interceptY < GK_FEET_CLAIM_MAX_HEIGHT) return false
  if (threat.interceptY > GK_REACH_HEIGHT - 0.1) return false

  const lateral = Math.abs(gk.position.x - threat.interceptX)
  const central = isCentralToGk(gk.position.x, threat.interceptX)

  if (central && threat.ballSpeed <= GK_CATCH_MAX_SPEED * 1.08) return true

  if (threat.ballSpeed > GK_CLAIM_BOX_SPEED) return false
  if (threat.urgency > 0.72) return false
  if (threat.interceptY >= 0.52 && lateral < GK_REACH_STANDING * getPlayerAttrMultipliers(gk.id).goalkeeping + 0.28)
    return true
  return lateral < GK_REACH_STANDING * getPlayerAttrMultipliers(gk.id).goalkeeping + 0.22
}

export function clampGkFacing(
  team: TeamId,
  bounds: FieldBounds,
  gkPos: Vec3,
  lookAt: Vec3,
): number {
  const base = getFieldFacingRotation(team, bounds)
  const toTarget = Math.atan2(lookAt.x - gkPos.x, lookAt.z - gkPos.z)
  let delta = toTarget - base
  while (delta > Math.PI) delta -= Math.PI * 2
  while (delta < -Math.PI) delta += Math.PI * 2
  delta = Math.max(-GK_FACING_CLAMP, Math.min(GK_FACING_CLAMP, delta))
  return base + delta
}

export function clampGkPosition(
  pos: Vec3,
  team: TeamId,
  bounds: FieldBounds,
  maxDepth = GK_MAX_STEP_FROM_LINE,
): { x: number; z: number } {
  const goalZ = getDefensiveGoalZ(team, bounds)
  const intoField = getAttackSign(team, bounds)
  const halfW = bounds.goalWidth / 2
  const x = Math.max(
    bounds.center.x - halfW * 0.92,
    Math.min(bounds.center.x + halfW * 0.92, pos.x),
  )
  const nearLine = goalZ + intoField * GK_MIN_FROM_LINE
  const farLine = goalZ + intoField * maxDepth
  const z =
    intoField > 0
      ? Math.max(nearLine, Math.min(farLine, pos.z))
      : Math.min(nearLine, Math.max(farLine, pos.z))
  return { x, z }
}

function gk1v1CoverPoint(
  team: TeamId,
  bounds: FieldBounds,
  ball: Vec3,
  baseX: number,
): { x: number; z: number } {
  const goalZ = getDefensiveGoalZ(team, bounds)
  const intoField = getAttackSign(team, bounds)
  const targetX = baseX * 0.32 + ball.x * 0.68
  const depth = GK_MIN_FROM_LINE + 0.78
  return clampGkPosition(
    { x: targetX, y: 0, z: goalZ + intoField * depth },
    team,
    bounds,
    GK_MAX_STEP_FROM_LINE,
  )
}

function findCloseAttacker(gk: PlayerRef, team: TeamId, bounds: FieldBounds): PlayerRef | null {
  const store = useGameStore.getState()
  const poss = store.ballPossession
  let best: PlayerRef | null = null
  let bestDist = Infinity

  for (const p of playerRegistry.values()) {
    if (p.team === team || p.role === 'gk') continue
    const d = distance2D(gk.position, p.position)
    if (d > GK_CLOSE_ATTACKER_DIST) continue
    if (!isInPenaltyArea(p.position, team, bounds)) continue

    const hasBall = poss?.playerId === p.id
    const nearBall = distance2D(p.position, ballRef.current) < 0.85
    if (!hasBall && !nearBall) continue

    if (d < bestDist) {
      bestDist = d
      best = p
    }
  }
  return best
}

function startGkSave(
  gkId: string,
  team: TeamId,
  bounds: FieldBounds,
  ball: Vec3,
  vel: Vec3,
  opts?: {
    allowStep?: boolean
    stepDepth?: number
    force1v1?: boolean
    aim?: Vec3
    estimatedVel?: Vec3
    shotDistance?: number
  },
) {
  const gk = playerRegistry.get(gkId)
  if (!gk) return

  const decision = evaluateGkSave(gk, ball, vel, bounds, {
    force1v1: opts?.force1v1,
    aim: opts?.aim,
    estimatedVel: opts?.estimatedVel,
    shotDistance: opts?.shotDistance,
  })
  const rt = gkRuntimes.get(gkId) ?? defaultRuntime()

  const goalZ = getDefensiveGoalZ(team, bounds)
  const intoField = getAttackSign(team, bounds)
  let meetX = opts?.aim?.x ?? decision.target.x
  let meetZ =
    opts?.aim?.z ??
    goalZ +
      intoField *
        gkMeetBallDepth(decision.target.y, Math.hypot(vel.x, vel.z) / SHOT_SPEED)

  if (isLowSaveHeight(decision.target.y)) {
    const cover = gkLowShotCoverPoint(team, bounds, meetX)
    meetX = cover.x
    meetZ = cover.z
  }

  rt.mode = 'save'
  rt.saveAnim = decision.anim
  rt.saveKind = decision.kind
  rt.saveSide = decision.side
  rt.interceptTarget = { x: meetX, z: meetZ }
  rt.handContactResolved = false
  // Avança até o ponto de contato — sem isso o GK só “desliza” no root motion
  const depthFromLine = Math.abs(meetZ - goalZ)
  rt.allowStep = decision.anim != null || decision.kind === 'foot' || !!opts?.force1v1
  rt.stepDepth = Math.min(
    GK_BODY_SAVE_STEP * 0.9,
    Math.max(
      opts?.stepDepth ?? GK_MAX_STEP_FROM_LINE,
      depthFromLine + 0.4,
      GK_MAX_STEP_FROM_LINE,
    ),
  )
  rt.saveLockedUntil = performance.now() + (decision.anim ? 980 : decision.kind === 'foot' ? 720 : 520)
  rt.lastSaveAt = performance.now()
  rt.faceAngle = clampGkFacing(team, bounds, gk.position, decision.target)
  rt.distributing = false

  gkRuntimes.set(gkId, rt)
}

export function applyGkFeetClaim(gkId: string, team: TeamId): boolean {
  const store = useGameStore.getState()
  if (!store.canPlayerClaimBall(gkId)) return false

  store.setPossession(gkId, team)
  store.setLastTouch(team)
  ballRef.velocity = { x: 0, y: 0, z: 0 }

  const rt = gkRuntimes.get(gkId) ?? defaultRuntime()
  rt.mode = 'idle'
  rt.saveAnim = null
  rt.saveKind = null
  rt.interceptTarget = null
  rt.holdUntil = 0
  rt.saveLockedUntil = 0
  rt.allowStep = false
  rt.handContactResolved = false
  rt.distributing = false
  gkRuntimes.set(gkId, rt)
  return true
}

export function applyGkCatch(
  gkId: string,
  team: TeamId,
  anchorMode: 'left' | 'right' | 'feet' | null = null,
) {
  if (anchorMode === 'feet') {
    applyGkFeetClaim(gkId, team)
    return
  }

  const store = useGameStore.getState()
  if (!store.canPlayerClaimBall(gkId)) return

  store.setPossession(gkId, team)
  store.setLastTouch(team)
  ballRef.velocity = { x: 0, y: 0, z: 0 }

  const gk = playerRegistry.get(gkId)
  if (gk) {
    const handAnchor = getGkCatchAnchor(
      gkId,
      anchorMode === 'left' ? 'left' : 'right',
    )
    if (handAnchor) {
      ballRef.current.x = handAnchor.x
      ballRef.current.y = handAnchor.y
      ballRef.current.z = handAnchor.z
    } else {
      ballRef.current.x = gk.position.x
      ballRef.current.y = 1.05
      ballRef.current.z = gk.position.z + 0.22
    }
  }

  const body = ballBodyRef.current as import('@react-three/rapier').RapierRigidBody | null
  if (body) {
    const p = ballRef.current
    body.setTranslation({ x: p.x, y: p.y, z: p.z }, true)
    body.setLinvel({ x: 0, y: 0, z: 0 }, true)
    body.setAngvel({ x: 0, y: 0, z: 0 }, true)
  }

  const rt = gkRuntimes.get(gkId) ?? defaultRuntime()
  rt.mode = 'hold'
  rt.saveAnim = null
  rt.saveKind = null
  rt.interceptTarget = null
  rt.holdUntil = performance.now() + GK_HOLD_MS
  rt.saveLockedUntil = 0
  rt.allowStep = false
  rt.handContactResolved = true
  gkRuntimes.set(gkId, rt)
}

function onSaveAnimFinished(gkId: string) {
  const rt = gkRuntimes.get(gkId)
  if (!rt || rt.mode !== 'save') return
  if (rt.handContactResolved) return

  rt.mode = 'idle'
  rt.saveAnim = null
  rt.saveKind = null
  rt.interceptTarget = null
  rt.saveLockedUntil = performance.now() + GK_SAVE_COOLDOWN_MS * 0.35
  rt.allowStep = false
  gkRuntimes.set(gkId, rt)
}

/** Espalma com física já resolvida pelo Rapier — só atualiza estado. */
export function resolveGkPhysicsParry(gkId: string, team: TeamId) {
  const store = useGameStore.getState()
  store.setLastTouch(team)

  const body = ballBodyRef.current as import('@react-three/rapier').RapierRigidBody | null
  if (body) {
    const t = body.translation()
    const v = body.linvel()
    ballRef.current = { x: t.x, y: t.y, z: t.z }
    ballRef.velocity = { x: v.x, y: v.y, z: v.z }
  }

  const rt = gkRuntimes.get(gkId) ?? defaultRuntime()
  rt.mode = 'idle'
  rt.saveAnim = null
  rt.saveKind = null
  rt.interceptTarget = null
  rt.handContactResolved = true
  rt.saveLockedUntil = performance.now() + GK_SAVE_COOLDOWN_MS
  rt.allowStep = false
  gkRuntimes.set(gkId, rt)
}

export function notifyGkSaveFinished(gkId: string) {
  onSaveAnimFinished(gkId)
}

export function shouldGkBlendToHold(gkId: string): boolean {
  const rt = gkRuntimes.get(gkId)
  return rt?.mode === 'hold'
}

/** Avalia ameaças e dispara animações — roda cedo no frame */
export function tickGoalkeeperDefense() {
  const store = useGameStore.getState()
  if (store.phase !== 'playing' || store.ballFrozen || !store.fieldBounds) return

  const bounds = store.fieldBounds
  const ball = ballRef.current
  const vel = ballRef.velocity
  const speed = Math.hypot(vel.x, vel.z)
  const now = performance.now()
  const poss = store.ballPossession

  for (const gk of playerRegistry.values()) {
    if (gk.role !== 'gk') continue
    const rt = gkRuntimes.get(gk.id) ?? defaultRuntime()
    gkRuntimes.set(gk.id, rt)

    // --- Failsafes: nada aqui deve travar o goleiro pra sempre --------------

    // Se o callback de fim de animação de defesa nunca chegou (bug de anim,
    // evento perdido etc.), força a volta pro idle depois de um tempo bem
    // maior que qualquer defesa real dura.
    if (rt.mode === 'save' && now - rt.lastSaveAt > GK_SAVE_FAILSAFE_MS) {
      onSaveAnimFinished(gk.id)
    }

    if (rt.mode === 'save' && !rt.saveAnim) {
      const elapsed = now - rt.lastSaveAt
      const threatNow =
        store.goalZones.length > 0
          ? assessShotThreat(ball, vel, bounds, store.goalZones)
          : null
      const stillThreat =
        threatNow &&
        threatNow.defendingTeam === gk.team &&
        threatNow.timeToGoal < 0.35
      if (elapsed > 520 && !stillThreat) {
        onSaveAnimFinished(gk.id)
      }
    }

    // Se ele não está mais de posse da bola mas ficou marcado como
    // 'hold'/'distribute' (por exemplo, perdeu a bola num desarme), esse
    // estado não faz mais sentido — solta o goleiro imediatamente.
    if ((rt.mode === 'hold' || rt.mode === 'distribute') && poss?.playerId !== gk.id) {
      rt.mode = 'idle'
      rt.distributing = false
      rt.holdUntil = 0
    } else if (
      rt.mode === 'distribute' &&
      now - rt.lastSaveAt > GK_DISTRIBUTE_FAILSAFE_MS
    ) {
      // Rede de segurança extra: distribuição que nunca terminou.
      finishGkDistribution(gk.id)
    }

    if (poss?.playerId === gk.id) {
      tickGkHoldAndRelease()
      continue
    }

    if (rt.mode === 'hold' || rt.mode === 'distribute') continue

    if (rt.mode === 'save') continue

    const lineZ = gkLineZ(gk.team, bounds)

    const ballThreat =
      store.goalZones.length > 0
        ? assessShotThreat(ball, vel, bounds, store.goalZones)
        : null
    const preShotThreat =
      store.goalZones.length > 0
        ? assessPreShotThreat(gk.team, bounds, store.goalZones, poss)
        : null
    const threatForTeamEarly = resolveGkThreat(gk.team, ballThreat, preShotThreat)

    if (isWeakLowBall(ball, vel) && isInPenaltyArea(ball, gk.team, bounds)) {
      const predicted = predictBallAtZ(ball, vel, lineZ)
      rt.interceptTarget = gkLowShotCoverPoint(
        gk.team,
        bounds,
        predicted?.x ?? ball.x,
      )
      rt.faceAngle = clampGkFacing(gk.team, bounds, gk.position, ball)
      continue
    }

    // Sempre atualiza pra onde o goleiro está olhando
    rt.faceAngle = clampGkFacing(gk.team, bounds, gk.position, predictBallAtZ(ball, vel, lineZ) ?? ball)

    const inCooldown = now - rt.lastSaveAt < GK_SAVE_COOLDOWN_MS

    if (inCooldown) {
      updateGkInterceptTarget(gk, bounds, ball, vel, rt, threatForTeamEarly)
      continue
    }

    // Antes: com adversário na bola e sem preShot o GK só “assistia”.
    // Agora sempre cobre ângulo; commit vem do threat/1v1 abaixo.

    const closeAtt = findCloseAttacker(gk, gk.team, bounds)
    if (closeAtt && poss?.playerId === closeAtt.id) {
      updateGkInterceptTarget(gk, bounds, ball, vel, rt, threatForTeamEarly)
      const baseCover = rt.interceptTarget ?? computeGkCoverPosition(gk.team, bounds, ball)
      rt.interceptTarget = gk1v1CoverPoint(
        gk.team,
        bounds,
        ball,
        baseCover.x,
      )
      rt.faceAngle = clampGkFacing(gk.team, bounds, gk.position, ball)

      const attDist = distance2D(gk.position, closeAtt.position)
      if (
        attDist < GK_CLOSE_ATTACKER_DIST * 0.95 &&
        speed > 1.4 &&
        !isWeakLowBall(ball, vel) &&
        speed > GK_CLAIM_BOX_SPEED * 0.82
      ) {
        startGkSave(gk.id, gk.team, bounds, ball, vel, {
          force1v1: true,
        })
      }
      continue
    }

    const threatForTeam = threatForTeamEarly

    const distToBall = distance2D(gk.position, ball)
    const easyCatch = threatForTeam ? isEasyCatchShot(threatForTeam, gk) : false

    if (
      threatForTeam &&
      threatForTeam.urgency >=
        (threatForTeam.preShot && !threatForTeam.preShotImminent
          ? 0.22
          : threatForTeam.preShot
            ? 0.12
            : 0.18) &&
      threatForTeam.ballSpeed >= (threatForTeam.preShot ? 1.1 : 2.2)
    ) {
      const aimX = threatForTeam.interceptX
      const lateralError = Math.abs(gk.position.x - aimX)
      const centralShot = isCentralToGk(gk.position.x, aimX)

      let estimatedVel: Vec3 | undefined
      if (threatForTeam.preShot && poss) {
        const shooter = playerRegistry.get(poss.playerId)
        if (shooter) {
          const storeNow = useGameStore.getState()
          const aim =
            storeNow.strikeAim && storeNow.ballPossession?.playerId === shooter.id
              ? storeNow.strikeAim
              : null
          let dirX = Math.sin(shooter.rotation)
          let dirZ = Math.cos(shooter.rotation)
          if (aim && Math.hypot(aim.dirX, aim.dirZ) > 0.18) {
            dirX = aim.dirX
            dirZ = aim.dirZ
          }
          const power =
            aim && aim.power > 0.12
              ? aim.power
              : storeNow.shotChargePower > 0.12
                ? storeNow.shotChargePower
                : 0.68
          estimatedVel = estimateShotVelocity(dirX, dirZ, power)
        }
      }

      const previewPlan = evaluateGkSave(gk, ball, vel, bounds, {
        aim: { x: aimX, y: 0, z: lineZ },
        estimatedVel,
        shotDistance: threatForTeam.shotDistance,
      })

      refreshGkThreatJitter(rt, threatForTeam)

      const lowShot = isLowBallThreat(threatForTeam)
      const threatDepth = lowShot
        ? GK_MIN_FROM_LINE + 0.26
        : centralShot && threatForTeam.timeToGoal < 1.5
          ? GK_MIN_FROM_LINE + 0.38
          : threatForTeam.urgency > 0.52
            ? Math.min(GK_BODY_SAVE_STEP * 0.72, GK_MAX_STEP_FROM_LINE * 1.02)
            : GK_MAX_STEP_FROM_LINE * 0.78

      rt.interceptTarget = lowShot
        ? gkLowShotCoverPoint(gk.team, bounds, aimX, threatDepth)
        : gkThreatPosition(
            gk.team,
            bounds,
            threatForTeam,
            threatDepth,
            gk.position.x,
          )

      const inReach =
        minGkHandDist(gk.id, ball) < GK_HAND_RADIUS + BALL_RADIUS + 0.35

      const shouldCommit = shouldCommitGkSave(
        threatForTeam,
        previewPlan,
        inReach,
        lateralError,
        distToBall,
        centralShot,
        easyCatch,
        rt.commitJitter,
      )

      if (shouldCommit) {
        const saveVel = estimatedVel ?? vel
        if (lowShot) {
          const cover = gkLowShotCoverPoint(gk.team, bounds, aimX, threatDepth)
          startGkSave(gk.id, gk.team, bounds, ball, saveVel, {
            aim: { x: cover.x, y: previewPlan.target.y, z: cover.z },
            estimatedVel,
            shotDistance: threatForTeam.shotDistance,
          })
        } else {
          const sweep = gkThreatSweepDepth(
            threatForTeam,
            threatDepth,
            gk.position.x,
          )
          const goalZ = getDefensiveGoalZ(gk.team, bounds)
          const intoField = getAttackSign(gk.team, bounds)
          startGkSave(gk.id, gk.team, bounds, ball, saveVel, {
            aim: { x: aimX, y: previewPlan.target.y, z: goalZ + intoField * sweep },
            estimatedVel,
            shotDistance: threatForTeam.shotDistance,
          })
        }
      }
      continue
    }

    updateGkInterceptTarget(gk, bounds, ball, vel, rt, threatForTeamEarly)
  }
}

/** Bola solta baixa na área — goleiro domina com os pés (como jogador de linha). */
export function tryGkFeetClaim(): boolean {
  const store = useGameStore.getState()
  if (!store.fieldBounds || store.ballPossession) return false

  const ball = ballRef.current
  const vel = ballRef.velocity
  if (!isWeakLowBall(ball, vel)) return false

  let best: PlayerRef | null = null
  let bestDist = Infinity

  for (const gk of playerRegistry.values()) {
    if (gk.role !== 'gk') continue
    const rt = gkRuntimes.get(gk.id)
    if (rt?.mode === 'save' || rt?.mode === 'hold' || rt?.mode === 'distribute') continue
    if (!isInPenaltyArea(ball, gk.team, store.fieldBounds)) continue
    if (!store.canPlayerClaimBall(gk.id)) continue

    const d = distance2D(gk.position, ball)
    if (d >= CLAIM_DISTANCE || d >= bestDist) continue
    bestDist = d
    best = gk
  }

  if (!best) return false
  return applyGkFeetClaim(best.id, best.team)
}

/** Catch de segurança — bola lenta perto das mãos (evita passar pelo corpo) */
export function tryGkEasyCatch(): boolean {
  const store = useGameStore.getState()
  if (!store.fieldBounds || store.ballPossession) return false

  const ball = ballRef.current
  const vel = ballRef.velocity
  const speed = Math.hypot(vel.x, vel.y, vel.z)
  if (speed > GK_CLAIM_BOX_SPEED * 0.92) return false
  if (ball.y < GK_FEET_CLAIM_MAX_HEIGHT * 0.85) return false
  if (ball.y > GK_REACH_HEIGHT + 0.15) return false

  let best: PlayerRef | null = null
  let bestDist = Infinity

  for (const gk of playerRegistry.values()) {
    if (gk.role !== 'gk') continue
    const rt = gkRuntimes.get(gk.id)
    if (rt?.mode === 'hold' || rt?.mode === 'distribute') continue
    if (!isInPenaltyArea(ball, gk.team, store.fieldBounds)) continue
    if (!store.canPlayerClaimBall(gk.id)) continue

    const handDist = minGkHandDist(gk.id, ball)
    if (handDist > GK_HAND_RADIUS + BALL_RADIUS + 0.28) continue
    if (handDist >= bestDist) continue
    bestDist = handDist
    best = gk
  }

  if (!best) return false
  applyGkCatch(best.id, best.team, null)
  return true
}

function tickGkHoldAndRelease() {
  const store = useGameStore.getState()
  const poss = store.ballPossession
  if (!poss) return

  const gk = playerRegistry.get(poss.playerId)
  if (!gk || gk.role !== 'gk') return

  const rt = gkRuntimes.get(gk.id) ?? defaultRuntime()
  gkRuntimes.set(gk.id, rt)

  if (rt.mode !== 'hold' && rt.mode !== 'distribute') {
    rt.mode = 'hold'
    rt.holdUntil = performance.now() + GK_HOLD_MS
  }

  const now = performance.now()
  if (now < rt.holdUntil) return
  if (rt.distributing) return

  rt.distributing = true
  rt.mode = 'distribute'
  rt.lastSaveAt = now
  rt.saveLockedUntil = now + GK_DISTRIBUTE_DELAY_MS + 600
}

export function tryGoalkeeperRelease(gkId: string): boolean {
  const rt = gkRuntimes.get(gkId)
  return !!(rt && rt.mode === 'distribute' && rt.distributing)
}

export function finishGkDistribution(gkId: string) {
  const rt = gkRuntimes.get(gkId) ?? defaultRuntime()
  rt.mode = 'idle'
  rt.distributing = false
  rt.saveAnim = null
  rt.holdUntil = 0
  rt.saveLockedUntil = performance.now() + 400
  gkRuntimes.set(gkId, rt)
}

export function getThreatAwareGkPosition(
  gkPos: Vec3,
  threat: ShotThreat,
  bounds: FieldBounds,
  team: TeamId,
  ball: Vec3,
): { x: number; z: number } {
  const central = isCentralToGk(gkPos.x, threat.interceptX)
  const maxDepth =
    central && threat.timeToGoal < 1.4
      ? GK_MIN_FROM_LINE + 0.3
      : threat.urgency > 0.5
        ? Math.min(GK_BODY_SAVE_STEP * 0.7, GK_MAX_STEP_FROM_LINE)
        : GK_MAX_STEP_FROM_LINE * 0.8
  if (threat.defendingTeam === team) {
    return gkThreatPosition(team, bounds, threat, maxDepth, gkPos.x)
  }
  return computeGkCoverPosition(team, bounds, ball, maxDepth)
}

/**
 * Posicionamento estilo FIFA/PES: cobre o ângulo da bola ao gol,
 * avança da linha quando a ameaça está perto e desliza lateralmente.
 */
export function computeGkCoverPosition(
  team: TeamId,
  bounds: FieldBounds,
  ball: Vec3,
  maxDepth = GK_MAX_STEP_FROM_LINE,
): { x: number; z: number } {
  const goalZ = getDefensiveGoalZ(team, bounds)
  const intoField = getAttackSign(team, bounds)
  const goalX = bounds.center.x
  const halfW = bounds.goalWidth / 2

  const relX = ball.x - goalX
  const relZ = (ball.z - goalZ) * intoField
  const angle = Math.atan2(relX, Math.max(relZ, 0.55))

  const lateralReach = halfW * 0.92
  const lateralPull = Math.min(lateralReach, Math.abs(relX) * 0.68 + 0.32)
  const targetX = goalX + Math.sin(angle) * lateralPull
  const ballCentral = Math.abs(relX) < halfW * 0.3
  const ballLow = ball.y < GK_FEET_CLAIM_MAX_HEIGHT + 0.5

  const minDepth = GK_MIN_FROM_LINE
  let depth = minDepth + 0.48
  if (ballLow) {
    depth = minDepth + 0.24
  } else if (relZ < 5 && ballCentral) {
    depth = minDepth + 0.18
  } else if (relZ < 8 && ballCentral) {
    depth = minDepth + 0.28
  } else if (relZ < 7) {
    depth = minDepth + 0.68 + (7 - relZ) * 0.09
  } else if (relZ < 14) {
    depth = minDepth + 0.72 + (14 - relZ) * 0.04
  } else if (relZ < 24) {
    depth = minDepth + 0.52 + (24 - relZ) * 0.014
  } else if (relZ > 34) {
    depth = minDepth + 0.42
  }

  if (isInPenaltyArea(ball, team, bounds) && !ballCentral) {
    depth = Math.max(depth, minDepth + 0.68 + Math.max(0, 9 - relZ) * 0.065)
  } else if (relZ < 18 && !ballLow) {
    depth = Math.max(depth, minDepth + 0.58 + (18 - relZ) * 0.028)
  }

  depth = Math.min(depth, maxDepth)
  const targetZ = goalZ + intoField * depth
  return clampGkPosition({ x: targetX, y: 0, z: targetZ }, team, bounds, maxDepth)
}

function updateGkInterceptTarget(
  gk: PlayerRef,
  bounds: FieldBounds,
  ball: Vec3,
  vel: Vec3,
  rt: GkRuntime,
  threat: ShotThreat | null,
) {
  const lineZ = gkLineZ(gk.team, bounds)
  const maxDepth =
    threat && threat.urgency > 0.55
      ? Math.min(GK_BODY_SAVE_STEP * 0.7, GK_MAX_STEP_FROM_LINE)
      : GK_MAX_STEP_FROM_LINE * 0.82

  if (threat && threat.defendingTeam === gk.team) {
    if (isLowBallThreat(threat)) {
      rt.interceptTarget = gkLowShotCoverPoint(
        gk.team,
        bounds,
        threat.interceptX,
        maxDepth,
      )
    } else {
      rt.interceptTarget = gkThreatPosition(
        gk.team,
        bounds,
        threat,
        maxDepth,
        gk.position.x,
      )
    }
    return
  }

  const predicted = predictBallAtZ(ball, vel, lineZ)
  if (predicted && isInPenaltyArea(ball, gk.team, bounds)) {
    if (predicted.y < GK_MIDDLE_JUMP_MIN_Y) {
      rt.interceptTarget = gkLowShotCoverPoint(gk.team, bounds, predicted.x, maxDepth)
      return
    }
    const goalZ = getDefensiveGoalZ(gk.team, bounds)
    const intoField = getAttackSign(gk.team, bounds)
    const boxSweep = gkMeetBallDepth(predicted.y, 0.55)
    rt.interceptTarget = clampGkPosition(
      { x: predicted.x, y: 0, z: goalZ + intoField * boxSweep },
      gk.team,
      bounds,
      maxDepth,
    )
    return
  }

  rt.interceptTarget = computeGkCoverPosition(gk.team, bounds, ball, maxDepth)
}

export function getGkPositionTarget(
  gkId: string,
  team: TeamId,
  bounds: FieldBounds,
  ball: Vec3,
  vel: Vec3,
): { x: number; z: number } | null {
  const rt = gkRuntimes.get(gkId)
  if (rt?.interceptTarget) return rt.interceptTarget

  const store = useGameStore.getState()
  const threat =
    store.goalZones.length > 0
      ? assessShotThreat(ball, vel, bounds, store.goalZones)
      : null
  const lineZ = gkLineZ(team, bounds)

  if (threat && threat.defendingTeam === team) {
    if (isLowBallThreat(threat)) {
      return gkLowShotCoverPoint(
        team,
        bounds,
        threat.interceptX,
        GK_MAX_STEP_FROM_LINE * 0.82,
      )
    }
    const gk = playerRegistry.get(gkId)
    return gkThreatPosition(
      team,
      bounds,
      threat,
      GK_MAX_STEP_FROM_LINE * 0.82,
      gk?.position.x,
    )
  }

  if (isInPenaltyArea(ball, team, bounds)) {
    const predicted = predictBallAtZ(ball, vel, lineZ)
    if (predicted) {
      if (predicted.y < GK_MIDDLE_JUMP_MIN_Y) {
        return gkLowShotCoverPoint(team, bounds, predicted.x)
      }
      const goalZ = getDefensiveGoalZ(team, bounds)
      const intoField = getAttackSign(team, bounds)
      const boxSweep = gkMeetBallDepth(predicted.y, Math.hypot(vel.x, vel.z) / SHOT_SPEED)
      return clampGkPosition(
        { x: predicted.x, y: 0, z: goalZ + intoField * boxSweep },
        team,
        bounds,
      )
    }
  }

  return computeGkCoverPosition(team, bounds, ball)
}

export function getGkMoveTarget(
  gkId: string,
  team: TeamId,
  bounds: FieldBounds,
  _ball: Vec3,
): { x: number; z: number } | null {
  const rt = gkRuntimes.get(gkId)
  if (!rt?.allowStep || rt.mode !== 'save') return null

  if (rt.interceptTarget) {
    return clampGkPosition(
      { x: rt.interceptTarget.x, y: 0, z: rt.interceptTarget.z },
      team,
      bounds,
      rt.stepDepth,
    )
  }

  const gk = playerRegistry.get(gkId)
  if (!gk) return null

  const intoField = getAttackSign(team, bounds)
  const goalZ = getDefensiveGoalZ(team, bounds)
  const tz = goalZ + intoField * Math.min(rt.stepDepth, GK_BODY_SAVE_STEP)
  return clampGkPosition({ x: gk.position.x, y: 0, z: tz }, team, bounds, rt.stepDepth)
}