const SPIN_STICK_MIN = 0.52
/** Precisa ~190° de giro rápido — hold de look não conta */
const SPIN_ANGLE_TRIGGER = Math.PI * 1.05
const SPIN_COOLDOWN = 1.1
const SPIN_ANGLE_DECAY = 0.72
/** rad/s mínimo pra contar como flick (look lento não acumula) */
const SPIN_MIN_ANG_VEL = 5.5
/** Stick esquerdo não pode estar dominando (é corrida, não skill) */
const SPIN_LEFT_DOMINANCE = 0.85

type Runtime = {
  prevAngle: number | null
  angleAccum: number
  cooldown: number
}

const runtimes = new Map<string, Runtime>()

function getRuntime(id: string): Runtime {
  let rt = runtimes.get(id)
  if (!rt) {
    rt = { prevAngle: null, angleAccum: 0, cooldown: 0 }
    runtimes.set(id, rt)
  }
  return rt
}

function wrapAngle(delta: number): number {
  while (delta > Math.PI) delta -= Math.PI * 2
  while (delta < -Math.PI) delta += Math.PI * 2
  return delta
}

export function clearPlayerSkillMoves(id: string) {
  runtimes.delete(id)
}

/** Detecta flick circular no analógico direito — ignora look lento e o esquerdo. */
export function updatePlayerSkillSpin(
  id: string,
  skillX: number,
  skillZ: number,
  moveX: number,
  moveZ: number,
  delta: number,
  enabled: boolean,
): { triggered: boolean } {
  const rt = getRuntime(id)
  rt.cooldown = Math.max(0, rt.cooldown - delta)

  const rightMag = Math.hypot(skillX, skillZ)
  const leftMag = Math.hypot(moveX, moveZ)

  const rightStickActive =
    rightMag >= SPIN_STICK_MIN && rightMag >= leftMag * SPIN_LEFT_DOMINANCE

  if (!enabled || rt.cooldown > 0 || !rightStickActive) {
    rt.prevAngle = null
    rt.angleAccum *= SPIN_ANGLE_DECAY
    return { triggered: false }
  }

  const angle = Math.atan2(skillX, skillZ)
  if (rt.prevAngle != null) {
    const deltaAngle = wrapAngle(angle - rt.prevAngle)
    const angVel = Math.abs(deltaAngle) / Math.max(delta, 0.001)
    // Só flick rápido acumula — hold/look lateral decai
    if (angVel >= SPIN_MIN_ANG_VEL) {
      rt.angleAccum += Math.abs(deltaAngle)
    } else {
      rt.angleAccum *= SPIN_ANGLE_DECAY
    }
  }
  rt.prevAngle = angle

  if (rt.angleAccum < SPIN_ANGLE_TRIGGER) {
    return { triggered: false }
  }

  rt.angleAccum = 0
  rt.prevAngle = null
  rt.cooldown = SPIN_COOLDOWN
  return { triggered: true }
}
