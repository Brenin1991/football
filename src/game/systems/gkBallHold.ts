import type { RapierRigidBody } from '@react-three/rapier'
import { ballRef } from './entityRegistry'
import { getGkCatchAnchor } from './goalkeeperHands'

/** Bola presa nas mãos do goleiro — segue o osso durante hold/distribuição. */
export function updateGkHeldBall(
  body: RapierRigidBody,
  gkId: string,
  delta: number,
): void {
  const anchor = getGkCatchAnchor(gkId, 'right')
  if (!anchor) return

  const cur = ballRef.current
  const t = 1 - Math.exp(-28 * delta)
  const newX = cur.x + (anchor.x - cur.x) * t
  const newY = cur.y + (anchor.y - cur.y) * t
  const newZ = cur.z + (anchor.z - cur.z) * t

  body.setTranslation({ x: newX, y: newY, z: newZ }, true)
  body.setLinvel({ x: 0, y: 0, z: 0 }, true)
  body.setAngvel({ x: 0, y: 0, z: 0 }, true)
  ballRef.current = { x: newX, y: newY, z: newZ }
  ballRef.velocity = { x: 0, y: 0, z: 0 }
}
