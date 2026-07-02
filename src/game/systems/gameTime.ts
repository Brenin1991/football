import { useGameStore } from '../store/gameStore'
import { replaySystem } from './replaySystem'

const GOAL_CELEBRATION_SCALE = 0.85
const BASE_PHYSICS_STEP = 1 / 60

export const TIME_SCALE_STEPS = [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2] as const

/** Delta escalado para simulação (movimento, timers, relógio da partida). */
export function getSimDelta(clockDelta: number): number {
  const { phase, timeScale } = useGameStore.getState()

  if (phase === 'replay') {
    return clockDelta * replaySystem.getPlaybackSpeed() * timeScale
  }
  if (phase === 'goal-celebration') {
    return clockDelta * GOAL_CELEBRATION_SCALE * timeScale
  }
  return clockDelta * timeScale
}

export function isUserPauseActive(): boolean {
  return useGameStore.getState().timeScale === 0
}

/** Só pausa física na pausa manual — replay/comemoração precisam do step p/ corpos cinemáticos. */
export function isPhysicsPaused(): boolean {
  return isUserPauseActive()
}

export function getPhysicsTimeStep(): number {
  const { phase, timeScale } = useGameStore.getState()
  if (isUserPauseActive()) return BASE_PHYSICS_STEP
  if (phase === 'replay' || phase === 'goal-celebration') return BASE_PHYSICS_STEP
  return BASE_PHYSICS_STEP * Math.max(0.01, timeScale)
}

export function formatTimeScale(scale: number): string {
  if (scale === 0) return 'Pausa'
  if (scale === 1) return '1×'
  return `${scale.toFixed(2).replace(/\.?0+$/, '')}×`
}

function nearestStepIndex(scale: number): number {
  let best = 0
  let bestDist = Infinity
  for (let i = 0; i < TIME_SCALE_STEPS.length; i++) {
    const dist = Math.abs(TIME_SCALE_STEPS[i] - scale)
    if (dist < bestDist) {
      bestDist = dist
      best = i
    }
  }
  return best
}

export function stepTimeScale(current: number, direction: -1 | 1): number {
  const idx = nearestStepIndex(current)
  const next = Math.max(0, Math.min(TIME_SCALE_STEPS.length - 1, idx + direction))
  return TIME_SCALE_STEPS[next]
}
