import * as THREE from 'three'
import type { RapierRigidBody } from '@react-three/rapier'
import { BALL_FOOT_OFFSET, WORLD_SCALE } from '../constants'
import { ballRef } from './entityRegistry'
import type { PlayerRef } from './entityRegistry'

const DRIBBLE_FOLLOW_RATE = 16
const DRIBBLE_ANCHOR_RATE = 22
const DRIBBLE_MAX_LEAD = 0.2 * WORLD_SCALE
const DRIBBLE_LATERAL_MAX = 0.06 * WORLD_SCALE
const DRIBBLE_SPRINT_LEAD = 0.34 * WORLD_SCALE
const DRIBBLE_SPRINT_FOLLOW = 24
const DRIBBLE_MIN_FOLLOW = 2.7 * WORLD_SCALE

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

/** Impulso imediato da bola na parada/finta */
export function impulseDribbleFeint(offsetX: number, offsetZ: number) {
  dribbleAnchorX = ballRef.current.x + offsetX
  dribbleAnchorZ = ballRef.current.z + offsetZ
}

/** Ponto ideal da bola: à frente do corpo, na direção do movimento */
export function getDribbleTarget(holder: PlayerRef): { x: number; z: number } {
  const feintOff = holder.dribbleBallOffset
  const feintMag = feintOff ? Math.hypot(feintOff.x, feintOff.z) : 0
  const feintActive = feintMag > 0.06

  const speed = Math.hypot(holder.velocity.x, holder.velocity.z)
  const sprinting = holder.isSprinting === true && speed > 0.35
  const fx = Math.sin(holder.rotation)
  const fz = Math.cos(holder.rotation)

  let dirX = fx
  let dirZ = fz
  if (!feintActive && speed > 0.12) {
    const vx = holder.velocity.x / speed
    const vz = holder.velocity.z / speed
    const blend = THREE.MathUtils.clamp(speed / 3.8, 0.3, 0.82)
    dirX = fx * (1 - blend) + vx * blend
    dirZ = fz * (1 - blend) + vz * blend
    const len = Math.hypot(dirX, dirZ) || 1
    dirX /= len
    dirZ /= len
  }

  const leadBase = feintActive
    ? BALL_FOOT_OFFSET * 0.28
    : sprinting
      ? DRIBBLE_SPRINT_LEAD
      : BALL_FOOT_OFFSET
  const lead =
    leadBase + (feintActive ? 0 : Math.min(speed * (sprinting ? 0.08 : 0.055), DRIBBLE_MAX_LEAD))

  const strafe = holder.velocity.x * fz - holder.velocity.z * fx
  const latOff = feintActive
    ? 0
    : THREE.MathUtils.clamp(strafe * 0.035, -DRIBBLE_LATERAL_MAX, DRIBBLE_LATERAL_MAX)

  return {
    x: holder.position.x + dirX * lead - fz * latOff + (feintOff?.x ?? 0),
    z: holder.position.z + dirZ * lead + fx * latOff + (feintOff?.z ?? 0),
  }
}

export function updatePossessedBall(
  body: RapierRigidBody,
  holder: PlayerRef,
  delta: number,
  restY: number,
): void {
  const target = getDribbleTarget(holder)

  const feintMag = holder.dribbleBallOffset
    ? Math.hypot(holder.dribbleBallOffset.x, holder.dribbleBallOffset.z)
    : 0
  const feintActive = feintMag > 0.06

  const anchorT = 1 - Math.exp(-(feintActive ? 42 : DRIBBLE_ANCHOR_RATE) * delta)
  dribbleAnchorX += (target.x - dribbleAnchorX) * anchorT
  dribbleAnchorZ += (target.z - dribbleAnchorZ) * anchorT

  const cur = ballRef.current
  const dx = dribbleAnchorX - cur.x
  const dz = dribbleAnchorZ - cur.z

  const holderSpeed = Math.hypot(holder.velocity.x, holder.velocity.z)
  const sprinting = holder.isSprinting === true && holderSpeed > 0.35
  const followRate = feintActive ? 36 : sprinting ? DRIBBLE_SPRINT_FOLLOW : DRIBBLE_FOLLOW_RATE
  const followT = 1 - Math.exp(-followRate * delta)

  let newX = cur.x + dx * followT
  let newZ = cur.z + dz * followT

  const stepX = newX - cur.x
  const stepZ = newZ - cur.z
  const step = Math.hypot(stepX, stepZ)
  const minFollow = feintActive ? DRIBBLE_MIN_FOLLOW * 0.85 : sprinting ? DRIBBLE_MIN_FOLLOW * 1.35 : DRIBBLE_MIN_FOLLOW
  const maxSpeed = feintActive
    ? Math.max(holderSpeed * 1.8, 4.8 * WORLD_SCALE)
    : Math.max(holderSpeed * (sprinting ? 1.45 : 1.2), minFollow)
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
