import type { TeamId } from '../types'
import type { TeamTacticsData } from '../data/formations'
import { getUserTeam, useGameStore } from '../store/gameStore'
import { getTeamTacticsData, patchLiveTeamTactics } from './teamTactics'

/**
 * IA adapta táticas conforme placar / momento da partida.
 * Só muda quando a situação muda de “faixa” ou após cooldown longo — não a todo frame.
 */

type ScoreBand = 'draw' | 'lead1' | 'lead2' | 'trail1' | 'trail2' | 'late_draw'

type AdaptState = {
  lastBand: ScoreBand | null
  lastChangeMatchTime: number
  baseline: TeamTacticsData | null
}

const state: AdaptState = {
  lastBand: null,
  lastChangeMatchTime: -9999,
  baseline: null,
}

/** Intervalo mínimo entre mudanças (segundos de tempo de jogo) */
const MIN_CHANGE_INTERVAL = 4 * 60
/** No fim do jogo, pode reagir um pouco mais cedo */
const LATE_CHANGE_INTERVAL = 2.5 * 60
const LATE_MATCH_SEC = 70 * 60

const BAND_TACTICS: Record<ScoreBand, Partial<TeamTacticsData>> = {
  draw: {
    mentality: 'balanced',
    buildUp: 'mixed',
    chanceCreation: 'balanced',
    defensiveStyle: 'balanced',
    width: 50,
    depth: 50,
    pressIntensity: 50,
    tempo: 50,
  },
  lead1: {
    mentality: 'defensive',
    buildUp: 'short',
    chanceCreation: 'possession',
    defensiveStyle: 'drop_back',
    width: 46,
    depth: 40,
    pressIntensity: 38,
    tempo: 42,
  },
  lead2: {
    mentality: 'ultra_def',
    buildUp: 'short',
    chanceCreation: 'possession',
    defensiveStyle: 'drop_back',
    width: 42,
    depth: 32,
    pressIntensity: 30,
    tempo: 36,
  },
  trail1: {
    mentality: 'attacking',
    buildUp: 'mixed',
    chanceCreation: 'direct',
    defensiveStyle: 'press',
    width: 58,
    depth: 62,
    pressIntensity: 68,
    tempo: 64,
  },
  trail2: {
    mentality: 'ultra_att',
    buildUp: 'long',
    chanceCreation: 'forward_runs',
    defensiveStyle: 'constant_press',
    width: 64,
    depth: 74,
    pressIntensity: 84,
    tempo: 74,
  },
  late_draw: {
    mentality: 'attacking',
    buildUp: 'mixed',
    chanceCreation: 'forward_runs',
    defensiveStyle: 'press',
    width: 56,
    depth: 60,
    pressIntensity: 64,
    tempo: 66,
  },
}

export function resetAiTacticsAdapt(): void {
  state.lastBand = null
  state.lastChangeMatchTime = -9999
  state.baseline = null
}

function getAiTeam(): TeamId {
  return getUserTeam() === 'home' ? 'away' : 'home'
}

function resolveBand(
  aiTeam: TeamId,
  scoreHome: number,
  scoreAway: number,
  matchTime: number,
): ScoreBand {
  const ai = aiTeam === 'home' ? scoreHome : scoreAway
  const opp = aiTeam === 'home' ? scoreAway : scoreHome
  const diff = ai - opp

  if (diff >= 2) return 'lead2'
  if (diff === 1) return 'lead1'
  if (diff <= -2) return 'trail2'
  if (diff === -1) return 'trail1'
  if (matchTime >= LATE_MATCH_SEC) return 'late_draw'
  return 'draw'
}

function bandSeverity(band: ScoreBand): number {
  switch (band) {
    case 'trail2':
      return 3
    case 'trail1':
      return 2
    case 'late_draw':
      return 1
    case 'draw':
      return 0
    case 'lead1':
      return -1
    case 'lead2':
      return -2
  }
}

/**
 * Chamado no MatchManager (tempo de jogo / após gol).
 * Retorna true se aplicou mudança.
 */
export function tickAiTacticsAdapt(force = false): boolean {
  const store = useGameStore.getState()
  if (store.phase !== 'playing' && store.phase !== 'goal' && store.phase !== 'kickoff') {
    return false
  }

  const aiTeam = getAiTeam()
  if (!state.baseline) {
    state.baseline = { ...getTeamTacticsData(aiTeam) }
  }

  const band = resolveBand(aiTeam, store.scoreHome, store.scoreAway, store.matchTime)
  if (!force && band === state.lastBand) return false

  const interval =
    store.matchTime >= LATE_MATCH_SEC ? LATE_CHANGE_INTERVAL : MIN_CHANGE_INTERVAL
  const elapsed = store.matchTime - state.lastChangeMatchTime

  // Permite troca antecipada se a situação piorou claramente (ex.: empatou → perdeu)
  const worsened =
    state.lastBand != null &&
    bandSeverity(band) > bandSeverity(state.lastBand) + 0.5

  if (!force && state.lastBand != null && elapsed < interval && !worsened) {
    return false
  }

  const patch = BAND_TACTICS[band]
  patchLiveTeamTactics(aiTeam, patch)
  store.bumpTacticsRevision()

  state.lastBand = band
  state.lastChangeMatchTime = store.matchTime
  return true
}
