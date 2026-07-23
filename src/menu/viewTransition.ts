import type { AppView } from '../store/appStore'

export const VIEW_TRANSITION_MS = 580

const VIEW_DEPTH: Record<AppView, number> = {
  menu: 0,
  'match-setup': 1,
  'team-management': 1,
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

/**
 * Coordinates screen-level and element-level motion so they never overlap.
 * While a view transition (whole-screen slide/fade) is running, per-element
 * entrance animations should stay idle — otherwise the same content animates
 * twice at once. The grace window covers the remount that happens right when
 * the transition finishes.
 */
let viewTransitionEndsAt = 0

export function beginViewTransitionWindow() {
  viewTransitionEndsAt = performance.now() + VIEW_TRANSITION_MS
}

export function isViewTransitionActive() {
  return performance.now() < viewTransitionEndsAt + 120
}
