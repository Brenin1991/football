import type { MatchPhase } from '../types'

/** Fases em que jogadores seguem o entranceSystem (entrada/saída do campo) */
export function isFieldParadePhase(phase: MatchPhase): boolean {
  return (
    phase === 'intro' ||
    phase === 'half-time-exit' ||
    phase === 'half-time-enter' ||
    phase === 'full-time-exit'
  )
}
