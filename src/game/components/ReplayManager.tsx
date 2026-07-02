import { useFrame } from '@react-three/fiber'
import { ballBodyRef, ballRef } from '../systems/entityRegistry'
import { ensureBallKinematic } from '../systems/ballPhysics'
import { replaySystem } from '../systems/replaySystem'

/** Avança sequência de comemoração / replay e sincroniza a bola */
export function ReplayManager() {
  useFrame((_, delta) => {
    replaySystem.updateSequence(delta)

    if (!replaySystem.isActive()) {
      replaySystem.updatePendingShot()
      return
    }

    const body = ballBodyRef.current as {
      setTranslation: (t: { x: number; y: number; z: number }, wake: boolean) => void
      setLinvel: (v: { x: number; y: number; z: number }, wake: boolean) => void
      setAngvel: (v: { x: number; y: number; z: number }, wake: boolean) => void
    } | null

    if (body) {
      ensureBallKinematic()
      const pos = ballRef.current
      body.setTranslation(pos, true)
      body.setLinvel(ballRef.velocity, true)
      body.setAngvel({ x: 0, y: 0, z: 0 }, true)
    }
  }, -55)

  return null
}
