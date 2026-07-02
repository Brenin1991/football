import { SHOT_SPEED } from '../constants'

/** Velocidade da barra (ida + volta por segundo) */
export const SHOT_POWER_OSC_SPEED = 1.75

export const SHOT_SPEED_MIN_MUL = 0.32
export const SHOT_SPEED_MAX_MUL = 1.18

export type ShotChargeState = {
  active: boolean
  power: number
  direction: 1 | -1
}

export function createShotChargeState(): ShotChargeState {
  return { active: false, power: 0, direction: 1 }
}

export function updateShotCharge(state: ShotChargeState, delta: number) {
  if (!state.active) return
  state.power += state.direction * SHOT_POWER_OSC_SPEED * delta
  if (state.power >= 1) {
    state.power = 1
    state.direction = -1
  } else if (state.power <= 0) {
    state.power = 0
    state.direction = 1
  }
}

export function shotSpeedFromPower(power: number): number {
  const t = clamp(power, 0, 1)
  const mul = SHOT_SPEED_MIN_MUL + t * (SHOT_SPEED_MAX_MUL - SHOT_SPEED_MIN_MUL)
  return SHOT_SPEED * mul
}

export function shotLoftFromPower(power: number): number {
  const t = clamp(power, 0, 1)
  // Fraco = rasteiro (loft ~0); forte = bola sobe com arco
  if (t < 0.22) return t * 0.07
  const u = (t - 0.22) / 0.78
  return 0.03 + Math.pow(u, 1.25) * 1.05
}

export function setPieceSpeedMul(power: number): number {
  const t = clamp(power, 0, 1)
  return 0.45 + t * 0.85
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v))
}
