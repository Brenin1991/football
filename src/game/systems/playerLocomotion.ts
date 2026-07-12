import * as THREE from 'three'
import { rotateTowardAngle } from './rules'
import type { PlayerLocoAnim } from '../types'

/** Aceleração ao ir para velocidade alvo (1/s) */
export const PLAYER_MOVE_ACCEL = 18
/** Desaceleração — menor = mais inércia ao parar */
export const PLAYER_MOVE_DECEL = 5.5
/** Suavização da direção do input (jogador humano) */
export const PLAYER_DIR_SMOOTH_CONTROLLED = 12
/** Suavização da direção (IA em posicionamento) */
export const PLAYER_DIR_SMOOTH_AI = 7.5
/** Suavização da direção (IA em corrida direta — passe, marcação) */
export const PLAYER_DIR_SMOOTH_AI_DIRECT = 10
/** Giro para olhar bola/jogo */
export const PLAYER_BALL_FOCUS_TURN = 7.5

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
  // Banda mais alta (0.35) para evitar o "flip" de fonte de facing quando a
  // velocidade oscila em torno do limiar — trocar entre direção-de-velocidade
  // e direção-de-intenção frame a frame era uma das causas do giro nervoso.
  if (moveSpeed > 0.35) {
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

/**
 * Olhar para a bola / jogo. Com deadzone: quando o jogador está praticamente
 * em cima da bola (vetor quase nulo), o atan2 fica instável e faz o corpo
 * "rodar" no lugar — nesse caso mantemos a orientação atual.
 */
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

/** Movimento world → eixos locais do corpo (frente / direita) */
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

/** Escolhe clip de locomoção strafe olhando para a bola */
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

  if (sprint && nf > 0.15) return 'player_run'

  if (nf < -0.5 && absF >= absR) return 'player_backward'
  if (absR > 0.72 && absR > absF * 1.35) return nr < 0 ? 'player_left' : 'player_right'

  return 'player_walking'
}

/** Locomoção frontal — transições / corrida normal */
export function resolveDirectLocoClip(moving: boolean, sprint: boolean): PlayerLocoAnim {
  if (!moving) return 'player_idle'
  return sprint ? 'player_run' : 'player_walking'
}
