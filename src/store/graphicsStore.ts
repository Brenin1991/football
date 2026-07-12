import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  AAA_CANVAS_RESOLUTION_DEFAULT,
  type AaaCanvasResolutionId,
} from '../game/graphics/aaaSettings'

export type GraphicsMode = 'psx' | 'aaa'

interface GraphicsStore {
  mode: GraphicsMode
  aaaResolution: AaaCanvasResolutionId
  setMode: (mode: GraphicsMode) => void
  setAaaResolution: (resolution: AaaCanvasResolutionId) => void
}

export const useGraphicsStore = create<GraphicsStore>()(
  persist(
    (set) => ({
      mode: 'psx',
      aaaResolution: AAA_CANVAS_RESOLUTION_DEFAULT,
      setMode: (mode) => set({ mode }),
      setAaaResolution: (aaaResolution) => set({ aaaResolution }),
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
