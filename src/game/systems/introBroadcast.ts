export type IntroBroadcastPanel =
  | 'match'
  | 'home-lineup'
  | 'away-lineup'
  | 'officials'

const PANEL_WINDOWS: { panel: IntroBroadcastPanel; start: number; end: number }[] = [
  { panel: 'match', start: 2.5, end: 11 },
  { panel: 'home-lineup', start: 13, end: 22 },
  { panel: 'away-lineup', start: 22, end: 31 },
  { panel: 'officials', start: 33, end: 42 },
]

export function getIntroBroadcastPanel(elapsed: number): IntroBroadcastPanel | null {
  for (const window of PANEL_WINDOWS) {
    if (elapsed >= window.start && elapsed < window.end) {
      return window.panel
    }
  }
  return null
}

export function isIntroBroadcastVisible(elapsed: number): boolean {
  return elapsed >= 0.6
}

export function getIntroPanelFade(elapsed: number, panel: IntroBroadcastPanel): number {
  const window = PANEL_WINDOWS.find((w) => w.panel === panel)
  if (!window) return 0

  const fadeIn = 0.65
  const fadeOut = 0.5
  const { start, end } = window

  if (elapsed < start || elapsed >= end) return 0
  if (elapsed < start + fadeIn) return (elapsed - start) / fadeIn
  if (elapsed > end - fadeOut) return (end - elapsed) / fadeOut
  return 1
}
