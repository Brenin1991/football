import { useGLTF } from '@react-three/drei'
import { createContext, useContext, useMemo, type ReactNode } from 'react'
import type { AnimationClip, Group } from 'three'

type PlayerAssets = {
  scene: Group
  animations: AnimationClip[]
}

const PlayerAssetsContext = createContext<PlayerAssets | null>(null)

useGLTF.preload('/models/player.glb')

export function PlayerAssetsProvider({ children }: { children: ReactNode }) {
  const { scene, animations } = useGLTF('/models/player.glb')
  const value = useMemo(() => {
    const root = scene as Group
    return { scene: root, animations: animations as AnimationClip[] }
  }, [scene, animations])
  return (
    <PlayerAssetsContext.Provider value={value}>
      {children}
    </PlayerAssetsContext.Provider>
  )
}

export function usePlayerAssets() {
  const ctx = useContext(PlayerAssetsContext)
  if (!ctx) throw new Error('usePlayerAssets must be used inside PlayerAssetsProvider')
  return ctx
}
