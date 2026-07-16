import { useGameStore } from '../store/gameStore'
import { replaySystem } from './replaySystem'

const GOAL_CELEBRATION_SCALE = 0.85
export const BASE_PHYSICS_STEP = 1 / 60
/** Mesmo passo da simulação Rapier — lógica customizada deve usar isso */
export const FIXED_SIM_STEP = BASE_PHYSICS_STEP
/** Evita espirais de morte em queda de FPS (≈8× 60 Hz por frame) */
export const MAX_SIM_STEPS_PER_FRAME = 8
const MAX_SIM_DELTA = FIXED_SIM_STEP * MAX_SIM_STEPS_PER_FRAME

export const TIME_SCALE_STEPS = [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2] as const

/** Limita delta de simulação — evita instabilidade em queda brusca de FPS */
export function clampSimDelta(delta: number): number {
  if (delta <= 0) return 0
  return Math.min(delta, MAX_SIM_DELTA)
}

/**
 * Integra lógica dependente de delta em passos fixos (estilo Gaffer on Games).
 * Molas/impulsos da bola ficam estáveis em 30 FPS ou menos.
 */
export function forEachFixedSimStep(
  delta: number,
  fn: (stepDt: number) => void,
): void {
  const total = clampSimDelta(delta)
  if (total <= 0) return

  let remaining = total
  let steps = 0

  while (remaining > FIXED_SIM_STEP * 0.25 && steps < MAX_SIM_STEPS_PER_FRAME) {
    const stepDt = Math.min(FIXED_SIM_STEP, remaining)
    fn(stepDt)
    remaining -= stepDt
    steps++
  }

  if (remaining > 1e-5 && steps < MAX_SIM_STEPS_PER_FRAME) {
    fn(remaining)
  }
}

/** Delta escalado para simulação (movimento, timers, relógio da partida). */
export function getSimDelta(clockDelta: number): number {
  const { phase, timeScale } = useGameStore.getState()

  let scaled: number
  if (phase === 'replay') {
    scaled = clockDelta * replaySystem.getPlaybackSpeed() * timeScale
  } else if (phase === 'goal-celebration') {
    scaled = clockDelta * GOAL_CELEBRATION_SCALE * timeScale
  } else {
    scaled = clockDelta * timeScale
  }

  return clampSimDelta(scaled)
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
