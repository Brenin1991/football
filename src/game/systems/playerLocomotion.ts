import * as THREE from 'three'
import { rotateTowardAngle } from './rules'
import type { PlayerLocoAnim } from '../types'

/** Off-ball: ágil pra receber, marcar, virar 180° */
export const PLAYER_MOVE_ACCEL = 20.4
/** IA: mais inércia — vira/freia como stick, sem “teleporte” de direção */
export const PLAYER_MOVE_ACCEL_AI = 13.2
/** Freio off-ball — 0 faz patinar; snappy precisa de rate > 0 */
export const PLAYER_MOVE_DECEL = 0.4
export const PLAYER_MOVE_DECEL_AI = 3.4
export const PLAYER_DIR_SMOOTH_CONTROLLED = 23.4
/** Suaviza intenção tática da IA (evita cortes secos) */
export const PLAYER_DIR_SMOOTH_AI = 11.2
export const PLAYER_DIR_SMOOTH_AI_PRESS = 9.2
export const PLAYER_DIR_SMOOTH_AI_DIRECT = 14.5
export const PLAYER_BALL_FOCUS_TURN = 50.5

/** Domínio previsível: stick responde; freio curto (menos “solto”) */
export const PLAYER_MOVE_ACCEL_DRIBBLE = 14.5
export const PLAYER_MOVE_DECEL_DRIBBLE = 5.2
export const PLAYER_DIR_SMOOTH_DRIBBLE = 16.5
/** IA com bola: um pouco mais filtrada que o stick do usuário */
export const PLAYER_DIR_SMOOTH_DRIBBLE_AI = 11.8

const VEL_YAW_RATE_ACCEL = 10.5
const VEL_YAW_RATE_COAST = 7.2
const PLANT_TURN_RAD = 1.85

function angleDelta(a: number, b: number): number {
  let d = a - b
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return d
}

function lerpAngle(a: number, b: number, t: number): number {
  return a + angleDelta(b, a) * t
}

export function smoothDirection2D(
  current: { x: number; z: number },
  targetX: number,
  targetZ: number,
  smoothSpeed: number,
  delta: number,
): { x: number; z: number } {
  const len = Math.hypot(targetX, targetZ)
  const blend = 1 - Math.exp(-smoothSpeed * delta)

  if (len < 0.02) {
    return {
      x: current.x * (1 - blend),
      z: current.z * (1 - blend),
    }
  }

  const tx = targetX / len
  const tz = targetZ / len
  let x = current.x + (tx - current.x) * blend
  let z = current.z + (tz - current.z) * blend
  const smLen = Math.hypot(x, z)
  if (smLen > 0.001) {
    x /= smLen
    z /= smLen
  }
  return { x, z }
}

/** Off-ball — pivot rápido, freio lateral em virada (evita órbita / patinação). */
function smoothVelocitySnappy(
  current: { x: number; z: number },
  targetX: number,
  targetZ: number,
  delta: number,
  accelerating: boolean,
  decelRate: number,
  accelRate: number,
): { x: number; z: number } {
  const curSpeed = Math.hypot(current.x, current.z)
  const targetSpeed = Math.hypot(targetX, targetZ)

  // Nunca rate 0 — senão a velocidade congela e vira skate no gramado
  let rate = accelerating
    ? Math.max(accelRate, 0.01)
    : Math.max(decelRate, accelRate * 0.42, 0.01)
  if (curSpeed > 0.18 && targetSpeed > 0.03) {
    const curYaw = Math.atan2(current.x, current.z)
    const tgtYaw = Math.atan2(targetX, targetZ)
    const turn = Math.abs(angleDelta(tgtYaw, curYaw))
    if (turn > 0.45) {
      const redirect = THREE.MathUtils.clamp(turn / Math.PI, 0.2, 1)
      const brake = Math.max(decelRate, accelRate * 0.75)
      rate = Math.max(rate, brake * (1.35 + redirect * 2.1))
    }
  }

  const blend = 1 - Math.exp(-rate * delta)
  const x = current.x + (targetX - current.x) * blend
  const z = current.z + (targetZ - current.z) * blend

  const nextSpeed = Math.hypot(x, z)
  if (targetSpeed < 0.03 && nextSpeed < 0.07) {
    return { x: 0, z: 0 }
  }
  return { x, z }
}

/** Domínio — curva o momentum (peso FIFA). */
function smoothVelocityWeighted(
  current: { x: number; z: number },
  targetX: number,
  targetZ: number,
  delta: number,
  accelerating: boolean,
  decelRate: number,
  accelRate: number,
): { x: number; z: number } {
  const curSpeed = Math.hypot(current.x, current.z)
  const targetSpeed = Math.hypot(targetX, targetZ)
  const dt = Math.min(delta, 0.05)

  if (targetSpeed < 0.03) {
    const blend = 1 - Math.exp(-decelRate * 0.92 * dt)
    const x = current.x * (1 - blend)
    const z = current.z * (1 - blend)
    if (Math.hypot(x, z) < 0.055) return { x: 0, z: 0 }
    return { x, z }
  }

  const tgtDirX = targetX / targetSpeed
  const tgtDirZ = targetZ / targetSpeed
  const desiredSpeed = targetSpeed

  if (curSpeed < 0.14) {
    const blend = 1 - Math.exp(-accelRate * 1.05 * dt)
    return {
      x: current.x + (tgtDirX * desiredSpeed - current.x) * blend,
      z: current.z + (tgtDirZ * desiredSpeed - current.z) * blend,
    }
  }

  const curYaw = Math.atan2(current.x, current.z)
  const tgtYaw = Math.atan2(tgtDirX, tgtDirZ)
  const turn = angleDelta(tgtYaw, curYaw)
  const turnAbs = Math.abs(turn)

  const speedNorm = THREE.MathUtils.clamp(
    curSpeed / Math.max(desiredSpeed, 0.01),
    0.35,
    1.35,
  )
  // PES close control: trote vira rápido; sprint carrega mais inércia
  const closeControlBoost = THREE.MathUtils.clamp(1.55 - speedNorm * 0.7, 0.85, 1.55)
  let yawRate =
    ((accelerating ? VEL_YAW_RATE_ACCEL : VEL_YAW_RATE_COAST) * closeControlBoost) /
    (0.48 + speedNorm * 0.62)

  let speed = curSpeed
  if (turnAbs > PLANT_TURN_RAD) {
    speed *= Math.exp(-2.15 * dt)
    yawRate *= 1.7
  } else if (turnAbs > 0.85) {
    speed *= Math.exp(-0.42 * turnAbs * dt)
    yawRate *= 1.22
  }

  const maxStep = yawRate * dt
  const step = THREE.MathUtils.clamp(turn, -maxStep, maxStep)
  const newYaw = curYaw + step
  const newDirX = Math.sin(newYaw)
  const newDirZ = Math.cos(newYaw)

  const speedingUp = speed < desiredSpeed - 0.02
  const rate = speedingUp ? accelRate : decelRate * 0.88
  const blend = 1 - Math.exp(-rate * dt)
  speed = speed + (desiredSpeed - speed) * blend

  return { x: newDirX * speed, z: newDirZ * speed }
}

/**
 * @param weighted true = domínio (inércia); false = off-ball (pivô / 180° rápido)
 */
export function smoothVelocity2D(
  current: { x: number; z: number },
  targetX: number,
  targetZ: number,
  delta: number,
  accelerating: boolean,
  decelRate = PLAYER_MOVE_DECEL,
  accelRate = PLAYER_MOVE_ACCEL,
  weighted = false,
): { x: number; z: number } {
  if (weighted) {
    return smoothVelocityWeighted(
      current,
      targetX,
      targetZ,
      delta,
      accelerating,
      decelRate,
      accelRate,
    )
  }
  return smoothVelocitySnappy(
    current,
    targetX,
    targetZ,
    delta,
    accelerating,
    decelRate,
    accelRate,
  )
}

export function scaleTurnSpeedByMomentum(
  baseTurnSpeed: number,
  currentSpeed: number,
  maxSpeed: number,
  controlled = false,
  weighted = false,
): number {
  const ratio = THREE.MathUtils.clamp(currentSpeed / Math.max(maxSpeed, 0.01), 0, 1)
  if (!weighted) {
    if (ratio < 0.2) return baseTurnSpeed * (controlled ? 1.55 : 1.4)
    if (ratio < 0.45) return baseTurnSpeed * (controlled ? 1.15 : 1.05)
    const damp = controlled ? 0.28 : 0.32
    return baseTurnSpeed * Math.max(0.62, 1 - ratio * damp)
  }
  // Domínio: ágil no close control, pesado no sprint
  if (ratio < 0.22) return baseTurnSpeed * (controlled ? 1.65 : 1.4)
  if (ratio < 0.45) return baseTurnSpeed * (controlled ? 1.22 : 1.08)
  const damp = controlled ? 0.48 : 0.4
  return baseTurnSpeed * Math.max(0.38, 1 - ratio * damp)
}

/**
 * @param weighted domínio = mistura vel/intent; off-ball = pivô pra intenção no 180°
 */
export function facingFromMovement(
  velX: number,
  velZ: number,
  intentX: number,
  intentZ: number,
  currentFacing: number,
  weighted = false,
): number {
  const moveSpeed = Math.hypot(velX, velZ)
  const intentLen = Math.hypot(intentX, intentZ)

  if (intentLen > 0.02) {
    const intentYaw = Math.atan2(intentX / intentLen, intentZ / intentLen)
    if (moveSpeed > (weighted ? 0.5 : 0.55)) {
      const velYaw = Math.atan2(velX, velZ)
      const turn = Math.abs(angleDelta(intentYaw, velYaw))
      if (!weighted) {
        if (turn > 0.5) return intentYaw
        return velYaw
      }
      if (turn < 0.28) return velYaw
      const intentPull = THREE.MathUtils.clamp(
        0.28 + (1 - turn / Math.PI) * 0.42,
        0.22,
        0.62,
      )
      return lerpAngle(velYaw, intentYaw, intentPull)
    }
    return intentYaw
  }

  if (moveSpeed > (weighted ? 0.42 : 0.48)) {
    return Math.atan2(velX, velZ)
  }
  return currentFacing
}

export function applyPlayerFacing(
  currentFacing: number,
  targetFacing: number,
  baseTurnSpeed: number,
  currentSpeed: number,
  maxSpeed: number,
  controlled: boolean,
  delta: number,
  weighted = false,
): number {
  const turnAbs = Math.abs(angleDelta(targetFacing, currentFacing))
  let boost = 1
  if (!weighted) {
    if (currentSpeed < maxSpeed * 0.28 && turnAbs > 0.9) {
      boost = controlled ? 1.65 : 1.45
    } else if (currentSpeed < maxSpeed * 0.45 && turnAbs > 1.4) {
      boost = controlled ? 1.4 : 1.25
    }
  } else if (currentSpeed < maxSpeed * 0.22 && turnAbs > 0.95) {
    boost = controlled ? 1.48 : 1.32
  } else if (currentSpeed < maxSpeed * 0.4 && turnAbs > 1.45) {
    boost = controlled ? 1.22 : 1.12
  }
  const turnSpeed =
    scaleTurnSpeedByMomentum(
      baseTurnSpeed,
      currentSpeed,
      maxSpeed,
      controlled,
      weighted,
    ) * boost
  return rotateTowardAngle(currentFacing, targetFacing, turnSpeed, delta)
}

export function getBallFocusFacing(
  pos: { x: number; z: number },
  ball: { x: number; z: number },
  currentFacing = 0,
  minDist = 0.45,
): number {
  const dx = ball.x - pos.x
  const dz = ball.z - pos.z
  if (Math.hypot(dx, dz) < minDist) return currentFacing
  return Math.atan2(dx, dz)
}

/**
 * Planta o pé quando o peito precisa virar pra bola —
 * mata o “giro deslizando” (skate) no gramado.
 */
export function plantVelocityForYawError(
  vel: { x: number; z: number },
  yawErrorAbs: number,
  delta: number,
): { x: number; z: number } {
  if (yawErrorAbs < 0.32) return vel
  // Virada média: freio forte; quase 180°: para no eixo e gira
  const rate =
    yawErrorAbs > 1.25
      ? 32
      : yawErrorAbs > 0.75
        ? 18 + yawErrorAbs * 10
        : 11 + yawErrorAbs * 8
  const blend = 1 - Math.exp(-rate * Math.min(delta, 0.05))
  const x = vel.x * (1 - blend)
  const z = vel.z * (1 - blend)
  if (yawErrorAbs > 1.15) return { x: 0, z: 0 }
  if (yawErrorAbs > 0.7 && Math.hypot(x, z) < 0.28) return { x: 0, z: 0 }
  return { x, z }
}

export function worldToLocalMovement(
  moveX: number,
  moveZ: number,
  facingY: number,
): { localForward: number; localRight: number } {
  const len = Math.hypot(moveX, moveZ)
  if (len < 0.02) return { localForward: 0, localRight: 0 }
  const wx = moveX / len
  const wz = moveZ / len
  const sin = Math.sin(facingY)
  const cos = Math.cos(facingY)
  return {
    localForward: wx * sin + wz * cos,
    localRight: wx * cos - wz * sin,
  }
}

export function resolveStrafeLocoClip(
  localForward: number,
  localRight: number,
  sprint: boolean,
): PlayerLocoAnim {
  const mag = Math.hypot(localForward, localRight)
  if (mag < 0.1) return 'player_idle'

  const nf = localForward / mag
  const nr = localRight / mag
  const absF = Math.abs(nf)
  const absR = Math.abs(nr)

  // Sprint só pra frente — de costas/lado nunca usa run
  if (sprint && nf > 0.35) return 'player_run'

  if (nf < -0.22 && absF >= absR * 0.75) return 'player_backward'
  if (absR > 0.42 && absR >= absF * 0.85) return nr < 0 ? 'player_left' : 'player_right'
  if (nf < -0.12) return 'player_backward'

  return 'player_walking'
}

export function resolveDirectLocoClip(moving: boolean, sprint: boolean): PlayerLocoAnim {
  if (!moving) return 'player_idle'
  return sprint ? 'player_run' : 'player_walking'
}
