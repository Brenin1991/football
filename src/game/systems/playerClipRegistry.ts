import type { AnimationClip } from 'three'
import type { PlayerAnim, PlayerLocoAnim, PlayerStrikeAnim } from '../types'

/** Ordem de fallback — primeiro clip que existir no GLB */
export const PLAYER_CLIP_ALIASES: Record<PlayerAnim, readonly string[]> = {
  player_idle: ['player_idle', 'idle'],
  player_walking: ['player_walking', 'run', 'player_run'],
  player_run: ['player_run', 'run'],
  player_backward: ['player_backward'],
  player_left: ['player_left'],
  player_right: ['player_right'],
  player_pass: ['player_pass', 'pass'],
  player_kick: ['player_kick', 'kick'],
  player_shoot: ['player_shoot', 'shoot'],
  player_tackle: ['player_tackle', 'carrinho'],
  player_trip: ['player_trip', 'cair'],
  player_header: ['player_header'],
  player_receive: ['player_receive'],
  player_throw_in: ['player_throw_in'],
  player_spin: ['player_spin'],
}

export const PLAYER_LOCO_ANIMS: PlayerLocoAnim[] = [
  'player_idle',
  'player_walking',
  'player_run',
  'player_backward',
  'player_left',
  'player_right',
]

export const PLAYER_STRIKE_ANIMS: PlayerStrikeAnim[] = [
  'player_pass',
  'player_kick',
  'player_shoot',
]

export const PLAYER_ACTION_ANIMS: PlayerAnim[] = [
  ...PLAYER_STRIKE_ANIMS,
  'player_tackle',
  'player_trip',
  'player_header',
  'player_receive',
  'player_throw_in',
  'player_spin',
]

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
  run: 'player_run',
  pass: 'player_pass',
  kick: 'player_kick',
  shoot: 'player_shoot',
  carrinho: 'player_tackle',
  cair: 'player_trip',
}

export function normalizePlayerAnim(anim: string): PlayerAnim {
  return (LEGACY_ANIM_MAP[anim] ?? anim) as PlayerAnim
}
