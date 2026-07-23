import * as THREE from 'three'
import type { PlayerAnim, TeamId, Vec3 } from '../types'
import { ballRef, ballBodyRef, playerRegistry } from './entityRegistry'
import { refereeState } from './referee'
import { getAttackingGoalZ, getAttackSign } from './teamField'
import { isBallInGoal } from './rules'
import { useGameStore, formatMatchTime } from '../store/gameStore'
import { getGoalkeeperId, PLAYER_HEIGHT } from '../constants'
import { runFadeIn, runFadeOut } from './screenTransition'
import { getEditionPlayerId } from '../matchRuntime'
import { getPlayerDisplayName, parsePlayerIndex } from '../data/playerRoster'
import {
  CELEBRATION_DURATION_SEC,
  getCelebrationCameraState as sampleCelebrationCam,
} from './celebrationCamera'

export type ReplayEventType = 'goal' | 'shot' | 'foul' | 'save' | 'offside'

export interface ReplayPlayerSnap {
  id: string
  x: number
  y: number
  z: number
  rotation: number
  anim: PlayerAnim
  animTime: number
}

export interface ReplayBallQuat {
  x: number
  y: number
  z: number
  w: number
}

export interface ReplayFrame {
  ball: Vec3
  ballVel: Vec3
  ballQuat: ReplayBallQuat
  ballAngVel: Vec3
  players: ReplayPlayerSnap[]
  refereeX: number
  refereeZ: number
}

type SeqState = 'idle' | 'celebrating' | 'transitioning' | 'replaying'

const BUFFER_SECONDS = 8.4
const RECORD_HZ = 30
const RECORD_INTERVAL = 1 / RECORD_HZ
const MAX_FRAMES = Math.ceil(BUFFER_SECONDS * RECORD_HZ) + 4

const FADE_OUT_MS = 480
const FADE_IN_MS = 620

/** Velocidade do replay (< 1 = câmera lenta) */
const REPLAY_SLOW_MO = 0.42

/** Comemoração no gramado antes do replay (estilo PES 6) */
const GOAL_CELEBRATION_SEC = CELEBRATION_DURATION_SEC

const PLAYBACK_SPEED: Record<ReplayEventType, number> = {
  goal: REPLAY_SLOW_MO,
  shot: REPLAY_SLOW_MO,
  save: REPLAY_SLOW_MO,
  foul: REPLAY_SLOW_MO,
  offside: REPLAY_SLOW_MO,
}

const LOOKBACK: Record<ReplayEventType, number> = {
  goal: 7.2,
  shot: 5.4,
  save: 5.8,
  foul: 6.2,
  offside: 5.4,
}

/** Grava mais um pouco após o apito antes de congelar o clip — mostra o carrinho/queda completa */
const FOUL_REPLAY_TAIL_SEC = 1.45
const OFFSIDE_REPLAY_TAIL_SEC = 1.1

const EVENT_LABEL: Record<ReplayEventType, string> = {
  goal: 'MARCOU GOL',
  shot: 'CHUTOU A GOL',
  save: 'DEFENDEU O CHUTE',
  foul: 'COMETEU FALTA',
  offside: 'IMPEDIMENTO',
}

const MIN_REPLAY_GAP_MS = 6500

interface PendingShot {
  team: TeamId
  at: number
  goalZ: number
  interesting: boolean
  resolved: boolean
  shooterId: string | null
}

interface ReplayMeta {
  team?: TeamId
  goalZ?: number
  foulSpot?: Vec3
  offsideLineZ?: number
  focusPlayerId?: string | null
  force?: boolean
}

interface PendingEventReplay {
  type: 'foul' | 'offside'
  meta: ReplayMeta
  onComplete: () => void
  armedAt: number
}

class ReplaySystem {
  private ring: ReplayFrame[] = []
  private recordAcc = 0

  private seqState: SeqState = 'idle'
  private playbackActive = false
  private eventType: ReplayEventType = 'goal'
  private playbackFrames: ReplayFrame[] = []
  private playbackTime = 0
  private playbackDuration = 0
  private playbackSpeed = REPLAY_SLOW_MO
  private onComplete: (() => void) | null = null

  private focusGoalZ = 0
  private focusTeam: TeamId = 'home'
  private focusPlayerId: string | null = null
  private foulSpot: Vec3 | null = null
  private offsideLineZ: number | null = null
  private celebrationTeam: TeamId | null = null
  private celebrationTimer = 0
  private celebrationScorerId: string | null = null
  private celebrationGather = { x: 0, z: 0 }
  private celebrationFaceX = 0
  private celebrationFaceZ = 1
  /** Invalida fades em andamento ao pular */
  private skipToken = 0
  private lastSkipAt = 0

  private lastReplayAt = 0
  private pendingShot: PendingShot | null = null
  private pendingEventReplay: PendingEventReplay | null = null

  private interpFrame: ReplayFrame | null = null
  private discreteFrame: ReplayFrame | null = null
  private playerSnapMap = new Map<string, ReplayPlayerSnap>()
  private liveSnapshot: ReplayFrame | null = null
  private frozenClip: ReplayFrame[] = []

  /** Direção estável da câmera (não segue rotação frame-a-frame) */
  private camFaceX = 0
  private camFaceZ = 1
  private camSmoothPos = new THREE.Vector3()
  private camSmoothLook = new THREE.Vector3()
  private camInitialized = false

  isActive() {
    return this.playbackActive
  }

  isSequenceRunning() {
    return this.seqState !== 'idle'
  }

  isCelebrating() {
    return this.seqState === 'celebrating'
  }

  getCelebrationTeam() {
    return this.celebrationTeam
  }

  getCelebrationScorerId() {
    return this.celebrationScorerId
  }

  getCelebrationGather() {
    return this.celebrationGather
  }

  getCelebrationElapsed() {
    return this.celebrationTimer
  }

  /**
   * Pula o trecho atual: comemoração → replay; replay → fim da sequência.
   * Também cancela replay de falta/impedimento ainda na fila.
   */
  skip(): boolean {
    const now = performance.now()
    if (now - this.lastSkipAt < 280) return false
    this.lastSkipAt = now

    if (this.pendingEventReplay && this.seqState === 'idle') {
      const pending = this.pendingEventReplay
      this.pendingEventReplay = null
      pending.onComplete()
      return true
    }

    if (this.seqState === 'idle') return false

    const gen = ++this.skipToken

    if (this.seqState === 'celebrating') {
      this.seqState = 'transitioning'
      const clip = this.frozenClip
      const team = this.celebrationTeam ?? 'home'
      void runFadeOut(FADE_OUT_MS)
        .then(() => {
          if (gen !== this.skipToken) return
          this.armPlayback('goal', clip, {
            team,
            goalZ: this.focusGoalZ,
            focusPlayerId: this.celebrationScorerId,
          })
          this.seqState = 'replaying'
          return runFadeIn(FADE_IN_MS)
        })
        .catch(() => {
          if (gen === this.skipToken) this.forceEndSequence()
        })
      return true
    }

    // Replay (ou fade no meio): encerra a sequência
    this.seqState = 'transitioning'
    void runFadeOut(FADE_OUT_MS)
      .then(() => {
        if (gen !== this.skipToken) return
        this.finishPlayback()
        return runFadeIn(FADE_IN_MS)
      })
      .then(() => {
        if (gen !== this.skipToken) return
        this.endSequence()
      })
      .catch(() => {
        if (gen === this.skipToken) this.forceEndSequence()
      })
    return true
  }

  /** Câmeras de cinegrafista durante a comemoração */
  getCelebrationCameraState(
    outPos: THREE.Vector3,
    outLook: THREE.Vector3,
  ): { fov: number; hardCut: boolean } {
    return sampleCelebrationCam(
      {
        elapsed: this.celebrationTimer,
        scorerId: this.celebrationScorerId,
        team: this.celebrationTeam,
        gatherX: this.celebrationGather.x,
        gatherZ: this.celebrationGather.z,
        faceX: this.celebrationFaceX,
        faceZ: this.celebrationFaceZ,
        bounds: useGameStore.getState().fieldBounds,
      },
      outPos,
      outLook,
    )
  }

  getPlaybackSpeed() {
    return this.playbackSpeed
  }

  getEventLabel() {
    return EVENT_LABEL[this.eventType]
  }

  getReplayHighlight(): {
    playerId: string
    playerName: string
    action: string
    editionPlayerId: string | null
  } | null {
    if (!this.focusPlayerId) return null
    const team: TeamId = this.focusPlayerId.startsWith('away-') ? 'away' : 'home'
    const index = parsePlayerIndex(this.focusPlayerId)
    return {
      playerId: this.focusPlayerId,
      playerName: getPlayerDisplayName(team, index).toUpperCase(),
      action: EVENT_LABEL[this.eventType],
      editionPlayerId: getEditionPlayerId(team, index),
    }
  }

  private resolveFocusPlayerId(
    type: ReplayEventType,
    frames: ReplayFrame[],
    meta: ReplayMeta,
  ): string | null {
    if (meta.focusPlayerId) return meta.focusPlayerId

    const team = meta.team ?? this.focusTeam
    if (type === 'save') {
      const defending = team === 'home' ? 'away' : 'home'
      return getGoalkeeperId(defending)
    }

    return this.nearestPlayerToBall(frames, team)
  }

  private nearestPlayerToBall(frames: ReplayFrame[], team: TeamId): string | null {
    const last = frames[frames.length - 1]
    if (!last) return null
    return this.nearestOnFrame(last, team)
  }

  private nearestOnFrame(frame: ReplayFrame, team: TeamId): string | null {
    const { x, z } = frame.ball
    let bestId: string | null = null
    let bestDist = Infinity

    for (const p of frame.players) {
      const ref = playerRegistry.get(p.id)
      if (!ref || ref.team !== team) continue
      const dist = (p.x - x) ** 2 + (p.z - z) ** 2
      if (dist < bestDist) {
        bestDist = dist
        bestId = p.id
      }
    }

    return bestId
  }

  /**
   * Autor do gol: quem estava perto da bola ANTES dela entrar na rede.
   * Último frame (bola no fundo) costuma pegar o “último selecionado” correndo atrás.
   */
  private findLikelyScorer(frames: ReplayFrame[], team: TeamId): string | null {
    const bounds = useGameStore.getState().fieldBounds
    if (!bounds || frames.length === 0) return this.nearestPlayerToBall(frames, team)

    const goalZ = getAttackingGoalZ(team, bounds)
    const sign = getAttackSign(team, bounds)

    for (let i = frames.length - 1; i >= 0; i--) {
      const frame = frames[i]!
      const toGoal = (goalZ - frame.ball.z) * sign
      // Ainda fora / na linha — quem chutou
      if (toGoal < 1.1) continue
      const near = this.nearestOnFrame(frame, team)
      if (near) return near
    }

    // Meio do clip (momento do chute) em vez do fim
    const mid = frames[Math.floor(frames.length * 0.4)]
    if (mid) {
      const near = this.nearestOnFrame(mid, team)
      if (near) return near
    }

    return this.nearestPlayerToBall(frames, team)
  }

  getEventType() {
    return this.eventType
  }

  getOffsideLineZ() {
    if (this.eventType !== 'offside') return null
    return this.offsideLineZ
  }

  /** HUD de TV só quando o replay está visível (pós-fade) */
  isTvHudVisible() {
    return (
      this.seqState === 'replaying' &&
      this.playbackActive &&
      this.playbackTime > 0.15
    )
  }

  getTvClock() {
    const store = useGameStore.getState()
    return formatMatchTime(store.matchTime)
  }

  getPlaybackProgress() {
    if (this.playbackDuration <= 0) return 0
    return Math.min(1, this.playbackTime / this.playbackDuration)
  }

  getPlayerSnap(id: string): ReplayPlayerSnap | undefined {
    const pos = this.playerSnapMap.get(id)
    const discrete = this.discreteFrame?.players.find((p) => p.id === id)
    if (!pos) return discrete
    if (!discrete) return pos
    return {
      ...pos,
      anim: discrete.anim,
      animTime: discrete.animTime,
    }
  }

  getBallPlayback(): Pick<ReplayFrame, 'ball' | 'ballVel' | 'ballQuat' | 'ballAngVel'> | null {
    if (!this.interpFrame) return null
    return {
      ball: this.interpFrame.ball,
      ballVel: this.interpFrame.ballVel,
      ballQuat: this.interpFrame.ballQuat,
      ballAngVel: this.interpFrame.ballAngVel,
    }
  }

  private defaultBallQuat(): ReplayBallQuat {
    return { x: 0, y: 0, z: 0, w: 1 }
  }

  private readBallPhysics(): { quat: ReplayBallQuat; angVel: Vec3 } {
    const body = ballBodyRef.current as {
      rotation: () => { x: number; y: number; z: number; w: number }
      angvel: () => { x: number; y: number; z: number }
    } | null

    if (!body) {
      return { quat: this.defaultBallQuat(), angVel: { x: 0, y: 0, z: 0 } }
    }

    const r = body.rotation()
    const av = body.angvel()
    return {
      quat: { x: r.x, y: r.y, z: r.z, w: r.w },
      angVel: { x: av.x, y: av.y, z: av.z },
    }
  }

  private captureFrame(): ReplayFrame {
    const players: ReplayPlayerSnap[] = []
    for (const p of playerRegistry.values()) {
      players.push({
        id: p.id,
        x: p.position.x,
        y: p.position.y,
        z: p.position.z,
        rotation: p.rotation,
        anim: p.anim,
        animTime: p.animTime ?? 0,
      })
    }
    const ballPhys = this.readBallPhysics()
    return {
      ball: { ...ballRef.current },
      ballVel: { ...ballRef.velocity },
      ballQuat: ballPhys.quat,
      ballAngVel: ballPhys.angVel,
      players,
      refereeX: refereeState.x,
      refereeZ: refereeState.z,
    }
  }

  record(delta: number) {
    if (this.isSequenceRunning()) return
    const store = useGameStore.getState()
    if (store.phase !== 'playing' || store.ballFrozen) return

    this.recordAcc += delta
    while (this.recordAcc >= RECORD_INTERVAL) {
      this.recordAcc -= RECORD_INTERVAL
      this.ring.push(this.captureFrame())
      if (this.ring.length > MAX_FRAMES) {
        this.ring.shift()
      }
    }
  }

  private sliceLookback(seconds: number): ReplayFrame[] {
    const count = Math.min(
      this.ring.length,
      Math.max(8, Math.ceil(seconds * RECORD_HZ)),
    )
    return this.ring.slice(-count).map((f) => ({
      ball: { ...f.ball },
      ballVel: { ...f.ballVel },
      ballQuat: { ...(f.ballQuat ?? this.defaultBallQuat()) },
      ballAngVel: { ...(f.ballAngVel ?? { x: 0, y: 0, z: 0 }) },
      players: f.players.map((p) => ({
        ...p,
        animTime: p.animTime ?? 0,
      })),
      refereeX: f.refereeX,
      refereeZ: f.refereeZ,
    }))
  }

  private canStartReplay(force = false) {
    if (this.isSequenceRunning()) return false
    if (force) return true
    return performance.now() - this.lastReplayAt >= MIN_REPLAY_GAP_MS
  }

  private armPlayback(type: ReplayEventType, frames: ReplayFrame[], meta: ReplayMeta) {
    this.playbackActive = true
    this.eventType = type
    this.playbackFrames = frames
    this.playbackDuration = frames.length / RECORD_HZ
    this.playbackTime = 0
    this.playbackSpeed = PLAYBACK_SPEED[type]
    this.focusTeam = meta.team ?? 'home'
    this.focusGoalZ = meta.goalZ ?? 0
    this.focusPlayerId = this.resolveFocusPlayerId(type, frames, meta)
    this.foulSpot = meta.foulSpot ?? null
    this.offsideLineZ = meta.offsideLineZ ?? null
    this.lastReplayAt = performance.now()
    this.pendingShot = null
    this.liveSnapshot = this.captureFrame()
    this.initReplayCameraBasis(frames)
    this.camInitialized = false

    useGameStore.setState({
      phase: 'replay',
      ballFrozen: true,
      ballPossession: null,
      passIntent: null,
      message: '',
    })

    const frame = this.sampleFrame(0)
    this.applyFrame(frame)
  }

  /** Ângulo fixo do replay — baseado no ataque / jogador, não muda a cada frame */
  private initReplayCameraBasis(frames: ReplayFrame[]) {
    const bounds = useGameStore.getState().fieldBounds
    const sign = bounds ? getAttackSign(this.focusTeam, bounds) : 1
    let fx = 0
    let fz = sign

    const mid = frames[Math.floor(frames.length * 0.55)] ?? frames[frames.length - 1]
    if (mid) {
      const focus = this.focusPlayerId
        ? mid.players.find((p) => p.id === this.focusPlayerId)
        : null
      if (focus) {
        fx = Math.sin(focus.rotation)
        fz = Math.cos(focus.rotation)
      } else {
        const vx = mid.ballVel.x
        const vz = mid.ballVel.z
        const len = Math.hypot(vx, vz)
        if (len > 0.4) {
          fx = vx / len
          fz = vz / len
        }
      }
    }

    const len = Math.hypot(fx, fz) || 1
    this.camFaceX = fx / len
    this.camFaceZ = fz / len
  }

  private startCelebration(scoringTeam: TeamId) {
    this.seqState = 'celebrating'
    this.celebrationTeam = scoringTeam
    this.celebrationTimer = 0
    this.frozenClip = this.sliceLookback(LOOKBACK.goal)

    const pending = this.pendingShot
    let scorerId: string | null = null
    if (
      pending &&
      !pending.resolved &&
      pending.team === scoringTeam &&
      pending.shooterId
    ) {
      scorerId = pending.shooterId
      pending.resolved = true
    }
    if (!scorerId) {
      scorerId = this.findLikelyScorer(this.frozenClip, scoringTeam)
    }
    this.celebrationScorerId = scorerId

    this.celebrationGather = this.resolveCelebrationGather(
      scoringTeam,
      this.celebrationScorerId,
    )
    this.initCelebrationCamFace()

    useGameStore.setState({
      phase: 'goal-celebration',
      ballFrozen: false,
      ballPossession: null,
      passIntent: null,
      message: `GOL do ${scoringTeam === 'home' ? 'Time Casa' : 'Time Visitante'}!`,
    })
  }

  /** Direção fixa da comemoração: do autor rumo ao canto (câmera à frente) */
  private initCelebrationCamFace() {
    const scorer = this.celebrationScorerId
      ? playerRegistry.get(this.celebrationScorerId)
      : null
    const ox = scorer?.position.x ?? ballRef.current.x
    const oz = scorer?.position.z ?? ballRef.current.z
    let fx = this.celebrationGather.x - ox
    let fz = this.celebrationGather.z - oz
    const len = Math.hypot(fx, fz)
    if (len < 0.35) {
      const bounds = useGameStore.getState().fieldBounds
      const sign = bounds
        ? getAttackSign(this.celebrationTeam ?? 'home', bounds)
        : 1
      fx = 0
      fz = sign
    }
    const n = Math.hypot(fx, fz) || 1
    this.celebrationFaceX = fx / n
    this.celebrationFaceZ = fz / n
  }

  /** Canto mais próximo da bola — corrida clássica PES */
  private resolveCelebrationGather(
    team: TeamId,
    scorerId: string | null,
  ): { x: number; z: number } {
    const bounds = useGameStore.getState().fieldBounds
    const ball = ballRef.current
    const scorer = scorerId ? playerRegistry.get(scorerId) : null
    const ox = scorer?.position.x ?? ball.x
    const oz = scorer?.position.z ?? ball.z

    if (bounds?.corners?.length) {
      let best = bounds.corners[0]
      let bestD = Infinity
      for (const c of bounds.corners) {
        // Preferir canto do lado do gol marcado (próximo ao goalZ)
        const goalBias = Math.abs(c.z - this.focusGoalZ) * 0.35
        const d = (c.x - ox) ** 2 + (c.z - oz) ** 2 + goalBias
        if (d < bestD) {
          bestD = d
          best = c
        }
      }
      // Um pouco pra dentro do campo (não colado na bandeirinha)
      const inwardX = bounds.center.x - best.x
      const inwardZ = bounds.center.z - best.z
      const ilen = Math.hypot(inwardX, inwardZ) || 1
      return {
        x: best.x + (inwardX / ilen) * 2.4,
        z: best.z + (inwardZ / ilen) * 2.4,
      }
    }

    const sign = bounds ? getAttackSign(team, bounds) : 1
    return {
      x: ox + (ox >= 0 ? 4.5 : -4.5),
      z: oz + sign * 3.2,
    }
  }

  private runReplayWithFades(
    type: ReplayEventType,
    frames: ReplayFrame[],
    meta: ReplayMeta,
    onComplete: () => void,
  ) {
    if (frames.length < 6 || !this.canStartReplay(meta.force ?? type === 'goal')) {
      onComplete()
      return
    }

    this.onComplete = onComplete
    this.seqState = 'transitioning'

    void runFadeOut(FADE_OUT_MS)
      .then(() => {
        this.armPlayback(type, frames, meta)
        this.seqState = 'replaying'
        return runFadeIn(FADE_IN_MS)
      })
      .catch(() => {
        this.abortSequence()
      })
  }

  private scheduleEventReplay(pending: PendingEventReplay) {
    if (this.pendingEventReplay || this.isSequenceRunning()) {
      pending.onComplete()
      return
    }
    this.pendingEventReplay = pending
  }

  private tickPendingEventReplay() {
    const pending = this.pendingEventReplay
    if (!pending) return

    const tailSec =
      pending.type === 'foul' ? FOUL_REPLAY_TAIL_SEC : OFFSIDE_REPLAY_TAIL_SEC
    if (performance.now() - pending.armedAt < tailSec * 1000) return

    const lookback = LOOKBACK[pending.type] + tailSec
    const frames = this.sliceLookback(lookback)
    const { type, meta, onComplete } = pending
    this.pendingEventReplay = null

    this.runReplayWithFades(type, frames, { ...meta, force: true }, onComplete)
  }

  private finishPlayback() {
    this.playbackActive = false
    this.interpFrame = null
    this.discreteFrame = null
    this.playerSnapMap.clear()
    this.offsideLineZ = null
    this.focusPlayerId = null
    this.camInitialized = false

    if (this.eventType !== 'goal' && this.liveSnapshot) {
      this.applyFrame(this.liveSnapshot)
    }
    this.liveSnapshot = null
  }

  private endSequence() {
    this.seqState = 'idle'
    this.celebrationTeam = null
    this.celebrationTimer = 0
    this.celebrationScorerId = null
    this.frozenClip = []
    const done = this.onComplete
    this.onComplete = null
    done?.()
  }

  /** Encerra chamando o callback (gol / bola em jogo) mesmo após erro de fade */
  private forceEndSequence() {
    this.finishPlayback()
    this.pendingEventReplay = null
    this.endSequence()
  }

  private abortSequence() {
    this.finishPlayback()
    this.seqState = 'idle'
    this.celebrationTeam = null
    this.celebrationScorerId = null
    this.pendingEventReplay = null
    this.onComplete = null
  }

  requestGoalSequence(scoringTeam: TeamId, onComplete: () => void) {
    if (this.isSequenceRunning()) return
    this.frozenClip = this.sliceLookback(LOOKBACK.goal)
    if (this.frozenClip.length < 6) {
      onComplete()
      return
    }

    this.onComplete = onComplete
    const bounds = useGameStore.getState().fieldBounds
    const goalZ = bounds ? getAttackingGoalZ(scoringTeam, bounds) : 0
    this.focusTeam = scoringTeam
    this.focusGoalZ = goalZ
    this.startCelebration(scoringTeam)
  }

  requestFoulReplay(
    fouledTeam: TeamId,
    spot: Vec3,
    foulerId: string,
    onComplete: () => void,
  ) {
    const bounds = useGameStore.getState().fieldBounds
    const goalZ = bounds ? getAttackingGoalZ(fouledTeam, bounds) : spot.z
    this.scheduleEventReplay({
      type: 'foul',
      meta: { team: fouledTeam, goalZ, foulSpot: spot, focusPlayerId: foulerId },
      onComplete,
      armedAt: performance.now(),
    })
  }

  requestOffsideReplay(
    defendingTeam: TeamId,
    spot: Vec3,
    lineZAtPass: number,
    receiverId: string,
    onComplete: () => void,
  ) {
    const bounds = useGameStore.getState().fieldBounds
    const goalZ = bounds ? getAttackingGoalZ(defendingTeam, bounds) : spot.z
    this.scheduleEventReplay({
      type: 'offside',
      meta: {
        team: defendingTeam,
        goalZ,
        foulSpot: spot,
        offsideLineZ: lineZAtPass,
        focusPlayerId: receiverId,
      },
      onComplete,
      armedAt: performance.now(),
    })
  }

  requestShotReplay(
    type: 'shot' | 'save',
    team: TeamId,
    onComplete: () => void,
    force = false,
    focusPlayerId?: string | null,
  ) {
    const bounds = useGameStore.getState().fieldBounds
    const goalZ = bounds ? getAttackingGoalZ(team, bounds) : 0
    const frames = this.sliceLookback(LOOKBACK[type])
    this.runReplayWithFades(
      type,
      frames,
      { team, goalZ, force, focusPlayerId: focusPlayerId ?? null },
      onComplete,
    )
  }

  notifyGoalkeeperSave(_defendingTeam: TeamId) {
    const pending = this.pendingShot
    if (pending && !pending.resolved) {
      pending.resolved = true
    }
  }

  notifyShot(team: TeamId, shooterId?: string | null) {
    const bounds = useGameStore.getState().fieldBounds
    if (!bounds) return
    const poss = useGameStore.getState().ballPossession
    const id =
      shooterId ??
      (poss?.team === team ? poss.playerId : null)
    this.pendingShot = {
      team,
      at: performance.now(),
      goalZ: getAttackingGoalZ(team, bounds),
      interesting: false,
      resolved: false,
      shooterId: id,
    }
  }

  updatePendingShot() {
    const pending = this.pendingShot
    if (!pending || pending.resolved || this.isSequenceRunning()) return

    const store = useGameStore.getState()
    if (store.phase !== 'playing') {
      this.pendingShot = null
      return
    }

    const elapsed = performance.now() - pending.at
    if (elapsed > 5200) {
      this.pendingShot = null
      return
    }

    const ball = ballRef.current
    const vel = ballRef.velocity
    const speed = Math.hypot(vel.x, vel.z)
    const bounds = store.fieldBounds
    if (!bounds) return

    const sign = getAttackSign(pending.team, bounds)
    const distToGoal = (pending.goalZ - ball.z) * sign

    if (speed > 5 && distToGoal > 0 && distToGoal < 38) {
      pending.interesting = true
    }

    const goalZones = store.goalZones
    const defendingTeam = pending.team === 'home' ? 'away' : 'home'
    if (isBallInGoal(ball, goalZones)) {
      pending.resolved = true
      return
    }

    const gkId = getGoalkeeperId(defendingTeam)
    const poss = store.ballPossession
    if (
      pending.interesting &&
      poss?.playerId === gkId &&
      elapsed > 350 &&
      distToGoal < 24
    ) {
      pending.resolved = true
      return
    }
  }

  /** Replay de chute a gol só quando a bola sai — chamado pelo MatchManager no OOB */
  tryRunShotOutReplay(onComplete: () => void): boolean {
    const pending = this.pendingShot
    if (!pending || pending.resolved || !pending.interesting) {
      return false
    }
    pending.resolved = true
    this.requestShotReplay('shot', pending.team, onComplete, true, pending.shooterId)
    return true
  }

  updateSequence(delta: number) {
    this.tickPendingEventReplay()

    if (this.seqState === 'celebrating') {
      this.celebrationTimer += delta
      if (this.celebrationTimer >= GOAL_CELEBRATION_SEC) {
        // Mesmo caminho do skip — evita duplicar lógica
        this.celebrationTimer = GOAL_CELEBRATION_SEC
        if (this.seqState === 'celebrating') {
          const gen = ++this.skipToken
          this.seqState = 'transitioning'
          const clip = this.frozenClip
          const team = this.celebrationTeam ?? 'home'
          void runFadeOut(FADE_OUT_MS)
            .then(() => {
              if (gen !== this.skipToken) return
              this.armPlayback('goal', clip, {
                team,
                goalZ: this.focusGoalZ,
                focusPlayerId: this.celebrationScorerId,
              })
              this.seqState = 'replaying'
              return runFadeIn(FADE_IN_MS)
            })
            .catch(() => {
              if (gen === this.skipToken) this.forceEndSequence()
            })
        }
      }
      return
    }

    if (this.seqState === 'replaying' && this.playbackActive) {
      const stillPlaying = this.tick(delta)
      if (!stillPlaying) {
        const gen = ++this.skipToken
        this.seqState = 'transitioning'
        void runFadeOut(FADE_OUT_MS)
          .then(() => {
            if (gen !== this.skipToken) return
            this.finishPlayback()
            return runFadeIn(FADE_IN_MS)
          })
          .then(() => {
            if (gen !== this.skipToken) return
            this.endSequence()
          })
          .catch(() => {
            if (gen === this.skipToken) this.forceEndSequence()
          })
      }
    }
  }

  private applyFrame(frame: ReplayFrame) {
    ballRef.current = { ...frame.ball }
    ballRef.velocity = { ...frame.ballVel }
    refereeState.x = frame.refereeX
    refereeState.z = frame.refereeZ
    refereeState.targetX = frame.refereeX
    refereeState.targetZ = frame.refereeZ

    for (const p of frame.players) {
      const ref = playerRegistry.get(p.id)
      if (ref) {
        ref.position = { x: p.x, y: p.y, z: p.z }
        ref.rotation = p.rotation
        ref.velocity = { x: 0, y: 0, z: 0 }
        ref.anim = p.anim
        ref.animTime = p.animTime ?? 0
      }
    }
  }

  private lerp(a: number, b: number, t: number) {
    return a + (b - a) * t
  }

  private lerpAngle(a: number, b: number, t: number) {
    let delta = b - a
    while (delta > Math.PI) delta -= Math.PI * 2
    while (delta < -Math.PI) delta += Math.PI * 2
    return a + delta * t
  }

  private lerpQuat(
    a: ReplayBallQuat,
    b: ReplayBallQuat,
    t: number,
  ): ReplayBallQuat {
    const qa = new THREE.Quaternion(a.x, a.y, a.z, a.w)
    const qb = new THREE.Quaternion(b.x, b.y, b.z, b.w)
    qa.slerp(qb, t)
    return { x: qa.x, y: qa.y, z: qa.z, w: qa.w }
  }

  private lerpFrame(a: ReplayFrame, b: ReplayFrame, t: number): ReplayFrame {
    const bMap = new Map(b.players.map((p) => [p.id, p]))
    const players: ReplayPlayerSnap[] = a.players.map((pa) => {
      const pb = bMap.get(pa.id) ?? pa
      return {
        id: pa.id,
        x: this.lerp(pa.x, pb.x, t),
        y: this.lerp(pa.y, pb.y, t),
        z: this.lerp(pa.z, pb.z, t),
        rotation: this.lerpAngle(pa.rotation, pb.rotation, t),
        anim: pa.anim ?? 'player_idle',
        animTime: this.lerp(pa.animTime ?? 0, pb.animTime ?? 0, t),
      }
    })
    for (const pb of b.players) {
      if (!players.some((p) => p.id === pb.id)) {
        players.push({ ...pb, animTime: pb.animTime ?? 0 })
      }
    }
    const aq = a.ballQuat ?? this.defaultBallQuat()
    const bq = b.ballQuat ?? this.defaultBallQuat()
    const aav = a.ballAngVel ?? { x: 0, y: 0, z: 0 }
    const bav = b.ballAngVel ?? { x: 0, y: 0, z: 0 }
    return {
      ball: {
        x: this.lerp(a.ball.x, b.ball.x, t),
        y: this.lerp(a.ball.y, b.ball.y, t),
        z: this.lerp(a.ball.z, b.ball.z, t),
      },
      ballVel: {
        x: this.lerp(a.ballVel.x, b.ballVel.x, t),
        y: this.lerp(a.ballVel.y, b.ballVel.y, t),
        z: this.lerp(a.ballVel.z, b.ballVel.z, t),
      },
      ballQuat: this.lerpQuat(aq, bq, t),
      ballAngVel: {
        x: this.lerp(aav.x, bav.x, t),
        y: this.lerp(aav.y, bav.y, t),
        z: this.lerp(aav.z, bav.z, t),
      },
      players,
      refereeX: this.lerp(a.refereeX, b.refereeX, t),
      refereeZ: this.lerp(a.refereeZ, b.refereeZ, t),
    }
  }

  private sampleFrame(timeSec: number): ReplayFrame {
    const frames = this.playbackFrames
    if (frames.length === 0) {
      return this.captureFrame()
    }
    const idx = Math.min(
      frames.length - 1,
      Math.max(0, timeSec * RECORD_HZ),
    )
    const i0 = Math.floor(idx)
    const i1 = Math.min(frames.length - 1, i0 + 1)
    const t = idx - i0
    return this.lerpFrame(frames[i0], frames[i1], t)
  }

  private tick(delta: number): boolean {
    if (!this.playbackActive) return false

    this.playbackTime += delta * this.playbackSpeed
    const progress = Math.min(1, this.playbackTime / this.playbackDuration)
    const discreteIdx = Math.min(
      this.playbackFrames.length - 1,
      Math.max(0, Math.floor(this.playbackTime * RECORD_HZ)),
    )
    this.discreteFrame = this.playbackFrames[discreteIdx] ?? null
    const frame = this.sampleFrame(this.playbackTime)
    this.interpFrame = frame

    this.playerSnapMap.clear()
    for (const p of frame.players) {
      this.playerSnapMap.set(p.id, p)
    }

    this.applyFrame(frame)

    return progress < 1 - 1e-5
  }

  getCameraState(
    delta: number,
    outPos: THREE.Vector3,
    outLook: THREE.Vector3,
  ) {
    const frame = this.interpFrame ?? this.playbackFrames[0]
    if (!frame) return

    const ball = frame.ball
    const foul = this.foulSpot

    // Sempre olha a bola no lance (falta: spot do lance)
    const lookX = foul?.x ?? ball.x
    const lookZ = foul?.z ?? ball.z
    const lookY = foul
      ? PLAYER_HEIGHT * 0.78
      : Math.max(0.38, Math.min(3.2, ball.y))

    // Ângulo travado no início do replay — não segue rotação a cada frame
    const faceX = this.camFaceX
    const faceZ = this.camFaceZ
    const sideX = -faceZ
    const sideZ = faceX

    // ¾ de frente, baixo, distância fixa (sem sway / orbit)
    const dist = 5.1
    const side = 1.55
    const height = 1.45
    const targetPosX = lookX + faceX * dist + sideX * side
    const targetPosY = height
    const targetPosZ = lookZ + faceZ * dist + sideZ * side

    if (!this.camInitialized) {
      this.camSmoothLook.set(lookX, lookY, lookZ)
      this.camSmoothPos.set(targetPosX, targetPosY, targetPosZ)
      this.camInitialized = true
    } else {
      // Look na bola bem responsivo; posição um pouco mais suave
      const lookA = 1 - Math.exp(-6.5 * delta)
      const posA = 1 - Math.exp(-3.2 * delta)
      this.camSmoothLook.x = THREE.MathUtils.lerp(this.camSmoothLook.x, lookX, lookA)
      this.camSmoothLook.y = THREE.MathUtils.lerp(this.camSmoothLook.y, lookY, lookA)
      this.camSmoothLook.z = THREE.MathUtils.lerp(this.camSmoothLook.z, lookZ, lookA)
      this.camSmoothPos.x = THREE.MathUtils.lerp(this.camSmoothPos.x, targetPosX, posA)
      this.camSmoothPos.y = THREE.MathUtils.lerp(this.camSmoothPos.y, targetPosY, posA)
      this.camSmoothPos.z = THREE.MathUtils.lerp(this.camSmoothPos.z, targetPosZ, posA)
    }

    outPos.copy(this.camSmoothPos)
    outPos.y = THREE.MathUtils.clamp(outPos.y, 1.15, 1.85)
    outLook.copy(this.camSmoothLook)

    // GameCamera ainda aplica um pouco de lerp — devolve alpha baixo
    return 1 - Math.exp(-4.0 * delta)
  }
}

export const replaySystem = new ReplaySystem()

export function isReplayActive() {
  return replaySystem.isActive()
}

export function isReplaySequenceRunning() {
  return replaySystem.isSequenceRunning()
}
