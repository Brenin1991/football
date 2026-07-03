import * as THREE from 'three'
import type { RapierRigidBody } from '@react-three/rapier'
import { BALL_FOOT_OFFSET, WORLD_SCALE } from '../constants'
import { ballRef } from './entityRegistry'
import type { PlayerRef } from './entityRegistry'

const DRIBBLE_FOLLOW_RATE = 16
const DRIBBLE_ANCHOR_RATE = 22
const DRIBBLE_MAX_LEAD = 0.32 * WORLD_SCALE
const DRIBBLE_LATERAL_MAX = 0.1 * WORLD_SCALE
const DRIBBLE_MIN_FOLLOW = 3.2 * WORLD_SCALE

let dribbleAnchorX = 0
let dribbleAnchorZ = 0
let activePossessionKey = ''

function possessionKey(playerId: string, possessionSince: number) {
  return `${playerId}:${possessionSince}`
}

export function syncDribblePossession(playerId: string, possessionSince: number) {
  const key = possessionKey(playerId, possessionSince)
  if (key === activePossessionKey) return
  activePossessionKey = key
  dribbleAnchorX = ballRef.current.x
  dribbleAnchorZ = ballRef.current.z
}

export function clearDribbleState() {
  activePossessionKey = ''
}

/** Ponto ideal da bola: à frente do corpo, na direção do movimento */
export function getDribbleTarget(holder: PlayerRef): { x: number; z: number } {
  const speed = Math.hypot(holder.velocity.x, holder.velocity.z)
  const fx = Math.sin(holder.rotation)
  const fz = Math.cos(holder.rotation)

  let dirX = fx
  let dirZ = fz
  if (speed > 0.12) {
    const vx = holder.velocity.x / speed
    const vz = holder.velocity.z / speed
    const blend = THREE.MathUtils.clamp(speed / 3.8, 0.3, 0.82)
    dirX = fx * (1 - blend) + vx * blend
    dirZ = fz * (1 - blend) + vz * blend
    const len = Math.hypot(dirX, dirZ) || 1
    dirX /= len
    dirZ /= len
  }

  const lead = BALL_FOOT_OFFSET + Math.min(speed * 0.055, DRIBBLE_MAX_LEAD)

  const strafe = holder.velocity.x * fz - holder.velocity.z * fx
  const latOff = THREE.MathUtils.clamp(strafe * 0.035, -DRIBBLE_LATERAL_MAX, DRIBBLE_LATERAL_MAX)

  return {
    x: holder.position.x + dirX * lead - fz * latOff,
    z: holder.position.z + dirZ * lead + fx * latOff,
  }
}

export function updatePossessedBall(
  body: RapierRigidBody,
  holder: PlayerRef,
  delta: number,
  restY: number,
): void {
  const target = getDribbleTarget(holder)

  const anchorT = 1 - Math.exp(-DRIBBLE_ANCHOR_RATE * delta)
  dribbleAnchorX += (target.x - dribbleAnchorX) * anchorT
  dribbleAnchorZ += (target.z - dribbleAnchorZ) * anchorT

  const cur = ballRef.current
  const dx = dribbleAnchorX - cur.x
  const dz = dribbleAnchorZ - cur.z

  const holderSpeed = Math.hypot(holder.velocity.x, holder.velocity.z)
  const maxSpeed = Math.max(holderSpeed * 1.2, DRIBBLE_MIN_FOLLOW)
  const followT = 1 - Math.exp(-DRIBBLE_FOLLOW_RATE * delta)

  let newX = cur.x + dx * followT
  let newZ = cur.z + dz * followT

  const stepX = newX - cur.x
  const stepZ = newZ - cur.z
  const step = Math.hypot(stepX, stepZ)
  const maxStep = maxSpeed * Math.max(delta, 1 / 240)
  if (step > maxStep && step > 1e-6) {
    const s = maxStep / step
    newX = cur.x + stepX * s
    newZ = cur.z + stepZ * s
  }

  const invDt = delta > 1e-5 ? 1 / delta : 0
  const vx = (newX - cur.x) * invDt
  const vz = (newZ - cur.z) * invDt

  body.setTranslation({ x: newX, y: restY, z: newZ }, true)
  body.setLinvel({ x: vx, y: 0, z: vz }, true)
  ballRef.current = { x: newX, y: restY, z: newZ }
  ballRef.velocity = { x: vx, y: 0, z: vz }
}
