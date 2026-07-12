import type { AnimationClip } from 'three'
import type { GoalkeeperAnim } from '../types'
import { buildClipNameSet } from './playerClipRegistry'

/** Ordem de fallback — primeiro clip que existir no GLB */
export const GK_CLIP_ALIASES: Record<GoalkeeperAnim, readonly string[]> = {
  gk_idle: ['gk_idle'],
  gk_idle_ball: ['gk_idle_ball'],
  gk_catch: ['goalkeeper_catch', 'gk_catch'],
  gk_diving_save_left: ['gk_diving_save_left'],
  gk_diving_save_right: ['gk_diving_save_right'],
  gk_body_save_left: ['gk_body_save_left'],
  gk_body_save_right: ['gk_body_save_right'],
  gk_miss_middle: ['gk_miss_middle'],
  gk_hand_pass: ['gk_hand_pass'],
}

export function resolveGkClipName(
  anim: GoalkeeperAnim,
  available: Set<string>,
): string | null {
  for (const name of GK_CLIP_ALIASES[anim]) {
    if (available.has(name)) return name
  }
  return null
}

export function buildGkClipToAnimMap(clips: AnimationClip[]): Map<string, GoalkeeperAnim> {
  const available = buildClipNameSet(clips)
  const map = new Map<string, GoalkeeperAnim>()
  for (const anim of Object.keys(GK_CLIP_ALIASES) as GoalkeeperAnim[]) {
    const resolved = resolveGkClipName(anim, available)
    if (resolved) map.set(resolved, anim)
  }
  return map
}
