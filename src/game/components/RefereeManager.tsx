import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import { useGameStore } from '../store/gameStore'
import { updateRefereeFollow, whistleForPhase } from '../systems/referee'
import { getSimDelta } from '../systems/gameTime'

export function RefereeManager() {
  const fieldBounds = useGameStore((s) => s.fieldBounds)
  const prevPhaseRef = useRef<string | null>(null)

  useFrame((_, delta) => {
    const store = useGameStore.getState()
    if (!fieldBounds) return

    if (store.phase !== prevPhaseRef.current) {
      if (prevPhaseRef.current != null) {
        const skipGoalRepeat =
          store.phase === 'goal' && prevPhaseRef.current === 'goal-celebration'
        if (!skipGoalRepeat) {
          whistleForPhase(store.phase)
        }
      }
      prevPhaseRef.current = store.phase
    }

    updateRefereeFollow(getSimDelta(delta), fieldBounds)
  })

  return null
}
