import { create } from 'zustand'
import { getGoalkeeperId, HALF_DURATION, MATCH_DURATION } from '../constants'
import { ACTION_BUFFER_WINDOW_MS, CROSS_VOLLEY_BUFFER_MS } from '../systems/shotPower'
import type { PowerBarMode } from '../systems/shotPower'
import type { FieldBounds, GoalZone, MatchPhase, TeamId, Vec3 } from '../types'
import type { GoalFrameCollider } from '../systems/fieldData'
import type { DifficultyId } from '../systems/difficulty'
import { getPressReliefMs } from '../systems/difficulty'
import { clearDribbleState } from '../systems/ballDribble'
import { playerRegistry } from '../systems/entityRegistry'
import { primeCrossReceive } from '../systems/receiveRoutes'
import { getBallSpawnPosition } from '../systems/fieldData'

const claimBlockUntilByPlayer = new Map<string, number>()

export type PitchColliderDebug = {
  halfExtents: [number, number, number]
  position: [number, number, number]
}

export interface StrikeAimState {
  originX: number
  originZ: number
  dirX: number
  dirZ: number
  angle: number
  facingDot: number
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
  /** Time que iniciou o passe — mantém fase de ataque durante o voo da bola */
  passingTeam: TeamId
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
  pitchCollider: PitchColliderDebug | null
  goalFrameColliders: GoalFrameCollider[]
  ballFrozen: boolean
  /** Jogador ativo do time controlado (casa) — troca automática estilo FIFA */
  activePlayerId: string
  /** Evita auto-troca logo após LB manual */
  manualSwitchUntil: number
  /** Bola presa no pé de um jogador, ou solta */
  ballPossession: BallPossession | null
  /** Evita roubo instantâneo ping-pong */
  possessionSince: number
  /** Passe em andamento — receptor corre para o alvo */
  passIntent: PassIntent | null
  passBlockPlayerId: string | null
  passBlockUntil: number
  /** Bloqueia domínio por distância — só física de contato */
  ballClaimFreezeUntil: number
  /** Incrementado a cada saída de bola — reposiciona jogadores na formação */
  kickoffResetVersion: number
  /** Direção da cobrança (lateral, escanteio, tiro de meta) */
  setPieceAimAngle: number
  /** Barreira da falta — mira fixa no início (não gira com o batedor) */
  setPieceWallAimAngle: number
  /** Bloqueia roubo na bandeira logo após o chute */
  setPieceGuardUntil: number
  setPieceGuardPos: Vec3 | null
  /** Escanteio do jogador: aguarda câmera voltar antes de chutar */
  setPieceKickPending: boolean

  /** Escanteio / tiro de meta / falta — animação no cobrador */
  setPieceShootAnim: {
    kickerId: string
    at: number
    clip?: 'player_shoot' | 'player_pass' | 'player_kick'
  } | null

  /** Lateral — animação de arremesso (bola sai no contato) */
  setPieceThrowAnim: { kickerId: string; at: number; power: number } | null

  /** Saída de bola — animação de passe no cobrador */
  kickoffStrikeAnim: { kickerId: string; at: number } | null

  /** Barra de força do chute/passe (0–1) enquanto segura o botão */
  shotChargeActive: boolean
  shotChargePower: number
  powerBarMode: PowerBarMode
  pendingUserShot: {
    power: number
    playerId: string
    queuedAt: number
    dirX: number
    dirZ: number
    /** Pré-agendado antes de dominar (first-time / rebote) */
    buffered?: boolean
    /** Finalização aérea no cruzamento — dispara no contato, não ao dominar */
    crossVolley?: boolean
  } | null
  pendingUserPass: {
    type: 'pass' | 'through' | 'cross'
    power: number
    playerId: string
    queuedAt: number
    dirX?: number
    dirZ?: number
    /** Pré-agendado antes de receber a bola (first-time / antecipação) */
    buffered: boolean
  } | null
  pendingSetPiecePower: number

  /** Receptor segura X durante cruzamento — finalização sem dominar */
  crossOneTouchActive: boolean

  /** Indicador de mira do jogador controlado */
  strikeAim: StrikeAimState | null

  /** Portador imune a roubo em pé (finta, etc.) */
  stealImmunityPlayerId: string | null
  stealImmunityUntil: number
  /** Janela após o jogador ganhar a bola — IA recua e para de pressionar */
  userPressReliefUntil: number

  playerCards: Record<string, { yellow: number; red: boolean }>
  sentOffPlayers: string[]
  refereeSignal: { card: 'yellow' | 'red' | null; at: number; playerId: string } | null

  /** Escala de tempo da simulação (0 = pausa, 1 = normal) */
  timeScale: number
  /** Última escala antes de pausar — restaurada ao despausar */
  resumeTimeScale: number

  setFieldData: (
    bounds: FieldBounds,
    goals: GoalZone[],
    colliders?: { pitch: PitchColliderDebug; frames: GoalFrameCollider[] },
  ) => void
  setTimeScale: (scale: number) => void
  togglePause: () => void
  resetTimeScale: () => void
  setPhase: (phase: MatchPhase) => void
  setMessage: (message: string) => void
  setCountdown: (countdown: number) => void
  setBallFrozen: (frozen: boolean) => void
  setLastTouch: (team: TeamId) => void
  setActivePlayer: (id: string, manual?: boolean) => void
  setPossession: (playerId: string, team: TeamId) => void
  clearPossession: () => void
  setPassIntent: (intent: PassIntent | null) => void
  blockPasserClaim: (playerId: string, ms: number) => void
  freezeDistanceBallClaims: (ms: number) => void
  canDistanceClaimBall: () => boolean
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
  setSetPieceWallAim: (angle: number) => void
  setSetPieceKickPending: (pending: boolean) => void
  setShotCharge: (power: number, active: boolean, mode?: PowerBarMode) => void
  setPendingUserShot: (
    power: number,
    dirX?: number,
    dirZ?: number,
    buffered?: boolean,
  ) => void
  setPendingBufferedShot: (
    playerId: string,
    power: number,
    dirX: number,
    dirZ: number,
    crossVolley?: boolean,
  ) => void
  consumePendingUserShot: (
    playerId: string,
  ) => { power: number; dirX: number; dirZ: number } | null
  setPendingUserPass: (
    type: 'pass' | 'through' | 'cross',
    power: number,
    buffered?: boolean,
    dirX?: number,
    dirZ?: number,
  ) => void
  consumePendingUserPass: (playerId: string) => {
    type: 'pass' | 'through' | 'cross'
    power: number
    dirX?: number
    dirZ?: number
  } | null
  setPendingSetPiecePower: (power: number) => void
  takePendingSetPiecePower: () => number
  setCrossOneTouchActive: (active: boolean) => void
  setStealImmunity: (playerId: string, ms: number) => void
  isStealImmune: (playerId: string) => boolean
  setStrikeAim: (aim: StrikeAimState | null) => void
  userTeam: TeamId
  setUserTeam: (team: TeamId) => void
  difficulty: DifficultyId
  setDifficulty: (difficulty: DifficultyId) => void
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
  message: 'Saída de bola — passe (Espaço / E)',
  countdown: 0,
  fieldBounds: null,
  goalZones: [],
  pitchCollider: null,
  goalFrameColliders: [],
  ballFrozen: true,
  activePlayerId: 'home-9',
  manualSwitchUntil: 0,
  ballPossession: null,
  possessionSince: 0,
  passIntent: null,
  passBlockPlayerId: null,
  passBlockUntil: 0,
  ballClaimFreezeUntil: 0,
  kickoffResetVersion: 0,
  setPieceAimAngle: 0,
  setPieceWallAimAngle: 0,
  setPieceGuardUntil: 0,
  setPieceGuardPos: null,
  setPieceKickPending: false,
  setPieceShootAnim: null,
  setPieceThrowAnim: null,
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
  userPressReliefUntil: 0,
  playerCards: {},
  sentOffPlayers: [],
  refereeSignal: null,
  timeScale: 1,
  resumeTimeScale: 1,
  userTeam: 'home',
  difficulty: 'medium',

  setUserTeam: (team) => {
    set({ userTeam: team, activePlayerId: `${team}-9` })
  },

  setDifficulty: (difficulty) => set({ difficulty }),

  setFieldData: (bounds, goals, colliders) =>
    set({
      fieldBounds: bounds,
      goalZones: goals,
      pitchCollider: colliders?.pitch ?? null,
      goalFrameColliders: colliders?.frames ?? [],
    }),

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

  setActivePlayer: (id, manual = false) => {
    if (id === getGoalkeeperId(get().userTeam)) return
    if (get().sentOffPlayers.includes(id)) return
    if (id === get().activePlayerId) return
    const poss = get().ballPossession
    if (manual && poss?.team === get().userTeam && poss.playerId !== id) return
    set({
      activePlayerId: id,
      ...(manual ? { manualSwitchUntil: performance.now() + 1100 } : {}),
    })
  },

  setPossession: (playerId, team) => {
    const state = get()
    const current = state.ballPossession
    if (current?.playerId === playerId && current.team === team) return

    const userTeam = state.userTeam
    const stolenFromOpp =
      current != null && current.team !== team && team === userTeam
    const userGained =
      team === userTeam && playerId !== getGoalkeeperId(userTeam)
    const switchActive =
      team === userTeam && playerId !== getGoalkeeperId(userTeam)
    const nextActive =
      switchActive && playerId !== state.activePlayerId
        ? playerId
        : state.activePlayerId

    const now = performance.now()
    const immunityMs = stolenFromOpp ? 2400 : userGained ? 1200 : 0
    const immunityUntil = now + immunityMs
    const prevImmunity =
      state.stealImmunityPlayerId === playerId ? state.stealImmunityUntil : 0

    set({
      ballPossession: { playerId, team },
      possessionSince: now,
      lastTouchTeam: team,
      activePlayerId: nextActive,
      passIntent: null,
      ...(userGained
        ? {
            userPressReliefUntil: now + getPressReliefMs(stolenFromOpp),
            stealImmunityPlayerId: playerId,
            stealImmunityUntil: Math.max(immunityUntil, prevImmunity),
          }
        : {}),
      ...(team !== userTeam
        ? { pendingUserPass: null, pendingUserShot: null }
        : {}),
    })
  },

  clearPossession: () => {
    if (get().ballPossession === null) return
    clearDribbleState()
    set({ ballPossession: null })
  },

  setPassIntent: (intent) => {
    if (!intent) {
      set({
        passIntent: null,
        crossOneTouchActive: false,
        shotChargeActive: false,
        shotChargePower: 0,
        powerBarMode: null,
        strikeAim: null,
      })
      return
    }

    const receiverId = intent.receiverId

    const pending = get().pendingUserPass
    const keepBufferedPass =
      pending?.buffered &&
      pending.playerId === receiverId

    const pendingShot = get().pendingUserShot
    const keepBufferedCrossShot =
      pendingShot?.buffered &&
      (pendingShot.crossVolley || intent.passType === 'cross')

    set({
      passIntent: intent,
      pendingUserShot: keepBufferedCrossShot ? pendingShot : null,
      pendingUserPass: keepBufferedPass ? pending : null,
      shotChargeActive: false,
      shotChargePower: 0,
      powerBarMode: null,
      crossOneTouchActive: false,
    })

    if (intent.passType === 'cross') {
      primeCrossReceive(intent)
    }
  },

  blockPasserClaim: (playerId, ms) => {
    const until = performance.now() + ms
    claimBlockUntilByPlayer.set(
      playerId,
      Math.max(claimBlockUntilByPlayer.get(playerId) ?? 0, until),
    )
    set({
      passBlockPlayerId: playerId,
      passBlockUntil: until,
    })
  },

  freezeDistanceBallClaims: (ms) =>
    set({
      ballClaimFreezeUntil: performance.now() + ms,
    }),

  canDistanceClaimBall: () => performance.now() >= get().ballClaimFreezeUntil,

  canPlayerClaimBall: (playerId) => {
    const { sentOffPlayers } = get()
    if (sentOffPlayers.includes(playerId)) return false
    const blockedUntil = claimBlockUntilByPlayer.get(playerId)
    if (blockedUntil != null && performance.now() < blockedUntil) return false
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
      ballFrozen: false,
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
  setPieceThrowAnim: null,
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
      message: 'Saída de bola — passe (Espaço / E)',
    })
  },

  resetForKickoff: () => {
    const { kickoffTeam, fieldBounds } = get()
    set({
      phase: 'kickoff',
      setPieceTeam: kickoffTeam,
      setPiecePosition: fieldBounds ? getBallSpawnPosition(fieldBounds) : { x: 0, y: 0.11, z: 0 },
      ballFrozen: true,
      lastTouchTeam: null,
      ballPossession: null,
    })
  },

  rotateSetPieceAim: (delta) => {
    set({ setPieceAimAngle: get().setPieceAimAngle + delta })
  },

  setSetPieceAim: (angle) => set({ setPieceAimAngle: angle }),

  setSetPieceWallAim: (angle) => set({ setPieceWallAimAngle: angle }),

  setSetPieceKickPending: (pending) => set({ setPieceKickPending: pending }),

  setShotCharge: (power, active, mode = null) => {
    const rounded = Math.round(power * 40) / 40
    const state = get()
    const nextMode = active ? mode : null
    if (
      state.shotChargeActive === active &&
      state.shotChargePower === rounded &&
      state.powerBarMode === nextMode
    ) {
      return
    }
    set({
      shotChargePower: rounded,
      shotChargeActive: active,
      powerBarMode: nextMode,
    })
  },

  setPendingBufferedShot: (playerId, power, dirX, dirZ, crossVolley = false) => {
    set({
      pendingUserShot: {
        power,
        playerId,
        queuedAt: performance.now(),
        dirX,
        dirZ,
        buffered: true,
        crossVolley,
      },
      pendingUserPass: null,
    })
  },

  setPendingUserShot: (power, dirX, dirZ, buffered = false) => {
    const state = get()
    const aim = state.strikeAim
    let playerId = state.activePlayerId

    if (buffered && state.passIntent) {
      if (state.passIntent.passType === 'cross') {
        playerId = state.activePlayerId
      } else {
        const receiver = playerRegistry.get(state.passIntent.receiverId)
        if (receiver && receiver.team === getUserTeam()) {
          playerId = state.passIntent.receiverId
          if (playerId !== state.activePlayerId) {
            get().setActivePlayer(playerId)
          }
        }
      }
      get().setPendingBufferedShot(
        playerId,
        power,
        dirX ?? aim?.dirX ?? 0,
        dirZ ?? aim?.dirZ ?? 1,
      )
      return
    }

    set({
      pendingUserShot: {
        power,
        playerId,
        queuedAt: performance.now(),
        dirX: dirX ?? aim?.dirX ?? 0,
        dirZ: dirZ ?? aim?.dirZ ?? 1,
        buffered,
      },
      pendingUserPass: null,
    })
  },

  consumePendingUserShot: (playerId) => {
    const state = get()
    const pending = state.pendingUserShot
    if (!pending || pending.playerId !== playerId) return null
    if (pending.crossVolley) return null
    const poss = state.ballPossession
    if (!poss || poss.playerId !== playerId) return null
    if (pending.buffered) {
      const pi = state.passIntent
      const bufferMs =
        pi?.passType === 'cross' ? CROSS_VOLLEY_BUFFER_MS : ACTION_BUFFER_WINDOW_MS * 3
      if (performance.now() - pending.queuedAt > bufferMs) {
        return null
      }
    } else if (pending.queuedAt + 1 < state.possessionSince) {
      return null
    }
    set({ pendingUserShot: null })
    return {
      power: pending.power,
      dirX: pending.dirX,
      dirZ: pending.dirZ,
    }
  },

  setPendingUserPass: (type, power, buffered = false, dirX, dirZ) => {
    const state = get()
    const aim = state.strikeAim
    let playerId = state.activePlayerId

    if (buffered && state.passIntent) {
      if (state.passIntent.passType === 'cross') {
        playerId = state.activePlayerId
      } else {
        const receiver = playerRegistry.get(state.passIntent.receiverId)
        if (receiver && receiver.team === getUserTeam()) {
          playerId = state.passIntent.receiverId
          if (playerId !== state.activePlayerId) {
            get().setActivePlayer(playerId)
          }
        }
      }
    }

    const nextDirX = dirX ?? aim?.dirX
    const nextDirZ = dirZ ?? aim?.dirZ
    const prev = state.pendingUserPass
    if (
      prev &&
      prev.playerId === playerId &&
      prev.type === type &&
      prev.power === power &&
      prev.buffered === buffered &&
      prev.dirX === nextDirX &&
      prev.dirZ === nextDirZ
    ) {
      return
    }
    set({
      pendingUserPass: {
        type,
        power,
        playerId,
        queuedAt: performance.now(),
        buffered,
        dirX: nextDirX,
        dirZ: nextDirZ,
      },
      pendingUserShot: null,
    })
  },

  consumePendingUserPass: (playerId) => {
    const state = get()
    const pending = state.pendingUserPass
    if (!pending || pending.playerId !== playerId) return null
    const poss = state.ballPossession
    if (!poss || poss.playerId !== playerId) return null
    if (pending.buffered) {
      const pi = state.passIntent
      const bufferMs =
        pi?.passType === 'cross' ? CROSS_VOLLEY_BUFFER_MS : ACTION_BUFFER_WINDOW_MS * 3
      if (performance.now() - pending.queuedAt > bufferMs) {
        return null
      }
    } else if (pending.queuedAt < state.possessionSince) {
      return null
    }
    set({ pendingUserPass: null })
    return {
      type: pending.type,
      power: pending.power,
      dirX: pending.dirX,
      dirZ: pending.dirZ,
    }
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
    const until = performance.now() + ms
    const state = get()
    if (
      state.stealImmunityPlayerId === playerId &&
      state.stealImmunityUntil >= until
    ) {
      return
    }
    set({
      stealImmunityPlayerId: playerId,
      stealImmunityUntil: until,
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
    if (prev === aim) return
    if (
      prev &&
      aim &&
      prev.dirX === aim.dirX &&
      prev.dirZ === aim.dirZ &&
      prev.facingDot === aim.facingDot &&
      prev.mode === aim.mode &&
      prev.power === aim.power &&
      prev.charging === aim.charging
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
