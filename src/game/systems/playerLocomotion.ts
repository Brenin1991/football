import * as THREE from 'three'
import { rotateTowardAngle } from './rules'
import type { PlayerLocoAnim } from '../types'

/** Off-ball: ágil pra receber, marcar, virar 180° */
export const PLAYER_MOVE_ACCEL = 26.5
/** IA: responsiva sem teleporte — antes ficava “travada” */
export const PLAYER_MOVE_ACCEL_AI = 21.5
/** Freio off-ball — suave o bastante pra não engessar a passada */
export const PLAYER_MOVE_DECEL = 4.2
export const PLAYER_MOVE_DECEL_AI = 5.0
export const PLAYER_DIR_SMOOTH_CONTROLLED = 28
/** Suaviza intenção tática da IA (evita cortes secos) */
export const PLAYER_DIR_SMOOTH_AI = 24
export const PLAYER_DIR_SMOOTH_AI_PRESS = 18
export const PLAYER_DIR_SMOOTH_AI_DIRECT = 21
export const PLAYER_BALL_FOCUS_TURN = 50.5

/** Domínio: stick responde, freio curto, sem órbita no gramado */
export const PLAYER_MOVE_ACCEL_DRIBBLE = 17.5
export const PLAYER_MOVE_DECEL_DRIBBLE = 5.8
export const PLAYER_DIR_SMOOTH_DRIBBLE = 19
/** IA com bola: bem mais baixo — preserva meia-lua do stick virtual */
export const PLAYER_DIR_SMOOTH_DRIBBLE_AI = 100.5

/** Giro do momentum no domínio (rad/s) — trote ágil, sprint carrega */
const VEL_YAW_RATE_JOG = 5.4
const VEL_YAW_RATE_SPRINT = 2.85
const VEL_YAW_RATE_COAST = 3.2
/** Acima disso: planta e reconstrói (evita arco de 180°) */
const PLANT_TURN_RAD = 1.35
/** Ângulo em que começa a matar o deslize lateral */
const SLIP_TURN_RAD = 0.48

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
    // Freio só em virada fechada — correção leve não trava a passada
    if (turn > 0.7) {
      const redirect = THREE.MathUtils.clamp(turn / Math.PI, 0.25, 1)
      const brake = Math.max(decelRate, accelRate * 0.55)
      rate = Math.max(rate, brake * (0.75 + redirect * 1.15))
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

/**
 * Domínio — peso FIFA/PES sem órbita:
 * gira o momentum, mata deslize lateral e planta em reversão.
 */
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
    const blend = 1 - Math.exp(-decelRate * 1.15 * dt)
    const x = current.x * (1 - blend)
    const z = current.z * (1 - blend)
    if (Math.hypot(x, z) < 0.05) return { x: 0, z: 0 }
    return { x, z }
  }

  const tgtDirX = targetX / targetSpeed
  const tgtDirZ = targetZ / targetSpeed
  const desiredSpeed = targetSpeed

  // Partida / quase parado: vai direto pro stick (close control)
  if (curSpeed < 0.16) {
    const blend = 1 - Math.exp(-accelRate * 1.25 * dt)
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
    0.3,
    1.4,
  )
  const sprintish = speedNorm > 0.85
  const baseYaw = accelerating
    ? sprintish
      ? VEL_YAW_RATE_SPRINT
      : VEL_YAW_RATE_JOG
    : VEL_YAW_RATE_COAST
  // Close control: trote vira; sprint carrega inércia
  const closeControlBoost = THREE.MathUtils.clamp(1.65 - speedNorm * 0.85, 0.72, 1.65)
  let yawRate = (baseYaw * closeControlBoost) / (0.42 + speedNorm * 0.7)

  let speed = curSpeed

  // Reversão: planta e reconstrói — NÃO faz arco de 180° no gramado
  if (turnAbs > PLANT_TURN_RAD) {
    const plant = 1 - Math.exp(-(4.8 + turnAbs * 2.2) * dt)
    speed *= 1 - plant
    if (speed < desiredSpeed * 0.32) {
      const rebuild = 1 - Math.exp(-accelRate * 1.35 * dt)
      return {
        x: current.x * (1 - rebuild) + tgtDirX * desiredSpeed * rebuild,
        z: current.z * (1 - rebuild) + tgtDirZ * desiredSpeed * rebuild,
      }
    }
    yawRate *= 2.05
  } else if (turnAbs > 0.7) {
    speed *= Math.exp(-0.55 * turnAbs * dt)
    yawRate *= 1.18
  }

  const maxStep = yawRate * dt
  const step = THREE.MathUtils.clamp(turn, -maxStep, maxStep)
  const newYaw = curYaw + step
  let newDirX = Math.sin(newYaw)
  let newDirZ = Math.cos(newYaw)

  // Mistura leve com a direção do stick — corta órbita pura
  if (turnAbs > 0.2 && turnAbs < PLANT_TURN_RAD) {
    const pull = THREE.MathUtils.clamp(0.12 + turnAbs * 0.22, 0.12, 0.42)
    const pullBlend = 1 - Math.exp(-pull * 14 * dt)
    newDirX += (tgtDirX - newDirX) * pullBlend
    newDirZ += (tgtDirZ - newDirZ) * pullBlend
    const nLen = Math.hypot(newDirX, newDirZ)
    if (nLen > 0.001) {
      newDirX /= nLen
      newDirZ /= nLen
    }
  }

  const speedingUp = speed < desiredSpeed - 0.02
  const rate = speedingUp ? accelRate : decelRate * 1.05
  const blend = 1 - Math.exp(-rate * dt)
  speed = speed + (desiredSpeed - speed) * blend

  let vx = newDirX * speed
  let vz = newDirZ * speed

  // Freio lateral: mata componente perpendicular ao stick (fim do skate)
  if (turnAbs > SLIP_TURN_RAD) {
    const along = vx * tgtDirX + vz * tgtDirZ
    const latX = vx - tgtDirX * along
    const latZ = vz - tgtDirZ * along
    const slipKill = THREE.MathUtils.clamp(
      (turnAbs - SLIP_TURN_RAD) / (Math.PI * 0.55),
      0,
      1,
    )
    const damp = 1 - Math.exp(-(4.2 + slipKill * 7) * dt)
    vx -= latX * damp * (0.4 + slipKill * 0.4)
    vz -= latZ * damp * (0.4 + slipKill * 0.4)
  }

  return { x: vx, z: vz }
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
  // Domínio: close control rápido; sprint gira o peito sem ficar “preso”
  if (ratio < 0.22) return baseTurnSpeed * (controlled ? 1.72 : 1.45)
  if (ratio < 0.5) return baseTurnSpeed * (controlled ? 1.28 : 1.12)
  const damp = controlled ? 0.38 : 0.34
  return baseTurnSpeed * Math.max(0.48, 1 - ratio * damp)
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
    if (moveSpeed > (weighted ? 0.42 : 0.55)) {
      const velYaw = Math.atan2(velX, velZ)
      const turn = Math.abs(angleDelta(intentYaw, velYaw))
      if (!weighted) {
        if (turn > 0.5) return intentYaw
        return velYaw
      }
      // Domínio: peito acompanha o stick no close control; no sprint segue o corpo
      if (turn < 0.18) return velYaw
      const intentPull = THREE.MathUtils.clamp(
        0.38 + (1 - turn / Math.PI) * 0.4,
        0.32,
        0.78,
      )
      return lerpAngle(velYaw, intentYaw, intentPull)
    }
    return intentYaw
  }

  if (moveSpeed > (weighted ? 0.38 : 0.48)) {
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
  } else if (currentSpeed < maxSpeed * 0.28 && turnAbs > 0.85) {
    boost = controlled ? 1.55 : 1.35
  } else if (currentSpeed < maxSpeed * 0.48 && turnAbs > 1.35) {
    boost = controlled ? 1.28 : 1.15
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
  if (yawErrorAbs < 0.4) return vel
  // Virada média: freio; quase 180°: planta mais — sem engessar virada leve
  const rate =
    yawErrorAbs > 1.25
      ? 22
      : yawErrorAbs > 0.85
        ? 12 + yawErrorAbs * 7
        : 7 + yawErrorAbs * 5
  const blend = 1 - Math.exp(-rate * Math.min(delta, 0.05))
  const x = vel.x * (1 - blend)
  const z = vel.z * (1 - blend)
  if (yawErrorAbs > 1.25) return { x: 0, z: 0 }
  if (yawErrorAbs > 0.85 && Math.hypot(x, z) < 0.22) return { x: 0, z: 0 }
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

/**
 * Animações de chute/passe são destras.
 * Mira à direita do peito → espelha (pé esquerdo).
 * Mira à esquerda / reto → normal (pé direito).
 */
export function shouldMirrorRightFootedStrike(
  bodyYaw: number,
  aimX: number,
  aimZ: number,
  deadzone = 0.14,
): boolean {
  const { localRight } = worldToLocalMovement(aimX, aimZ, bodyYaw)
  // localRight no nosso frame fica invertido vs. “direita do peito” visual
  return localRight < -deadzone
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

  // Sprint só pra frente — lado e costas NUNCA usam run
  if (sprint && nf > 0.4 && absR < absF * 0.85) return 'player_run'

  // Limiares: off-ball usa left/right/back de verdade
  if (nf < -0.18 && absF >= absR * 0.65) return 'player_backward'
  if (absR > 0.32 && absR >= absF * 0.7) return nr < 0 ? 'player_left' : 'player_right'
  if (nf < -0.08) return 'player_backward'

  return 'player_walking'
}

export function resolveDirectLocoClip(moving: boolean, sprint: boolean): PlayerLocoAnim {
  if (!moving) return 'player_idle'
  return sprint ? 'player_run' : 'player_walking'
}
