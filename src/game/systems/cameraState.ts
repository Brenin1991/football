/** Direção da câmera projetada no chão — usada para mover relativo à tela */
export const cameraState = {
  forward: { x: 0, z: -1 },
  right: { x: 1, z: 0 },
}

export function updateCameraBasis(forwardX: number, forwardZ: number) {
  const len = Math.hypot(forwardX, forwardZ)
  if (len < 0.001) return
  cameraState.forward.x = forwardX / len
  cameraState.forward.z = forwardZ / len
  // right = up × forward (Y-up, plano XZ)
  cameraState.right.x = cameraState.forward.z
  cameraState.right.z = -cameraState.forward.x
}
