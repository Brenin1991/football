import type { ControlState } from '../hooks/useKeyboardControls'
import { cameraState } from './cameraState'

/** Zona morta maior na mira — evita micro-tremores do stick */
const AIM_STICK_DEADZONE = 0.28
/** Curva >1: meia deflexão mexe bem menos que full stick */
const AIM_STICK_RESPONSE_EXP = 1.85
/** Velocidade máxima de giro da mira (rad/s) — antes era instantâneo */
const AIM_MAX_TURN_RAD_PER_SEC = 2.55
const AIM_DIR_EPS = 0.18

function wrapAngleDelta(delta: number): number {
  let d = delta
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return d
}

function facingDir(facingRotation: number): { x: number; z: number } {
  return {
    x: Math.sin(facingRotation),
    z: Math.cos(facingRotation),
  }
}

function normalizeDir(
  x: number,
  z: number,
): { x: number; z: number } | null {
  const len = Math.hypot(x, z)
  if (len < AIM_DIR_EPS) return null
  return { x: x / len, z: z / len }
}

/** Gira a mira em direção ao alvo com teto de radianos neste frame. */
function rotateAimToward(
  from: { x: number; z: number },
  to: { x: number; z: number },
  maxRadians: number,
): { x: number; z: number } {
  if (maxRadians <= 0) return from
  const fromA = Math.atan2(from.x, from.z)
  const toA = Math.atan2(to.x, to.z)
  const delta = wrapAngleDelta(toA - fromA)
  const step = Math.sign(delta) * Math.min(Math.abs(delta), maxRadians)
  const next = fromA + step
  return { x: Math.sin(next), z: Math.cos(next) }
}

/**
 * Direção câmera-relativa do analógico/teclas para mira.
 * Retorna magnitude 0–1 (já com curva) além da direção unitária.
 */
export function computeCameraRelativeAimInput(controls: ControlState): {
  x: number
  z: number
  mag: number
  active: boolean
} {
  const f = cameraState.forward
  const r = cameraState.right
  const stickLen = Math.hypot(controls.moveX, controls.moveZ)
  let dx = 0
  let dz = 0
  let mag = 0

  if (stickLen > AIM_STICK_DEADZONE) {
    const remapped =
      (stickLen - AIM_STICK_DEADZONE) / (1 - AIM_STICK_DEADZONE)
    mag = Math.pow(Math.min(1, remapped), AIM_STICK_RESPONSE_EXP)
    dx = f.x * controls.moveZ + r.x * controls.moveX
    dz = f.z * controls.moveZ + r.z * controls.moveX
  } else {
    if (controls.forward) {
      dx += f.x
      dz += f.z
    }
    if (controls.backward) {
      dx -= f.x
      dz -= f.z
    }
    if (controls.left) {
      dx += r.x
      dz += r.z
    }
    if (controls.right) {
      dx -= r.x
      dz -= r.z
    }
    const keyLen = Math.hypot(dx, dz)
    if (keyLen > 0.01) mag = 0.72
  }

  const dir = normalizeDir(dx, dz)
  if (!dir || mag < 0.04) return { x: 0, z: 0, mag: 0, active: false }
  return { x: dir.x, z: dir.z, mag, active: true }
}

/** @deprecated use computeCameraRelativeAimInput */
export function computeCameraRelativeMoveDir(controls: ControlState): {
  x: number
  z: number
  active: boolean
} {
  const aim = computeCameraRelativeAimInput(controls)
  return { x: aim.x, z: aim.z, active: aim.active }
}

/**
 * Mira (passe/chute/cruzamento): stick ajusta com giro limitado;
 * sem input mantém a última mira.
 */
export function computeShotAimDirection(
  controls: ControlState,
  facingRotation: number,
  prevDir?: { x: number; z: number } | null,
  delta = 1 / 60,
): { x: number; z: number } {
  const base =
    normalizeDir(prevDir?.x ?? 0, prevDir?.z ?? 0) ?? facingDir(facingRotation)

  const stick = computeCameraRelativeAimInput(controls)
  if (!stick.active) return base

  const dt = Math.max(0, Math.min(0.05, delta))
  const maxTurn = AIM_MAX_TURN_RAD_PER_SEC * stick.mag * dt
  return rotateAimToward(base, { x: stick.x, z: stick.z }, maxTurn)
}

/**
 * Janela livre do chute cinemático: mira segue o stick na hora (sem giro lento).
 */
export function computeCinematicShotAimDirection(
  controls: ControlState,
  facingRotation: number,
  prevDir?: { x: number; z: number } | null,
): { x: number; z: number } {
  const base =
    normalizeDir(prevDir?.x ?? 0, prevDir?.z ?? 0) ?? facingDir(facingRotation)

  const f = cameraState.forward
  const r = cameraState.right
  const stickLen = Math.hypot(controls.moveX, controls.moveZ)
  if (stickLen > 0.1) {
    let dx = f.x * controls.moveZ + r.x * controls.moveX
    let dz = f.z * controls.moveZ + r.z * controls.moveX
    const len = Math.hypot(dx, dz)
    if (len > 0.001) {
      dx /= len
      dz /= len
      return { x: dx, z: dz }
    }
  }

  if (controls.forward || controls.backward || controls.left || controls.right) {
    let dx = 0
    let dz = 0
    if (controls.forward) {
      dx += f.x
      dz += f.z
    }
    if (controls.backward) {
      dx -= f.x
      dz -= f.z
    }
    if (controls.left) {
      dx += r.x
      dz += r.z
    }
    if (controls.right) {
      dx -= r.x
      dz -= r.z
    }
    const len = Math.hypot(dx, dz)
    if (len > 0.01) return { x: dx / len, z: dz / len }
  }

  return base
}

export function computeStrikeDirection(
  controls: ControlState,
  facingRotation: number,
  prevDir?: { x: number; z: number } | null,
  delta = 1 / 60,
): { x: number; z: number } {
  return computeShotAimDirection(controls, facingRotation, prevDir, delta)
}
