import type { ReactNode } from 'react'
import { useGameStore } from '../store/gameStore'
import { getPhysicsTimeStep, isPhysicsPaused } from '../systems/gameTime'
import { Physics } from '@react-three/rapier'

export function PhysicsWorld({ children }: { children: ReactNode }) {
  useGameStore((s) => s.timeScale)
  useGameStore((s) => s.phase)

  return (
    <Physics
      gravity={[0, -9.81, 0]}
      timeStep={getPhysicsTimeStep()}
      paused={isPhysicsPaused()}
      interpolate
      maxCcdSubsteps={2}
      numSolverIterations={4}
    >
      {children}
    </Physics>
  )
}
