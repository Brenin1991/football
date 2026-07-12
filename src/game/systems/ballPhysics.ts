import type { RapierRigidBody } from '@react-three/rapier'
import {
  BALL_GROUND_ROLL_BLEND,
  BALL_GROUND_ROLL_MAX,
  BALL_GROUND_ROLL_MIN,
  BALL_RADIUS,
  BALL_STOP_SPEED,
  KICK_LOFT_HEIGHT,
  KICK_PASS_LOFT_BASE,
} from '../constants'
import { ballBodyRef, ballRef } from './entityRegistry'
import { ballRestY } from './fieldData'

export type KickOptions = {
  dirX: number
  dirZ: number
  speed: number
  /** 0 = rasteiro, 1 = lob */
  loft?: number
}

let setPieceLaunchUntil = 0

export function markSetPieceLaunch() {
  setPieceLaunchUntil = performance.now() + 220
}

export function isSetPieceLaunchActive() {
  return performance.now() < setPieceLaunchUntil
}

export function ensureBallDynamic() {
  const body = ballBodyRef.current as RapierRigidBody | null
  if (!body) return
  if (body.bodyType() !== 0) {
    body.setBodyType(0, true)
  }
  body.wakeUp()
}

export function ensureBallKinematic() {
  const body = ballBodyRef.current as RapierRigidBody | null
  if (!body) return
  if (body.bodyType() !== 2) {
    body.setBodyType(2, true)
  }
}

export function kickBall({ dirX, dirZ, speed, loft = 0 }: KickOptions) {
  ensureBallDynamic()

  const horiz = Math.hypot(dirX, dirZ)
  const nx = horiz > 0.001 ? dirX / horiz : 0
  const nz = horiz > 0.001 ? dirZ / horiz : 1

  const vy =
    loft > 0.02
      ? KICK_LOFT_HEIGHT * loft + speed * (0.14 + 0.32 * loft) * loft
      : KICK_PASS_LOFT_BASE + speed * 0.022

  applyBallVelocity(nx * speed, vy, nz * speed)
}

export function applyBallVelocity(vx: number, vy: number, vz: number) {
  const body = ballBodyRef.current as RapierRigidBody | null
  if (!body) {
    ballRef.velocity = { x: vx, y: vy, z: vz }
    return
  }

  ensureBallDynamic()
  body.wakeUp()
  body.setLinvel({ x: vx, y: vy, z: vz }, true)
  syncBallFromBody(body)
}

export function syncBallFromBody(body: RapierRigidBody) {
  const t = body.translation()
  const v = body.linvel()
  ballRef.current = { x: t.x, y: t.y, z: t.z }
  ballRef.velocity = { x: v.x, y: v.y, z: v.z }
}

export function kickFromVector(vx: number, vy: number, vz: number) {
  const horiz = Math.hypot(vx, vz)
  if (horiz < 0.01) {
    applyBallVelocity(vx, vy, vz)
    return
  }
  kickBall({
    dirX: vx,
    dirZ: vz,
    speed: horiz,
    loft: vy / horiz,
  })
}

/** Rolagem no gramado — drag exponencial contínuo, sem degraus nem trava brusca. */
export function tickBallGroundRoll(body: RapierRigidBody, delta: number) {
  if (delta <= 0) return

  const restY = ballRestY(BALL_RADIUS)
  const t = body.translation()
  const v = body.linvel()
  const speed = Math.hypot(v.x, v.z)
  const onGround = t.y <= restY + BALL_RADIUS * 0.55 && Math.abs(v.y) < 0.65

  if (!onGround) return

  if (speed < 0.5 && Math.abs(v.y) < 0.2) {
    if (t.y > restY + 0.004) {
      body.setTranslation({ x: t.x, y: restY, z: t.z }, true)
    }
    if (Math.abs(v.y) < 0.1) {
      body.setLinvel({ x: v.x, y: 0, z: v.z }, true)
    }
  }

  const flat = body.linvel()
  const spd = Math.hypot(flat.x, flat.z)

  if (spd < BALL_STOP_SPEED) {
    body.setLinvel({ x: 0, y: 0, z: 0 }, true)
    body.setAngvel({ x: 0, y: 0, z: 0 }, true)
    syncBallFromBody(body)
    body.sleep()
    return
  }

  const blend = Math.min(1, spd / BALL_GROUND_ROLL_BLEND)
  const dragPerSec =
    BALL_GROUND_ROLL_MIN + (BALL_GROUND_ROLL_MAX - BALL_GROUND_ROLL_MIN) * (1 - blend)
  const scale = Math.exp(-dragPerSec * delta)

  body.setLinvel(
    { x: flat.x * scale, y: flat.y, z: flat.z * scale },
    true,
  )

  syncBallFromBody(body)
}
