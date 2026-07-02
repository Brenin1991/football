import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { AnimationClip } from 'three'
import type { PlayerAnim } from '../types'

/** Mixer manual — sem useFrame interno; o jogo atualiza com simDelta */
export function usePlayerMixer(
  clips: AnimationClip[],
  rootRef: React.RefObject<THREE.Object3D | null>,
) {
  const mixer = useMemo(
    () => new THREE.AnimationMixer(undefined as unknown as THREE.Object3D),
    [],
  )
  const lazy = useRef<Partial<Record<string, THREE.AnimationAction>>>({})

  useLayoutEffect(() => {
    // mixer root é definido por clipAction(clip, root) a cada getter
    void rootRef.current
  })

  const actions = useMemo(() => {
    lazy.current = {}
    const map: Partial<Record<PlayerAnim, THREE.AnimationAction>> = {}
    for (const clip of clips) {
      Object.defineProperty(map, clip.name, {
        enumerable: true,
        configurable: true,
        get() {
          const root = rootRef.current
          if (!root) return undefined
          const key = clip.name
          if (!lazy.current[key]) {
            lazy.current[key] = mixer.clipAction(clip, root)
          }
          return lazy.current[key]
        },
      })
    }
    return map
  }, [clips, mixer])

  return { mixer, actions }
}
