import {
  useAfterPhysicsStep,
  useBeforePhysicsStep,
  type RapierRigidBody,
} from '@react-three/rapier'
import { ballBodyRef } from '../systems/entityRegistry'
import {
  syncBallAfterPhysics,
  tickBallBeforePhysics,
} from '../systems/ballPhysics'
import { getPhysicsTimeStep } from '../systems/gameTime'

/** Sincroniza drible/rolagem com cada subpasso Rapier — estável em FPS baixo. */
export function BallPhysicsDriver() {
  useBeforePhysicsStep(() => {
    const body = ballBodyRef.current as RapierRigidBody | null
    if (!body) return
    tickBallBeforePhysics(body, getPhysicsTimeStep())
  })

  useAfterPhysicsStep(() => {
    const body = ballBodyRef.current as RapierRigidBody | null
    if (!body) return
    syncBallAfterPhysics(body)
  })

  return null
}
