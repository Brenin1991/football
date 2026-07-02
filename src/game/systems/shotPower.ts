import { SHOT_SPEED } from '../constants'

/** Velocidade de preenchimento da barra (0→1 por segundo) — estilo FIFA */
export const POWER_FILL_SPEED = 2.35

/** Força mínima ao soltar rápido (toque curto) */
export const POWER_MIN_ON_RELEASE = 0.22

export const SHOT_SPEED_MIN_MUL = 0.32
export const SHOT_SPEED_MAX_MUL = 1.18

export const PASS_SPEED_MIN_MUL = 0.52
export const PASS_SPEED_MAX_MUL = 1.0
export const THROUGH_SPEED_MIN_MUL = 0.68
export const THROUGH_SPEED_MAX_MUL = 1.22
export const CROSS_SPEED_MIN_MUL = 0.58
export const CROSS_SPEED_MAX_MUL = 1.08

export type ShotChargeState = {
  active: boolean
  power: number
}

export type PowerBarMode = 'shot' | 'pass' | 'through' | 'cross' | null

export function createShotChargeState(): ShotChargeState {
  return { active: false, power: 0 }
}

/** Preenche linearmente enquanto segura o botão (FIFA) */
export function updatePowerFill(state: ShotChargeState, delta: number) {
  if (!state.active) return
  state.power += POWER_FILL_SPEED * delta
  if (state.power >= 1) state.power = 1
}

/** @deprecated use updatePowerFill */
export function updateShotCharge(state: ShotChargeState, delta: number) {
  updatePowerFill(state, delta)
}

export function finalizePower(power: number): number {
  return Math.max(power, POWER_MIN_ON_RELEASE)
}

export function shotSpeedFromPower(power: number): number {
  const t = clamp(finalizePower(power), 0, 1)
  const mul = SHOT_SPEED_MIN_MUL + t * (SHOT_SPEED_MAX_MUL - SHOT_SPEED_MIN_MUL)
  return SHOT_SPEED * mul
}

export function shotLoftFromPower(power: number): number {
  const t = clamp(finalizePower(power), 0, 1)
  if (t < 0.22) return t * 0.07
  const u = (t - 0.22) / 0.78
  return 0.03 + Math.pow(u, 1.25) * 1.05
}

export function passSpeedFromPower(baseSpeed: number, power: number): number {
  const t = clamp(finalizePower(power), 0, 1)
  const mul = PASS_SPEED_MIN_MUL + t * (PASS_SPEED_MAX_MUL - PASS_SPEED_MIN_MUL)
  return baseSpeed * mul
}

export function throughSpeedFromPower(baseSpeed: number, power: number): number {
  const t = clamp(finalizePower(power), 0, 1)
  const mul = THROUGH_SPEED_MIN_MUL + t * (THROUGH_SPEED_MAX_MUL - THROUGH_SPEED_MIN_MUL)
  return baseSpeed * mul
}

export function crossSpeedFromPower(baseSpeed: number, power: number): number {
  const t = clamp(finalizePower(power), 0, 1)
  const mul = CROSS_SPEED_MIN_MUL + t * (CROSS_SPEED_MAX_MUL - CROSS_SPEED_MIN_MUL)
  return baseSpeed * mul
}

export function passLoftFromPower(power: number, through = false): number {
  const t = clamp(finalizePower(power), 0, 1)
  if (through) return 0.02 + t * 0.12
  return t * 0.04
}

export function crossLoftFromPower(power: number, baseLoft: number): number {
  const t = clamp(finalizePower(power), 0, 1)
  return baseLoft * (0.72 + t * 0.38)
}

export function setPieceSpeedMul(power: number): number {
  const t = clamp(finalizePower(power), 0, 1)
  return 0.45 + t * 0.85
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v))
}
