import type { AppView } from '../store/appStore'

export const VIEW_TRANSITION_MS = 580

const VIEW_DEPTH: Record<AppView, number> = {
  menu: 0,
  'match-setup': 1,
  editor: 1,
  game: 2,
}

export type ViewTransitionMode = 'slide-forward' | 'slide-back' | 'fade'

export function getViewTransitionMode(from: AppView, to: AppView): ViewTransitionMode {
  if (from === 'game' || to === 'game') return 'fade'
  if (VIEW_DEPTH[to] > VIEW_DEPTH[from]) return 'slide-forward'
  if (VIEW_DEPTH[to] < VIEW_DEPTH[from]) return 'slide-back'
  return 'slide-forward'
}
