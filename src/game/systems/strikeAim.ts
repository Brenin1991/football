import type { ControlState } from '../hooks/useKeyboardControls'
import { cameraState } from './cameraState'

const AIM_STICK_DEADZONE = 0.12

/** Direção câmera-relativa do analógico/teclas (movimento ou mira). */
export function computeCameraRelativeMoveDir(controls: ControlState): {
  x: number
  z: number
  active: boolean
} {
  const f = cameraState.forward
  const r = cameraState.right
  const stickLen = Math.hypot(controls.moveX, controls.moveZ)
  let dx = 0
  let dz = 0

  if (stickLen > AIM_STICK_DEADZONE) {
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
  }

  const len = Math.hypot(dx, dz)
  if (len < 0.18) return { x: 0, z: 0, active: false }
  return { x: dx / len, z: dz / len, active: true }
}

/**
 * Mira do chute (FIFA): analógico ajusta a direção livremente; sem input mantém
 * a última mira — permite chutar cruzado enquanto o corpo segue a corrida.
 */
export function computeShotAimDirection(
  controls: ControlState,
  facingRotation: number,
  prevDir?: { x: number; z: number } | null,
): { x: number; z: number } {
  const move = computeCameraRelativeMoveDir(controls)
  if (move.active) return { x: move.x, z: move.z }

  if (prevDir) {
    const prevLen = Math.hypot(prevDir.x, prevDir.z)
    if (prevLen > 0.18) {
      return { x: prevDir.x / prevLen, z: prevDir.z / prevLen }
    }
  }

  return {
    x: Math.sin(facingRotation),
    z: Math.cos(facingRotation),
  }
}

export function computeStrikeDirection(
  controls: ControlState,
  facingRotation: number,
): { x: number; z: number } {
  return computeShotAimDirection(controls, facingRotation, null)
}
