import * as THREE from 'three'
import type { FieldBounds } from '../types'
import { FIELD_SCALE, PITCH_LIMITS } from './fieldData'

export type BroadcastCameraPresetId =
  | 'wide'
  | 'broadcast'
  | 'close'
  | 'tele'
  | 'tactical'

export type BroadcastCameraPreset = {
  id: BroadcastCameraPresetId
  label: string
  hint: string
  /** Distância da lateral (× FIELD_SCALE). Menor = mais perto. */
  offset: number
  /** Altura perto da câmera (× √FIELD_SCALE). */
  heightWide: number
  /** Altura quando a bola está no lado oposto. */
  heightTight: number
  fovWide: number
  fovTight: number
  lookAtY: number
  /** Quanto a câmera acompanha a bola em Z. */
  zFollow: number
  /** Quanto avança em X no zoom (× FIELD_SCALE). */
  zoomPush: number
}

/** Presets — `wide` é o comportamento atual. */
export const BROADCAST_CAMERA_PRESETS: BroadcastCameraPreset[] = [
  {
    id: 'wide',
    label: 'Wide',
    hint: 'Visão lateral padrão — campo aberto.',
    offset: 6.22,
    heightWide: 5.48,
    heightTight: 7.05,
    fovWide: 40,
    fovTight: 15,
    lookAtY: 0.48,
    zFollow: 1.6,
    zoomPush: 0.28,
  },
  {
    id: 'broadcast',
    label: 'Broadcast',
    hint: 'Mais baixa e próxima — estilo TV.',
    offset: 4.2,
    heightWide: 3.15,
    heightTight: 4.75,
    fovWide: 38,
    fovTight: 17,
    lookAtY: 0.42,
    zFollow: 1.35,
    zoomPush: 0.22,
  },
  {
    id: 'close',
    label: 'Close',
    hint: 'Colada na lateral — sensação de estádio.',
    offset: 3.25,
    heightWide: 2.4,
    heightTight: 3.7,
    fovWide: 44,
    fovTight: 22,
    lookAtY: 0.38,
    zFollow: 1.1,
    zoomPush: 0.16,
  },
  {
    id: 'tele',
    label: 'Tele',
    hint: 'Mais longe com zoom óptico forte.',
    offset: 7.35,
    heightWide: 6.35,
    heightTight: 8.55,
    fovWide: 34,
    fovTight: 11,
    lookAtY: 0.52,
    zFollow: 1.85,
    zoomPush: 0.34,
  },
  {
    id: 'tactical',
    label: 'Tactical',
    hint: 'Alta e aberta — lê a formação.',
    offset: 8.6,
    heightWide: 9.1,
    heightTight: 11.4,
    fovWide: 48,
    fovTight: 26,
    lookAtY: 0.2,
    zFollow: 2.1,
    zoomPush: 0.4,
  },
]

const PRESET_BY_ID = Object.fromEntries(
  BROADCAST_CAMERA_PRESETS.map((preset) => [preset.id, preset]),
) as Record<BroadcastCameraPresetId, BroadcastCameraPreset>

export function getBroadcastCameraPreset(
  id: BroadcastCameraPresetId,
): BroadcastCameraPreset {
  return PRESET_BY_ID[id] ?? PRESET_BY_ID.wide
}

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
  presetId: BroadcastCameraPresetId = 'wide',
): void {
  const preset = getBroadcastCameraPreset(presetId)
  const minX = bounds?.minX ?? PITCH_LIMITS.minX
  const maxX = bounds?.maxX ?? PITCH_LIMITS.maxX
  const minZ = bounds?.minZ ?? PITCH_LIMITS.minZ
  const maxZ = bounds?.maxZ ?? PITCH_LIMITS.maxZ

  const camOffset = preset.offset * FIELD_SCALE
  const heightWide = preset.heightWide * Math.sqrt(FIELD_SCALE)
  const heightTight = preset.heightTight * Math.sqrt(FIELD_SCALE)

  // 0 = lateral da câmera, 1 = lado oposto
  const depthT = THREE.MathUtils.clamp((ballX - minX) / Math.max(maxX - minX, 0.01), 0, 1)
  const zoomT = zoomCurve(depthT)

  const camX = minX - camOffset + zoomT * preset.zoomPush * FIELD_SCALE
  const camY = THREE.MathUtils.lerp(heightWide, heightTight, zoomT)
  const fov = THREE.MathUtils.lerp(preset.fovWide, preset.fovTight, zoomT)

  const zSpan = Math.max(maxZ - minZ, 0.01)
  const zNorm = THREE.MathUtils.clamp((ballZ - minZ) / zSpan, 0, 1) - 0.5
  const camZ = ballZ - zNorm * preset.zFollow * FIELD_SCALE

  out.position.set(camX, camY, camZ)
  out.lookAt.set(ballX, preset.lookAtY, ballZ)
  out.fov = fov
}
