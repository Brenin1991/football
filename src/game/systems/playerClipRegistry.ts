import type { AnimationClip } from 'three'
import type { PlayerAnim, PlayerLocoAnim, PlayerStrikeAnim } from '../types'

/** Ordem de fallback — primeiro clip que existir no GLB */
export const PLAYER_CLIP_ALIASES: Record<PlayerAnim, readonly string[]> = {
  player_idle: ['player_idle', 'idle'],
  idle_01: ['idle_01'],
  idle_02: ['idle_02'],
  idle_03: ['idle_03'],
  idle_04: ['idle_04'],
  idle_05: ['idle_05'],
  player_walking: ['player_walking', 'run', 'player_run'],
  player_run: ['player_run', 'run'],
  player_backward: ['player_backward'],
  player_left: ['player_left'],
  player_right: ['player_right'],
  /** Legacy — prefer short/long via pickPassStrikeAnim */
  player_pass: ['player_pass'],
  /** Parado / walking / toque curto */
  player_pass_short: ['player_pass_02'],
  /** Sprint ou passe longo */
  player_pass_long: ['player_pass_long', 'pass_long', 'player_shoot', 'player_kick'],
  /** Legacy genérico */
  player_kick: ['player_kick', 'player_kick_medium', 'kick'],
  /** Chute forte (barra alta) */
  player_kick_high: ['player_kick'],
  /** Chute médio */
  player_kick_medium: ['player_shoot'],
  /** Chute fraco / toque */
  player_kick_low: ['player_shoot'],
  /** Legacy — usa medium por padrão */
  player_shoot: ['player_kick_medium', 'player_kick', 'kick'],
  player_tackle: ['player_tackle', 'carrinho'],
  player_trip: ['player_trip', 'cair'],
  player_header: ['player_header'],
  player_receive: ['player_receive'],
  player_throw_in: ['player_throw_in'],
  player_spin: ['player_spin'],
  player_finta_01: ['player_finta_01'],
  player_finta_180: ['player_finta_180'],
  player_imbalance_01: ['player_imbalance_01'],
  player_imbalance_stolen: ['player_imbalance_01.001', 'player_imbalance_stolen'],
  player_shoulder_charge: ['player_shoulder_charge'],
  player_run_stop: ['player_run_stop'],
  celebration_01: ['celebration_01'],
  celebration_02: ['celebration_02'],
  celebration_03: ['celebration_03'],
  celebration_04: ['celebration_04'],
  celebration_05: ['celebration_05'],
  celebration_06: ['celebration_06'],
  celebration_07: ['celebration_07'],
}

export const PLAYER_IDLE_VARIANT_ANIMS = [
  'idle_01',
  'idle_02',
  'idle_03',
  'idle_04',
  'idle_05',
] as const

export const PLAYER_LOCO_ANIMS: PlayerLocoAnim[] = [
  'player_idle',
  'idle_01',
  'idle_02',
  'idle_03',
  'idle_04',
  'idle_05',
  'player_walking',
  'player_run',
  'player_backward',
  'player_left',
  'player_right',
]

export function isStandingIdleAnim(name: string): boolean {
  return name === 'player_idle' || name.startsWith('idle_')
}

export const PLAYER_STRIKE_ANIMS: PlayerStrikeAnim[] = [
  'player_pass',
  'player_pass_short',
  'player_pass_long',
  'player_kick',
  'player_kick_high',
  'player_kick_medium',
  'player_kick_low',
  'player_shoot',
]

/** Distância acima disso → animação de passe longo (mesmo andando). */
export const PASS_LONG_ANIM_DIST = 12

/** Barra: fraco / médio / forte */
export const SHOT_KICK_LOW_MAX = 0.4
export const SHOT_KICK_HIGH_MIN = 0.72

/**
 * Parado / walking / toque curto → short.
 * Sprint ou passe mais longo (through / distância) → long.
 */
export function pickPassStrikeAnim(opts: {
  moveSpeed: number
  sprinting?: boolean
  dist?: number
  through?: boolean
  cross?: boolean
  walkSpeed?: number
}): PlayerStrikeAnim {
  if (opts.cross || opts.through) return 'player_pass_long'
  const walk = opts.walkSpeed ?? 0
  const sprinting =
    !!opts.sprinting || (walk > 0 && opts.moveSpeed > walk * 1.08)
  if (sprinting) return 'player_pass_long'
  if ((opts.dist ?? 0) >= PASS_LONG_ANIM_DIST) return 'player_pass_long'
  return 'player_pass_short'
}

/** Chute: low / medium / high conforme a força (0..1). */
export function pickShotStrikeAnim(power: number): PlayerStrikeAnim {
  const t = Math.max(0, Math.min(1, power))
  if (t < SHOT_KICK_LOW_MAX) return 'player_kick_low'
  if (t >= SHOT_KICK_HIGH_MIN) return 'player_kick_high'
  return 'player_kick_medium'
}

export function isShotStrikeAnim(name: string): boolean {
  return (
    name === 'player_shoot' ||
    name === 'player_kick' ||
    name === 'player_kick_high' ||
    name === 'player_kick_medium' ||
    name === 'player_kick_low'
  )
}

export const PLAYER_ACTION_ANIMS: PlayerAnim[] = [
  ...PLAYER_STRIKE_ANIMS,
  'player_tackle',
  'player_trip',
  'player_header',
  'player_receive',
  'player_throw_in',
  'player_spin',
  'player_finta_01',
  'player_finta_180',
  'player_imbalance_01',
  'player_imbalance_stolen',
  'player_shoulder_charge',
  'player_run_stop',
  'celebration_01',
  'celebration_02',
  'celebration_03',
  'celebration_04',
  'celebration_05',
  'celebration_06',
  'celebration_07',
]

export const PLAYER_CELEBRATION_ANIMS = [
  'celebration_01',
  'celebration_02',
  'celebration_03',
  'celebration_04',
  'celebration_05',
  'celebration_06',
  'celebration_07',
] as const

export function buildClipNameSet(clips: AnimationClip[]): Set<string> {
  return new Set(clips.map((c) => c.name))
}

export function resolveClipName(
  anim: PlayerAnim,
  available: Set<string>,
): string | null {
  for (const name of PLAYER_CLIP_ALIASES[anim]) {
    if (available.has(name)) return name
  }
  return null
}

/** Mapeia clip GLB → anim lógica (para mixer lazy) */
export function buildClipToAnimMap(clips: AnimationClip[]): Map<string, PlayerAnim> {
  const available = buildClipNameSet(clips)
  const map = new Map<string, PlayerAnim>()
  for (const anim of Object.keys(PLAYER_CLIP_ALIASES) as PlayerAnim[]) {
    const resolved = resolveClipName(anim, available)
    if (resolved) map.set(resolved, anim)
  }
  return map
}

/** Converte nomes antigos gravados no replay */
export const LEGACY_ANIM_MAP: Record<string, PlayerAnim> = {
  idle: 'player_idle',
  idle_01: 'idle_01',
  idle_02: 'idle_02',
  idle_03: 'idle_03',
  idle_04: 'idle_04',
  idle_05: 'idle_05',
  run: 'player_run',
  pass: 'player_pass_short',
  player_pass: 'player_pass_short',
  pass_long: 'player_pass_long',
  kick: 'player_kick_medium',
  player_kick: 'player_kick_medium',
  player_kick_high: 'player_kick_high',
  player_kick_medium: 'player_kick_medium',
  player_kick_low: 'player_kick_low',
  shoot: 'player_shoot',
  carrinho: 'player_tackle',
  cair: 'player_trip',
}

export function normalizePlayerAnim(anim: string): PlayerAnim {
  return (LEGACY_ANIM_MAP[anim] ?? anim) as PlayerAnim
}
