import type { PassIntent } from '../store/gameStore'
import type { FieldBounds, TeamId, Vec3 } from '../types'
import type { PlayerRef } from './entityRegistry'
import { ballRef } from './entityRegistry'
import {
  BALL_RADIUS,
  BALL_FOOT_OFFSET,
  CLAIM_DISTANCE,
  PASS_RECEIVE_DISTANCE,
  STEAL_COOLDOWN_MS,
  STEAL_DISTANCE,
} from '../constants'
import { ballRestY } from './fieldData'
import { predictBallPosition } from './dynamicFormation'
import { distance2D } from './rules'
import { isOffsideAtZ } from './offside'

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

  if (distToBall < 3.2 || ballSpeed < 2.2) {
    return { x: ball.x, z: ball.z }
  }

  if (ballSpeed > 0.35) {
    const toBallX = ball.x - receiverPos.x
    const toBallZ = ball.z - receiverPos.z
    const approach =
      (toBallX * velocity.x + toBallZ * velocity.z) / (distToBall * ballSpeed + 0.001)

    const horizon = clamp(distToBall / Math.max(ballSpeed, 2), 0.12, 0.45)
    const predicted = predictBallPosition(ball, velocity, horizon)

    if (approach > 0.08) {
      if (passIntent) {
        const w = clamp(1 - distToBall / 20, 0.12, 0.35)
        return {
          x: predicted.x * (1 - w) + passIntent.targetX * w,
          z: predicted.z * (1 - w) + passIntent.targetZ * w,
        }
      }
      return { x: predicted.x, z: predicted.z }
    }

    return { x: ball.x, z: ball.z }
  }

  if (passIntent) {
    const mix = clamp(1 - distToBall / 16, 0.2, 0.55)
    return {
      x: ball.x * (1 - mix) + passIntent.targetX * mix,
      z: ball.z * (1 - mix) + passIntent.targetZ * mix,
    }
  }

  const horizon = clamp(distToBall / (Math.max(ballSpeed, 1) * 2.5), 0.1, 0.35)
  const predicted = predictBallPosition(ball, velocity, horizon)
  return { x: predicted.x, z: predicted.z }
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

  const ox = defenderPos.x - fromX
  const oz = defenderPos.z - fromZ
  let t = (ox * dx + oz * dz) / (len * len)
  t = clamp(t, 0.06, 0.94)

  const ballSpeed = Math.hypot(velocity.x, velocity.z)
  const horizon = clamp(ballSpeed > 0.4 ? distAlongLane(defenderPos, fromX, fromZ, dx, dz, len) / Math.max(ballSpeed, 2.5) : 0.12, 0.1, 0.42)
  const predicted = predictBallPosition(ball, velocity, horizon)

  const laneX = fromX + dx * t
  const laneZ = fromZ + dz * t

  return {
    x: laneX * 0.5 + predicted.x * 0.5,
    z: laneZ * 0.5 + predicted.z * 0.5,
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
  const roleBonus = defender.role === 'def' ? 2.4 : defender.role === 'mid' ? 1.5 : 0.5
  const laneDist = distAlongLane(
    defender.position,
    ball.x,
    ball.z,
    passIntent.targetX - ball.x,
    passIntent.targetZ - ball.z,
    Math.hypot(passIntent.targetX - ball.x, passIntent.targetZ - ball.z),
  )

  if (laneDist > 4.2) return -8
  return roleBonus - distToCut * 0.42 - laneDist * 0.18
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

export function findClosestContestant(
  players: PlayerRef[],
  ball: { x: number; y?: number; z: number },
  preferredId?: string,
): PlayerRef | null {
  const ballPos = { x: ball.x, y: ball.y ?? 0, z: ball.z }

  let closest: PlayerRef | null = null
  let minDist = Infinity
  for (const p of players) {
    if (p.role === 'gk') continue
    const d = distance2D(p.position, ballPos)
    if (d < CLAIM_DISTANCE && d < minDist) {
      minDist = d
      closest = p
    }
  }
  if (!closest) return null

  if (preferredId && preferredId !== closest.id) {
    const preferred = players.find((p) => p.id === preferredId)
    if (preferred) {
      const d = distance2D(preferred.position, ballPos)
      if (d < PASS_RECEIVE_DISTANCE && d <= minDist + 0.14) return preferred
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
  const toFoot = distance2D(stealer.position, { x: foot.x, y: 0, z: foot.z })
  const toBody = distance2D(stealer.position, holder.position)
  return toFoot < STEAL_DISTANCE || toBody < STEAL_DISTANCE * 0.92
}

export { STEAL_COOLDOWN_MS }
