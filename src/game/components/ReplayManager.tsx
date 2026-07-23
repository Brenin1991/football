import { useFrame } from '@react-three/fiber'
import { replaySystem } from '../systems/replaySystem'
import { ballRef, getBallBody } from '../systems/entityRegistry'
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
    const body = getBallBody()

    if (!body || !playback) return

    ensureBallKinematic()
    const pos = playback.ball
    ballRef.current = { ...pos }
    ballRef.velocity = { ...playback.ballVel }

    try {
      body.setTranslation(pos, true)
      body.setRotation(playback.ballQuat, true)
      body.setLinvel(playback.ballVel, true)
      body.setAngvel(playback.ballAngVel, true)
    } catch {
      /* body freed mid-frame */
    }
  }, -55)

  return null
}
