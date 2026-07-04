import * as THREE from 'three'
import { BALL_RADIUS, GK_HAND_RADIUS } from '../constants'
import type { Vec3 } from '../types'

const LEFT_BONE = 'mixamorig5:LeftHand'
const RIGHT_BONE = 'mixamorig5:RightHand'

type HandSide = 'left' | 'right'

type GkHandEntry = {
  left: THREE.Object3D
  right: THREE.Object3D
  leftWorld: THREE.Vector3
  rightWorld: THREE.Vector3
}

const gkHands = new Map<string, GkHandEntry>()
const _v = new THREE.Vector3()

export function registerGkHands(gkId: string, modelRoot: THREE.Object3D) {
  const left = modelRoot.getObjectByName(LEFT_BONE)
  const right = modelRoot.getObjectByName(RIGHT_BONE)
  if (!left || !right) return false
  gkHands.set(gkId, {
    left,
    right,
    leftWorld: new THREE.Vector3(),
    rightWorld: new THREE.Vector3(),
  })
  return true
}

export function unregisterGkHands(gkId: string) {
  gkHands.delete(gkId)
}

/** Atualiza posições world após mixer — chamar no fim do useFrame do goleiro */
export function updateGkHandPositions(gkId: string, root?: THREE.Object3D) {
  const entry = gkHands.get(gkId)
  if (!entry) return
  if (root) root.updateMatrixWorld(true)
  entry.left.updateMatrixWorld(true)
  entry.right.updateMatrixWorld(true)
  entry.left.getWorldPosition(entry.leftWorld)
  entry.right.getWorldPosition(entry.rightWorld)
}

export function getGkHandWorld(gkId: string, side: HandSide): Vec3 | null {
  const entry = gkHands.get(gkId)
  if (!entry) return null
  const w = side === 'left' ? entry.leftWorld : entry.rightWorld
  return { x: w.x, y: w.y, z: w.z }
}

const contactRadius = GK_HAND_RADIUS + BALL_RADIUS

export function testGkHandContact(gkId: string, ball: Vec3): HandSide | null {
  const entry = gkHands.get(gkId)
  if (!entry) return null

  const distL = Math.hypot(
    ball.x - entry.leftWorld.x,
    ball.y - entry.leftWorld.y,
    ball.z - entry.leftWorld.z,
  )
  if (distL <= contactRadius) return 'left'

  const distR = Math.hypot(
    ball.x - entry.rightWorld.x,
    ball.y - entry.rightWorld.y,
    ball.z - entry.rightWorld.z,
  )
  if (distR <= contactRadius) return 'right'

  return null
}

/** Distância mínima bola → qualquer mão (debug / fallback leve) */
export function minGkHandDist(gkId: string, ball: Vec3): number {
  const entry = gkHands.get(gkId)
  if (!entry) return Infinity
  _v.set(ball.x, ball.y, ball.z)
  return Math.min(entry.leftWorld.distanceTo(_v), entry.rightWorld.distanceTo(_v))
}
