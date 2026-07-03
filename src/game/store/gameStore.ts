import { create } from 'zustand'
import { getGoalkeeperId, HALF_DURATION, MATCH_DURATION } from '../constants'
import type { PowerBarMode } from '../systems/shotPower'
import type { FieldBounds, GoalZone, MatchPhase, TeamId, Vec3 } from '../types'

export interface StrikeAimState {
  originX: number
  originZ: number
  dirX: number
  dirZ: number
  angle: number
  mode: PowerBarMode | null
  power: number
  charging: boolean
}

export interface BallPossession {
  playerId: string
  team: TeamId
}

export interface PassIntent {
  receiverId: string
  targetX: number
  targetZ: number
  startedAt: number
  /** Outros jogadores que também devem atacar a bola (lateral/escanteio) */
  runnerIds?: string[]
  /** Impedimento detectado no passe — bandeira só quando o receptor toca */
  offsideFlag?: OffsidePassFlag
  /** Posição Z da bola no instante do passe */
  ballZAtPass?: number
  /** Passe rasteiro vs cruzamento alto vs profundidade */
  passType?: 'pass' | 'cross' | 'through'
}

export interface OffsidePassFlag {
  attackingTeam: TeamId
  receiverId: string
  receiverZAtPass: number
  ballZAtPass: number
  lineZAtPass: number
}

interface GameStore {
  phase: MatchPhase
  half: 1 | 2
  matchTime: number
  scoreHome: number
  scoreAway: number
  kickoffTeam: TeamId
  lastTouchTeam: TeamId | null
  setPieceTeam: TeamId | null
  setPiecePosition: Vec3 | null
  setPieceKickerId: string | null
  message: string
  countdown: number
  fieldBounds: FieldBounds | null
  goalZones: GoalZone[]
  ballFrozen: boolean
  /** Jogador ativo do time controlado (casa) — troca automática estilo FIFA */
  activePlayerId: string
  /** Bola presa no pé de um jogador, ou solta */
  ballPossession: BallPossession | null
  /** Evita roubo instantâneo ping-pong */
  possessionSince: number
  /** Passe em andamento — receptor corre para o alvo */
  passIntent: PassIntent | null
  passBlockPlayerId: string | null
  passBlockUntil: number
  /** Incrementado a cada saída de bola — reposiciona jogadores na formação */
  kickoffResetVersion: number
  /** Direção da cobrança (lateral, escanteio, tiro de meta) */
  setPieceAimAngle: number
  /** Bloqueia roubo na bandeira logo após o chute */
  setPieceGuardUntil: number
  setPieceGuardPos: Vec3 | null
  /** Escanteio do jogador: aguarda câmera voltar antes de chutar */
  setPieceKickPending: boolean

  /** Escanteio / tiro de meta — dispara animação shoot no cobrador */
  setPieceShootAnim: { kickerId: string; at: number } | null

  /** Saída de bola — animação de passe no cobrador */
  kickoffStrikeAnim: { kickerId: string; at: number } | null

  /** Barra de força do chute/passe (0–1) enquanto segura o botão */
  shotChargeActive: boolean
  shotChargePower: number
  powerBarMode: PowerBarMode
  pendingUserShot: { power: number; playerId: string; queuedAt: number } | null
  pendingUserPass: {
    type: 'pass' | 'through' | 'cross'
    power: number
    playerId: string
    queuedAt: number
  } | null
  pendingSetPiecePower: number

  /** Receptor segura X durante cruzamento — finalização sem dominar */
  crossOneTouchActive: boolean

  /** Indicador de mira do jogador controlado */
  strikeAim: StrikeAimState | null

  /** Portador imune a roubo em pé (finta, etc.) */
  stealImmunityPlayerId: string | null
  stealImmunityUntil: number

  playerCards: Record<string, { yellow: number; red: boolean }>
  sentOffPlayers: string[]
  refereeSignal: { card: 'yellow' | 'red' | null; at: number; playerId: string } | null

  /** Escala de tempo da simulação (0 = pausa, 1 = normal) */
  timeScale: number
  /** Última escala antes de pausar — restaurada ao despausar */
  resumeTimeScale: number

  setFieldData: (bounds: FieldBounds, goals: GoalZone[]) => void
  setTimeScale: (scale: number) => void
  togglePause: () => void
  resetTimeScale: () => void
  setPhase: (phase: MatchPhase) => void
  setMessage: (message: string) => void
  setCountdown: (countdown: number) => void
  setBallFrozen: (frozen: boolean) => void
  setLastTouch: (team: TeamId) => void
  setActivePlayer: (id: string) => void
  setPossession: (playerId: string, team: TeamId) => void
  clearPossession: () => void
  setPassIntent: (intent: PassIntent | null) => void
  blockPasserClaim: (playerId: string, ms: number) => void
  canPlayerClaimBall: (playerId: string) => boolean
  tickMatchTime: (delta: number) => void
  scoreGoal: (scoringTeam: TeamId) => void
  startSetPiece: (
    phase: MatchPhase,
    team: TeamId,
    position: Vec3,
    message: string,
  ) => void
  prepareKickoff: (team: TeamId) => void
  resetForKickoff: () => void
  rotateSetPieceAim: (delta: number) => void
  setSetPieceAim: (angle: number) => void
  setSetPieceKickPending: (pending: boolean) => void
  setShotCharge: (power: number, active: boolean, mode?: PowerBarMode) => void
  setPendingUserShot: (power: number) => void
  consumePendingUserShot: (playerId: string) => number | null
  setPendingUserPass: (type: 'pass' | 'through' | 'cross', power: number) => void
  consumePendingUserPass: (playerId: string) => {
    type: 'pass' | 'through' | 'cross'
    power: number
  } | null
  setPendingSetPiecePower: (power: number) => void
  takePendingSetPiecePower: () => number
  setCrossOneTouchActive: (active: boolean) => void
  setStealImmunity: (playerId: string, ms: number) => void
  isStealImmune: (playerId: string) => boolean
  setStrikeAim: (aim: StrikeAimState | null) => void
  userTeam: TeamId
  setUserTeam: (team: TeamId) => void
}

export function getUserTeam(): TeamId {
  return useGameStore.getState().userTeam
}

/** @deprecated Use getUserTeam() */
export const USER_TEAM: TeamId = 'home'

export const useGameStore = create<GameStore>((set, get) => ({
  phase: 'kickoff',
  half: 1,
  matchTime: 0,
  scoreHome: 0,
  scoreAway: 0,
  kickoffTeam: 'home',
  lastTouchTeam: null,
  setPieceTeam: null,
  setPiecePosition: null,
  setPieceKickerId: null,
  message: 'Saída de bola — pressione Espaço para iniciar',
  countdown: 0,
  fieldBounds: null,
  goalZones: [],
  ballFrozen: true,
  activePlayerId: 'home-9',
  ballPossession: null,
  possessionSince: 0,
  passIntent: null,
  passBlockPlayerId: null,
  passBlockUntil: 0,
  kickoffResetVersion: 0,
  setPieceAimAngle: 0,
  setPieceGuardUntil: 0,
  setPieceGuardPos: null,
  setPieceKickPending: false,
  setPieceShootAnim: null,
  kickoffStrikeAnim: null,
  shotChargeActive: false,
  shotChargePower: 0,
  powerBarMode: null,
  pendingUserShot: null,
  pendingUserPass: null,
  pendingSetPiecePower: 1,
  crossOneTouchActive: false,
  strikeAim: null,
  stealImmunityPlayerId: null,
  stealImmunityUntil: 0,
  playerCards: {},
  sentOffPlayers: [],
  refereeSignal: null,
  timeScale: 1,
  resumeTimeScale: 1,
  userTeam: 'home',

  setUserTeam: (team) => {
    set({ userTeam: team, activePlayerId: `${team}-9` })
  },

  setFieldData: (bounds, goals) => set({ fieldBounds: bounds, goalZones: goals }),

  setTimeScale: (scale) => {
    const clamped = Math.max(0, Math.min(3, scale))
    if (clamped > 0) {
      set({ timeScale: clamped, resumeTimeScale: clamped })
    } else {
      const prev = get().timeScale
      set({
        timeScale: 0,
        resumeTimeScale: prev > 0 ? prev : get().resumeTimeScale,
      })
    }
  },

  togglePause: () => {
    const { timeScale, resumeTimeScale } = get()
    if (timeScale === 0) {
      set({ timeScale: resumeTimeScale > 0 ? resumeTimeScale : 1 })
    } else {
      set({ timeScale: 0, resumeTimeScale: timeScale })
    }
  },

  resetTimeScale: () => set({ timeScale: 1, resumeTimeScale: 1 }),

  setPhase: (phase) => set({ phase }),

  setMessage: (message) => set({ message }),

  setCountdown: (countdown) => set({ countdown }),

  setBallFrozen: (frozen) => set({ ballFrozen: frozen }),

  setLastTouch: (team) => set({ lastTouchTeam: team }),

  setActivePlayer: (id) => {
    if (id === getGoalkeeperId(get().userTeam)) return
    if (get().sentOffPlayers.includes(id)) return
    set({ activePlayerId: id })
  },

  setPossession: (playerId, team) => {
    const userTeam = get().userTeam
    const switchActive =
      team === userTeam && playerId !== getGoalkeeperId(userTeam)
    set({
      ballPossession: { playerId, team },
      possessionSince: performance.now(),
      lastTouchTeam: team,
      activePlayerId: switchActive ? playerId : get().activePlayerId,
      passIntent: null,
    })
  },

  clearPossession: () => set({ ballPossession: null }),

  setPassIntent: (intent) => {
    if (!intent) {
      set({ passIntent: null })
      return
    }

    const receiverId = intent.receiverId
    const userTeam = get().userTeam
    const selectReceiver =
      receiverId.startsWith(`${userTeam}-`) &&
      receiverId !== getGoalkeeperId(userTeam) &&
      !get().sentOffPlayers.includes(receiverId)

    set({
      passIntent: intent,
      pendingUserShot: null,
      pendingUserPass: null,
      shotChargeActive: false,
      shotChargePower: 0,
      powerBarMode: null,
      ...(selectReceiver ? { activePlayerId: receiverId } : {}),
    })
  },

  blockPasserClaim: (playerId, ms) =>
    set({
      passBlockPlayerId: playerId,
      passBlockUntil: performance.now() + ms,
    }),

  canPlayerClaimBall: (playerId) => {
    const { passBlockPlayerId, passBlockUntil, sentOffPlayers } = get()
    if (sentOffPlayers.includes(playerId)) return false
    if (passBlockPlayerId === playerId && performance.now() < passBlockUntil) {
      return false
    }
    return true
  },

  tickMatchTime: (delta) => {
    const { phase, matchTime, half } = get()
    if (phase !== 'playing') return

    const newTime = matchTime + delta
    if (half === 1 && newTime >= HALF_DURATION) {
      set({
        matchTime: HALF_DURATION,
        phase: 'half-time-exit',
        ballFrozen: true,
        ballPossession: null,
        passIntent: null,
        message: 'Intervalo — times saindo do campo',
      })
      return
    }
    if (half === 2 && newTime >= MATCH_DURATION) {
      set({
        matchTime: MATCH_DURATION,
        phase: 'full-time-exit',
        ballFrozen: true,
        ballPossession: null,
        passIntent: null,
        message: 'Fim de jogo — times saindo do campo',
      })
      return
    }
    set({ matchTime: newTime })
  },

  scoreGoal: (scoringTeam) => {
    const state = get()
    set({
      scoreHome: scoringTeam === 'home' ? state.scoreHome + 1 : state.scoreHome,
      scoreAway: scoringTeam === 'away' ? state.scoreAway + 1 : state.scoreAway,
      phase: 'goal',
      ballFrozen: true,
      ballPossession: null,
      message: `GOL do ${scoringTeam === 'home' ? 'Time Casa' : 'Time Visitante'}!`,
      kickoffTeam: scoringTeam === 'home' ? 'away' : 'home',
    })
  },

  startSetPiece: (phase, team, position, message) => {
    set({
      phase,
      setPieceTeam: team,
      setPiecePosition: position,
      setPieceKickerId: null,
      ballFrozen: true,
      ballPossession: null,
      message,
      countdown: 0,
      setPieceKickPending: false,
      setPieceShootAnim: null,
      kickoffStrikeAnim: null,
    })
  },

  prepareKickoff: (team) => {
    set({
      kickoffTeam: team,
      phase: 'kickoff',
      setPieceTeam: team,
      setPiecePosition: null,
      ballFrozen: true,
      ballPossession: null,
      message: 'Saída de bola — pressione Espaço para iniciar',
    })
  },

  resetForKickoff: () => {
    const { kickoffTeam, fieldBounds } = get()
    set({
      phase: 'kickoff',
      setPieceTeam: kickoffTeam,
      setPiecePosition: fieldBounds?.center ?? { x: 0, y: 0.11, z: 0 },
      ballFrozen: true,
      lastTouchTeam: null,
      ballPossession: null,
    })
  },

  rotateSetPieceAim: (delta) => {
    set({ setPieceAimAngle: get().setPieceAimAngle + delta })
  },

  setSetPieceAim: (angle) => set({ setPieceAimAngle: angle }),

  setSetPieceKickPending: (pending) => set({ setPieceKickPending: pending }),

  setShotCharge: (power, active, mode = null) =>
    set({
      shotChargePower: power,
      shotChargeActive: active,
      powerBarMode: active ? mode : null,
    }),

  setPendingUserShot: (power) =>
    set({
      pendingUserShot: {
        power,
        playerId: get().activePlayerId,
        queuedAt: performance.now(),
      },
      pendingUserPass: null,
    }),

  consumePendingUserShot: (playerId) => {
    const state = get()
    const pending = state.pendingUserShot
    if (!pending || pending.playerId !== playerId) return null
    const poss = state.ballPossession
    if (!poss || poss.playerId !== playerId) return null
    if (pending.queuedAt < state.possessionSince) return null
    set({ pendingUserShot: null })
    return pending.power
  },

  setPendingUserPass: (type, power) =>
    set({
      pendingUserPass: {
        type,
        power,
        playerId: get().activePlayerId,
        queuedAt: performance.now(),
      },
      pendingUserShot: null,
    }),

  consumePendingUserPass: (playerId) => {
    const state = get()
    const pending = state.pendingUserPass
    if (!pending || pending.playerId !== playerId) return null
    const poss = state.ballPossession
    if (!poss || poss.playerId !== playerId) return null
    if (pending.queuedAt < state.possessionSince) return null
    set({ pendingUserPass: null })
    return { type: pending.type, power: pending.power }
  },

  setPendingSetPiecePower: (power) => set({ pendingSetPiecePower: power }),

  takePendingSetPiecePower: () => {
    const power = get().pendingSetPiecePower
    set({ pendingSetPiecePower: 1 })
    return power
  },

  setCrossOneTouchActive: (active) => {
    if (get().crossOneTouchActive !== active) {
      set({ crossOneTouchActive: active })
    }
  },

  setStealImmunity: (playerId, ms) => {
    set({
      stealImmunityPlayerId: playerId,
      stealImmunityUntil: performance.now() + ms,
    })
  },

  isStealImmune: (playerId) => {
    const state = get()
    return (
      state.stealImmunityPlayerId === playerId &&
      performance.now() < state.stealImmunityUntil
    )
  },

  setStrikeAim: (aim) => {
    const prev = get().strikeAim
    if (
      prev === aim ||
      (prev &&
        aim &&
        prev.originX === aim.originX &&
        prev.originZ === aim.originZ &&
        prev.dirX === aim.dirX &&
        prev.dirZ === aim.dirZ &&
        prev.mode === aim.mode &&
        prev.power === aim.power &&
        prev.charging === aim.charging)
    ) {
      return
    }
    set({ strikeAim: aim })
  },
}))

export function formatMatchTime(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
}

export function getOpponent(team: TeamId): TeamId {
  return team === 'home' ? 'away' : 'home'
}
