import { useFrame } from '@react-three/fiber'
import { replaySystem } from '../systems/replaySystem'
import { ballBodyRef, ballRef } from '../systems/entityRegistry'
import { ensureBallKinematic } from '../systems/ballPhysics'

/** Avança sequência de comemoração / replay e sincroniza a bola */
export function ReplayManager() {
  useFrame((_, delta) => {
    replaySystem.updateSequence(delta)

    if (!replaySystem.isActive()) {
      replaySystem.updatePendingShot()
      return
    }

    const playback = replaySystem.getBallPlayback()
    const body = ballBodyRef.current as {
      setTranslation: (t: { x: number; y: number; z: number }, wake: boolean) => void
      setRotation: (q: { x: number; y: number; z: number; w: number }, wake: boolean) => void
      setLinvel: (v: { x: number; y: number; z: number }, wake: boolean) => void
      setAngvel: (v: { x: number; y: number; z: number }, wake: boolean) => void
    } | null

    if (!body || !playback) return

    ensureBallKinematic()
    const pos = playback.ball
    ballRef.current = { ...pos }
    ballRef.velocity = { ...playback.ballVel }

    body.setTranslation(pos, true)
    body.setRotation(playback.ballQuat, true)
    body.setLinvel(playback.ballVel, true)
    body.setAngvel(playback.ballAngVel, true)
  }, -55)

  return null
}
