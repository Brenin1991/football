import type { FieldBounds, TeamId } from '../types'
import type { PlayerRef } from './entityRegistry'
import { playerRegistry } from './entityRegistry'
import { getAttackSign, getAttackingGoalZ } from './teamField'

const OFFSIDE_MARGIN = 0.35
const ONSIDE_BUFFER = 0.55
/** Distância mínima da linha do gol — evita colar no goleiro (campo ~28 m) */
export const GOAL_MOUTH_BUFFER = 4.8

export function getOffsideLineZ(attackingTeam: TeamId, bounds: FieldBounds): number {
  const sign = getAttackSign(attackingTeam, bounds)
  const opponents = [...playerRegistry.values()]
    .filter((p) => p.team !== attackingTeam && p.role !== 'gk')
    .map((p) => p.position.z)
    .sort((a, b) => (sign > 0 ? a - b : b - a))

  if (opponents.length === 0) {
    return bounds.center.z
  }
  const lineIndex = Math.max(0, opponents.length - 2)
  return opponents[lineIndex] ?? bounds.center.z
}

export function isOffsideAtPass(
  attackingTeam: TeamId,
  receiver: PlayerRef,
  bounds: FieldBounds,
  ballZ: number,
): boolean {
  return isOffsideAtZ(attackingTeam, receiver.position.z, bounds, ballZ)
}

export function isOffsideAtZ(
  attackingTeam: TeamId,
  receiverZ: number,
  bounds: FieldBounds,
  ballZ: number,
): boolean {
  const sign = getAttackSign(attackingTeam, bounds)
  const lineZ = getOffsideLineZ(attackingTeam, bounds)

  if (sign > 0) {
    return receiverZ > lineZ + OFFSIDE_MARGIN && receiverZ > ballZ + OFFSIDE_MARGIN
  }
  return receiverZ < lineZ - OFFSIDE_MARGIN && receiverZ < ballZ - OFFSIDE_MARGIN
}

/** Evita atacante dentro do gol — não trava linha de impedimento durante o jogo */
export function clampForwardFromGoalMouth(
  attackingTeam: TeamId,
  z: number,
  bounds: FieldBounds,
  buffer = GOAL_MOUTH_BUFFER,
): number {
  const goalZ = getAttackingGoalZ(attackingTeam, bounds)
  const sign = getAttackSign(attackingTeam, bounds)
  if (sign > 0) return Math.min(z, goalZ - buffer)
  return Math.max(z, goalZ + buffer)
}

/** Só na cobrança — respeita linha de impedimento e distância do gol */
export function clampZForSetPiece(
  attackingTeam: TeamId,
  z: number,
  bounds: FieldBounds,
  _ballZ: number,
): number {
  const sign = getAttackSign(attackingTeam, bounds)
  const lineZ = getOffsideLineZ(attackingTeam, bounds)
  const goalZ = getAttackingGoalZ(attackingTeam, bounds)

  if (sign > 0) {
    return Math.min(z, lineZ + ONSIDE_BUFFER, goalZ - GOAL_MOUTH_BUFFER)
  }
  return Math.max(z, lineZ - ONSIDE_BUFFER, goalZ + GOAL_MOUTH_BUFFER)
}

/** Limita Z para o jogador ficar em posição legal em relação à bola e à linha — só no passe */
export function clampZToStayOnside(
  attackingTeam: TeamId,
  z: number,
  bounds: FieldBounds,
  ballZ: number,
  buffer = ONSIDE_BUFFER,
): number {
  const sign = getAttackSign(attackingTeam, bounds)
  const lineZ = getOffsideLineZ(attackingTeam, bounds)

  if (sign > 0) {
    return Math.min(z, Math.min(lineZ, ballZ) + buffer)
  }
  return Math.max(z, Math.max(lineZ, ballZ) - buffer)
}
