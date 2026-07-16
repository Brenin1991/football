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
import { forEachFixedSimStep } from './gameTime'

/** Âncora — PES6 previsível: cola no trote, lead curto no sprint */
const DRIBBLE_ANCHOR_RATE = 16
const DRIBBLE_ANCHOR_FEINT = 5.5
const DRIBBLE_MAX_LEAD = 0.18 * WORLD_SCALE
const DRIBBLE_FOOT_BIAS = 0.028 * WORLD_SCALE
const DRIBBLE_LATERAL_MAX = 0.055 * WORLD_SCALE
/** Sprint: knock-on curto (não joga a bola longe) */
const DRIBBLE_SPRINT_LEAD = 0.26 * WORLD_SCALE
/** Close control — praticamente nos pés */
const DRIBBLE_IDLE_LEAD = 0.11 * WORLD_SCALE
const DRIBBLE_COMFORT = 0.035 * WORLD_SCALE
const DRIBBLE_TOUCH_LAG = 0.09 * WORLD_SCALE
const DRIBBLE_SETTLE_MS = 220

let dribbleAnchorX = 0
let dribbleAnchorZ = 0
let activePossessionKey = ''
let possessionBlendStart = 0
/** Rolagem livre durante 180/finta — a posse cinemática não pode matar o toque */
let feintRollVx = 0
let feintRollVz = 0

const ballSpin = new THREE.Quaternion()
const spinAxis = new THREE.Vector3()
const spinDelta = new THREE.Quaternion()

function possessionKey(playerId: string, possessionSince: number) {
  return `${playerId}:${possessionSince}`
}

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v))
}

export function syncDribblePossession(playerId: string, possessionSince: number) {
  const key = possessionKey(playerId, possessionSince)
  if (key === activePossessionKey) return
  activePossessionKey = key
  // Mantém a bola onde está — domínio traz ela aos poucos, sem warp
  dribbleAnchorX = ballRef.current.x
  dribbleAnchorZ = ballRef.current.z
  possessionBlendStart = performance.now()
  feintRollVx = 0
  feintRollVz = 0
  const body = ballBodyRef.current as RapierRigidBody | null
  if (body) {
    const r = body.rotation()
    ballSpin.set(r.x, r.y, r.z, r.w)
  }
}

export function clearDribbleState() {
  activePossessionKey = ''
  feintRollVx = 0
  feintRollVz = 0
}

/** Impulso da finta — desloca pouco (previsível, sem soltar a bola) */
export function impulseDribbleFeint(offsetX: number, offsetZ: number) {
  dribbleAnchorX = ballRef.current.x + offsetX
  dribbleAnchorZ = ballRef.current.z + offsetZ
  const mag = Math.hypot(offsetX, offsetZ)
  if (mag > 1e-4) {
    const boost = Math.min(mag * 4.2, 1.45 * WORLD_SCALE)
    ballRef.velocity = {
      x: ballRef.velocity.x + (offsetX / mag) * boost,
      y: 0,
      z: ballRef.velocity.z + (offsetZ / mag) * boost,
    }
  }
}

/**
 * Toque real do 180 — bola ganha rolagem na direção antiga e a posse
 * deixa ela correr até o jogador completar o giro.
 */
export function pushDribbleBallRoll(dirX: number, dirZ: number, speed: number) {
  const len = Math.hypot(dirX, dirZ)
  if (len < 1e-4 || speed <= 0) return
  const nx = dirX / len
  const nz = dirZ / len
  feintRollVx = nx * speed
  feintRollVz = nz * speed
  dribbleAnchorX = ballRef.current.x + nx * Math.min(0.55 * WORLD_SCALE, speed * 0.18)
  dribbleAnchorZ = ballRef.current.z + nz * Math.min(0.55 * WORLD_SCALE, speed * 0.18)
  ballRef.velocity = { x: feintRollVx, y: 0, z: feintRollVz }
  const body = ballBodyRef.current as RapierRigidBody | null
  if (body) {
    body.setLinvel({ x: feintRollVx, y: 0, z: feintRollVz }, true)
  }
}

/** Ponto ideal da bola: à frente e levemente ao lado do pé */
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
    // Pouca mistura com vel — âncora fica sob o corpo, não “à frente flutuando”
    const blend = THREE.MathUtils.clamp(speed / 6.5, 0.08, 0.35)
    dirX = fx * (1 - blend) + vx * blend
    dirZ = fz * (1 - blend) + vz * blend
    const len = Math.hypot(dirX, dirZ) || 1
    dirX /= len
    dirZ /= len
  }

  const leadBase = feintActive
    ? BALL_FOOT_OFFSET * 0.45
    : sprinting
      ? Math.max(BALL_FOOT_OFFSET * 1.05, DRIBBLE_SPRINT_LEAD)
      : Math.min(BALL_FOOT_OFFSET, DRIBBLE_IDLE_LEAD)
  const lead =
    leadBase +
    (feintActive ? 0 : Math.min(speed * (sprinting ? 0.055 : 0.012), DRIBBLE_MAX_LEAD))

  const strafe = holder.velocity.x * fz - holder.velocity.z * fx
  const latOff = feintActive
    ? 0
    : THREE.MathUtils.clamp(strafe * 0.022, -DRIBBLE_LATERAL_MAX, DRIBBLE_LATERAL_MAX)

  const footBias = feintActive || sprinting ? 0 : DRIBBLE_FOOT_BIAS * (speed < 0.45 ? 1 : 0.35)
  const sideX = fz
  const sideZ = -fx

  return {
    x: holder.position.x + dirX * lead - sideX * latOff + sideX * footBias + (feintOff?.x ?? 0),
    z: holder.position.z + dirZ * lead - sideZ * latOff + sideZ * footBias + (feintOff?.z ?? 0),
  }
}

export function updatePossessedBall(
  body: RapierRigidBody,
  holder: PlayerRef,
  delta: number,
  restY: number,
): void {
  forEachFixedSimStep(delta, (stepDt) => {
    stepPossessedBall(body, holder, stepDt, restY)
  })
}

export function stepPossessedBall(
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
  const severity = clamp01(holder.dribbleTouchSeverity ?? (feintActive ? 0.55 : 0))
  // Rolagem do 180: basta ter velocidade de toque — não depende do offset
  // (Player pode empurrar a bola antes do registry atualizar no mesmo frame).
  const rollSpeed = Math.hypot(feintRollVx, feintRollVz)
  const freeRoll = rollSpeed > 0.12

  const settle = clamp01((performance.now() - possessionBlendStart) / DRIBBLE_SETTLE_MS)
  const settleEase = settle * settle * (3 - 2 * settle)

  const cur = ballRef.current
  const holderSpeed = Math.hypot(holder.velocity.x, holder.velocity.z)
  const sprinting = holder.isSprinting === true && holderSpeed > 0.35

  let newX: number
  let newZ: number
  let vx: number
  let vz: number

  if (freeRoll) {
    // 180: bola rola sozinha no toque; só recolhe no final do giro
    const drag = Math.exp(-0.35 * delta)
    feintRollVx *= drag
    feintRollVz *= drag
    newX = cur.x + feintRollVx * delta
    newZ = cur.z + feintRollVz * delta

    // Recolhe só quando a severidade cai (drive / reencontro)
    const recollect = severity < 0.42 ? clamp01((0.42 - severity) / 0.42) : 0
    if (recollect > 0.01) {
      const feintAnchor = THREE.MathUtils.lerp(
        DRIBBLE_ANCHOR_RATE,
        DRIBBLE_ANCHOR_FEINT,
        1 - severity * 0.85,
      )
      const anchorT = 1 - Math.exp(-feintAnchor * recollect * delta)
      dribbleAnchorX += (target.x - dribbleAnchorX) * anchorT
      dribbleAnchorZ += (target.z - dribbleAnchorZ) * anchorT
      const seekT = 1 - Math.exp(-8 * recollect * delta)
      newX += (dribbleAnchorX - newX) * seekT
      newZ += (dribbleAnchorZ - newZ) * seekT
    } else {
      dribbleAnchorX = newX
      dribbleAnchorZ = newZ
    }

    const invDt = delta > 1e-5 ? 1 / delta : 0
    vx = (newX - cur.x) * invDt
    vz = (newZ - cur.z) * invDt
    // Mantém a rolagem livre; no recollect entrega ao seek
    if (recollect < 0.35) {
      feintRollVx = vx * 0.15 + feintRollVx * 0.85
      feintRollVz = vz * 0.15 + feintRollVz * 0.85
    } else {
      feintRollVx *= Math.exp(-6 * delta)
      feintRollVz *= Math.exp(-6 * delta)
    }
    // Finta acabou: mata a rolagem pra não ficar em free-roll eterno
    if (!feintActive && severity < 0.2) {
      feintRollVx = 0
      feintRollVz = 0
    }
  } else {
    feintRollVx = 0
    feintRollVz = 0

    // Finta forte: âncora lenta (bola atrasa); depois recupera
    const feintAnchor = THREE.MathUtils.lerp(
      DRIBBLE_ANCHOR_RATE,
      DRIBBLE_ANCHOR_FEINT,
      1 - severity * 0.85,
    )
    const anchorRate = feintActive ? feintAnchor : DRIBBLE_ANCHOR_RATE
    const anchorT = 1 - Math.exp(-anchorRate * delta)
    dribbleAnchorX += (target.x - dribbleAnchorX) * anchorT
    dribbleAnchorZ += (target.z - dribbleAnchorZ) * anchorT

    // Carry quase 1:1 — bola acompanha o corpo (previsível)
    const carry = feintActive
      ? THREE.MathUtils.lerp(0.72, 0.35, severity)
      : sprinting
        ? 0.92
        : 0.99
    newX = cur.x + holder.velocity.x * delta * carry
    newZ = cur.z + holder.velocity.z * delta * carry

    const dx = dribbleAnchorX - newX
    const dz = dribbleAnchorZ - newZ
    const lag = Math.hypot(dx, dz)

    let seekRate: number
    if (feintActive) {
      seekRate = THREE.MathUtils.lerp(14, 4.5, severity)
    } else if (lag > DRIBBLE_TOUCH_LAG) {
      seekRate = sprinting ? 14 : 22
    } else if (lag > DRIBBLE_COMFORT) {
      seekRate = sprinting ? 10 : 16
    } else {
      seekRate = sprinting ? 5.5 : 9
    }

    seekRate *= 0.55 + settleEase * 0.45

    const seekT = 1 - Math.exp(-seekRate * delta)
    newX += dx * seekT
    newZ += dz * seekT

    const stepX = newX - cur.x
    const stepZ = newZ - cur.z
    const step = Math.hypot(stepX, stepZ)
    const maxSpeed = feintActive
      ? Math.max(holderSpeed * THREE.MathUtils.lerp(1.2, 0.9, severity), 1.8 * WORLD_SCALE)
      : Math.max(
          holderSpeed * (sprinting ? 1.12 : 1.05) + 0.28 * WORLD_SCALE,
          (sprinting ? 1.75 : 1.35) * WORLD_SCALE,
        )
    const settleMax = maxSpeed * (0.7 + settleEase * 0.3)
    const maxStep = settleMax * Math.max(delta, 1 / 240)
    if (step > maxStep && step > 1e-6) {
      const s = maxStep / step
      newX = cur.x + stepX * s
      newZ = cur.z + stepZ * s
    }

    const invDt = delta > 1e-5 ? 1 / delta : 0
    vx = (newX - cur.x) * invDt
    vz = (newZ - cur.z) * invDt
  }

  const movedX = newX - cur.x
  const movedZ = newZ - cur.z

  const rollDist = Math.hypot(movedX, movedZ)
  if (rollDist > 1e-6) {
    const invR = 1 / BALL_RADIUS
    spinAxis.set(movedZ, 0, -movedX).normalize()
    spinDelta.setFromAxisAngle(spinAxis, rollDist * invR)
    ballSpin.premultiply(spinDelta).normalize()
    body.setNextKinematicRotation({
      x: ballSpin.x,
      y: ballSpin.y,
      z: ballSpin.z,
      w: ballSpin.w,
    })
    body.setAngvel({ x: vz * invR, y: 0, z: -vx * invR }, true)
  }

  body.setNextKinematicTranslation({ x: newX, y: restY, z: newZ })
  body.setLinvel({ x: vx, y: 0, z: vz }, true)
  ballRef.current = { x: newX, y: restY, z: newZ }
  ballRef.velocity = { x: vx, y: 0, z: vz }
}

/**
 * Drible físico: bola dinâmica com mola suave em direção ao alvo.
 */
export function updatePhysicalPossessedBall(
  body: RapierRigidBody,
  holder: PlayerRef,
  delta: number,
  _restY: number,
): void {
  forEachFixedSimStep(delta, (stepDt) => {
    stepPhysicalPossessedBall(body, holder, stepDt)
  })

  const finalT = body.translation()
  const finalV = body.linvel()
  ballRef.current = { x: finalT.x, y: finalT.y, z: finalT.z }
  ballRef.velocity = { x: finalV.x, y: finalV.y, z: finalV.z }
}

function stepPhysicalPossessedBall(
  body: RapierRigidBody,
  holder: PlayerRef,
  delta: number,
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

  const settle = clamp01((performance.now() - possessionBlendStart) / DRIBBLE_SETTLE_MS)
  const settleEase = settle * settle * (3 - 2 * settle)

  const anchorT = 1 - Math.exp(-(feintActive ? 20 : 14) * delta)
  dribbleAnchorX += (target.x - dribbleAnchorX) * anchorT
  dribbleAnchorZ += (target.z - dribbleAnchorZ) * anchorT

  const dx = dribbleAnchorX - t.x
  const dz = dribbleAnchorZ - t.z

  const spring =
    (feintActive
      ? DRIBBLE_PHYSICS_SPRINT_SPRING * 1.15
      : sprinting
        ? DRIBBLE_PHYSICS_SPRINT_SPRING * 1.05
        : DRIBBLE_PHYSICS_SPRING * 1.1) *
    (0.7 + settleEase * 0.3)

  let fx = dx * spring - v.x * DRIBBLE_PHYSICS_DAMP
  let fz = dz * spring - v.z * DRIBBLE_PHYSICS_DAMP

  const maxAccel = Math.max(
    holderSpeed * (sprinting ? 1.9 : 1.45),
    1.4 * WORLD_SCALE,
  )
  const accel = Math.hypot(fx, fz)
  if (accel > maxAccel && accel > 1e-6) {
    const s = maxAccel / accel
    fx *= s
    fz *= s
  }

  body.applyImpulse(
    {
      x: fx * BALL_MASS * delta,
      y: 0,
      z: fz * BALL_MASS * delta,
    },
    true,
  )

  const tv = body.linvel()
  const steerT = 1 - Math.exp(-9 * delta)
  const nvx = tv.x + (holder.velocity.x - tv.x) * steerT * 0.28
  const nvz = tv.z + (holder.velocity.z - tv.z) * steerT * 0.28
  body.setLinvel({ x: nvx, y: tv.y, z: nvz }, true)
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
