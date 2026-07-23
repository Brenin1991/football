/**
 * Look orbital com stick direito.
 * Segura = gira em torno do jogador (não fixa na bola).
 * Solta = offset volta a 0 e a câmera normal retoma.
 */
const LOOK_DEADZONE = 0.14
/** Quase meia volta pra cada lado — círculo orbital */
const MAX_YAW = Math.PI * 0.92
const MAX_PITCH = 0.42
const ENGAGE_SPEED = 12
const RETURN_SPEED = 5.8

let inputX = 0
let inputZ = 0
let lookYaw = 0
let lookPitch = 0

/** Chamar a cada frame com skillX / skillZ do controle. */
export function setCameraLookInput(skillX: number, skillZ: number) {
  const mag = Math.hypot(skillX, skillZ)
  if (mag < LOOK_DEADZONE) {
    inputX = 0
    inputZ = 0
    return
  }
  const t = (mag - LOOK_DEADZONE) / (1 - LOOK_DEADZONE)
  const nx = skillX / mag
  const nz = skillZ / mag
  inputX = nx * Math.min(1, t)
  inputZ = nz * Math.min(1, t)
}

export function tickCameraLook(delta: number): {
  yaw: number
  pitch: number
  /** Stick pressionado agora */
  holding: boolean
  /** Ainda interpolando (hold ou retorno) */
  active: boolean
} {
  const dt = Math.min(delta, 0.05)
  const holding = Math.hypot(inputX, inputZ) > 0.01

  if (holding) {
    const targetYaw = inputX * MAX_YAW
    // Stick pra frente = câmera sobe um pouco / olha mais baixo no pivot
    const targetPitch = -inputZ * MAX_PITCH
    const t = 1 - Math.exp(-ENGAGE_SPEED * dt)
    lookYaw += (targetYaw - lookYaw) * t
    lookPitch += (targetPitch - lookPitch) * t
  } else {
    const t = 1 - Math.exp(-RETURN_SPEED * dt)
    lookYaw += (0 - lookYaw) * t
    lookPitch += (0 - lookPitch) * t
    if (Math.abs(lookYaw) < 0.0015) lookYaw = 0
    if (Math.abs(lookPitch) < 0.0015) lookPitch = 0
  }

  return {
    yaw: lookYaw,
    pitch: lookPitch,
    holding,
    active: holding || Math.abs(lookYaw) > 0.002 || Math.abs(lookPitch) > 0.002,
  }
}

export function resetCameraLook() {
  inputX = 0
  inputZ = 0
  lookYaw = 0
  lookPitch = 0
}

/**
 * Câmera em círculo atrás/ao redor do pivot (jogador).
 * baseYaw = direção “atrás” padrão (facing do pro / chase).
 * lookYaw = offset do stick (0 = atrás, ±π = lados/frente).
 */
export function buildPlayerOrbitCamera(
  pivotX: number,
  pivotY: number,
  pivotZ: number,
  baseYaw: number,
  lookYawOffset: number,
  lookPitchOffset: number,
  behind: number,
  height: number,
  outPos: { x: number; y: number; z: number },
  outLook: { x: number; y: number; z: number },
) {
  const yaw = baseYaw + lookYawOffset
  const fx = Math.sin(yaw)
  const fz = Math.cos(yaw)

  // Pitch: sobe/desce a câmera no arco, mantém distância horizontal ~atrás
  const pitch = lookPitchOffset
  const horiz = behind * Math.cos(pitch)
  const vert = height + behind * Math.sin(pitch)

  outPos.x = pivotX - fx * horiz
  outPos.y = Math.max(0.45, vert)
  outPos.z = pivotZ - fz * horiz

  // Sempre olha pro jogador — nunca pra bola enquanto orbitando
  outLook.x = pivotX
  outLook.y = pivotY
  outLook.z = pivotZ
}
