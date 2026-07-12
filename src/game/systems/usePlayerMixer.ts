import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { AnimationClip } from 'three'
import type { GoalkeeperAnim, PlayerAnim } from '../types'
import {
  buildClipNameSet,
  PLAYER_CLIP_ALIASES,
  resolveClipName,
} from './playerClipRegistry'
import { GK_CLIP_ALIASES, resolveGkClipName } from './gkClipRegistry'

export type ClipAnimName = PlayerAnim | GoalkeeperAnim

/** Mixer manual — mapeia clips GLB → animações lógicas player_* */
export function usePlayerMixer(
  clips: AnimationClip[],
  rootRef: React.RefObject<THREE.Object3D | null>,
) {
  const mixer = useMemo(
    () => new THREE.AnimationMixer(undefined as unknown as THREE.Object3D),
    [],
  )
  const lazy = useRef<Partial<Record<string, THREE.AnimationAction>>>({})

  const animToClip = useMemo(() => {
    const available = buildClipNameSet(clips)
    const map = new Map<string, AnimationClip>()
    for (const anim of Object.keys(PLAYER_CLIP_ALIASES) as PlayerAnim[]) {
      const resolved = resolveClipName(anim, available)
      if (!resolved) continue
      const clip = clips.find((c) => c.name === resolved)
      if (clip) map.set(anim, clip)
    }
    for (const anim of Object.keys(GK_CLIP_ALIASES) as GoalkeeperAnim[]) {
      const resolved = resolveGkClipName(anim, available)
      if (!resolved) continue
      const clip = clips.find((c) => c.name === resolved)
      if (clip) map.set(anim, clip)
    }
    for (const clip of clips) {
      if (clip.name.startsWith('gk_') && !map.has(clip.name)) map.set(clip.name, clip)
    }
    return map
  }, [clips])

  useLayoutEffect(() => {
    void rootRef.current
  })

  const actions = useMemo(() => {
    lazy.current = {}
    const map: Partial<Record<ClipAnimName, THREE.AnimationAction>> = {}

    for (const [animName, clip] of animToClip) {
      Object.defineProperty(map, animName, {
        enumerable: true,
        configurable: true,
        get() {
          const root = rootRef.current
          if (!root) return undefined
          const key = `${animName}:${clip.name}`
          if (!lazy.current[key]) {
            lazy.current[key] = mixer.clipAction(clip, root)
          }
          return lazy.current[key]
        },
      })
    }

    return map
  }, [animToClip, mixer])

  return { mixer, actions, animToClip }
}
