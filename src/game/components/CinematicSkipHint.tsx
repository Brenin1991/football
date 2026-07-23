import { useGameStore } from '../store/gameStore'

/** Dica de skip em intro / comemoração / replay */
export function CinematicSkipHint() {
  const phase = useGameStore((s) => s.phase)
  if (
    phase !== 'intro' &&
    phase !== 'replay' &&
    phase !== 'goal-celebration'
  ) {
    return null
  }

  return (
    <div className="cinematic-skip-hint" aria-hidden>
      <span className="cinematic-skip-hint__key">A</span>
      <span className="cinematic-skip-hint__label">pular</span>
    </div>
  )
}
