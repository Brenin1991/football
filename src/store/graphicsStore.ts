import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type GraphicsMode = 'psx' | 'aaa'

interface GraphicsStore {
  mode: GraphicsMode
  setMode: (mode: GraphicsMode) => void
}

export const useGraphicsStore = create<GraphicsStore>()(
  persist(
    (set) => ({
      mode: 'psx',
      setMode: (mode) => set({ mode }),
    }),
    { name: 'futebol-graphics-mode' },
  ),
)

export function getGraphicsMode(): GraphicsMode {
  return useGraphicsStore.getState().mode
}

export function isAaaGraphics(): boolean {
  return getGraphicsMode() === 'aaa'
}
