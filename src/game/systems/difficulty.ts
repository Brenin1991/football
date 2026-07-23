import { getUserTeam, useGameStore } from '../store/gameStore'
import type { TeamId } from '../types'
import { PLAYER_SPEED } from '../constants'
import { distance2D } from './rules'
import type { PlayerRef } from './entityRegistry'
import { playerRegistry } from './entityRegistry'
import { getAttackSign, getDefensiveGoalZ } from './teamField'

export type DifficultyId = 'easy' | 'medium' | 'hard' | 'expert'

export const DIFFICULTY_ORDER: DifficultyId[] = ['easy', 'medium', 'hard', 'expert']

export const DIFFICULTY_LABELS: Record<DifficultyId, string> = {
  easy: 'Fácil',
  medium: 'Médio',
  hard: 'Difícil',
  expert: 'Expert',
}

/** Multiplicadores da IA adversária vs jogador humano. */
type OpponentTuning = {
  pressWeight: number
  markBlend: number
  compactDefense: number
  interceptChance: number
  standingStealChance: number
  standingStealInterval: number
  slideChance: number
  slideInterval: number
  /** Bônus na margem quando a IA rouba o jogador (positivo = rouba mais). */
  opponentStealBonus: number
  /** Bônus na margem quando o jogador rouba a IA. */
  userStealBonus: number
  /** Duração do alívio de pressão após o jogador ganhar a bola (roubo). */
  stealPressReliefMs: number
  /** Alívio mais curto quando o jogador só recupera posse (não roubo). */
  softPressReliefMs: number
  /** Multiplicador de perseguição ao portador humano (>1 = persegue mais longe). */
  pursuitMul: number
  /** Quanto a IA usa cruzamento (menor = cruza mais fácil). */
  crossThresholdMul: number
  /** Largura extra na faixa de interceptação de passe. */
  interceptLaneMul: number
}

const OPPONENT_TUNING: Record<DifficultyId, OpponentTuning> = {
  easy: {
    pressWeight: 0.42,
    markBlend: 0.38,
    compactDefense: 0.38,
    interceptChance: 0.32,
    standingStealChance: 0.26,
    standingStealInterval: 2.05,
    slideChance: 0.5,
    slideInterval: 1.7,
    opponentStealBonus: -0.52,
    userStealBonus: 0.48,
    stealPressReliefMs: 4800,
    softPressReliefMs: 2200,
    pursuitMul: 0.72,
    crossThresholdMul: 1.18,
    interceptLaneMul: 0.85,
  },
  medium: {
    pressWeight: 0.8,
    markBlend: 0.78,
    compactDefense: 0.55,
    interceptChance: 0.88,
    standingStealChance: 0.7,
    standingStealInterval: 1.08,
    slideChance: 0.9,
    slideInterval: 0.95,
    opponentStealBonus: -0.18,
    userStealBonus: 0.32,
    stealPressReliefMs: 2800,
    softPressReliefMs: 1300,
    pursuitMul: 1.05,
    crossThresholdMul: 0.95,
    interceptLaneMul: 1.12,
  },
  hard: {
    pressWeight: 1.1,
    markBlend: 1.12,
    compactDefense: 0.68,
    interceptChance: 1.28,
    standingStealChance: 0.88,
    standingStealInterval: 0.95,
    slideChance: 1.05,
    slideInterval: 0.72,
    opponentStealBonus: -0.1,
    userStealBonus: 0.22,
    stealPressReliefMs: 1800,
    softPressReliefMs: 800,
    pursuitMul: 1.28,
    crossThresholdMul: 0.82,
    interceptLaneMul: 1.35,
  },
  expert: {
    pressWeight: 1.22,
    markBlend: 1.25,
    compactDefense: 0.75,
    interceptChance: 1.42,
    standingStealChance: 1.02,
    standingStealInterval: 0.78,
    slideChance: 1.18,
    slideInterval: 0.62,
    opponentStealBonus: -0.02,
    userStealBonus: 0.14,
    stealPressReliefMs: 1200,
    softPressReliefMs: 550,
    pursuitMul: 1.42,
    crossThresholdMul: 0.74,
    interceptLaneMul: 1.48,
  },
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v))
}

export function getMatchDifficulty(): DifficultyId {
  return useGameStore.getState().difficulty
}

function opponentTuning(): OpponentTuning {
  return OPPONENT_TUNING[getMatchDifficulty()]
}

/** IA adversária (defende / rouba o jogador). */
function isOpponentTeam(team: TeamId): boolean {
  return team !== getUserTeam()
}

/** 0.15–1 — alívio de pressão logo após o jogador ganhar a bola. */
export function getUserPressReliefFactor(): number {
  const until = useGameStore.getState().userPressReliefUntil
  const now = performance.now()
  if (now >= until) return 1
  const remaining = until - now
  const windowMs = Math.max(
    opponentTuning().stealPressReliefMs,
    opponentTuning().softPressReliefMs,
    800,
  )
  const t = Math.min(1, remaining / windowMs)
  if (t > 0.72) return 0.22
  return 0.22 + (1 - t / 0.72) * 0.78
}

/** Durações de alívio conforme dificuldade (para setPossession). */
export function getPressReliefMs(stolenFromOpp: boolean): number {
  const t = opponentTuning()
  return stolenFromOpp ? t.stealPressReliefMs : t.softPressReliefMs
}

/**
 * Pressão da IA quando o jogador conduz.
 * Baixa no próprio campo (construção), sobe no meio e fica pesada no ataque —
 * igual na vida real: não satura de marcação na saída de bola.
 */
export function getUserBuildUpPressFactor(carrier?: PlayerRef | null): number {
  const store = useGameStore.getState()
  const bounds = store.fieldBounds
  if (!bounds) return 1

  const user = getUserTeam()
  let pos = carrier?.team === user ? carrier.position : null
  if (!pos) {
    const poss = store.ballPossession
    if (!poss || poss.team !== user) return 1
    const holder = playerRegistry.get(poss.playerId)
    if (!holder) return 1
    pos = holder.position
  }

  const defZ = getDefensiveGoalZ(user, bounds)
  const attackSign = getAttackSign(user, bounds)
  const fieldLen = Math.max(Math.abs(bounds.maxZ - bounds.minZ), 1)
  const progress = clamp(((pos.z - defZ) * attackSign) / fieldLen, 0, 1)

  // Terço defensivo: bloco compacto, quase sem pressão alta
  if (progress < 0.34) return 0.16 + (progress / 0.34) * 0.26
  // Meio-campo / transição
  if (progress < 0.55) return 0.42 + ((progress - 0.34) / 0.21) * 0.38
  // Campo adversário
  return Math.min(1.0, 0.8 + ((progress - 0.55) / 0.45) * 0.2)
}

/**
 * Após recuperar a bola: alívio real (inclusive no difícil).
 * Expert só corta se o alívio já acabou quase totalmente.
 */
export function shouldSkipBallPressure(defendingTeam: TeamId): boolean {
  if (!isOpponentTeam(defendingTeam)) return false
  const relief = getUserPressReliefFactor()
  const diff = getMatchDifficulty()
  // Alívio mais curto — alguém sempre volta a pressionar
  if (diff === 'expert') return relief < 0.16
  if (diff === 'hard') return relief < 0.2
  return relief < 0.18
}

export function shouldOpponentStandingSteal(holderTeam: TeamId): boolean {
  if (holderTeam !== getUserTeam()) return true
  const diff = getMatchDifficulty()
  if (diff === 'expert') return getUserPressReliefFactor() > 0.42
  if (diff === 'hard') return getUserPressReliefFactor() > 0.5
  if (diff === 'medium') return getUserPressReliefFactor() > 0.65
  return getUserPressReliefFactor() > 0.8
}

/**
 * Intensidade da perseguição ao portador humano.
 * Cai quando o jogador se afasta — a IA recua e volta à formação.
 * Em difícil/expert a IA segura a pressão bem mais longe.
 */
export function getMarkerPursuitIntensity(
  defendingTeam: TeamId,
  markerPos: { x: number; z: number },
  carrier: PlayerRef | null,
): number {
  if (!carrier || carrier.team === defendingTeam) return 1
  if (carrier.team !== getUserTeam()) return 1

  const zone = getUserBuildUpPressFactor(carrier)
  let intensity = getUserPressReliefFactor() * zone
  const pursuitMul = isOpponentTeam(defendingTeam)
    ? opponentTuning().pursuitMul
    : 1

  // No próprio campo: acompanha mais de perto (antes largava e “perdia” a bola)
  if (zone < 0.45) {
    const dist = distance2D(
      { x: markerPos.x, y: 0, z: markerPos.z },
      carrier.position,
    )
    if (dist > 4.2) return Math.min(0.38, 0.2 + zone * 0.35)
    return Math.min(0.58, 0.34 + zone * 0.4)
  }

  // Alívio pós-recuperação — ainda respira, mas a marcação volta logo
  if (intensity < 0.55) {
    const soft = intensity * (0.55 + pursuitMul * 0.32)
    return Math.max(0.32, Math.min(0.68, soft))
  }

  const dist = distance2D(
    { x: markerPos.x, y: 0, z: markerPos.z },
    carrier.position,
  )
  if (dist < 4.8 * pursuitMul * zone) return Math.min(0.98, zone * 1.0)

  const speed = Math.hypot(carrier.velocity.x, carrier.velocity.z)
  const pullingAway = speed > PLAYER_SPEED * 0.42
  const far = 8.2 / Math.max(pursuitMul * zone, 0.55)
  const mid = 6.2 / Math.max(pursuitMul * zone, 0.55)
  const near = 4.9 / Math.max(pursuitMul * zone, 0.55)

  if (dist > far) return Math.max(0.15, 0.18 * pursuitMul * zone)
  if (dist > mid && pullingAway) return Math.max(0.24, 0.3 * pursuitMul * zone)
  if (dist > near && pullingAway) return Math.max(0.34, 0.42 * pursuitMul * zone)
  if (dist > 3.8 && pullingAway) return Math.max(0.42, 0.55 * pursuitMul * zone)
  if (dist > 3.2) return Math.max(0.52, 0.68 * pursuitMul * zone)
  if (dist > 2.6 && pullingAway) return Math.min(0.95, 0.8 * pursuitMul * zone)
  return Math.min(1, intensity)
}

export function scalePressWeight(base: number, defendingTeam: TeamId): number {
  if (!isOpponentTeam(defendingTeam)) return base
  let w = base * opponentTuning().pressWeight * getUserBuildUpPressFactor()
  const relief = getUserPressReliefFactor()
  if (relief < 1) w *= 0.55 + relief * 0.45
  return clamp(w, 0, 1.0)
}

export function scaleMarkBlend(base: number, defendingTeam: TeamId): number {
  if (!isOpponentTeam(defendingTeam)) return base
  let w = base * opponentTuning().markBlend * getUserBuildUpPressFactor()
  const relief = getUserPressReliefFactor()
  if (relief < 1) w *= 0.55 + relief * 0.45
  return clamp(w, 0.12, 0.92)
}

export function scaleCompactDefense(base: number, defendingTeam: TeamId): number {
  if (!isOpponentTeam(defendingTeam)) return base
  const zone = getUserBuildUpPressFactor()
  // Compacto leve no build-up — sem colar o bloco no miolo
  const buildUpCompact = zone < 0.5 ? 1.05 + (0.5 - zone) * 0.2 : 1
  return clamp(base * opponentTuning().compactDefense * buildUpCompact, 0.08, 0.55)
}

export function scaleInterceptChance(base: number, defendingTeam: TeamId): number {
  if (!isOpponentTeam(defendingTeam)) return base
  let c = base * opponentTuning().interceptChance
  const relief = getUserPressReliefFactor()
  if (relief < 1) c *= 0.55 + relief * 0.45
  return clamp(c, 0.02, 1.0)
}

export function scaleStandingStealChance(base: number, stealerTeam: TeamId): number {
  if (!isOpponentTeam(stealerTeam)) return base
  let c = base * opponentTuning().standingStealChance * getUserBuildUpPressFactor()
  const relief = getUserPressReliefFactor()
  if (relief < 1) c *= 0.45 + relief * 0.55
  return clamp(c, 0.03, 0.95)
}

export function scaleStandingStealInterval(base: number, stealerTeam: TeamId): number {
  if (!isOpponentTeam(stealerTeam)) return base
  return base * opponentTuning().standingStealInterval
}

export function scaleSlideChance(base: number, sliderTeam: TeamId): number {
  if (!isOpponentTeam(sliderTeam)) return base
  let c = base * opponentTuning().slideChance * getUserBuildUpPressFactor()
  const relief = getUserPressReliefFactor()
  if (relief < 1) c *= 0.55 + relief * 0.45
  return clamp(c, 0.03, 0.92)
}

export function scaleSlideInterval(base: number, sliderTeam: TeamId): number {
  if (!isOpponentTeam(sliderTeam)) return base
  return base * opponentTuning().slideInterval
}

/** Ajusta disputa física conforme quem rouba e a dificuldade. */
export function adjustStealContestMargin(
  margin: number,
  stealerTeam: TeamId,
  holderTeam: TeamId,
  stealerIsActiveUser = false,
): number {
  const user = getUserTeam()
  const t = opponentTuning()
  if (stealerTeam === user && holderTeam !== user) {
    // Jogador controlado: bônus/malus de dificuldade.
    // IA aliada: sempre um leve bônus — senão no difícil fica impossível roubar.
    if (stealerIsActiveUser) return margin + t.userStealBonus
    return margin + Math.max(0.12, t.userStealBonus * 0.25 + 0.18)
  }
  if (holderTeam === user && stealerTeam !== user) {
    return margin + t.opponentStealBonus
  }
  return margin
}

/** Chance extra da IA do seu time no roubo em pé vs adversário. */
export function getUserTeammateStealChanceMul(): number {
  const diff = getMatchDifficulty()
  if (diff === 'expert') return 1.35
  if (diff === 'hard') return 1.42
  if (diff === 'medium') return 1.28
  return 1.55
}

/** Ajusta pontuação de posição para interceptar passe adversário. */
export function adjustInterceptScore(score: number, defendingTeam: TeamId): number {
  if (!isOpponentTeam(defendingTeam)) return score
  const mul = opponentTuning().interceptChance
  if (score <= 0) return score + (mul - 1) * 2.4
  return score * Math.min(mul, 1.35)
}

/** Largura da faixa de interceptação (passa mais candidatos em difícil). */
export function getInterceptLaneMaxDist(defendingTeam: TeamId): number {
  const base = 6.2
  if (!isOpponentTeam(defendingTeam)) return base
  return base * opponentTuning().interceptLaneMul
}

/** Multiplicador de threshold de cruzamento da IA atacante. */
export function getAICrossThresholdMul(attackingTeam: TeamId): number {
  if (!isOpponentTeam(attackingTeam)) return 1
  return opponentTuning().crossThresholdMul
}

/** Ajusta chance da IA finalizar cruzamento de voleio. */
export function adjustCrossVolleyScore(score: number, attackingTeam: TeamId): number {
  if (!isOpponentTeam(attackingTeam)) return score
  const mul = opponentTuning().interceptChance
  if (score <= 0) return score + (mul - 1) * 1.4
  return score * (0.72 + mul * 0.38)
}

/** Chance mul ao roubar o jogador em disputa em pé (shield do user). */
export function getOpponentStealVsUserChanceMul(): number {
  const diff = getMatchDifficulty()
  if (diff === 'expert') return 0.58
  if (diff === 'hard') return 0.48
  if (diff === 'medium') return 0.4
  return 0.28
}

/** Segundo homem na pressão — só aparece de verdade fora do terço defensivo do jogador. */
export function shouldAssignCoverPresser(
  defendingTeam: TeamId,
  carrierTeam: TeamId,
): boolean {
  if (!isOpponentTeam(defendingTeam)) return true
  if (carrierTeam !== getUserTeam()) return true
  const zone = getUserBuildUpPressFactor()
  if (zone < 0.45) return false
  const diff = getMatchDifficulty()
  const relief = getUserPressReliefFactor()
  if (diff === 'expert') return relief > 0.28 && zone > 0.52
  if (diff === 'hard') return relief > 0.38 && zone > 0.5
  if (diff === 'medium') return relief > 0.58 && zone > 0.58
  return relief > 0.9
}
