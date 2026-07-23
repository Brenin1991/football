import {
  STAMINA_BASE_DRAIN,
  STAMINA_DUEL_DRAIN,
  STAMINA_EXHAUSTED,
  STAMINA_HALF_TIME_RECOVER,
  STAMINA_HAS_BALL_JOG_DRAIN,
  STAMINA_JOG_DRAIN,
  STAMINA_PRESS_DRAIN,
  STAMINA_SHOULDER_DRAIN,
  STAMINA_SLIDE_COST,
  STAMINA_SPRINT_DRAIN,
  STAMINA_STEAL_ATTEMPT_COST,
  STAMINA_TIRED,
  STAMINA_WINDING,
} from '../constants'
import type { PlayerRole } from '../types'
import { playerRegistry } from './entityRegistry'
import { getPlayerAttrMultipliers } from './playerAttributes'
import { getTacticsMultipliers } from './teamTactics'

/**
 * Stamina por jogador (0..1) — só gasta na partida, não recupera.
 * Obriga a baixar ritmo, mudar tática ou substituir.
 * Atributo `stamina` + função + táticas mudam a taxa de gasto.
 */

const stamina = new Map<string, number>()
/** Travou sprint por exaustão — só limpa em sub / reset (sem recover in-match). */
const sprintWinded = new Map<string, boolean>()

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v))
}

/** Função: laterais/meias gastam mais; zaga e GK menos. */
function roleStaminaDrainMul(role: PlayerRole | undefined): number {
  if (role === 'def') return 0.82
  if (role === 'mid') return 1.06
  if (role === 'fwd') return 1
  if (role === 'gk') return 0.42
  return 1
}

export function getPlayerStamina(playerId: string): number {
  return stamina.get(playerId) ?? 1
}

export function setPlayerStamina(playerId: string, value: number) {
  const next = clamp01(value)
  stamina.set(playerId, next)
  if (next > STAMINA_TIRED) sprintWinded.set(playerId, false)
  else if (next <= STAMINA_EXHAUSTED) sprintWinded.set(playerId, true)
}

export function ensurePlayerStamina(playerId: string): number {
  if (!stamina.has(playerId)) stamina.set(playerId, 1)
  return stamina.get(playerId)!
}

export function clearPlayerStamina(playerId: string) {
  stamina.delete(playerId)
  sprintWinded.delete(playerId)
}

export function resetAllStamina() {
  stamina.clear()
  sprintWinded.clear()
}

/** Intervalo: sobe um pouco (~10%), sem voltar ao fresco. */
export function applyHalfTimeStaminaRecovery(
  amount = STAMINA_HALF_TIME_RECOVER,
) {
  if (amount <= 0) return
  for (const [playerId, cur] of stamina) {
    const attrRecover = getPlayerAttrMultipliers(playerId).staminaRecover
    // Attr alto recupera um pouco mais no intervalo (ainda limitado)
    const recover = amount * Math.max(0.85, Math.min(1.2, attrRecover || 1))
    const next = clamp01(cur + recover)
    stamina.set(playerId, next)
    if (next > STAMINA_TIRED) sprintWinded.set(playerId, false)
  }
}

export function drainPlayerStamina(playerId: string, amount: number) {
  if (amount <= 0) return
  const player = playerRegistry.get(playerId)
  const roleMul = roleStaminaDrainMul(player?.role)
  const attrDrain = getPlayerAttrMultipliers(playerId).staminaDrain
  const tacticsDrain = player
    ? getTacticsMultipliers(player.team).staminaDrainMul
    : 1
  const cur = ensurePlayerStamina(playerId)
  const next = clamp01(cur - amount * roleMul * attrDrain * tacticsDrain)
  stamina.set(playerId, next)
  if (next <= STAMINA_EXHAUSTED) sprintWinded.set(playerId, true)
}

/**
 * Recuperação in-match desligada — use applyHalfTimeStaminaRecovery no intervalo.
 * Substituição / partida nova: setPlayerStamina / resetAllStamina.
 */
export function recoverPlayerStamina(_playerId: string, _amount: number) {
  // no-op
}

export type StaminaTickInput = {
  sprinting: boolean
  pressing: boolean
  shoulderCharging: boolean
  inDuel: boolean
  hasBall: boolean
  moving: boolean
  sliding: boolean
}

export function tickPlayerStamina(
  playerId: string,
  simDelta: number,
  input: StaminaTickInput,
) {
  const dt = Math.min(simDelta, 0.05)
  ensurePlayerStamina(playerId)
  const player = playerRegistry.get(playerId)
  const pressMul = player
    ? getTacticsMultipliers(player.team).pressStaminaMul
    : 1

  // Sempre gasta um pouco só por estar em campo (relógio da partida).
  let drain = STAMINA_BASE_DRAIN * dt

  if (input.sliding) drain += STAMINA_SLIDE_COST * 0.12 * dt
  if (input.sprinting) drain += STAMINA_SPRINT_DRAIN * dt
  if (input.pressing && input.sprinting) {
    drain += STAMINA_PRESS_DRAIN * pressMul * dt
  } else if (input.pressing) {
    drain += STAMINA_PRESS_DRAIN * 0.55 * pressMul * dt
  }
  if (input.shoulderCharging) drain += STAMINA_SHOULDER_DRAIN * dt
  if (input.inDuel) drain += STAMINA_DUEL_DRAIN * dt

  if (!input.sprinting && !input.pressing && !input.shoulderCharging && !input.inDuel) {
    if (input.moving) {
      drain += input.hasBall ? STAMINA_HAS_BALL_JOG_DRAIN * dt : STAMINA_JOG_DRAIN * dt
    }
  } else if (input.moving && !input.sprinting) {
    drain += STAMINA_JOG_DRAIN * 0.45 * dt
  }

  drainPlayerStamina(playerId, drain)
}

export function payStealAttemptStamina(playerId: string) {
  drainPlayerStamina(playerId, STAMINA_STEAL_ATTEMPT_COST)
}

export function paySlideStamina(playerId: string) {
  drainPlayerStamina(playerId, STAMINA_SLIDE_COST)
}

export function isStaminaExhausted(playerId: string): boolean {
  return getPlayerStamina(playerId) <= STAMINA_EXHAUSTED || !!sprintWinded.get(playerId)
}

export function isStaminaTired(playerId: string): boolean {
  return getPlayerStamina(playerId) <= STAMINA_TIRED
}

export function isSprintWinded(playerId: string): boolean {
  return !!sprintWinded.get(playerId)
}

/**
 * Sprint com histerese sticky: caiu no exhausted → sem sprint até sub/reset.
 */
export function canPlayerSprint(playerId: string, urgent = false): boolean {
  const s = getPlayerStamina(playerId)
  if (s <= STAMINA_EXHAUSTED) {
    sprintWinded.set(playerId, true)
    return false
  }
  if (sprintWinded.get(playerId)) return false
  if (s <= STAMINA_TIRED) return urgent
  return true
}

export function canAiAttemptStandingSteal(playerId: string): boolean {
  if (sprintWinded.get(playerId)) return false
  return getPlayerStamina(playerId) > STAMINA_EXHAUSTED + 0.04
}

export function getStaminaStealChanceMul(playerId: string): number {
  if (sprintWinded.get(playerId)) return 0
  const s = getPlayerStamina(playerId)
  if (s <= STAMINA_EXHAUSTED) return 0
  if (s <= STAMINA_TIRED) return 0.35
  if (s <= STAMINA_WINDING) return 0.7
  return 1
}

export function getStaminaStealIntervalMul(playerId: string): number {
  if (sprintWinded.get(playerId)) return 3
  const s = getPlayerStamina(playerId)
  if (s <= STAMINA_TIRED) return 2.4
  if (s <= STAMINA_WINDING) return 1.55
  return 1
}

/**
 * Velocidade em degraus fixos — NÃO interpola com stamina crua
 * (interpolação a cada frame = tremor quando stamina oscila).
 */
export function getStaminaSpeedMul(playerId: string): number {
  if (sprintWinded.get(playerId)) return 0.82
  const s = getPlayerStamina(playerId)
  if (s <= STAMINA_EXHAUSTED) return 0.82
  if (s <= STAMINA_TIRED) return 0.9
  if (s <= STAMINA_WINDING) return 0.96
  return 1
}

export function getStaminaContestMul(playerId: string): number {
  if (sprintWinded.get(playerId)) return 0.7
  const s = getPlayerStamina(playerId)
  if (s <= STAMINA_EXHAUSTED) return 0.7
  if (s <= STAMINA_TIRED) return 0.85
  if (s <= STAMINA_WINDING) return 0.94
  return 1
}
