import { create } from 'zustand'

export type AppView = 'menu' | 'match-setup' | 'team-management' | 'editor' | 'game'

interface AppStore {
  view: AppView
  dbReady: boolean
  dbVersion: number
  gameSessionKey: number
  setView: (view: AppView) => void
  setDbReady: (ready: boolean) => void
  bumpDbVersion: () => void
  startGame: () => void
}

export const useAppStore = create<AppStore>((set) => ({
  view: 'menu',
  dbReady: false,
  dbVersion: 0,
  gameSessionKey: 0,
  setView: (view) => set({ view }),
  setDbReady: (ready) => set({ dbReady: ready }),
  bumpDbVersion: () => set((s) => ({ dbVersion: s.dbVersion + 1 })),
  startGame: () => set((s) => ({ view: 'game', gameSessionKey: s.gameSessionKey + 1 })),
}))
