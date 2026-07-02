import * as THREE from 'three'
import { PLAYER_HEIGHT } from '../constants'

/** Gramado no espaço local do RigidBody (origem do GLB = pés) */
export const PLAYER_FOOT_LOCAL_Y = -PLAYER_HEIGHT / 2

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
