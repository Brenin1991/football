import { SHOT_SPEED } from '../constants'

/** Tempo para encher a barra de força do chute (estilo FIFA — segura para dosar) */
export const SHOT_POWER_CHARGE_DURATION_SEC = 1.0
export const PASS_POWER_CHARGE_DURATION_SEC = 0.42

/** Velocidade de preenchimento da barra (0→1 por segundo) */
export const POWER_FILL_SPEED = 1 / SHOT_POWER_CHARGE_DURATION_SEC

/** Força mínima ao soltar rápido (toque curto) */
export const POWER_MIN_ON_RELEASE = 0.22

/**
 * Passe rápido: apertar e soltar o botão dentro dessa janela conta como um
 * "toque" — sai um passe normal imediato, sem depender do quanto carregou.
 * Segurar além disso entra no modo de mira/carga (força variável).
 */
export const QUICK_PASS_TAP_MS = 180
/** Força padrão de um passe normal (toque rápido / antecipação) */
export const QUICK_PASS_POWER = 0.82
/** Impulso extra no passe rápido sem mira — compensa arrasto da bola no gramado */
export const QUICK_PASS_SPEED_MUL = 1.14

/** Chute rápido: toque curto no botão de chute */
export const QUICK_SHOT_TAP_MS = 200
export const QUICK_SHOT_POWER = 0.58

/**
 * Antecipação de passe (first-time, estilo FIFA): quanto tempo um passe
 * pré-agendado antes de receber a bola continua válido para sair no instante
 * da recepção.
 */
export const ACTION_BUFFER_WINDOW_MS = 1400
/** @deprecated use ACTION_BUFFER_WINDOW_MS */
export const PASS_BUFFER_WINDOW_MS = ACTION_BUFFER_WINDOW_MS

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

export function getPowerChargeDuration(mode: PowerBarMode | null): number {
  if (mode === 'shot') return SHOT_POWER_CHARGE_DURATION_SEC
  if (mode === 'pass' || mode === 'through' || mode === 'cross') {
    return PASS_POWER_CHARGE_DURATION_SEC
  }
  return SHOT_POWER_CHARGE_DURATION_SEC
}

export function getPowerFillSpeed(mode: PowerBarMode | null): number {
  const duration = getPowerChargeDuration(mode)
  return duration > 0 ? 1 / duration : POWER_FILL_SPEED
}

/** Preenche linearmente enquanto a carga estiver ativa */
export function updatePowerFill(state: ShotChargeState, delta: number, speed = POWER_FILL_SPEED) {
  if (!state.active) return
  state.power += speed * delta
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
  return 0.03 + Math.pow(u, 1.25) * 0.82
}

export function passSpeedFromPower(
  baseSpeed: number,
  power: number,
  quickPass = false,
): number {
  const t = clamp(finalizePower(power), 0, 1)
  const mul = PASS_SPEED_MIN_MUL + t * (PASS_SPEED_MAX_MUL - PASS_SPEED_MIN_MUL)
  const quickMul = quickPass ? QUICK_PASS_SPEED_MUL : 1
  return baseSpeed * mul * quickMul
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
