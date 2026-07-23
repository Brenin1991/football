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

/**
 * Mixer manual — mapeia clips GLB → animações lógicas player_*.
 * Passe o `root` atual (clone do skeleton). Quando o clone muda (formação /
 * elenco no pause), as actions são recriadas nele — senão fica T-pose.
 */
export function usePlayerMixer(
  clips: AnimationClip[],
  rootRef: React.RefObject<THREE.Object3D | null>,
  root: THREE.Object3D | null | undefined,
) {
  const mixer = useMemo(
    () => new THREE.AnimationMixer(undefined as unknown as THREE.Object3D),
    [],
  )
  const lazy = useRef<Partial<Record<string, THREE.AnimationAction>>>({})
  const boundRoot = useRef<THREE.Object3D | null>(null)

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

  // Skeleton novo → invalida actions do root antigo
  useLayoutEffect(() => {
    const prev = boundRoot.current
    mixer.stopAllAction()
    lazy.current = {}
    if (prev && prev !== root) {
      try {
        mixer.uncacheRoot(prev)
      } catch {
        /* root já descartado */
      }
    }
    boundRoot.current = root ?? null
    if (root && rootRef.current !== root) {
      rootRef.current = root
    }
  }, [root, mixer, rootRef])

  useLayoutEffect(() => {
    return () => {
      mixer.stopAllAction()
      const prev = boundRoot.current
      if (prev) {
        try {
          mixer.uncacheRoot(prev)
        } catch {
          /* ignore */
        }
      }
      lazy.current = {}
      boundRoot.current = null
    }
  }, [mixer])

  const actions = useMemo(() => {
    lazy.current = {}
    const map: Partial<Record<ClipAnimName, THREE.AnimationAction>> = {}
    const bindTarget = root

    for (const [animName, clip] of animToClip) {
      Object.defineProperty(map, animName, {
        enumerable: true,
        configurable: true,
        get() {
          const target = bindTarget ?? rootRef.current
          if (!target) return undefined
          const key = `${animName}:${clip.name}`
          const existing = lazy.current[key]
          if (existing && existing.getRoot() === target) return existing
          const action = mixer.clipAction(clip, target)
          lazy.current[key] = action
          boundRoot.current = target
          return action
        },
      })
    }

    return map
  }, [animToClip, mixer, rootRef, root])

  return { mixer, actions, animToClip }
}
