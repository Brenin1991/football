import * as THREE from 'three'
import type { FieldBounds } from '../types'
import { FIELD_SCALE, PITCH_LIMITS } from './fieldData'

/** Câmera fixa na lateral — só varia um pouco para não invadir arquibancada */
const CAM_OFFSET = 0.62 * FIELD_SCALE
const CAM_HEIGHT_WIDE = 3.48 * Math.sqrt(FIELD_SCALE)
const CAM_HEIGHT_TIGHT = 3.05 * Math.sqrt(FIELD_SCALE)

/** Zoom forte no lado oposto — só óptico, sem recuar pra arquibancada */
const FOV_WIDE = 52
const FOV_TIGHT = 19

export type BroadcastCameraTarget = {
  position: THREE.Vector3
  lookAt: THREE.Vector3
  fov: number
}

function smoothstep(t: number) {
  return t * t * (3 - 2 * t)
}

/** Curva de zoom: largo na nossa lateral, teleobjetiva no lado oposto */
function zoomCurve(depthT: number) {
  const t = THREE.MathUtils.clamp((depthT - 0.1) / 0.9, 0, 1)
  return smoothstep(Math.pow(t, 0.62))
}

/** Visão lateral estilo transmissão — posição estável, zoom óptico suave */
export function computeBroadcastCamera(
  ballX: number,
  ballZ: number,
  bounds: FieldBounds | null,
  out: BroadcastCameraTarget,
): void {
  const minX = bounds?.minX ?? PITCH_LIMITS.minX
  const maxX = bounds?.maxX ?? PITCH_LIMITS.maxX
  const minZ = bounds?.minZ ?? PITCH_LIMITS.minZ
  const maxZ = bounds?.maxZ ?? PITCH_LIMITS.maxZ

  // 0 = lateral da câmera, 1 = lado oposto
  const depthT = THREE.MathUtils.clamp((ballX - minX) / Math.max(maxX - minX, 0.01), 0, 1)
  const zoomT = zoomCurve(depthT)

  const camX = minX - CAM_OFFSET + zoomT * 0.28 * FIELD_SCALE
  const camY = THREE.MathUtils.lerp(CAM_HEIGHT_WIDE, CAM_HEIGHT_TIGHT, zoomT)
  const fov = THREE.MathUtils.lerp(FOV_WIDE, FOV_TIGHT, zoomT)

  // Nas pontas do campo, desloca levemente em Z para manter a bola enquadrada
  const zSpan = Math.max(maxZ - minZ, 0.01)
  const zNorm = THREE.MathUtils.clamp((ballZ - minZ) / zSpan, 0, 1) - 0.5
  const camZ = ballZ - zNorm * 1.6 * FIELD_SCALE

  out.position.set(camX, camY, camZ)
  out.lookAt.set(ballX, 0.48, ballZ)
  out.fov = fov
}
