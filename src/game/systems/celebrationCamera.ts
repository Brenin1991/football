import * as THREE from 'three'
import type { FieldBounds } from '../types'
import { PLAYER_HEIGHT } from '../constants'
import { useGameStore } from '../store/gameStore'
import { FIELD_SCALE, getPitchGroundY, PITCH_LIMITS } from './fieldData'
import { playerRegistry } from './entityRegistry'
import { computeBroadcastCamera, type BroadcastCameraTarget } from './broadcastCamera'

export const CELEBRATION_DURATION_SEC = 9.6

const FACE = PLAYER_HEIGHT * 0.92
const EYE_CAM = PLAYER_HEIGHT * 0.88
const S = FIELD_SCALE

type ShotKind =
  | 'broadcast' // 1 — ponto de transmissão
  | 'pitchside' // 2 — fora do campo (cinegrafistas)
  | 'playerMedium' // 3 — no gramado, autor
  | 'faceClose' // 4 — close no rosto
  | 'twoShot' // 5 — autor + companheiro

interface CelebShot {
  kind: ShotKind
  duration: number
  /** 0 = usa FOV do broadcast */
  fov: number
}

const CELEB_SHOTS: CelebShot[] = [
  { kind: 'broadcast', duration: 2.35, fov: 0 },
  { kind: 'pitchside', duration: 2.15, fov: 36 },
  { kind: 'playerMedium', duration: 1.85, fov: 30 },
  { kind: 'faceClose', duration: 1.75, fov: 26 },
  { kind: 'twoShot', duration: 1.5, fov: 32 },
]

function easeOut(t: number) {
  const x = THREE.MathUtils.clamp(t, 0, 1)
  return 1 - (1 - x) * (1 - x)
}

function softHand(
  t: number,
  strength: number,
  out: { x: number; y: number; z: number },
) {
  const s = strength * 0.5
  out.x = Math.sin(t * 1.15) * 0.01 * s + Math.sin(t * 2.4 + 0.5) * 0.004 * s
  out.y = Math.sin(t * 1.55 + 0.8) * 0.007 * s + Math.sin(t * 2.9) * 0.003 * s
  out.z = Math.sin(t * 1.3 + 0.3) * 0.009 * s + Math.cos(t * 2.1) * 0.004 * s
}

const _hand = { x: 0, y: 0, z: 0 }
const _lookHand = { x: 0, y: 0, z: 0 }
const _broadcast: BroadcastCameraTarget = {
  position: new THREE.Vector3(),
  lookAt: new THREE.Vector3(),
  fov: 30,
}

function shotAt(elapsed: number): { shot: CelebShot; localU: number; index: number } {
  let t = Math.max(0, elapsed)
  for (let i = 0; i < CELEB_SHOTS.length; i++) {
    const shot = CELEB_SHOTS[i]
    if (t <= shot.duration || i === CELEB_SHOTS.length - 1) {
      return {
        shot,
        index: i,
        localU: THREE.MathUtils.clamp(t / shot.duration, 0, 1),
      }
    }
    t -= shot.duration
  }
  const last = CELEB_SHOTS[CELEB_SHOTS.length - 1]
  return { shot: last, index: CELEB_SHOTS.length - 1, localU: 1 }
}

function readPlayer(id: string | null) {
  if (!id) return null
  return playerRegistry.get(id) ?? null
}

function nearestTeammate(
  scorerId: string | null,
  team: 'home' | 'away' | null,
  sx: number,
  sz: number,
) {
  if (!team) return null
  const gkId = `${team}-0`
  let best: { x: number; z: number } | null = null
  let bestD = Infinity
  for (const p of playerRegistry.values()) {
    if (p.team !== team || p.id === scorerId || p.id === gkId) continue
    const d = (p.position.x - sx) ** 2 + (p.position.z - sz) ** 2
    if (d < bestD && d > 0.25) {
      bestD = d
      best = { x: p.position.x, z: p.position.z }
    }
  }
  return best
}

function resolveBounds(bounds: FieldBounds | null) {
  return {
    minX: bounds?.minX ?? PITCH_LIMITS.minX,
    maxX: bounds?.maxX ?? PITCH_LIMITS.maxX,
    minZ: bounds?.minZ ?? PITCH_LIMITS.minZ,
    maxZ: bounds?.maxZ ?? PITCH_LIMITS.maxZ,
  }
}

/**
 * Câmera no perímetro externo — onde ficam os cinegrafistas de beira de campo.
 * Prioriza o lado/canto mais perto do ponto de comemoração.
 */
function samplePitchsideCam(
  fx: number,
  fz: number,
  gatherX: number,
  gatherZ: number,
  faceY: number,
  ground: number,
  bounds: ReturnType<typeof resolveBounds>,
  u: number,
  outPos: THREE.Vector3,
  outLook: THREE.Vector3,
) {
  const { minX, maxX, minZ, maxZ } = bounds
  const focusX = THREE.MathUtils.lerp(fx, gatherX, 0.35)
  const focusZ = THREE.MathUtils.lerp(fz, gatherZ, 0.35)

  // Escolhe a linha de fora mais próxima do lance (lateral ou fundo)
  const distMinX = Math.abs(focusX - minX)
  const distMaxX = Math.abs(focusX - maxX)
  const distMinZ = Math.abs(focusZ - minZ)
  const distMaxZ = Math.abs(focusZ - maxZ)
  const edge = Math.min(distMinX, distMaxX, distMinZ, distMaxZ)

  const outside = 1.55 * S
  const along = THREE.MathUtils.lerp(-0.4, 0.55, u) * S
  let camX = focusX
  let camZ = focusZ
  let camY = ground + 0.92

  if (edge === distMinX) {
    camX = minX - outside
    camZ = THREE.MathUtils.clamp(focusZ + along, minZ - 0.5 * S, maxZ + 0.5 * S)
  } else if (edge === distMaxX) {
    camX = maxX + outside
    camZ = THREE.MathUtils.clamp(focusZ + along, minZ - 0.5 * S, maxZ + 0.5 * S)
  } else if (edge === distMinZ) {
    camZ = minZ - outside
    camX = THREE.MathUtils.clamp(focusX + along, minX - 0.5 * S, maxX + 0.5 * S)
  } else {
    camZ = maxZ + outside
    camX = THREE.MathUtils.clamp(focusX + along, minX - 0.5 * S, maxX + 0.5 * S)
  }

  outPos.set(camX, camY, camZ)
  outLook.set(focusX, faceY, focusZ)
}

export interface CelebrationCamCtx {
  elapsed: number
  scorerId: string | null
  team: 'home' | 'away' | null
  gatherX: number
  gatherZ: number
  faceX: number
  faceZ: number
  bounds: FieldBounds | null
}

/**
 * Sequência PES:
 * 1) broadcast → 2) cinegrafista fora do campo → 3+) jogador
 */
export function getCelebrationCameraState(
  ctx: CelebrationCamCtx,
  outPos: THREE.Vector3,
  outLook: THREE.Vector3,
): { fov: number; hardCut: boolean } {
  const { shot, localU, index } = shotAt(ctx.elapsed)
  const hardCut = localU < 0.04 && index > 0
  const ground = getPitchGroundY()
  const faceY = ground + FACE
  const eyeCamY = ground + EYE_CAM
  const bounds = resolveBounds(ctx.bounds)

  const scorer = readPlayer(ctx.scorerId)
  const fx = scorer?.position.x ?? ctx.gatherX
  const fz = scorer?.position.z ?? ctx.gatherZ

  let aheadX = ctx.faceX
  let aheadZ = ctx.faceZ
  const alen = Math.hypot(aheadX, aheadZ) || 1
  aheadX /= alen
  aheadZ /= alen
  const sideX = -aheadZ
  const sideZ = aheadX

  const u = easeOut(localU)
  const t = ctx.elapsed
  let fov = shot.fov
  let applyFaceClamp = false

  switch (shot.kind) {
    case 'broadcast': {
      // Mesmo ponto da transmissão ao vivo — time correndo no campo
      const lookX = THREE.MathUtils.lerp(fx, ctx.gatherX, 0.25)
      const lookZ = THREE.MathUtils.lerp(fz, ctx.gatherZ, 0.25)
      computeBroadcastCamera(
        lookX,
        lookZ,
        ctx.bounds,
        _broadcast,
        useGameStore.getState().broadcastCameraPreset,
      )
      outPos.copy(_broadcast.position)
      outLook.set(lookX, faceY * 0.85 + 0.12, lookZ)
      fov = _broadcast.fov
      softHand(t, 0.2, _hand)
      softHand(t + 0.5, 0.12, _lookHand)
      break
    }
    case 'pitchside': {
      // Fora do gramado — posição típica de cinegrafista de beira
      samplePitchsideCam(
        fx,
        fz,
        ctx.gatherX,
        ctx.gatherZ,
        faceY,
        ground,
        bounds,
        u,
        outPos,
        outLook,
      )
      softHand(t, 0.55, _hand)
      softHand(t + 0.7, 0.3, _lookHand)
      break
    }
    case 'playerMedium': {
      // Entra no campo: ¾ no autor correndo / comemorando
      const dist = THREE.MathUtils.lerp(3.4, 2.6, u)
      const side = 0.7
      outPos.set(
        fx + aheadX * dist + sideX * side,
        eyeCamY + 0.04,
        fz + aheadZ * dist + sideZ * side,
      )
      outLook.set(fx, faceY, fz)
      applyFaceClamp = true
      softHand(t, 0.45, _hand)
      softHand(t + 0.6, 0.25, _lookHand)
      break
    }
    case 'faceClose': {
      const dist = THREE.MathUtils.lerp(2.1, 1.7, u)
      const side = 0.4
      outPos.set(
        fx + aheadX * dist + sideX * side,
        eyeCamY,
        fz + aheadZ * dist + sideZ * side,
      )
      outLook.set(fx, faceY + 0.01, fz)
      applyFaceClamp = true
      softHand(t, 0.5, _hand)
      softHand(t + 0.5, 0.28, _lookHand)
      break
    }
    case 'twoShot':
    default: {
      const mate = nearestTeammate(ctx.scorerId, ctx.team, fx, fz)
      const mx = mate ? THREE.MathUtils.lerp(fx, mate.x, 0.48) : fx
      const mz = mate ? THREE.MathUtils.lerp(fz, mate.z, 0.48) : fz
      const dist = 2.75
      outPos.set(
        mx + aheadX * dist + sideX * 0.65,
        eyeCamY + 0.02,
        mz + aheadZ * dist + sideZ * 0.65,
      )
      outLook.set(mx, faceY, mz)
      applyFaceClamp = true
      softHand(t, 0.4, _hand)
      softHand(t + 1.1, 0.22, _lookHand)
      break
    }
  }

  outPos.x += _hand.x
  outPos.y += _hand.y
  outPos.z += _hand.z
  outLook.x += _lookHand.x
  outLook.y += _lookHand.y * 0.35
  outLook.z += _lookHand.z

  if (applyFaceClamp) {
    outPos.y = THREE.MathUtils.clamp(
      outPos.y,
      ground + FACE * 0.45,
      ground + FACE * 1.2,
    )
  }

  return { fov, hardCut }
}
