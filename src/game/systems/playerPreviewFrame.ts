import * as THREE from 'three'

export type PlayerPreviewFrame = {
  pivot: THREE.Vector3
  camera: THREE.Vector3
}

/** Pivô no peito e câmera frontal após alignPlayerModelToCapsule. */
export function computePlayerPreviewFrame(model: THREE.Object3D): PlayerPreviewFrame {
  model.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(model)
  const center = new THREE.Vector3()
  box.getCenter(center)

  const height = box.max.y - box.min.y
  const chestY = box.min.y + height * 0.62
  const pivot = new THREE.Vector3(center.x, chestY, center.z)

  const span = Math.max(box.max.x - box.min.x, box.max.z - box.min.z, height * 0.45)
  const camera = new THREE.Vector3(pivot.x, pivot.y + height * 0.02, pivot.z + span * 1.15)

  return { pivot, camera }
}
