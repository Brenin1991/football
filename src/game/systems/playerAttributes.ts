import {
  PLAYER_ATTR_NEUTRAL,
  createDefaultPlayerAttributes,
  derivePlayerOverall,
  type PlayerAttrKey,
  type PlayerAttributes,
} from '../../db/playerAttributeDefaults'
import type { RosterSlot } from '../../db/types'
import type { TeamId } from '../types'
import { useMatchSetupStore } from '../../store/matchSetupStore'

/**
 * Cache O(1) de atributos por id de runtime (`home-3`) e multiplicadores limitados.
 * Neutro = 65. Curvas curtas para não dominar dificuldade / fadiga / função.
 */

export type PlayerAttrProfile = {
  attributes: PlayerAttributes
  overall: number
  shirtNumber: number
  nationalityLabel: string | null
  countryName: string | null
  countryId: string | null
  editionPlayerId: string
  positionLabel: string
}

type PlayerAttrMultipliers = {
  pace: number
  acceleration: number
  agility: number
  staminaDrain: number
  staminaRecover: number
  strength: number
  dribbling: number
  passing: number
  shotPower: number
  finishing: number
  tackling: number
  vision: number
  goalkeeping: number
  /** Ruído angular (rad) para passe/finalização — limitado. */
  aimNoise: number
}

const byRuntimeId = new Map<string, PlayerAttrProfile>()
const multipliersByRuntimeId = new Map<string, PlayerAttrMultipliers>()

const NEUTRAL_MULS: PlayerAttrMultipliers = {
  pace: 1,
  acceleration: 1,
  agility: 1,
  staminaDrain: 1,
  staminaRecover: 1,
  strength: 1,
  dribbling: 1,
  passing: 1,
  shotPower: 1,
  finishing: 1,
  tackling: 1,
  vision: 1,
  goalkeeping: 1,
  aimNoise: 0.028,
}

/** rating 1–99 → multiplicador centrado em 65. */
export function ratingToMul(
  rating: number,
  maxDelta: number,
  invert = false,
): number {
  const t = (Math.max(1, Math.min(99, rating)) - PLAYER_ATTR_NEUTRAL) / 34
  const delta = Math.max(-1, Math.min(1, t)) * maxDelta
  const mul = invert ? 1 - delta : 1 + delta
  return Math.max(0.55, Math.min(1.45, mul))
}

function buildMultipliers(attrs: PlayerAttributes): PlayerAttrMultipliers {
  const finish = ratingToMul(attrs.finishing, 0.14)
  const pass = ratingToMul(attrs.passing, 0.12)
  // Ruído: alto rating → menos desvio (máx ~2.5°, mín ~0.6°)
  const aimNoise =
    0.044 -
    ((attrs.finishing + attrs.passing + attrs.vision) / 3 - PLAYER_ATTR_NEUTRAL) *
      (0.028 / 34)
  return {
    pace: ratingToMul(attrs.pace, 0.12),
    acceleration: ratingToMul(attrs.acceleration, 0.18),
    agility: ratingToMul(attrs.agility, 0.2),
    staminaDrain: ratingToMul(attrs.stamina, 0.34, true),
    staminaRecover: ratingToMul(attrs.stamina, 0.18),
    strength: ratingToMul(attrs.strength, 0.25),
    dribbling: ratingToMul(attrs.dribbling, 0.2),
    passing: pass,
    shotPower: ratingToMul(attrs.shotPower, 0.14),
    finishing: finish,
    tackling: ratingToMul(attrs.tackling, 0.22),
    vision: ratingToMul(attrs.vision, 0.18),
    goalkeeping: ratingToMul(attrs.goalkeeping, 0.22),
    aimNoise: Math.max(0.01, Math.min(0.05, aimNoise)),
  }
}

function profileFromSlot(slot: RosterSlot): PlayerAttrProfile {
  const attributes = slot.attributes ?? createDefaultPlayerAttributes()
  return {
    attributes,
    overall: slot.overall || derivePlayerOverall(attributes, slot.positionLabel),
    shirtNumber: slot.shirtNumber,
    nationalityLabel: slot.nationalityLabel,
    countryName: slot.countryName,
    countryId: slot.countryId,
    editionPlayerId: slot.playerId,
    positionLabel: slot.positionLabel,
  }
}

export function clearPlayerAttributeCache(): void {
  byRuntimeId.clear()
  multipliersByRuntimeId.clear()
}

/** Hidrata a partir da sessão de partida (chamar no loading). */
export function hydratePlayerAttributesFromSession(): void {
  clearPlayerAttributeCache()
  const session = useMatchSetupStore.getState().session
  if (!session) return

  for (const team of ['home', 'away'] as const) {
    const data = team === 'home' ? session.home : session.away
    for (const slot of data.roster) {
      const runtimeId = `${team}-${slot.slotIndex}`
      const profile = profileFromSlot(slot)
      byRuntimeId.set(runtimeId, profile)
      multipliersByRuntimeId.set(runtimeId, buildMultipliers(profile.attributes))
    }
  }
}

export function getPlayerAttrProfile(playerId: string): PlayerAttrProfile | null {
  return byRuntimeId.get(playerId) ?? null
}

export function getPlayerAttrMultipliers(playerId: string): PlayerAttrMultipliers {
  return multipliersByRuntimeId.get(playerId) ?? NEUTRAL_MULS
}

export function getPlayerAttr(
  playerId: string,
  key: PlayerAttrKey,
): number {
  return getPlayerAttrProfile(playerId)?.attributes[key] ?? PLAYER_ATTR_NEUTRAL
}

export function getPlayerOverallRuntime(playerId: string): number {
  return getPlayerAttrProfile(playerId)?.overall ?? PLAYER_ATTR_NEUTRAL
}

export function getPlayerShirtNumber(playerId: string): number {
  const profile = getPlayerAttrProfile(playerId)
  if (profile) return profile.shirtNumber
  const dash = playerId.lastIndexOf('-')
  if (dash < 0) return 1
  const n = parseInt(playerId.slice(dash + 1), 10)
  return Number.isFinite(n) ? n + 1 : 1
}

export function getPlayerNationalityLabel(playerId: string): string | null {
  const p = getPlayerAttrProfile(playerId)
  return p?.nationalityLabel || p?.countryName || null
}

export function getShirtNumberFromSession(team: TeamId, slotIndex: number): number {
  const session = useMatchSetupStore.getState().session
  if (!session) return slotIndex + 1
  const data = team === 'home' ? session.home : session.away
  const slot = data.roster.find((p) => p.slotIndex === slotIndex)
  return slot?.shirtNumber ?? slotIndex + 1
}

/** Aplica ruído angular limitado na direção 2D (passe/chute). */
export function applyAttrAimNoise(
  dirX: number,
  dirZ: number,
  playerId: string,
  kind: 'pass' | 'shot' = 'pass',
): { x: number; z: number } {
  const muls = getPlayerAttrMultipliers(playerId)
  const scale = kind === 'shot' ? 1.15 / Math.max(0.75, muls.finishing) : 1 / Math.max(0.75, muls.passing)
  const noise = muls.aimNoise * scale * (Math.random() * 2 - 1)
  const cos = Math.cos(noise)
  const sin = Math.sin(noise)
  return {
    x: dirX * cos - dirZ * sin,
    z: dirX * sin + dirZ * cos,
  }
}
