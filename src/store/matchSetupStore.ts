import { create } from 'zustand'
import type { TeamWithPlayers } from '../db/types'
import { menuSfx } from '../menu/menuSfx'

export type MatchSession = {
  home: TeamWithPlayers
  away: TeamWithPlayers
  stadium: string
  matchType: string
  playerSide: 'home' | 'away'
}

export type MatchSetupStep = 'side' | 'team' | 'kit' | 'loading'

export type MatchSetupDraft = {
  step: MatchSetupStep
  playerSide: 'home' | 'away'
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

    const previousStep: MatchSetupStep =
      draft.step === 'loading' ? 'kit' : draft.step === 'kit' ? 'team' : 'side'

    menuSfx.playOpen()
    set({ draft: { ...draft, step: previousStep } })
    return 'handled'
  },
}))
