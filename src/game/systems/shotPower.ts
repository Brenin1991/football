import { SHOT_SPEED } from '../constants'

/**
 * Wind-up cinemático do chute a gol: ao apertar X, timer fixo até o chute.
 * Janela curta pra mirar, depois trava; força só sobe com X (estilo FIFA/PES).
 */
export const SHOT_CINEMATIC_WINDUP_SEC = 0.85
/** Ms livres pra ajustar a mira antes de congelar */
export const SHOT_AIM_LOCK_DELAY_MS = 320

/**
 * Atraso mínimo entre início da anim de chute e a bola sair do pé.
 * Evita “bola voando” antes da perna chegar — sincroniza com o contato.
 */
export const SHOT_CONTACT_MIN_DELAY_SEC = 0.14
/** Fração do clip de chute até o contato (se o clip for longo, usa isso). */
export const SHOT_CONTACT_RATIO = 0.28

/**
 * Chute antecipado / first-time: contato bem mais cedo e animação mais rápida
 * que o chute normal com a bola no pé.
 */
export const SHOT_FIRST_TIME_CONTACT_MIN_DELAY_SEC = 0.05
export const SHOT_FIRST_TIME_CONTACT_RATIO = 0.14
/** Multiplica o timeScale do clip de chute no first-time. */
export const SHOT_FIRST_TIME_TIME_SCALE_MUL = 1.45

/** Tempo pra encher a barra com X segurado (~janela do wind-up) */
export const SHOT_POWER_CHARGE_DURATION_SEC = 0.75
export const PASS_POWER_CHARGE_DURATION_SEC = 0.42

/** Velocidade de preenchimento da barra (0→1 por segundo) */
export const POWER_FILL_SPEED = 0.3 / SHOT_POWER_CHARGE_DURATION_SEC

/** Força mínima ao soltar rápido (toque curto) */
export const POWER_MIN_ON_RELEASE = 0.22

/**
 * Passe rápido: apertar e soltar o botão dentro dessa janela conta como um
 * "toque" — sai um passe normal imediato, sem depender do quanto carregou.
 * Segurar além disso entra no modo de mira/carga (força variável).
 */
export const QUICK_PASS_TAP_MS = 180
/**
 * Força "neutra" do toque rápido — marcador; distância manda via
 * passSpeedForDistance / quickPassPowerForDistance.
 */
export const QUICK_PASS_POWER = 0.55
/** Leve compensação de drag — a curva de distância faz o resto */
export const QUICK_PASS_SPEED_MUL = 1.06

/** @deprecated chute a gol agora é wind-up cinemático (não toque rápido) */
export const QUICK_SHOT_TAP_MS = 200
/** @deprecated */
export const QUICK_SHOT_POWER = 0.48

/**
 * Antecipação de passe (first-time, estilo FIFA): quanto tempo um passe
 * pré-agendado antes de receber a bola continua válido para sair no instante
 * da recepção.
 */
export const ACTION_BUFFER_WINDOW_MS = 1400
/** Voleio no cruzamento — bola pode demorar vários segundos no ar */
export const CROSS_VOLLEY_BUFFER_MS = 5200
/** @deprecated use ACTION_BUFFER_WINDOW_MS */
export const PASS_BUFFER_WINDOW_MS = ACTION_BUFFER_WINDOW_MS

/** Dosar a barra — cheia sobe um pouco; meia força é firme */
export const SHOT_SPEED_MIN_MUL = 0.5
export const SHOT_SPEED_MAX_MUL = 1.22

/**
 * Força de chute da IA — faixa firme (não fraco, não barra no talo).
 * Escala com distância até o gol.
 */
export function getAIShotPower(goalDist?: number): number {
  const jitter = () => (Math.random() - 0.5) * 0.06
  if (goalDist == null) return clamp(0.68 + jitter(), 0.58, 0.78)
  if (goalDist < 6.5) return clamp(0.58 + jitter(), 0.52, 0.66)
  if (goalDist < 11) return clamp(0.66 + jitter(), 0.58, 0.74)
  if (goalDist < 16) return clamp(0.72 + jitter(), 0.64, 0.8)
  return clamp(0.76 + jitter(), 0.68, 0.84)
}

export const PASS_SPEED_MIN_MUL = 0.48
export const PASS_SPEED_MAX_MUL = 1.05
export const THROUGH_SPEED_MIN_MUL = 0.62
export const THROUGH_SPEED_MAX_MUL = 1.18
export const CROSS_SPEED_MIN_MUL = 0.62
export const CROSS_SPEED_MAX_MUL = 1.0

export type ShotChargeState = {
  active: boolean
  power: number
}

export type PowerBarMode = 'shot' | 'pass' | 'through' | 'cross' | null

export function createShotChargeState(): ShotChargeState {
  return { active: false, power: 0 }
}

export function getPowerChargeDuration(mode: PowerBarMode | null): number {
  if (mode === 'shot') return SHOT_CINEMATIC_WINDUP_SEC
  if (mode === 'pass' || mode === 'through' || mode === 'cross') {
    return PASS_POWER_CHARGE_DURATION_SEC
  }
  return SHOT_CINEMATIC_WINDUP_SEC
}

export function getShotChargeElapsedMs(startedAt: number): number {
  return Math.max(0, performance.now() - startedAt)
}

export function isShotCinematicWindupComplete(startedAt: number): boolean {
  return getShotChargeElapsedMs(startedAt) >= SHOT_CINEMATIC_WINDUP_SEC * 1000
}

/** @deprecated use isShotCinematicWindupComplete */
export function isShotChargeWindowComplete(startedAt: number): boolean {
  return isShotCinematicWindupComplete(startedAt)
}

export function getPowerFillSpeed(mode: PowerBarMode | null): number {
  if (mode === 'shot') return 1 / SHOT_POWER_CHARGE_DURATION_SEC
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

/**
 * Velocidade horizontal do chute.
 * @param goalDist distância até a linha do gol (unidades do campo) — opcional
 */
export function shotSpeedFromPower(power: number, goalDist?: number): number {
  const t = clamp(finalizePower(power), 0, 1)
  let mul = SHOT_SPEED_MIN_MUL + t * (SHOT_SPEED_MAX_MUL - SHOT_SPEED_MIN_MUL)

  // Carga alta perde um pouco de horizontal (vira loft), sem matar o chute
  if (t > 0.82) {
    mul *= 1 - (t - 0.82) * 0.1
  }

  if (goalDist != null) {
    if (goalDist < 8 && t > 0.85) mul *= 0.96
    else if (goalDist > 14 && t > 0.45) mul *= 1.08
    else if (goalDist > 20 && t > 0.4) mul *= 1.12
  }

  return SHOT_SPEED * mul
}

/**
 * Elevação — meia barra firme/baixa; barra cheia sobe (errado), sem foguete.
 * @param goalDist distância até o gol
 */
export function shotLoftFromPower(power: number, goalDist?: number): number {
  const t = clamp(finalizePower(power), 0, 1)

  let loft: number
  if (t < 0.4) {
    loft = t * 0.018
  } else if (t < 0.68) {
    // Faixa boa — sobe pouco
    const u = (t - 0.4) / 0.28
    loft = 0.007 + u * u * 0.055
  } else if (t < 0.88) {
    // Arriscado
    const u = (t - 0.68) / 0.2
    loft = 0.062 + Math.pow(u, 1.4) * 0.12
  } else {
    // Barra no talo — por cima, sem arquibancada absurda
    const u = (t - 0.88) / 0.12
    loft = 0.182 + Math.pow(u, 1.2) * 0.2
  }

  if (goalDist != null) {
    const overcharge = Math.max(0, t - 0.7)
    if (goalDist < 7) {
      loft *= 1 + overcharge * 1.15
    } else if (goalDist < 12) {
      loft *= 1 + overcharge * 0.7
    } else if (goalDist > 22) {
      loft *= 0.88 + t * 0.12
    }
  }

  return loft
}

/** Power do toque rápido pela distância — curto já entrega, longo sobe. */
export function quickPassPowerForDistance(dist: number): number {
  // ~2 m → 0.50 · 8 m → 0.62 · 15 m → 0.78 · 22 m → 0.92
  return clamp(0.45 + dist * 0.022, 0.5, 0.92)
}

export function passSpeedFromPower(
  baseSpeed: number,
  power: number,
  quickPass = false,
): number {
  const t = clamp(finalizePower(power), 0, 1)
  // Toque rápido: não esmaga o curto; só afina o longo
  const mul = quickPass
    ? 0.96 + t * 0.12
    : PASS_SPEED_MIN_MUL + t * (PASS_SPEED_MAX_MUL - PASS_SPEED_MIN_MUL)
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
  if (through) return 0.015 + t * 0.08
  return t * 0.025
}

export function crossLoftFromPower(power: number, baseLoft: number): number {
  const t = clamp(finalizePower(power), 0, 1)
  return baseLoft * (0.78 + t * 0.22)
}

export function setPieceSpeedMul(power: number): number {
  const t = clamp(finalizePower(power), 0, 1)
  return 0.45 + t * 0.85
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v))
}
