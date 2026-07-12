const SPIN_STICK_MIN = 0.38
const SPIN_ANGLE_TRIGGER = Math.PI * 0.82
const SPIN_COOLDOWN = 0.9
const SPIN_ANGLE_DECAY = 0.88

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

/** Detecta rotação do analógico direito (skill) — ignora o esquerdo (andar). */
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

  // Só o analógico direito — se o esquerdo está dominando, é corrida, não drible.
  const rightStickActive =
    rightMag >= SPIN_STICK_MIN && rightMag >= leftMag * 0.72

  if (!enabled || rt.cooldown > 0 || !rightStickActive) {
    rt.prevAngle = null
    rt.angleAccum *= SPIN_ANGLE_DECAY
    return { triggered: false }
  }

  const angle = Math.atan2(skillX, skillZ)
  if (rt.prevAngle != null) {
    const deltaAngle = wrapAngle(angle - rt.prevAngle)
    rt.angleAccum += Math.abs(deltaAngle)
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
