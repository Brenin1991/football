import type { RapierRigidBody } from '@react-three/rapier'
import type { Vec3 } from '../types'
import {
  BALL_AIR_DRAG,
  BALL_BODY_HIT_SPEED_CAP,
  BALL_GROUND_ROLL_BLEND,
  BALL_GROUND_ROLL_MAX,
  BALL_GROUND_ROLL_MIN,
  BALL_MAX_SPEED,
  BALL_RADIUS,
  BALL_STOP_SPEED,
  KICK_LOFT_HEIGHT,
  KICK_PASS_LOFT_BASE,
} from '../constants'
import { ballBodyRef, ballRef, getBallBody, playerRegistry } from './entityRegistry'
import { ballRestY } from './fieldData'
import { forEachFixedSimStep } from './gameTime'
import {
  clearDribbleState,
  stepPossessedBall,
  syncDribblePossession,
} from './ballDribble'
import { tickCrossTrap } from './crossAssist'
import { stepGkHeldBall } from './gkBallHold'
import { getGkRuntime } from './goalkeeper'
import { isActiveSetPiecePhase } from './setPiece'
import { useGameStore } from '../store/gameStore'

export type KickOptions = {
  dirX: number
  dirZ: number
  speed: number
  /** 0 = rasteiro, 1 = lob */
  loft?: number
}

let setPieceLaunchUntil = 0

/** Efeito Magnus pós-falta — curva / topspin / knuckle */
type BallCurlState = {
  wx: number
  wy: number
  wz: number
  knuckle: boolean
  until: number
}

let ballCurl: BallCurlState | null = null

const CURL_MAGNUS = 0.085
const CURL_VERT_MUL = 0.28
const CURL_DECAY = 1.1
const CURL_KNUCKLE = 0.18

export function markSetPieceLaunch() {
  setPieceLaunchUntil = performance.now() + 220
}

export function isSetPieceLaunchActive() {
  return performance.now() < setPieceLaunchUntil
}

export function clearBallCurl() {
  ballCurl = null
}

/**
 * Contato na bola (PES): contactX curva, contactY loft/topspin.
 * dir = direção do chute no chão.
 */
export function applyFreeKickCurl(
  dirX: number,
  dirZ: number,
  contactX: number,
  contactY: number,
  power: number,
) {
  const horiz = Math.hypot(dirX, dirZ)
  const nx = horiz > 0.001 ? dirX / horiz : 0
  const nz = horiz > 0.001 ? dirZ / horiz : 1
  // Direita do chute (perp no plano XZ)
  const rx = -nz
  const rz = nx

  const cx = Math.max(-1, Math.min(1, contactX))
  const cy = Math.max(-1, Math.min(1, contactY))
  const p = 0.55 + Math.max(0, Math.min(1, power)) * 0.45
  const side = Math.abs(cx)
  const vert = Math.abs(cy)
  const knuckle = side < 0.12 && vert < 0.12

  // Spin suave — curvinha
  // Bate no lado esquerdo da bola (cx<0) → curva para a DIREITA (PES)
  const wy = -cx * 3.2 * p
  const wr = cy * 2.4 * p
  const wx = rx * wr
  const wz = rz * wr

  ballCurl = {
    wx,
    wy,
    wz,
    knuckle,
    until: performance.now() + (knuckle ? 900 : 1800),
  }

  const body = getBallBody()
  if (body) {
    try {
      body.setAngvel({ x: wx * 0.2, y: wy * 0.2, z: wz * 0.2 }, true)
    } catch {
      /* ignore */
    }
  }
}

export function stepBallCurl(body: RapierRigidBody, delta: number) {
  if (!ballCurl || delta <= 0) return
  if (performance.now() > ballCurl.until) {
    ballCurl = null
    return
  }

  const restY = ballRestY(BALL_RADIUS)
  const t = body.translation()
  const v = body.linvel()
  const airborne = t.y > restY + BALL_RADIUS * 0.55 || Math.abs(v.y) > 0.55
  if (!airborne) {
    ballCurl = null
    return
  }

  const speed = Math.hypot(v.x, v.y, v.z)
  if (speed < 0.8) return

  let { wx, wy, wz } = ballCurl
  // a = k * (ω × v)
  let ax = CURL_MAGNUS * (wy * v.z - wz * v.y)
  let ay = CURL_MAGNUS * CURL_VERT_MUL * (wz * v.x - wx * v.z)
  let az = CURL_MAGNUS * (wx * v.y - wy * v.x)

  if (ballCurl.knuckle) {
    const n = performance.now() * 0.01
    ax += Math.sin(n * 1.7) * CURL_KNUCKLE * delta * 4
    az += Math.cos(n * 2.1) * CURL_KNUCKLE * delta * 4
  }

  body.setLinvel(
    {
      x: v.x + ax * delta,
      y: v.y + ay * delta,
      z: v.z + az * delta,
    },
    true,
  )

  const decay = Math.exp(-CURL_DECAY * delta)
  ballCurl.wx = wx * decay
  ballCurl.wy = wy * decay
  ballCurl.wz = wz * decay
}

export function ensureBallDynamic() {
  const body = getBallBody()
  if (!body) return
  if (body.bodyType() !== 0) {
    body.setBodyType(0, true)
  }
  body.wakeUp()
}

export function ensureBallKinematic() {
  const body = getBallBody()
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

  // Loft → altura de pico. Rasteiro no chão; só overcharge sobe de verdade.
  let vy: number
  let horizMul = 1
  if (loft > 0.045) {
    const peak = KICK_LOFT_HEIGHT * (0.2 + loft * 0.95)
    const g = 9.81
    vy = Math.sqrt(Math.max(0.06, 2 * g * peak)) + speed * 0.028 * loft
    if (loft > 0.28) {
      horizMul = Math.max(0.72, 1 - (loft - 0.28) * 0.28)
    }
  } else if (loft > 0.015) {
    vy = KICK_PASS_LOFT_BASE * 0.55 + speed * 0.008
  } else {
    vy = KICK_PASS_LOFT_BASE * 0.35 + speed * 0.004
  }

  applyBallVelocity(nx * speed * horizMul, vy, nz * speed * horizMul)
}

export function applyBallVelocity(vx: number, vy: number, vz: number) {
  const body = getBallBody()
  const horiz = Math.hypot(vx, vz)
  let ox = vx
  let oz = vz
  if (horiz > BALL_MAX_SPEED) {
    const s = BALL_MAX_SPEED / horiz
    ox *= s
    oz *= s
  }
  if (!body) {
    ballRef.velocity = { x: ox, y: vy, z: oz }
    return
  }

  ensureBallDynamic()
  body.wakeUp()
  body.setLinvel({ x: ox, y: vy, z: oz }, true)
  syncBallFromBody(body)
}

/** Corta velocidade absurda (rebote de osso cinemático etc.) */
export function clampBallSpeed(maxHoriz = BALL_MAX_SPEED) {
  const body = getBallBody()
  if (!body) return
  const v = body.linvel()
  const horiz = Math.hypot(v.x, v.z)
  if (horiz <= maxHoriz) return
  const s = maxHoriz / horiz
  body.setLinvel({ x: v.x * s, y: Math.min(v.y, maxHoriz * 0.55), z: v.z * s }, true)
  syncBallFromBody(body)
}

/** Amortece impacto corpo/perna que o Rapier exagerou */
export function softenBallBodyHit() {
  const body = getBallBody()
  if (!body) return
  const v = body.linvel()
  const horiz = Math.hypot(v.x, v.z)
  const cap = BALL_BODY_HIT_SPEED_CAP
  if (horiz <= cap && Math.abs(v.y) < 2.2) return
  const s = horiz > cap ? cap / horiz : 1
  body.setLinvel(
    {
      x: v.x * s * 0.72,
      y: Math.min(Math.max(v.y * 0.35, 0), 1.1),
      z: v.z * s * 0.72,
    },
    true,
  )
  syncBallFromBody(body)
}

export function syncBallFromBody(body: RapierRigidBody) {
  try {
    const t = body.translation()
    const v = body.linvel()
    ballRef.current = { x: t.x, y: t.y, z: t.z }
    ballRef.velocity = { x: v.x, y: v.y, z: v.z }
  } catch {
    if (ballBodyRef.current === body) ballBodyRef.current = null
  }
}

let liveBallFrame = -1
const liveBallCached = {
  ball: { x: 0, y: 0, z: 0 },
  velocity: { x: 0, y: 0, z: 0 },
}

/** Uma leitura Rapier por frame — compartilhada por contato/voleio */
export function refreshLiveBallState(frame: number) {
  if (frame === liveBallFrame) return
  liveBallFrame = frame

  const body = getBallBody()
  if (body) {
    syncBallFromBody(body)
  }

  const b = ballRef.current
  const v = ballRef.velocity
  liveBallCached.ball.x = b.x
  liveBallCached.ball.y = b.y ?? 0
  liveBallCached.ball.z = b.z
  liveBallCached.velocity.x = v.x
  liveBallCached.velocity.y = v.y
  liveBallCached.velocity.z = v.z
}

/** Posição/velocidade da bola — usa cache por frame quando disponível */
export function getLiveBallState(): { ball: Vec3; velocity: Vec3 } {
  if (liveBallFrame < 0) {
    const body = getBallBody()
    if (body) {
      syncBallFromBody(body)
    }
    const b = ballRef.current
    const v = ballRef.velocity
    liveBallCached.ball.x = b.x
    liveBallCached.ball.y = b.y ?? 0
    liveBallCached.ball.z = b.z
    liveBallCached.velocity.x = v.x
    liveBallCached.velocity.y = v.y
    liveBallCached.velocity.z = v.z
  }
  return liveBallCached
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

/** Drag no ar — desacelera cruzamentos/lobs sem afetar rolagem no chão. */
export function stepBallAirDrag(body: RapierRigidBody, delta: number) {
  if (delta <= 0) return

  const restY = ballRestY(BALL_RADIUS)
  const t = body.translation()
  const v = body.linvel()
  const airborne = t.y > restY + BALL_RADIUS * 0.7 || Math.abs(v.y) > 0.9
  if (!airborne) return

  const speed = Math.hypot(v.x, v.y, v.z)
  if (speed < 0.15) return

  const scale = Math.exp(-BALL_AIR_DRAG * delta)
  // Vertical perde um pouco menos — parábola mais natural
  body.setLinvel(
    { x: v.x * scale, y: v.y * Math.exp(-BALL_AIR_DRAG * 0.55 * delta), z: v.z * scale },
    true,
  )
}

/** Rolagem no gramado — drag exponencial contínuo, sem degraus nem trava brusca. */
export function tickBallGroundRoll(body: RapierRigidBody, delta: number) {
  forEachFixedSimStep(delta, (stepDt) => {
    stepBallGroundRoll(body, stepDt)
  })
}

export function stepBallGroundRoll(body: RapierRigidBody, delta: number) {
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

/**
 * Lógica customizada da bola — roda antes de cada subpasso Rapier (FPS estável).
 */
export function tickBallBeforePhysics(body: RapierRigidBody, stepDt: number): void {
  if (stepDt <= 0) return

  const store = useGameStore.getState()
  if (store.phase === 'replay') return
  if (isSetPieceLaunchActive()) {
    // Curva começa imediatamente após o chute da falta
    stepBallCurl(body, stepDt)
    return
  }

  const restY = ballRestY(BALL_RADIUS)
  const possessed = store.ballPossession
  const frozen = store.ballFrozen
  const setPieceWait =
    frozen && isActiveSetPiecePhase(store.phase) && store.setPiecePosition

  if (setPieceWait) {
    if (store.phase === 'throw-in' && store.setPieceKickerId) {
      ensureBallKinematic()
      stepGkHeldBall(body, store.setPieceKickerId, stepDt)
    }
    return
  }

  if (!possessed && !frozen && tickCrossTrap(body, stepDt, restY)) {
    return
  }

  if (possessed || frozen) {
    clearBallCurl()
    if (possessed) {
      const holder = playerRegistry.get(possessed.playerId)
      if (holder) {
        syncDribblePossession(possessed.playerId, store.possessionSince)
        ensureBallKinematic()
        body.setLinvel({ x: 0, y: 0, z: 0 }, true)
        body.setAngvel({ x: 0, y: 0, z: 0 }, true)

        const gkRt =
          holder.role === 'gk' ? getGkRuntime(possessed.playerId) : null
        const gkHandsOnly =
          holder.role === 'gk' &&
          (gkRt?.mode === 'hold' || gkRt?.mode === 'distribute')

        if (gkHandsOnly) {
          stepGkHeldBall(body, possessed.playerId, stepDt)
        } else if (!frozen) {
          stepPossessedBall(body, holder, stepDt, restY)
        }
        return
      }
    }
    return
  }

  clearDribbleState()
  ensureBallDynamic()
  body.wakeUp()
  stepBallAirDrag(body, stepDt)
  stepBallCurl(body, stepDt)
  stepBallGroundRoll(body, stepDt)
  clampBallSpeed()
}

/** Mantém ballRef alinhado ao corpo após a integração Rapier. */
export function syncBallAfterPhysics(body: RapierRigidBody): void {
  const store = useGameStore.getState()
  if (store.phase === 'replay') return

  const possessed = store.ballPossession
  const frozen = store.ballFrozen
  const setPieceWait =
    frozen && isActiveSetPiecePhase(store.phase) && store.setPiecePosition

  if (setPieceWait && store.phase !== 'throw-in') return
  if (possessed || frozen) {
    if (possessed) {
      const holder = playerRegistry.get(possessed.playerId)
      if (!holder) return
      const gkRt =
        holder.role === 'gk' ? getGkRuntime(possessed.playerId) : null
      const gkHandsOnly =
        holder.role === 'gk' &&
        (gkRt?.mode === 'hold' || gkRt?.mode === 'distribute')
      if (!gkHandsOnly && !frozen) return
    } else {
      return
    }
  }

  syncBallFromBody(body)
  if (!possessed && !frozen) {
    clampBallSpeed()
  }
}
