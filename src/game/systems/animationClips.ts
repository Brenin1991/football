import * as THREE from 'three'
import type { AnimationClip } from 'three'
import { PLAYER_HEIGHT } from '../constants'

/** Gramado no espaço local do RigidBody (origem do GLB = pés) */
export const PLAYER_FOOT_LOCAL_Y = -PLAYER_HEIGHT / 2

/**
 * Mixamo exporta translation/scale em centímetros em todos os ossos.
 * Com o modelo escalado para ~0,68 m, esses tracks deslocam o boneco.
 * Locomoção in-place: só rotação (quaternion).
 */
export function sanitizePlayerAnimationClips(clips: AnimationClip[]): AnimationClip[] {
  return clips.map((clip) => {
    const tracks = clip.tracks.filter((track) => track.name.endsWith('.quaternion'))
    return new THREE.AnimationClip(clip.name, clip.duration, tracks)
  })
}

/** Trava o mesh no pivot da cápsula após o mixer (evita root motion residual). */
export function lockPlayerModelToCapsule(
  model: THREE.Object3D,
  footLocalY: number,
  facingY: number,
) {
  model.position.set(0, footLocalY, 0)
  model.rotation.set(0, facingY, 0)
}

/**
 * Escala o modelo e coloca a origem do GLB (pés, y≈0 no bind) no gramado.
 * Centro da cápsula Rapier em y=0 local → pés em y = PLAYER_FOOT_LOCAL_Y.
 */
export function alignPlayerModelToCapsule(model: THREE.Object3D) {
  model.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(model)
  const size = new THREE.Vector3()
  box.getSize(size)
  if (size.y > 0.01) {
    model.scale.setScalar(PLAYER_HEIGHT / size.y)
  }
  model.position.set(0, PLAYER_FOOT_LOCAL_Y, 0)
  model.updateMatrixWorld(true)
}
