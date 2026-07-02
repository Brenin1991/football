import * as THREE from 'three'
import type { PlayerAnim, TeamId, Vec3 } from '../types'
import { ballRef, playerRegistry } from './entityRegistry'
import { refereeState } from './referee'
import { getAttackingGoalZ, getAttackSign } from './teamField'
import { isBallInGoal } from './rules'
import { useGameStore, formatMatchTime } from '../store/gameStore'
import { getGoalkeeperId } from '../constants'
import { FIELD_SCALE } from './fieldData'
import { runFadeIn, runFadeOut } from './screenTransition'

export type ReplayEventType = 'goal' | 'shot' | 'foul' | 'save' | 'offside'

export interface ReplayPlayerSnap {
  id: string
  x: number
  y: number
  z: number
  rotation: number
  anim: PlayerAnim
}

export interface ReplayFrame {
  ball: Vec3
  ballVel: Vec3
  players: ReplayPlayerSnap[]
  refereeX: number
  refereeZ: number
}

export type ReplayCameraMode = 'broadcast' | 'goalSide' | 'dramatic'

type SeqState = 'idle' | 'celebrating' | 'transitioning' | 'replaying'

const BUFFER_SECONDS = 4.2
const RECORD_HZ = 30
const RECORD_INTERVAL = 1 / RECORD_HZ
const MAX_FRAMES = Math.ceil(BUFFER_SECONDS * RECORD_HZ) + 4

const GOAL_CELEBRATION_SEC = 2.35
const FADE_OUT_MS = 480
const FADE_IN_MS = 620

const PLAYBACK_SPEED: Record<ReplayEventType, number> = {
  goal: 0.32,
  shot: 0.36,
  save: 0.34,
  foul: 0.38,
  offside: 0.38,
}

const LOOKBACK: Record<ReplayEventType, number> = {
  goal: 3.6,
  shot: 2.7,
  save: 2.9,
  foul: 2.5,
  offside: 2.5,
}

const EVENT_LABEL: Record<ReplayEventType, string> = {
  goal: 'GOL',
  shot: 'CHUTE A GOL',
  save: 'DEFESA DO GOLEIRO',
  foul: 'LANCE IRREGULAR',
  offside: 'IMPEDIMENTO',
}

const MIN_REPLAY_GAP_MS = 6500

interface PendingShot {
  team: TeamId
  at: number
  goalZ: number
  interesting: boolean
  resolved: boolean
}

interface ReplaySegment {
  mode: ReplayCameraMode
  start: number
  end: number
}

interface ReplayMeta {
  team?: TeamId
  goalZ?: number
  foulSpot?: Vec3
  offsideLineZ?: number
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
  private playbackSpeed = 0.36
  private segments: ReplaySegment[] = []
  private onComplete: (() => void) | null = null

  private focusGoalZ = 0
  private focusTeam: TeamId = 'home'
  private foulSpot: Vec3 | null = null
  private offsideLineZ: number | null = null
  private celebrationTeam: TeamId | null = null
  private celebrationTimer = 0

  private lastReplayAt = 0
  private pendingShot: PendingShot | null = null

  private interpFrame: ReplayFrame | null = null
  private playerSnapMap = new Map<string, ReplayPlayerSnap>()
  private liveSnapshot: ReplayFrame | null = null
  private frozenClip: ReplayFrame[] = []

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

  getPlaybackSpeed() {
    return this.playbackSpeed
  }

  getEventLabel() {
    return EVENT_LABEL[this.eventType]
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
    return this.playerSnapMap.get(id)
  }

  private canStartReplay(force = false) {
    if (this.isSequenceRunning()) return false
    if (force) return true
    return performance.now() - this.lastReplayAt >= MIN_REPLAY_GAP_MS
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
      })
    }
    return {
      ball: { ...ballRef.current },
      ballVel: { ...ballRef.velocity },
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
      players: f.players.map((p) => ({ ...p })),
      refereeX: f.refereeX,
      refereeZ: f.refereeZ,
    }))
  }

  private buildSegments(type: ReplayEventType): ReplaySegment[] {
    if (type === 'goal') {
      return [
        { mode: 'broadcast', start: 0, end: 0.52 },
        { mode: 'goalSide', start: 0.4, end: 0.78 },
        { mode: 'dramatic', start: 0.68, end: 1 },
      ]
    }
    if (type === 'foul' || type === 'offside') {
      return [
        { mode: 'broadcast', start: 0, end: 0.62 },
        { mode: 'dramatic', start: 0.52, end: 1 },
      ]
    }
    return [{ mode: 'goalSide', start: 0, end: 1 }]
  }

  private armPlayback(type: ReplayEventType, frames: ReplayFrame[], meta: ReplayMeta) {
    this.playbackActive = true
    this.eventType = type
    this.playbackFrames = frames
    this.playbackDuration = frames.length / RECORD_HZ
    this.playbackTime = 0
    this.playbackSpeed = PLAYBACK_SPEED[type]
    this.segments = this.buildSegments(type)
    this.focusTeam = meta.team ?? 'home'
    this.focusGoalZ = meta.goalZ ?? 0
    this.foulSpot = meta.foulSpot ?? null
    this.offsideLineZ = meta.offsideLineZ ?? null
    this.lastReplayAt = performance.now()
    this.pendingShot = null
    this.liveSnapshot = this.captureFrame()

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

  private startCelebration(scoringTeam: TeamId) {
    this.seqState = 'celebrating'
    this.celebrationTeam = scoringTeam
    this.celebrationTimer = 0
    this.frozenClip = this.sliceLookback(LOOKBACK.goal)

    useGameStore.setState({
      phase: 'goal-celebration',
      ballFrozen: true,
      ballPossession: null,
      passIntent: null,
      message: `GOL do ${scoringTeam === 'home' ? 'Time Casa' : 'Time Visitante'}!`,
    })
  }

  private runReplayWithFades(
    type: ReplayEventType,
    frames: ReplayFrame[],
    meta: ReplayMeta & { force?: boolean },
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

  private finishPlayback() {
    this.playbackActive = false
    this.interpFrame = null
    this.playerSnapMap.clear()
    this.offsideLineZ = null

    if (this.eventType !== 'goal' && this.liveSnapshot) {
      this.applyFrame(this.liveSnapshot)
    }
    this.liveSnapshot = null
  }

  private endSequence() {
    this.seqState = 'idle'
    this.celebrationTeam = null
    this.celebrationTimer = 0
    this.frozenClip = []
    const done = this.onComplete
    this.onComplete = null
    done?.()
  }

  private abortSequence() {
    this.finishPlayback()
    this.seqState = 'idle'
    this.celebrationTeam = null
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

  requestFoulReplay(fouledTeam: TeamId, spot: Vec3, onComplete: () => void) {
    const bounds = useGameStore.getState().fieldBounds
    const goalZ = bounds ? getAttackingGoalZ(fouledTeam, bounds) : spot.z
    const frames = this.sliceLookback(LOOKBACK.foul)
    this.runReplayWithFades(
      'foul',
      frames,
      { team: fouledTeam, goalZ, foulSpot: spot },
      onComplete,
    )
  }

  requestOffsideReplay(
    defendingTeam: TeamId,
    spot: Vec3,
    lineZAtPass: number,
    onComplete: () => void,
  ) {
    const bounds = useGameStore.getState().fieldBounds
    const goalZ = bounds ? getAttackingGoalZ(defendingTeam, bounds) : spot.z
    const frames = this.sliceLookback(LOOKBACK.offside)
    this.runReplayWithFades(
      'offside',
      frames,
      { team: defendingTeam, goalZ, foulSpot: spot, offsideLineZ: lineZAtPass },
      onComplete,
    )
  }

  requestShotReplay(
    type: 'shot' | 'save',
    team: TeamId,
    onComplete: () => void,
    force = false,
  ) {
    const bounds = useGameStore.getState().fieldBounds
    const goalZ = bounds ? getAttackingGoalZ(team, bounds) : 0
    const frames = this.sliceLookback(LOOKBACK[type])
    this.runReplayWithFades(type, frames, { team, goalZ, force }, onComplete)
  }

  notifyGoalkeeperSave(_defendingTeam: TeamId) {
    const pending = this.pendingShot
    if (pending && !pending.resolved) {
      pending.resolved = true
    }
  }

  notifyShot(team: TeamId) {
    const bounds = useGameStore.getState().fieldBounds
    if (!bounds) return
    this.pendingShot = {
      team,
      at: performance.now(),
      goalZ: getAttackingGoalZ(team, bounds),
      interesting: false,
      resolved: false,
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
    this.requestShotReplay('shot', pending.team, onComplete, true)
    return true
  }

  updateSequence(delta: number) {
    if (this.seqState === 'celebrating') {
      this.celebrationTimer += delta
      if (this.celebrationTimer >= GOAL_CELEBRATION_SEC) {
        this.seqState = 'transitioning'
        const clip = this.frozenClip
        const team = this.celebrationTeam ?? 'home'
        void runFadeOut(FADE_OUT_MS)
          .then(() => {
            this.armPlayback('goal', clip, {
              team,
              goalZ: this.focusGoalZ,
            })
            this.seqState = 'replaying'
            return runFadeIn(FADE_IN_MS)
          })
          .catch(() => this.abortSequence())
      }
      return
    }

    if (this.seqState === 'replaying' && this.playbackActive) {
      const stillPlaying = this.tick(delta)
      if (!stillPlaying) {
        this.seqState = 'transitioning'
        void runFadeOut(FADE_OUT_MS)
          .then(() => {
            this.finishPlayback()
            return runFadeIn(FADE_IN_MS)
          })
          .then(() => this.endSequence())
          .catch(() => this.abortSequence())
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
      }
    }
  }

  private lerp(a: number, b: number, t: number) {
    return a + (b - a) * t
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
        rotation: pa.rotation,
        anim: pa.anim ?? 'idle',
      }
    })
    for (const pb of b.players) {
      if (!players.some((p) => p.id === pb.id)) {
        players.push({ ...pb })
      }
    }
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

  private activeSegment(progress: number): ReplaySegment {
    for (const seg of this.segments) {
      if (progress >= seg.start && progress <= seg.end) return seg
    }
    return this.segments[this.segments.length - 1]
  }

  private tick(delta: number): boolean {
    if (!this.playbackActive) return false

    this.playbackTime += delta * this.playbackSpeed
    const progress = Math.min(1, this.playbackTime / this.playbackDuration)
    const frame = this.sampleFrame(this.playbackTime)
    this.interpFrame = frame

    this.playerSnapMap.clear()
    for (const p of frame.players) {
      this.playerSnapMap.set(p.id, p)
    }

    this.applyFrame(frame)

    return progress < 1
  }

  getCameraState(
    delta: number,
    outPos: THREE.Vector3,
    outLook: THREE.Vector3,
  ) {
    const frame = this.interpFrame ?? this.playbackFrames[0]
    if (!frame) return

    const progress =
      this.playbackDuration > 0
        ? Math.min(1, this.playbackTime / this.playbackDuration)
        : 0
    const seg = this.activeSegment(progress)
    const ball = frame.ball
    const bounds = useGameStore.getState().fieldBounds
    const centerX = bounds?.center.x ?? 0
    const sign = bounds ? getAttackSign(this.focusTeam, bounds) : 1
    const foul = this.foulSpot

    switch (seg.mode) {
      case 'goalSide': {
        const behind = this.focusGoalZ - sign * 5.5 * FIELD_SCALE
        outPos.set(
          centerX + sign * 2.2 * FIELD_SCALE,
          2.1 * Math.sqrt(FIELD_SCALE),
          behind,
        )
        outLook.set(ball.x, 0.55, ball.z)
        break
      }
      case 'dramatic': {
        const fx = ball.x - centerX
        const fz = (ball.z - this.focusGoalZ) * sign
        const len = Math.hypot(fx, fz) || 1
        outPos.set(
          ball.x - (fx / len) * 4.2,
          1.35 * Math.sqrt(FIELD_SCALE),
          ball.z - (fz / len) * 4.2 * sign,
        )
        outLook.set(
          foul ? foul.x : ball.x + velBias(frame.ballVel).x * 2,
          0.45,
          foul ? foul.z : ball.z + velBias(frame.ballVel).z * 2,
        )
        break
      }
      default: {
        const sideX = centerX - 11.5 * FIELD_SCALE
        outPos.set(sideX, 4.2 * Math.sqrt(FIELD_SCALE), ball.z)
        outLook.set(
          foul ? foul.x : ball.x,
          0.5,
          foul ? foul.z : ball.z,
        )
        break
      }
    }

    return 1 - Math.exp(-5.5 * delta)
  }
}

function velBias(v: Vec3) {
  const len = Math.hypot(v.x, v.z) || 1
  return { x: v.x / len, z: v.z / len }
}

export const replaySystem = new ReplaySystem()

export function isReplayActive() {
  return replaySystem.isActive()
}

export function isReplaySequenceRunning() {
  return replaySystem.isSequenceRunning()
}
