import {
  useAfterPhysicsStep,
  useBeforePhysicsStep,
} from '@react-three/rapier'
import { getBallBody } from '../systems/entityRegistry'
import {
  syncBallAfterPhysics,
  tickBallBeforePhysics,
} from '../systems/ballPhysics'
import { getPhysicsTimeStep } from '../systems/gameTime'

/** Sincroniza drible/rolagem com cada subpasso Rapier — estável em FPS baixo. */
export function BallPhysicsDriver() {
  useBeforePhysicsStep(() => {
    const body = getBallBody()
    if (!body) return
    tickBallBeforePhysics(body, getPhysicsTimeStep())
  })

  useAfterPhysicsStep(() => {
    const body = getBallBody()
    if (!body) return
    syncBallAfterPhysics(body)
  })

  return null
}
