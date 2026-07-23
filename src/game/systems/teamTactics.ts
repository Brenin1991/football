import type { TeamId } from '../types'
import type { FormationSlot } from '../types'
import {
  DEFAULT_PLAYER_INSTRUCTIONS,
  DEFAULT_TEAM_TACTICS,
  getFormationPreset,
  isWideSlotDef,
  type FormationLane,
  type FormationPresetId,
  type PlayerInstructionsData,
  type TeamTacticsData,
} from '../data/formations'
import type { TeamFormationSlot, TeamWithRoster } from '../../db/types'
import { getDatabase } from '../../db/database'
import { getTeamWithRoster } from '../../db/queries'
import { useMatchSetupStore } from '../../store/matchSetupStore'

/**
 * Cache O(1) de formação + táticas por time da partida.
 * Camada tática aplica-se ANTES de difficulty / stamina / atributos.
 */

export type RuntimeFormationSlot = FormationSlot & {
  positionLabel: string
  lane: FormationLane
  slotIndex: number
}

export type TeamTacticsRuntime = {
  tactics: TeamTacticsData
  slots: RuntimeFormationSlot[]
  kickoffSlotIndex: number
  wallSlotIndices: number[]
  /** Instruções por playerId de edição (edition player id). */
  instructionsByEditionPlayerId: Map<string, PlayerInstructionsData>
  /** Map runtime id (home-3) → edition player id */
  editionPlayerByRuntimeId: Map<string, string>
}

const byTeam: Record<TeamId, TeamTacticsRuntime | null> = {
  home: null,
  away: null,
}

function slotsFromTeam(team: TeamWithRoster): RuntimeFormationSlot[] {
  if (team.formationSlots?.length === 11) {
    return team.formationSlots
      .slice()
      .sort((a, b) => a.slotIndex - b.slotIndex)
      .map((s) => ({
        x: s.x,
        z: s.z,
        role: s.role,
        positionLabel: s.positionLabel,
        lane: s.lane,
        slotIndex: s.slotIndex,
      }))
  }
  const preset = getFormationPreset(team.tactics?.formationPresetId)
  return preset.slots.map((s, i) => ({
    ...s,
    slotIndex: i,
  }))
}

function buildRuntime(team: TeamWithRoster, side: TeamId): TeamTacticsRuntime {
  const slots = slotsFromTeam(team)
  const tactics: TeamTacticsData = team.tactics
    ? {
        formationPresetId: team.tactics.formationPresetId,
        mentality: team.tactics.mentality,
        buildUp: team.tactics.buildUp,
        chanceCreation: team.tactics.chanceCreation,
        defensiveStyle: team.tactics.defensiveStyle,
        width: team.tactics.width,
        depth: team.tactics.depth,
        pressIntensity: team.tactics.pressIntensity,
        tempo: team.tactics.tempo,
      }
    : { ...DEFAULT_TEAM_TACTICS }

  const preset =
    tactics.formationPresetId === 'custom'
      ? null
      : getFormationPreset(tactics.formationPresetId)

  const kickoffSlotIndex =
    preset?.kickoffSlotIndex ??
    slots.findIndex((s) => s.role === 'fwd') ??
    9

  const wallSlotIndices =
    preset?.wallSlotIndices ??
    slots.map((s, i) => (s.role === 'def' ? i : -1)).filter((i) => i >= 0)

  const instructionsByEditionPlayerId = new Map<string, PlayerInstructionsData>()
  const editionPlayerByRuntimeId = new Map<string, string>()

  for (const r of team.roster) {
    if (r.slotIndex < 0 || r.slotIndex > 10) continue
    editionPlayerByRuntimeId.set(`${side}-${r.slotIndex}`, r.playerId)
    instructionsByEditionPlayerId.set(
      r.playerId,
      r.instructions ?? DEFAULT_PLAYER_INSTRUCTIONS,
    )
  }

  return {
    tactics,
    slots,
    kickoffSlotIndex: kickoffSlotIndex < 0 ? 9 : kickoffSlotIndex,
    wallSlotIndices,
    instructionsByEditionPlayerId,
    editionPlayerByRuntimeId,
  }
}

export function clearTeamTacticsCache(): void {
  byTeam.home = null
  byTeam.away = null
}

export function hydrateTeamTacticsFromSession(): void {
  clearTeamTacticsCache()
  const session = useMatchSetupStore.getState().session
  if (!session) return
  byTeam.home = buildRuntime(session.home, 'home')
  byTeam.away = buildRuntime(session.away, 'away')
}

function getRuntime(team: TeamId): TeamTacticsRuntime {
  const cached = byTeam[team]
  if (cached) return cached
  // Fallback neutro 4-4-2
  const preset = getFormationPreset('4-4-2')
  const fallback: TeamTacticsRuntime = {
    tactics: { ...DEFAULT_TEAM_TACTICS },
    slots: preset.slots.map((s, i) => ({ ...s, slotIndex: i })),
    kickoffSlotIndex: preset.kickoffSlotIndex,
    wallSlotIndices: preset.wallSlotIndices,
    instructionsByEditionPlayerId: new Map(),
    editionPlayerByRuntimeId: new Map(),
  }
  byTeam[team] = fallback
  return fallback
}

export function getTeamFormationSlots(team: TeamId): RuntimeFormationSlot[] {
  return getRuntime(team).slots
}

export function getTeamFormationSlot(team: TeamId, slotIndex: number): RuntimeFormationSlot {
  const slots = getTeamFormationSlots(team)
  return slots[slotIndex] ?? slots[0] ?? {
    x: 0,
    z: 0.5,
    role: 'mid',
    positionLabel: 'CM',
    lane: 'C',
    slotIndex: 0,
  }
}

export function getKickoffSlotIndex(team: TeamId): number {
  return getRuntime(team).kickoffSlotIndex
}

export function getWallSlotIndices(team: TeamId): number[] {
  return getRuntime(team).wallSlotIndices
}

export function getTeamTacticsData(team: TeamId): TeamTacticsData {
  return getRuntime(team).tactics
}

export function getPlayerInstructions(playerId: string): PlayerInstructionsData {
  const team: TeamId = playerId.startsWith('away-') ? 'away' : 'home'
  const rt = getRuntime(team)
  const editionId = rt.editionPlayerByRuntimeId.get(playerId)
  if (!editionId) return DEFAULT_PLAYER_INSTRUCTIONS
  return rt.instructionsByEditionPlayerId.get(editionId) ?? DEFAULT_PLAYER_INSTRUCTIONS
}

export function isFormationWideSlot(slot: { x: number; lane?: FormationLane }): boolean {
  return isWideSlotDef(slot)
}

/** Multiplicadores limitados a partir das táticas coletivas. */
export type TacticsMultipliers = {
  lineDepthBias: number
  widthScale: number
  pressWeight: number
  compactWeight: number
  tempoThinkScale: number
  buildUpPassPrefer: number
  chanceCreationForward: number
  coverPresserChance: number
  /** Gasto de stamina (pressão alta / ritmo alto cansa mais). */
  staminaDrainMul: number
  /** @deprecated Sem recover in-match — mantido por compat. */
  staminaRecoverMul: number
  /** Extra no drain quando o jogador está pressionando de fato. */
  pressStaminaMul: number
}

export function getTacticsMultipliers(team: TeamId): TacticsMultipliers {
  const t = getTeamTacticsData(team)
  const depthT = (t.depth - 50) / 50
  const widthT = (t.width - 50) / 50
  const pressT = (t.pressIntensity - 50) / 50
  const tempoT = (t.tempo - 50) / 50

  let mentalityBias = 0
  let mentalityDrain = 0
  let mentalityRecover = 0
  if (t.mentality === 'ultra_def') {
    mentalityBias = -0.18
    mentalityDrain = -0.08
    mentalityRecover = 0.1
  } else if (t.mentality === 'defensive') {
    mentalityBias = -0.1
    mentalityDrain = -0.04
    mentalityRecover = 0.05
  } else if (t.mentality === 'attacking') {
    mentalityBias = 0.1
    mentalityDrain = 0.06
    mentalityRecover = -0.04
  } else if (t.mentality === 'ultra_att') {
    mentalityBias = 0.18
    mentalityDrain = 0.12
    mentalityRecover = -0.08
  }

  let defPress = 1
  let compact = 1
  let cover = 0.55
  let styleDrain = 0
  let styleRecover = 0
  let pressExtra = 1
  if (t.defensiveStyle === 'drop_back') {
    defPress = 0.82
    compact = 1.18
    cover = 0.35
    styleDrain = -0.08
    styleRecover = 0.1
    pressExtra = 0.82
  } else if (t.defensiveStyle === 'press') {
    defPress = 1.12
    compact = 0.92
    cover = 0.72
    styleDrain = 0.08
    styleRecover = -0.05
    pressExtra = 1.18
  } else if (t.defensiveStyle === 'constant_press') {
    defPress = 1.22
    compact = 0.85
    cover = 0.88
    styleDrain = 0.16
    styleRecover = -0.12
    pressExtra = 1.32
  }

  let buildUpPassPrefer = 0
  if (t.buildUp === 'short') buildUpPassPrefer = 0.12
  else if (t.buildUp === 'long') buildUpPassPrefer = -0.1

  let chanceCreationForward = 0
  let chanceDrain = 0
  if (t.chanceCreation === 'possession') {
    chanceCreationForward = -0.08
    chanceDrain = -0.04
  } else if (t.chanceCreation === 'direct') {
    chanceCreationForward = 0.1
    chanceDrain = 0.03
  } else if (t.chanceCreation === 'forward_runs') {
    chanceCreationForward = 0.16
    chanceDrain = 0.07
  }

  // Ritmo alto = menos pausa entre ações; linha alta = mais metros corridos
  const tempoDrain = tempoT * 0.14
  const tempoRecover = -tempoT * 0.1
  const depthDrain = depthT * 0.06
  const pressDrain = pressT * 0.14

  return {
    lineDepthBias: Math.max(-0.22, Math.min(0.22, depthT * 0.14 + mentalityBias)),
    widthScale: Math.max(0.78, Math.min(1.22, 1 + widthT * 0.18)),
    pressWeight: Math.max(0.7, Math.min(1.35, (1 + pressT * 0.22) * defPress)),
    compactWeight: Math.max(0.75, Math.min(1.3, compact)),
    tempoThinkScale: Math.max(0.72, Math.min(1.28, 1 - tempoT * 0.2)),
    buildUpPassPrefer,
    chanceCreationForward,
    coverPresserChance: Math.max(0.2, Math.min(0.95, cover * (0.85 + pressT * 0.2))),
    staminaDrainMul: Math.max(
      0.78,
      Math.min(
        1.38,
        1 + mentalityDrain + styleDrain + chanceDrain + tempoDrain + depthDrain + pressDrain,
      ),
    ),
    staminaRecoverMul: Math.max(
      0.68,
      Math.min(1.22, 1 + mentalityRecover + styleRecover + tempoRecover - pressDrain * 0.35),
    ),
    pressStaminaMul: Math.max(0.75, Math.min(1.4, pressExtra * (1 + pressT * 0.18))),
  }
}

export function getFormationPresetId(team: TeamId): FormationPresetId {
  return getTeamTacticsData(team).formationPresetId
}

/** Atualiza táticas ao vivo (pause / IA) — afeta gameplay imediatamente. */
export function patchLiveTeamTactics(
  team: TeamId,
  patch: Partial<TeamTacticsData>,
): TeamTacticsData {
  const rt = getRuntime(team)
  const next: TeamTacticsData = {
    ...rt.tactics,
    ...patch,
    width: patch.width != null ? clampSlider(patch.width) : rt.tactics.width,
    depth: patch.depth != null ? clampSlider(patch.depth) : rt.tactics.depth,
    pressIntensity:
      patch.pressIntensity != null
        ? clampSlider(patch.pressIntensity)
        : rt.tactics.pressIntensity,
    tempo: patch.tempo != null ? clampSlider(patch.tempo) : rt.tactics.tempo,
  }
  rt.tactics = next

  const session = useMatchSetupStore.getState().session
  if (session) {
    const side = team === 'home' ? session.home : session.away
    if (side.tactics) {
      Object.assign(side.tactics, next)
      side.formationPresetId = next.formationPresetId
    }
  }

  return next
}

/** Aplica preset de formação ao vivo (slots + kickoff/wall). */
export function applyLiveFormationPreset(
  team: TeamId,
  presetId: Exclude<FormationPresetId, 'custom'>,
): void {
  const preset = getFormationPreset(presetId)
  const rt = getRuntime(team)
  rt.slots = preset.slots.map((s, i) => ({ ...s, slotIndex: i }))
  rt.kickoffSlotIndex = preset.kickoffSlotIndex
  rt.wallSlotIndices = preset.wallSlotIndices
  rt.tactics = { ...rt.tactics, formationPresetId: presetId }

  const session = useMatchSetupStore.getState().session
  if (session) {
    const side = team === 'home' ? session.home : session.away
    side.formationSlots = preset.slots.map((s, i) => ({
      teamId: side.id,
      slotIndex: i,
      x: s.x,
      z: s.z,
      positionLabel: s.positionLabel,
      role: s.role,
      lane: s.lane,
    }))
    side.formationPresetId = presetId
    if (side.tactics) {
      side.tactics.formationPresetId = presetId
    }
    for (const r of side.roster) {
      if (r.slotIndex >= 0 && r.slotIndex < preset.slots.length) {
        r.positionLabel = preset.slots[r.slotIndex].positionLabel
      }
    }
  }
}

/** Recarrega formação/táticas/instruções do banco no cache da partida (pause ao vivo). */
export function resyncLiveTeamFromDatabase(side: TeamId, teamId: string): void {
  const session = useMatchSetupStore.getState().session
  const matchKit =
    session && (side === 'home' ? session.home.id === teamId : session.away.id === teamId)
      ? side === 'home'
        ? session.home.matchKit
        : session.away.matchKit
      : 1
  const team = getTeamWithRoster(getDatabase(), teamId, matchKit)
  if (!team) return
  byTeam[side] = buildRuntime(team, side)

  if (session) {
    if (side === 'home' && session.home.id === teamId) {
      session.home.tactics = team.tactics
      session.home.formationSlots = team.formationSlots
      session.home.formationPresetId = team.formationPresetId
      session.home.roster = team.roster
    } else if (side === 'away' && session.away.id === teamId) {
      session.away.tactics = team.tactics
      session.away.formationSlots = team.formationSlots
      session.away.formationPresetId = team.formationPresetId
      session.away.roster = team.roster
    }
  }
}

function clampSlider(v: number): number {
  if (!Number.isFinite(v)) return 50
  return Math.max(0, Math.min(100, Math.round(v)))
}

/** Converte slots DB → FormationSlot simples (compat). */
export function toFormationSlot(s: TeamFormationSlot | RuntimeFormationSlot): FormationSlot {
  return { x: s.x, z: s.z, role: s.role }
}
