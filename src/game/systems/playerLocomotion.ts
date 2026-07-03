import * as THREE from 'three'
import { rotateTowardAngle } from './rules'

/** Aceleração ao ir para velocidade alvo (1/s) */
export const PLAYER_MOVE_ACCEL = 15
/** Desaceleração — menor = mais inércia ao parar */
export const PLAYER_MOVE_DECEL = 9
/** Suavização da direção do input (jogador humano) */
export const PLAYER_DIR_SMOOTH_CONTROLLED = 10
/** Suavização da direção (IA em posicionamento) */
export const PLAYER_DIR_SMOOTH_AI = 6.5
/** Suavização da direção (IA em corrida direta — passe, marcação) */
export const PLAYER_DIR_SMOOTH_AI_DIRECT = 9

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

export function smoothVelocity2D(
  current: { x: number; z: number },
  targetX: number,
  targetZ: number,
  delta: number,
  accelerating: boolean,
): { x: number; z: number } {
  const rate = accelerating ? PLAYER_MOVE_ACCEL : PLAYER_MOVE_DECEL
  const blend = 1 - Math.exp(-rate * delta)
  const x = current.x + (targetX - current.x) * blend
  const z = current.z + (targetZ - current.z) * blend

  const targetSpeed = Math.hypot(targetX, targetZ)
  const nextSpeed = Math.hypot(x, z)
  if (targetSpeed < 0.04 && nextSpeed < 0.1) {
    return { x: 0, z: 0 }
  }
  return { x, z }
}

/** Menos giro em alta velocidade — inércia do corpo */
export function scaleTurnSpeedByMomentum(
  baseTurnSpeed: number,
  currentSpeed: number,
  maxSpeed: number,
  controlled = false,
): number {
  const ratio = THREE.MathUtils.clamp(currentSpeed / Math.max(maxSpeed, 0.01), 0, 1)
  const damp = controlled ? 0.42 : 0.52
  return baseTurnSpeed * Math.max(0.32, 1 - ratio * damp)
}

export function facingFromMovement(
  velX: number,
  velZ: number,
  intentX: number,
  intentZ: number,
  currentFacing: number,
): number {
  const moveSpeed = Math.hypot(velX, velZ)
  if (moveSpeed > 0.22) {
    return Math.atan2(velX, velZ)
  }
  const intentLen = Math.hypot(intentX, intentZ)
  if (intentLen > 0.02) {
    return Math.atan2(intentX / intentLen, intentZ / intentLen)
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
): number {
  const turnSpeed = scaleTurnSpeedByMomentum(baseTurnSpeed, currentSpeed, maxSpeed, controlled)
  return rotateTowardAngle(currentFacing, targetFacing, turnSpeed, delta)
}
