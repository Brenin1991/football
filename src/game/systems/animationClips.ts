import * as THREE from 'three'
import { PLAYER_HEIGHT } from '../constants'

/** Origem do GLB = pés. Offset pro centro da cápsula Rapier. */
export const PLAYER_FOOT_LOCAL_Y = -PLAYER_HEIGHT / 2

/** Escala pro tamanho do jogo + offset da cápsula. Não mexe em animação. */
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
