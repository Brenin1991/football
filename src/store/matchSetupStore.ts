import { create } from 'zustand'
import type { TeamWithPlayers } from '../db/types'
import { menuSfx } from '../menu/menuSfx'

import type { DifficultyId } from '../game/systems/difficulty'

export type ControlMode = 'team' | 'pro'

export type MatchSession = {
  home: TeamWithPlayers
  away: TeamWithPlayers
  stadium: string
  matchType: string
  playerSide: 'home' | 'away'
  difficulty: DifficultyId
  controlMode: ControlMode
  /** Slot do elenco controlado no modo Pro (1–10; 0 = GK) */
  proSlotIndex: number
}

export type MatchSetupStep = 'side' | 'team' | 'prematch' | 'player' | 'loading'

export type MatchSetupDraft = {
  step: MatchSetupStep
  playerSide: 'home' | 'away'
  difficulty: DifficultyId
  controlMode: ControlMode
  proSlotIndex: number
  homeTeamId: string | null
  awayTeamId: string | null
  homeLeagueId: string | null
  awayLeagueId: string | null
  homeKit: 1 | 2
  awayKit: 1 | 2
}

const initialDraft = (): MatchSetupDraft => ({
  step: 'side',
  playerSide: 'home',
  difficulty: 'medium',
  controlMode: 'team',
  proSlotIndex: 9,
  homeTeamId: null,
  awayTeamId: null,
  homeLeagueId: null,
  awayLeagueId: null,
  homeKit: 1,
  awayKit: 2,
})

interface MatchSetupStore {
  session: MatchSession | null
  draft: MatchSetupDraft | null
  setSession: (session: MatchSession) => void
  clearSession: () => void
  startSetup: () => void
  clearSetup: () => void
  setSetupStep: (step: MatchSetupStep) => void
  patchDraft: (patch: Partial<MatchSetupDraft>) => void
  /** Volta uma etapa no fluxo; retorna `menu` se deve sair para o menu principal. */
  backSetupStep: () => 'handled' | 'menu'
}

export const useMatchSetupStore = create<MatchSetupStore>((set, get) => ({
  session: null,
  draft: null,
  setSession: (session) => set({ session }),
  clearSession: () => set({ session: null }),
  startSetup: () => set({ draft: initialDraft() }),
  clearSetup: () => set({ draft: null }),
  setSetupStep: (step) =>
    set((state) => {
      if (!state.draft) return state
      if (state.draft.step !== step) menuSfx.playOpen()
      return { draft: { ...state.draft, step } }
    }),
  patchDraft: (patch) =>
    set((state) => (state.draft ? { draft: { ...state.draft, ...patch } } : state)),
  backSetupStep: () => {
    const draft = get().draft
    if (!draft) return 'menu'

    if (draft.step === 'side') {
      set({ draft: null })
      return 'menu'
    }

    let previousStep: MatchSetupStep = 'side'
    if (draft.step === 'loading') {
      previousStep = draft.controlMode === 'pro' ? 'player' : 'prematch'
    } else if (draft.step === 'player') {
      previousStep = 'prematch'
    } else if (draft.step === 'prematch') {
      previousStep = 'team'
    } else if (draft.step === 'team') {
      previousStep = 'side'
    }

    menuSfx.playOpen()
    set({ draft: { ...draft, step: previousStep } })
    return 'handled'
  },
}))
