import * as THREE from 'three'
import type { RapierRigidBody } from '@react-three/rapier'
import {
  BALL_FOOT_OFFSET,
  BALL_MASS,
  BALL_RADIUS,
  DRIBBLE_PHYSICS_DAMP,
  DRIBBLE_PHYSICS_SPRINT_SPRING,
  DRIBBLE_PHYSICS_SPRING,
  POSSESSION_LEASH,
  WORLD_SCALE,
} from '../constants'
import { ballRef, ballBodyRef, playerRegistry } from './entityRegistry'
import type { PlayerRef } from './entityRegistry'
import { minPlayerFootDist2D } from './playerSkeleton'
import { distance2D } from './rules'
import { useGameStore } from '../store/gameStore'

const DRIBBLE_FOLLOW_RATE = 20
const DRIBBLE_ANCHOR_RATE = 26
const DRIBBLE_MAX_LEAD = 0.2 * WORLD_SCALE
const DRIBBLE_LATERAL_MAX = 0.06 * WORLD_SCALE
const DRIBBLE_SPRINT_LEAD = 0.34 * WORLD_SCALE
const DRIBBLE_SPRINT_FOLLOW = 24
const DRIBBLE_MIN_FOLLOW = 2.7 * WORLD_SCALE

let dribbleAnchorX = 0
let dribbleAnchorZ = 0
let activePossessionKey = ''

// Giro visual da bola no drible. O corpo é cinemático enquanto conduzida, então
// a física não a faz rolar sozinha — reconstruímos o rolamento a partir do
// deslocamento real no chão pra ela girar naturalmente nos pés, em vez de
// deslizar. O quaternion acumula frame a frame e é reescrito no corpo.
const ballSpin = new THREE.Quaternion()
const spinAxis = new THREE.Vector3()
const spinDelta = new THREE.Quaternion()

function possessionKey(playerId: string, possessionSince: number) {
  return `${playerId}:${possessionSince}`
}

export function syncDribblePossession(playerId: string, possessionSince: number) {
  const key = possessionKey(playerId, possessionSince)
  if (key === activePossessionKey) return
  activePossessionKey = key
  dribbleAnchorX = ballRef.current.x
  dribbleAnchorZ = ballRef.current.z
  // Herda a rotação atual do corpo pra não dar "snap" ao assumir a posse.
  const body = ballBodyRef.current as RapierRigidBody | null
  if (body) {
    const r = body.rotation()
    ballSpin.set(r.x, r.y, r.z, r.w)
  }
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

  const movedX = newX - cur.x
  const movedZ = newZ - cur.z

  const invDt = delta > 1e-5 ? 1 / delta : 0
  const vx = movedX * invDt
  const vz = movedZ * invDt

  // Rolamento sem deslizamento: a bola gira em torno do eixo perpendicular ao
  // movimento, com ângulo = distância percorrida / raio. Assim ela "rola" de
  // verdade nos pés, e o giro fica proporcional à velocidade da condução.
  const rollDist = Math.hypot(movedX, movedZ)
  if (rollDist > 1e-6) {
    const invR = 1 / BALL_RADIUS
    spinAxis.set(movedZ, 0, -movedX).normalize()
    spinDelta.setFromAxisAngle(spinAxis, rollDist * invR)
    ballSpin.premultiply(spinDelta).normalize()
    body.setRotation(
      { x: ballSpin.x, y: ballSpin.y, z: ballSpin.z, w: ballSpin.w },
      true,
    )
    // Deixa a velocidade angular coerente com o rolamento — quando a bola se
    // soltar e virar dinâmica, ela continua girando sem "engasgar".
    body.setAngvel({ x: vz * invR, y: 0, z: -vx * invR }, true)
  }

  body.setTranslation({ x: newX, y: restY, z: newZ }, true)
  body.setLinvel({ x: vx, y: 0, z: vz }, true)
  ballRef.current = { x: newX, y: restY, z: newZ }
  ballRef.velocity = { x: vx, y: 0, z: vz }
}

/**
 * Drible físico: bola dinâmica com mola suave em direção ao alvo.
 * Os pés (colisores) empurram a bola; a mola mantém o feel de condução FIFA.
 */
export function updatePhysicalPossessedBall(
  body: RapierRigidBody,
  holder: PlayerRef,
  delta: number,
  _restY: number,
): void {
  const target = getDribbleTarget(holder)
  const t = body.translation()
  const v = body.linvel()

  const feintMag = holder.dribbleBallOffset
    ? Math.hypot(holder.dribbleBallOffset.x, holder.dribbleBallOffset.z)
    : 0
  const feintActive = feintMag > 0.06
  const holderSpeed = Math.hypot(holder.velocity.x, holder.velocity.z)
  const sprinting = holder.isSprinting === true && holderSpeed > 0.35

  const anchorT = 1 - Math.exp(-(feintActive ? 38 : 22) * delta)
  dribbleAnchorX += (target.x - dribbleAnchorX) * anchorT
  dribbleAnchorZ += (target.z - dribbleAnchorZ) * anchorT

  const dx = dribbleAnchorX - t.x
  const dz = dribbleAnchorZ - t.z

  const spring = feintActive
    ? DRIBBLE_PHYSICS_SPRINT_SPRING * 1.15
    : sprinting
      ? DRIBBLE_PHYSICS_SPRINT_SPRING
      : DRIBBLE_PHYSICS_SPRING

  let fx = dx * spring - v.x * DRIBBLE_PHYSICS_DAMP
  let fz = dz * spring - v.z * DRIBBLE_PHYSICS_DAMP

  const maxAccel = Math.max(
    holderSpeed * (sprinting ? 2.4 : 1.85),
    DRIBBLE_MIN_FOLLOW * 1.1,
  )
  const accel = Math.hypot(fx, fz)
  if (accel > maxAccel && accel > 1e-6) {
    const s = maxAccel / accel
    fx *= s
    fz *= s
  }

  const impulse = {
    x: fx * BALL_MASS * delta,
    y: 0,
    z: fz * BALL_MASS * delta,
  }
  body.applyImpulse(impulse, true)

  const tv = body.linvel()
  const steerT = 1 - Math.exp(-14 * delta)
  const nvx = tv.x + (holder.velocity.x - tv.x) * steerT * 0.38
  const nvz = tv.z + (holder.velocity.z - tv.z) * steerT * 0.38
  body.setLinvel({ x: nvx, y: tv.y, z: nvz }, true)

  const finalT = body.translation()
  const finalV = body.linvel()
  ballRef.current = { x: finalT.x, y: finalT.y, z: finalT.z }
  ballRef.velocity = { x: finalV.x, y: finalV.y, z: finalV.z }
}

/** Solta posse se a bola escapou demais dos pés (física real). */
export function checkPhysicalPossessionLeash(holderId: string): boolean {
  const store = useGameStore.getState()
  const poss = store.ballPossession
  if (!poss || poss.playerId !== holderId) return true

  const footDist = minPlayerFootDist2D(holderId, ballRef.current)
  const dist =
    footDist ??
    distance2D(
      playerRegistry.get(holderId)?.position ?? ballRef.current,
      ballRef.current,
    )

  if (dist > POSSESSION_LEASH) {
    store.clearPossession()
    clearDribbleState()
    return false
  }
  return true
}
