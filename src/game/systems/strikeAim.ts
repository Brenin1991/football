import type { ControlState } from '../hooks/useKeyboardControls'
import { cameraState } from './cameraState'

export function computeStrikeDirection(
  controls: ControlState,
  facingRotation: number,
): { x: number; z: number } {
  const facingX = Math.sin(facingRotation)
  const facingZ = Math.cos(facingRotation)

  const f = cameraState.forward
  const r = cameraState.right
  const stickLen = Math.hypot(controls.moveX, controls.moveZ)
  let dx = 0
  let dz = 0

  if (stickLen > 0.12) {
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
  if (len > 0.18) {
    return { x: dx / len, z: dz / len }
  }
  return { x: facingX, z: facingZ }
}
