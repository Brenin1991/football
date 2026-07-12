import type { GoalkeeperAnim } from '../types'

/**
 * Durações reais dos clips GK no player.glb (s).
 * miss_middle é a mais longa — precisa do maior lead de commit.
 */
export const GK_ANIM_DURATION_SEC: Record<GoalkeeperAnim, number> = {
  gk_idle: 1,
  gk_idle_ball: 1,
  gk_catch: 0.996,
  gk_hand_pass: 0.984,
  gk_miss_middle: 1.18,
  gk_diving_save_left: 1.02,
  gk_diving_save_right: 1,
  gk_body_save_left: 0.997,
  gk_body_save_right: 0.612,
}

/** Fração do clip até o goleiro estar na pose de contato */
export const GK_ANIM_CONTACT_RATIO: Partial<Record<GoalkeeperAnim, number>> = {
  gk_miss_middle: 0.62,
  gk_diving_save_left: 0.54,
  gk_diving_save_right: 0.52,
  gk_body_save_left: 0.5,
  gk_body_save_right: 0.48,
  gk_catch: 0.46,
}

const GK_REACTION_BUFFER_SEC = 0.07

export type GkCommitWindowOpts = {
  lowBall?: boolean
  shotDistance?: number
  preShot?: boolean
  preShotImminent?: boolean
  /** Variação aleatória por ameaça — positivo = reage mais cedo */
  jitter?: number
}

export function getGkAnimDuration(anim: GoalkeeperAnim | null): number {
  if (!anim) return GK_ANIM_DURATION_SEC.gk_body_save_left
  return GK_ANIM_DURATION_SEC[anim] ?? 0.9
}

export function getGkAnimContactRatio(anim: GoalkeeperAnim | null): number {
  if (!anim) return 0.46
  return GK_ANIM_CONTACT_RATIO[anim] ?? 0.5
}

function baseAnimLead(anim: GoalkeeperAnim | null): number {
  return (
    getGkAnimDuration(anim) * getGkAnimContactRatio(anim) + GK_REACTION_BUFFER_SEC
  )
}

/**
 * Segundos antes da bola chegar para iniciar a defesa.
 * Perto do gol → janela maior (reage mais cedo). Longe → janela curta.
 */
export function getGkCommitWindow(
  anim: GoalkeeperAnim | null,
  opts: GkCommitWindowOpts = {},
): number {
  const base = baseAnimLead(anim)
  const d = opts.shotDistance ?? 12
  const farT = Math.max(0, Math.min(1, (d - 3) / 14))
  const closeT = 1 - farT
  const jitter = opts.jitter ?? 0

  if (opts.lowBall) {
    let window =
      base * (0.24 + closeT * 1.08) + closeT * closeT * 0.32 + jitter

    if (d < 4) window += 0.22
    else if (d < 6.5) window += 0.14
    else if (d < 9) window += 0.06

    if (opts.preShot && !opts.preShotImminent) window *= 0.48

    return Math.max(0.1, window)
  }

  let window =
    base + jitter + (opts.preShotImminent ? 0.16 : opts.preShot ? 0.05 : 0.1)
  window += closeT * closeT * 0.24
  if (d < 5) window += 0.14
  else if (d < 8) window += 0.07

  return window
}

/** @deprecated use getGkCommitWindow */
export function getGkSaveCommitLead(
  anim: GoalkeeperAnim | null,
  opts?: { lowBall?: boolean; shotDistance?: number },
): number {
  return getGkCommitWindow(anim, {
    lowBall: opts?.lowBall,
    shotDistance: opts?.shotDistance,
  })
}

/** Jitter por ameaça — leve viés pra reagir um pouco mais cedo */
export function rollGkCommitJitter(): number {
  return Math.random() * 0.18 - 0.02
}

/** player_shoot — tempo até a bola sair do pé */
export const PLAYER_SHOOT_PLAYBACK_SEC = 0.503 * 1.32
export const PLAYER_SHOOT_CONTACT_SEC = PLAYER_SHOOT_PLAYBACK_SEC * 0.22
