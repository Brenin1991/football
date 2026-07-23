import type { PlayerRole } from '../types'
import type { FormationSlot } from '../types'

/** Faixa lateral — substitui heurística |x| >= 0.55 */
export type FormationLane = 'L' | 'C' | 'R'

export type FormationPresetId =
  | '4-4-2'
  | '4-3-3'
  | '4-3-3-att'
  | '4-3-3-hold'
  | '4-2-3-1'
  | '4-1-2-1-2'
  | '4-3-2-1'
  | '4-5-1'
  | '3-5-2'
  | '3-4-3'
  | '5-3-2'
  | '5-4-1'
  | 'custom'

export type FormationSlotDef = FormationSlot & {
  positionLabel: string
  lane: FormationLane
}

export type FormationPreset = {
  id: Exclude<FormationPresetId, 'custom'>
  name: string
  /** Slot index do cobrador de saída (atacante típico). */
  kickoffSlotIndex: number
  /** Índices elegíveis para barreira de falta (zaga/laterais). */
  wallSlotIndices: number[]
  slots: FormationSlotDef[]
}

function slot(
  x: number,
  z: number,
  role: PlayerRole,
  positionLabel: string,
  lane: FormationLane,
): FormationSlotDef {
  return { x, z, role, positionLabel, lane }
}

function laneFromX(x: number): FormationLane {
  if (x <= -0.45) return 'L'
  if (x >= 0.45) return 'R'
  return 'C'
}

/** Inferência de faixa a partir de x (custom / migração). */
export function inferLane(x: number): FormationLane {
  return laneFromX(x)
}

export function isWideLane(lane: FormationLane): boolean {
  return lane === 'L' || lane === 'R'
}

export function isWideSlotDef(s: { x: number; lane?: FormationLane }): boolean {
  if (s.lane) return isWideLane(s.lane)
  return Math.abs(s.x) >= 0.55
}

function wallFromRoles(slots: FormationSlotDef[]): number[] {
  return slots
    .map((s, i) => (s.role === 'def' ? i : -1))
    .filter((i) => i >= 0)
}

function kickoffFromRoles(slots: FormationSlotDef[]): number {
  const fwd = slots.findIndex((s) => s.role === 'fwd')
  if (fwd >= 0) return fwd
  const mid = slots.findIndex((s) => s.role === 'mid' && s.lane === 'C')
  return mid >= 0 ? mid : 9
}

function makePreset(
  id: Exclude<FormationPresetId, 'custom'>,
  name: string,
  slots: FormationSlotDef[],
  kickoffSlotIndex?: number,
): FormationPreset {
  return {
    id,
    name,
    kickoffSlotIndex: kickoffSlotIndex ?? kickoffFromRoles(slots),
    wallSlotIndices: wallFromRoles(slots),
    slots,
  }
}

export const FORMATION_PRESETS: Record<Exclude<FormationPresetId, 'custom'>, FormationPreset> = {
  '4-4-2': makePreset('4-4-2', '4-4-2', [
    slot(0, 0.93, 'gk', 'GK', 'C'),
    slot(-0.78, 0.74, 'def', 'LB', 'L'),
    slot(-0.28, 0.78, 'def', 'CB', 'C'),
    slot(0.28, 0.78, 'def', 'CB', 'C'),
    slot(0.78, 0.74, 'def', 'RB', 'R'),
    slot(-0.78, 0.5, 'mid', 'LM', 'L'),
    slot(-0.28, 0.52, 'mid', 'CM', 'C'),
    slot(0.28, 0.52, 'mid', 'CM', 'C'),
    slot(0.78, 0.5, 'mid', 'RM', 'R'),
    slot(-0.35, 0.14, 'fwd', 'CF', 'C'),
    slot(0.35, 0.14, 'fwd', 'ST', 'C'),
  ]),
  '4-3-3': makePreset('4-3-3', '4-3-3', [
    slot(0, 0.93, 'gk', 'GK', 'C'),
    slot(-0.78, 0.74, 'def', 'LB', 'L'),
    slot(-0.28, 0.78, 'def', 'CB', 'C'),
    slot(0.28, 0.78, 'def', 'CB', 'C'),
    slot(0.78, 0.74, 'def', 'RB', 'R'),
    slot(-0.42, 0.52, 'mid', 'CM', 'C'),
    slot(0, 0.48, 'mid', 'CM', 'C'),
    slot(0.42, 0.52, 'mid', 'CM', 'C'),
    slot(-0.78, 0.18, 'fwd', 'LW', 'L'),
    slot(0, 0.12, 'fwd', 'ST', 'C'),
    slot(0.78, 0.18, 'fwd', 'RW', 'R'),
  ]),
  '4-3-3-att': makePreset('4-3-3-att', '4-3-3 Ofensivo', [
    slot(0, 0.93, 'gk', 'GK', 'C'),
    slot(-0.78, 0.74, 'def', 'LB', 'L'),
    slot(-0.28, 0.78, 'def', 'CB', 'C'),
    slot(0.28, 0.78, 'def', 'CB', 'C'),
    slot(0.78, 0.74, 'def', 'RB', 'R'),
    slot(-0.38, 0.5, 'mid', 'CM', 'C'),
    slot(0, 0.42, 'mid', 'CAM', 'C'),
    slot(0.38, 0.5, 'mid', 'CM', 'C'),
    slot(-0.82, 0.16, 'fwd', 'LW', 'L'),
    slot(0, 0.1, 'fwd', 'ST', 'C'),
    slot(0.82, 0.16, 'fwd', 'RW', 'R'),
  ]),
  '4-3-3-hold': makePreset('4-3-3-hold', '4-3-3 Volante', [
    slot(0, 0.93, 'gk', 'GK', 'C'),
    slot(-0.78, 0.74, 'def', 'LB', 'L'),
    slot(-0.28, 0.78, 'def', 'CB', 'C'),
    slot(0.28, 0.78, 'def', 'CB', 'C'),
    slot(0.78, 0.74, 'def', 'RB', 'R'),
    slot(0, 0.58, 'mid', 'CDM', 'C'),
    slot(-0.4, 0.48, 'mid', 'CM', 'C'),
    slot(0.4, 0.48, 'mid', 'CM', 'C'),
    slot(-0.78, 0.18, 'fwd', 'LW', 'L'),
    slot(0, 0.12, 'fwd', 'ST', 'C'),
    slot(0.78, 0.18, 'fwd', 'RW', 'R'),
  ]),
  '4-2-3-1': makePreset('4-2-3-1', '4-2-3-1', [
    slot(0, 0.93, 'gk', 'GK', 'C'),
    slot(-0.78, 0.74, 'def', 'LB', 'L'),
    slot(-0.28, 0.78, 'def', 'CB', 'C'),
    slot(0.28, 0.78, 'def', 'CB', 'C'),
    slot(0.78, 0.74, 'def', 'RB', 'R'),
    slot(-0.32, 0.56, 'mid', 'CDM', 'C'),
    slot(0.32, 0.56, 'mid', 'CDM', 'C'),
    slot(-0.72, 0.32, 'mid', 'LM', 'L'),
    slot(0, 0.3, 'mid', 'CAM', 'C'),
    slot(0.72, 0.32, 'mid', 'RM', 'R'),
    slot(0, 0.1, 'fwd', 'ST', 'C'),
  ]),
  '4-1-2-1-2': makePreset('4-1-2-1-2', '4-1-2-1-2', [
    slot(0, 0.93, 'gk', 'GK', 'C'),
    slot(-0.78, 0.74, 'def', 'LB', 'L'),
    slot(-0.28, 0.78, 'def', 'CB', 'C'),
    slot(0.28, 0.78, 'def', 'CB', 'C'),
    slot(0.78, 0.74, 'def', 'RB', 'R'),
    slot(0, 0.58, 'mid', 'CDM', 'C'),
    slot(-0.48, 0.44, 'mid', 'CM', 'C'),
    slot(0.48, 0.44, 'mid', 'CM', 'C'),
    slot(0, 0.3, 'mid', 'CAM', 'C'),
    slot(-0.35, 0.12, 'fwd', 'ST', 'C'),
    slot(0.35, 0.12, 'fwd', 'ST', 'C'),
  ]),
  '4-3-2-1': makePreset('4-3-2-1', '4-3-2-1', [
    slot(0, 0.93, 'gk', 'GK', 'C'),
    slot(-0.78, 0.74, 'def', 'LB', 'L'),
    slot(-0.28, 0.78, 'def', 'CB', 'C'),
    slot(0.28, 0.78, 'def', 'CB', 'C'),
    slot(0.78, 0.74, 'def', 'RB', 'R'),
    slot(-0.42, 0.54, 'mid', 'CM', 'C'),
    slot(0, 0.56, 'mid', 'CDM', 'C'),
    slot(0.42, 0.54, 'mid', 'CM', 'C'),
    slot(-0.38, 0.28, 'mid', 'CAM', 'C'),
    slot(0.38, 0.28, 'mid', 'CAM', 'C'),
    slot(0, 0.1, 'fwd', 'ST', 'C'),
  ]),
  '4-5-1': makePreset('4-5-1', '4-5-1', [
    slot(0, 0.93, 'gk', 'GK', 'C'),
    slot(-0.78, 0.74, 'def', 'LB', 'L'),
    slot(-0.28, 0.78, 'def', 'CB', 'C'),
    slot(0.28, 0.78, 'def', 'CB', 'C'),
    slot(0.78, 0.74, 'def', 'RB', 'R'),
    slot(-0.78, 0.48, 'mid', 'LM', 'L'),
    slot(-0.32, 0.52, 'mid', 'CM', 'C'),
    slot(0, 0.5, 'mid', 'CDM', 'C'),
    slot(0.32, 0.52, 'mid', 'CM', 'C'),
    slot(0.78, 0.48, 'mid', 'RM', 'R'),
    slot(0, 0.12, 'fwd', 'ST', 'C'),
  ]),
  '3-5-2': makePreset('3-5-2', '3-5-2', [
    slot(0, 0.93, 'gk', 'GK', 'C'),
    slot(-0.42, 0.78, 'def', 'CB', 'C'),
    slot(0, 0.8, 'def', 'CB', 'C'),
    slot(0.42, 0.78, 'def', 'CB', 'C'),
    slot(-0.88, 0.48, 'mid', 'LWB', 'L'),
    slot(-0.32, 0.54, 'mid', 'CM', 'C'),
    slot(0, 0.5, 'mid', 'CDM', 'C'),
    slot(0.32, 0.54, 'mid', 'CM', 'C'),
    slot(0.88, 0.48, 'mid', 'RWB', 'R'),
    slot(-0.32, 0.14, 'fwd', 'ST', 'C'),
    slot(0.32, 0.14, 'fwd', 'ST', 'C'),
  ]),
  '3-4-3': makePreset('3-4-3', '3-4-3', [
    slot(0, 0.93, 'gk', 'GK', 'C'),
    slot(-0.42, 0.78, 'def', 'CB', 'C'),
    slot(0, 0.8, 'def', 'CB', 'C'),
    slot(0.42, 0.78, 'def', 'CB', 'C'),
    slot(-0.82, 0.5, 'mid', 'LM', 'L'),
    slot(-0.28, 0.52, 'mid', 'CM', 'C'),
    slot(0.28, 0.52, 'mid', 'CM', 'C'),
    slot(0.82, 0.5, 'mid', 'RM', 'R'),
    slot(-0.72, 0.16, 'fwd', 'LW', 'L'),
    slot(0, 0.1, 'fwd', 'ST', 'C'),
    slot(0.72, 0.16, 'fwd', 'RW', 'R'),
  ]),
  '5-3-2': makePreset('5-3-2', '5-3-2', [
    slot(0, 0.93, 'gk', 'GK', 'C'),
    slot(-0.88, 0.68, 'def', 'LWB', 'L'),
    slot(-0.48, 0.78, 'def', 'CB', 'C'),
    slot(0, 0.8, 'def', 'CB', 'C'),
    slot(0.48, 0.78, 'def', 'CB', 'C'),
    slot(0.88, 0.68, 'def', 'RWB', 'R'),
    slot(-0.4, 0.5, 'mid', 'CM', 'C'),
    slot(0, 0.48, 'mid', 'CDM', 'C'),
    slot(0.4, 0.5, 'mid', 'CM', 'C'),
    slot(-0.32, 0.14, 'fwd', 'ST', 'C'),
    slot(0.32, 0.14, 'fwd', 'ST', 'C'),
  ]),
  '5-4-1': makePreset('5-4-1', '5-4-1', [
    slot(0, 0.93, 'gk', 'GK', 'C'),
    slot(-0.88, 0.68, 'def', 'LWB', 'L'),
    slot(-0.48, 0.78, 'def', 'CB', 'C'),
    slot(0, 0.8, 'def', 'CB', 'C'),
    slot(0.48, 0.78, 'def', 'CB', 'C'),
    slot(0.88, 0.68, 'def', 'RWB', 'R'),
    slot(-0.72, 0.48, 'mid', 'LM', 'L'),
    slot(-0.28, 0.52, 'mid', 'CM', 'C'),
    slot(0.28, 0.52, 'mid', 'CM', 'C'),
    slot(0.72, 0.48, 'mid', 'RM', 'R'),
    slot(0, 0.12, 'fwd', 'ST', 'C'),
  ]),
}

export const FORMATION_PRESET_LIST = Object.values(FORMATION_PRESETS)

export const DEFAULT_FORMATION_PRESET_ID: Exclude<FormationPresetId, 'custom'> = '4-4-2'

export function getFormationPreset(id: string | null | undefined): FormationPreset {
  if (id && id !== 'custom' && id in FORMATION_PRESETS) {
    return FORMATION_PRESETS[id as Exclude<FormationPresetId, 'custom'>]
  }
  return FORMATION_PRESETS[DEFAULT_FORMATION_PRESET_ID]
}

export function roleFromPositionLabel(label: string): PlayerRole {
  const p = label.toUpperCase()
  if (p === 'GK') return 'gk'
  if (
    p === 'CB' ||
    p === 'LB' ||
    p === 'RB' ||
    p === 'LWB' ||
    p === 'RWB' ||
    p === 'SW'
  ) {
    return 'def'
  }
  if (
    p === 'ST' ||
    p === 'CF' ||
    p === 'SS' ||
    p === 'LW' ||
    p === 'RW' ||
    p === 'LF' ||
    p === 'RF'
  ) {
    return 'fwd'
  }
  return 'mid'
}

export const ALL_POSITION_LABELS = [
  'GK',
  'CB',
  'LB',
  'RB',
  'LWB',
  'RWB',
  'CDM',
  'CM',
  'CAM',
  'LM',
  'RM',
  'LW',
  'RW',
  'CF',
  'ST',
  'SS',
] as const

export type MentalityId = 'ultra_def' | 'defensive' | 'balanced' | 'attacking' | 'ultra_att'
export type BuildUpId = 'short' | 'mixed' | 'long'
export type ChanceCreationId = 'possession' | 'balanced' | 'direct' | 'forward_runs'
export type DefensiveStyleId = 'drop_back' | 'balanced' | 'press' | 'constant_press'

export type TeamTacticsData = {
  formationPresetId: FormationPresetId
  mentality: MentalityId
  buildUp: BuildUpId
  chanceCreation: ChanceCreationId
  defensiveStyle: DefensiveStyleId
  /** 0..100 */
  width: number
  depth: number
  pressIntensity: number
  tempo: number
}

export const DEFAULT_TEAM_TACTICS: TeamTacticsData = {
  formationPresetId: DEFAULT_FORMATION_PRESET_ID,
  mentality: 'balanced',
  buildUp: 'mixed',
  chanceCreation: 'balanced',
  defensiveStyle: 'balanced',
  width: 50,
  depth: 50,
  pressIntensity: 50,
  tempo: 50,
}

export type SupportRunsId = 'stay_back' | 'balanced' | 'get_forward' | 'free_roam'
export type AttackingRunsId = 'stay_central' | 'mixed' | 'get_in_behind' | 'target_man' | 'false_9'
export type InterceptionsId = 'conservative' | 'normal' | 'aggressive'
export type PositioningFreedomId = 'stick' | 'balanced' | 'free'

export type PlayerInstructionsData = {
  supportRuns: SupportRunsId
  attackingRuns: AttackingRunsId
  interceptions: InterceptionsId
  positioningFreedom: PositioningFreedomId
}

export const DEFAULT_PLAYER_INSTRUCTIONS: PlayerInstructionsData = {
  supportRuns: 'balanced',
  attackingRuns: 'mixed',
  interceptions: 'normal',
  positioningFreedom: 'balanced',
}

export function clampTacticSlider(v: number): number {
  if (!Number.isFinite(v)) return 50
  return Math.max(0, Math.min(100, Math.round(v)))
}

export function validateFormationSlots(
  slots: Array<{ x: number; z: number; role: PlayerRole; positionLabel: string }>,
): string[] {
  const errors: string[] = []
  if (slots.length !== 11) errors.push('A formação precisa de exatamente 11 postos.')
  const gks = slots.filter((s) => s.role === 'gk' || s.positionLabel.toUpperCase() === 'GK')
  if (gks.length !== 1) errors.push('É obrigatório ter exatamente 1 goleiro.')
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i]
    if (s.x < -1 || s.x > 1 || s.z < 0 || s.z > 1) {
      errors.push(`Posto ${i + 1}: coordenadas fora do campo.`)
    }
  }
  for (let i = 0; i < slots.length; i++) {
    for (let j = i + 1; j < slots.length; j++) {
      const dx = slots[i].x - slots[j].x
      const dz = slots[i].z - slots[j].z
      if (Math.hypot(dx, dz) < 0.08) {
        errors.push(`Postos ${i + 1} e ${j + 1} estão muito próximos.`)
      }
    }
  }
  return errors
}

export const MAX_SQUAD_SIZE = 23
export const STARTING_XI_SIZE = 11
