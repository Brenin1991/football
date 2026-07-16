import { getUserTeam, useGameStore } from '../store/gameStore'
import type { PassIntent } from '../store/gameStore'
import type { FieldBounds, TeamId, Vec3 } from '../types'
import type { PlayerRef } from './entityRegistry'
import { ballRef } from './entityRegistry'
import {
  BALL_RADIUS,
  BALL_FOOT_OFFSET,
  CLAIM_DISTANCE,
  PASS_RECEIVE_DISTANCE,
  PLAYER_SPRINT_SPEED,
  STEAL_COOLDOWN_MS,
  STEAL_DISTANCE,
} from '../constants'
import { ballRestY } from './fieldData'
import { predictBallPosition } from './dynamicFormation'
import { distance2D } from './rules'
import { isOffsideAtZ } from './offside'
import { minPlayerFootDist2D } from './playerSkeleton'
import { getInterceptLaneMaxDist } from './difficulty'

export { BALL_FOOT_OFFSET, STEAL_DISTANCE, CLAIM_DISTANCE, PASS_RECEIVE_DISTANCE }

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v))
}

/** Alvo de corrida para receber passe — persegue a bola / intercepta a trajetória */
export function getPassReceiveTarget(
  receiverPos: { x: number; z: number },
  ball: Vec3,
  velocity: Vec3,
  passIntent?: { targetX: number; targetZ: number } | null,
): { x: number; z: number } {
  const distToBall = distance2D({ x: receiverPos.x, y: 0, z: receiverPos.z }, ball)
  const ballSpeed = Math.hypot(velocity.x, velocity.z)

  if (ballSpeed > 0.2) {
    const eta = distToBall / Math.max(ballSpeed, 1.2)
    const horizon = clamp(eta * 0.9, 0.1, 0.58)
    const predicted = predictBallPosition(ball, velocity, horizon)
    if (passIntent && distToBall > 6) {
      const w = clamp(1 - distToBall / 24, 0.08, 0.22)
      return {
        x: predicted.x * (1 - w) + passIntent.targetX * w,
        z: predicted.z * (1 - w) + passIntent.targetZ * w,
      }
    }
    return { x: predicted.x, z: predicted.z }
  }

  if (passIntent && distToBall > 2.5) {
    const mix = clamp(1 - distToBall / 14, 0.15, 0.4)
    return {
      x: ball.x * (1 - mix) + passIntent.targetX * mix,
      z: ball.z * (1 - mix) + passIntent.targetZ * mix,
    }
  }

  return { x: ball.x, z: ball.z }
}

/** Ponto na linha do passe para o defensor cortar a trajetória */
export function getPassInterceptTarget(
  defenderPos: { x: number; z: number },
  ball: Vec3,
  velocity: { x: number; y: number; z: number },
  passIntent: Pick<PassIntent, 'targetX' | 'targetZ'>,
): { x: number; z: number } | null {
  const fromX = ball.x
  const fromZ = ball.z
  const dx = passIntent.targetX - fromX
  const dz = passIntent.targetZ - fromZ
  const len = Math.hypot(dx, dz)
  if (len < 1.2) return null

  const ballSpeed = Math.hypot(velocity.x, velocity.z)
  const chaseSpeed = Math.max(PLAYER_SPRINT_SPEED * 0.98, 2.65)

  const distToBall = Math.hypot(defenderPos.x - fromX, defenderPos.z - fromZ)
  if (distToBall < 2.4 && ballSpeed > 0.5) {
    const horizon = clamp(distToBall / Math.max(ballSpeed, 3.2), 0.04, 0.22)
    const predicted = predictBallPosition(ball, velocity, horizon)
    return { x: predicted.x, z: predicted.z }
  }

  let bestT = 0.5
  let bestScore = -Infinity

  for (let i = 2; i <= 14; i++) {
    const t = i / 14
    const laneX = fromX + dx * t
    const laneZ = fromZ + dz * t
    const distAlong = len * t
    const ballTime =
      ballSpeed > 0.35 ? distAlong / ballSpeed : distAlong / Math.max(ballSpeed + 4.5, 5.5)
    const defDist = Math.hypot(defenderPos.x - laneX, defenderPos.z - laneZ)
    const defTime = defDist / chaseSpeed
    const margin = defTime - ballTime

    let score = -Math.abs(margin) * 2.4
    if (margin <= 0.05 && margin >= -0.22) score += 4.2
    else if (margin < 0.35) score += 1.6
    if (t > 0.12 && t < 0.88) score += 0.55
    score -= defDist * 0.08

    if (score > bestScore) {
      bestScore = score
      bestT = t
    }
  }

  const laneX = fromX + dx * bestT
  const laneZ = fromZ + dz * bestT
  const horizon = clamp(
    ballSpeed > 0.4
      ? distAlongLane(defenderPos, fromX, fromZ, dx, dz, len) / Math.max(ballSpeed, 2.8)
      : 0.1,
    0.06,
    0.32,
  )
  const predicted = predictBallPosition(ball, velocity, horizon)

  const laneWeight = ballSpeed > 4.5 ? 0.38 : ballSpeed > 2.8 ? 0.48 : 0.58
  return {
    x: laneX * laneWeight + predicted.x * (1 - laneWeight),
    z: laneZ * laneWeight + predicted.z * (1 - laneWeight),
  }
}

function distAlongLane(
  pos: { x: number; z: number },
  fromX: number,
  fromZ: number,
  dx: number,
  dz: number,
  len: number,
): number {
  const t = clamp(((pos.x - fromX) * dx + (pos.z - fromZ) * dz) / (len * len), 0, 1)
  const px = fromX + dx * t
  const pz = fromZ + dz * t
  return Math.hypot(pos.x - px, pos.z - pz)
}

/** Quão bem o jogador está posicionado para interceptar o passe */
export function scorePassInterceptPosition(
  defender: PlayerRef,
  ball: Vec3,
  velocity: { x: number; y: number; z: number },
  passIntent: PassIntent,
): number {
  const target = getPassInterceptTarget(defender.position, ball, velocity, passIntent)
  if (!target) return -10

  const distToCut = distance2D(defender.position, { x: target.x, y: 0, z: target.z })
  const roleBonus = defender.role === 'def' ? 3.4 : defender.role === 'mid' ? 2.35 : 1.05
  const passLen = Math.hypot(passIntent.targetX - ball.x, passIntent.targetZ - ball.z)
  const laneDist = distAlongLane(
    defender.position,
    ball.x,
    ball.z,
    passIntent.targetX - ball.x,
    passIntent.targetZ - ball.z,
    passLen,
  )

  if (laneDist > getInterceptLaneMaxDist(defender.team)) return -8

  const ballSpeed = Math.hypot(velocity.x, velocity.z)
  const chaseSpeed = Math.max(PLAYER_SPRINT_SPEED * 1.02, 2.5)
  const ballTime = passLen / Math.max(ballSpeed, 4.5)
  const defTime = distToCut / chaseSpeed
  const timingBonus = defTime <= ballTime + 0.32 ? 3.8 : defTime <= ballTime + 0.55 ? 1.85 : 0.15

  const vx = defender.velocity?.x ?? 0
  const vz = defender.velocity?.z ?? 0
  const toCutX = target.x - defender.position.x
  const toCutZ = target.z - defender.position.z
  const toCutLen = Math.hypot(toCutX, toCutZ)
  const moveDot =
    toCutLen > 0.05
      ? (vx * toCutX + vz * toCutZ) / (Math.hypot(vx, vz) * toCutLen + 0.08)
      : 0
  const approachBonus = moveDot > 0.25 ? moveDot * 1.75 : 0

  return (
    roleBonus +
    timingBonus +
    approachBonus -
    distToCut * 0.28 -
    laneDist * 0.1
  )
}

export function getBallAtFeet(player: PlayerRef) {
  const fx = Math.sin(player.rotation)
  const fz = Math.cos(player.rotation)
  return {
    x: player.position.x + fx * BALL_FOOT_OFFSET,
    y: ballRestY(BALL_RADIUS),
    z: player.position.z + fz * BALL_FOOT_OFFSET,
  }
}

/** Posição real da bola com posse; evita snap no pivot do jogador */
export function getHeldBallPoint(holder: PlayerRef, possessedPlayerId?: string | null) {
  if (possessedPlayerId === holder.id) {
    return { x: ballRef.current.x, z: ballRef.current.z }
  }
  const foot = getBallAtFeet(holder)
  return { x: foot.x, z: foot.z }
}

export function findNearestTeammate(
  from: PlayerRef,
  players: PlayerRef[],
): PlayerRef | null {
  let best: PlayerRef | null = null
  let min = Infinity
  for (const p of players) {
    if (p.team !== from.team || p.id === from.id) continue
    const d = distance2D(from.position, p.position)
    if (d < min) {
      min = d
      best = p
    }
  }
  return best
}

/** Companheiro mais próximo na direção que o passador está olhando */
export function findPassTargetInFacingDirection(
  from: PlayerRef,
  players: PlayerRef[],
  options?: {
    minDist?: number
    maxDist?: number
    /** Alinhamento mínimo com a direção do corpo (1 = reta, 0.7 ≈ 45°) */
    minDot?: number
    /** Desvio lateral máximo proporcional à distância à frente */
    maxLateralRatio?: number
    /** Filtra alvos em impedimento */
    onsideOnly?: { team: TeamId; bounds: FieldBounds; ballZ: number }
    /** Direção de mira explícita (stick/WASD) em vez da rotação atual do corpo */
    facingDir?: { x: number; z: number }
  },
): PlayerRef | null {
  const {
    minDist = 2.5,
    maxDist = 22,
    minDot = 0.82,
    maxLateralRatio = 0.38,
    onsideOnly,
    facingDir,
  } = options ?? {}

  const dirLen = facingDir ? Math.hypot(facingDir.x, facingDir.z) : 0
  const fx = dirLen > 0.001 ? facingDir!.x / dirLen : Math.sin(from.rotation)
  const fz = dirLen > 0.001 ? facingDir!.z / dirLen : Math.cos(from.rotation)

  let best: PlayerRef | null = null
  let bestDist = Infinity

  for (const p of players) {
    if (p.team !== from.team || p.id === from.id || p.role === 'gk') continue

    const dx = p.position.x - from.position.x
    const dz = p.position.z - from.position.z
    const dist = Math.hypot(dx, dz)
    if (dist < minDist || dist > maxDist) continue

    const forward = dx * fx + dz * fz
    if (forward <= 0.5) continue

    const dot = forward / dist
    if (dot < minDot) continue

    const lateral = Math.abs(dx * fz - dz * fx)
    if (lateral / forward > maxLateralRatio && lateral > 1.4) continue

    if (
      onsideOnly &&
      isOffsideAtZ(onsideOnly.team, p.position.z, onsideOnly.bounds, onsideOnly.ballZ)
    ) {
      continue
    }

    if (dist < bestDist) {
      bestDist = dist
      best = p
    }
  }

  return best
}

/**
 * Passe assistido (estilo FIFA): escolhe o melhor companheiro na direção do
 * input, com cone largo — não exige o corpo estar virado pro alvo.
 */
export function findAssistedPassTarget(
  from: PlayerRef,
  players: PlayerRef[],
  aimDir: { x: number; z: number },
  options?: {
    minDist?: number
    maxDist?: number
    onsideOnly?: { team: TeamId; bounds: FieldBounds; ballZ: number }
  },
): PlayerRef | null {
  const { minDist = 2, maxDist = 28, onsideOnly } = options ?? {}

  const dirLen = Math.hypot(aimDir.x, aimDir.z)
  const fx = dirLen > 0.001 ? aimDir.x / dirLen : Math.sin(from.rotation)
  const fz = dirLen > 0.001 ? aimDir.z / dirLen : Math.cos(from.rotation)

  let best: PlayerRef | null = null
  let bestScore = -Infinity

  for (const p of players) {
    if (p.team !== from.team || p.id === from.id || p.role === 'gk') continue

    const dx = p.position.x - from.position.x
    const dz = p.position.z - from.position.z
    const dist = Math.hypot(dx, dz)
    if (dist < minDist || dist > maxDist) continue

    const forward = dx * fx + dz * fz
    if (forward < 0.35) continue

    const dot = forward / dist
    if (dot < 0.12) continue

    if (
      onsideOnly &&
      isOffsideAtZ(onsideOnly.team, p.position.z, onsideOnly.bounds, onsideOnly.ballZ)
    ) {
      continue
    }

    const alignScore = dot
    const distScore = 1 / (1 + dist * 0.1)
    const score = alignScore * 0.7 + distScore * 0.3

    if (score > bestScore) {
      bestScore = score
      best = p
    }
  }

  return best
}

export function findNearestPlayerToBall(
  players: PlayerRef[],
  ball: { x: number; y?: number; z: number },
  team?: TeamId,
): PlayerRef | null {
  let best: PlayerRef | null = null
  let min = Infinity
  for (const p of players) {
    if (team && p.team !== team) continue
    const d = distance2D(p.position, { x: ball.x, y: ball.y ?? 0, z: ball.z })
    if (d < min) {
      min = d
      best = p
    }
  }
  return best
}

function contestDistanceToBall(player: PlayerRef, ballPos: { x: number; y: number; z: number }) {
  const bodyDist = distance2D(player.position, ballPos)
  const foot = getBallAtFeet(player)
  const footDist = distance2D({ x: foot.x, y: 0, z: foot.z }, ballPos)
  return Math.min(bodyDist, footDist)
}

export function findClosestContestant(
  players: PlayerRef[],
  ball: { x: number; y?: number; z: number },
  preferredId?: string,
  maxClaimDistance = CLAIM_DISTANCE,
): PlayerRef | null {
  const ballPos = { x: ball.x, y: ball.y ?? 0, z: ball.z }

  let closest: PlayerRef | null = null
  let minDist = Infinity
  for (const p of players) {
    if (p.role === 'gk') continue
    const d = contestDistanceToBall(p, ballPos)
    if (d < maxClaimDistance && d < minDist) {
      minDist = d
      closest = p
    }
  }
  if (!closest) return null

  if (preferredId && preferredId !== closest.id) {
    const preferred = players.find((p) => p.id === preferredId)
    if (preferred) {
      const d = contestDistanceToBall(preferred, ballPos)
      const receiveReach = Math.max(PASS_RECEIVE_DISTANCE, maxClaimDistance)
      if (d < receiveReach && d <= minDist + 0.14) return preferred
    }
  }

  return closest
}

/** Disputa 1:1 — marcador encostou na bola ou no portador */
export function canStealFromHolder(
  stealer: PlayerRef,
  holder: PlayerRef,
  foot: { x: number; z: number },
): boolean {
  if (holder.role === 'gk') return false
  const ballPoint = { x: foot.x, y: 0, z: foot.z }
  const toFoot = distance2D(stealer.position, ballPoint)
  const toBody = distance2D(stealer.position, holder.position)
  const stealerFoot = minPlayerFootDist2D(stealer.id, ballPoint)
  const reach =
    STEAL_DISTANCE *
    (stealer.team === getUserTeam() &&
    stealer.id === useGameStore.getState().activePlayerId
      ? 1.08
      : 1.28)
  return (
    toFoot < reach ||
    toBody < STEAL_DISTANCE * 1.18 ||
    (stealerFoot != null && stealerFoot < reach)
  )
}

export { STEAL_COOLDOWN_MS }
