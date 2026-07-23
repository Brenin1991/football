import type { Camera } from 'three'
import { Vector3 } from 'three'
import { useGameStore } from '../store/gameStore'
import { getIntroAnthemShotEnd, getIntroAnthemShotStart } from './introCamera'
import { entranceSystem } from './teamEntrance'

const _dir = new Vector3()
const FOCUS_PLANE_Y = 1.15
const FADE = 0.45

/** Força 0–1 do borrão cinematográfico (hino / comemoração / replay). */
export function getCinematicDofStrength(): number {
  const phase = useGameStore.getState().phase

  if (phase === 'goal-celebration' || phase === 'replay') return 1

  if (phase === 'intro') {
    const t = entranceSystem.getElapsed()
    const start = getIntroAnthemShotStart()
    const end = getIntroAnthemShotEnd()
    if (t < start || t > end) return 0
    if (t < start + FADE) return Math.max(0, (t - start) / FADE)
    if (t > end - FADE) return Math.max(0, (end - t) / FADE)
    return 1
  }

  return 0
}

/** Distância de foco estimada (rosto / peito) ao longo do olhar da câmera. */
export function estimateCinematicFocusDistance(camera: Camera, fallback = 2.4): number {
  camera.getWorldDirection(_dir)
  if (Math.abs(_dir.y) < 1e-4) return fallback
  const t = (FOCUS_PLANE_Y - camera.position.y) / _dir.y
  if (t < 0.35 || t > 28) return fallback
  return t
}
