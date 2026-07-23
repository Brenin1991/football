import {
  HALF_TIME_ENTER_HOLD,
  HALF_TIME_EXIT_HOLD,
  FULL_TIME_EXIT_HOLD,
  PLAYERS_PER_TEAM,
  playerId,
} from '../constants'
import type { FieldBounds, TeamId } from '../types'
import { playerRegistry } from './entityRegistry'
import { FIELD_SCALE } from './fieldData'
import { getIntroAnthemShotEnd, getIntroSequenceDuration } from './introCamera'
import { refereeState } from './referee'
import { getFormationSpawn } from './teamField'
import { getTeamFormationSlots } from './teamTactics'
import {
  ANTHEM_FORMATION_MARCH,
  ANTHEM_PLAYER_SPACING,
  getAnthemLineLayout,
} from './anthemLine'

const TUNNEL_OFFSET = 4.2 * FIELD_SCALE
const LINE_SEPARATION = 1.7 * FIELD_SCALE
const STAGGER_ALONG_TUNNEL = 0.38 * FIELD_SCALE
const WALK_SPEED = 1.05 * FIELD_SCALE
const INTRO_WALK_SPEED = 1.12 * FIELD_SCALE
const STAGGER_SEC = 0.26
const AWAY_ROW_DELAY = 1.1
const REFEREE_DELAY = 2.8
const POST_ARRIVAL_HOLD = 6
/** Hold mínimo na linha se chegarem depois da câmera (fallback) */
const ANTHEM_HOLD_MIN_SEC = 4

export type ParadeMode = 'intro-enter' | 'half-enter' | 'exit'

export interface EntranceActorState {
  x: number
  z: number
  rotation: number
  moving: boolean
  done: boolean
}

interface PathPoint {
  x: number
  z: number
}

interface EntranceActor {
  id: string
  points: PathPoint[]
  segmentLengths: number[]
  distToAnthem: number
  totalLength: number
  delay: number
  done: boolean
}

class TeamEntranceSystem {
  private active = false
  private mode: ParadeMode = 'intro-enter'
  private elapsed = 0
  private holdStartedAt: number | null = null
  private holdDuration = POST_ARRIVAL_HOLD
  private useIntroCinematic = true
  private walkSpeed = WALK_SPEED
  private anthemReleaseAt: number | null = null
  private actors = new Map<string, EntranceActor>()

  isActive() {
    return this.active
  }

  getMode() {
    return this.mode
  }

  getElapsed() {
    return this.elapsed
  }

  getProgress() {
    if (!this.active || this.actors.size === 0) return 0
    let sum = 0
    for (const a of this.actors.values()) {
      sum += this.getActorTravel(a) / Math.max(0.01, a.totalLength)
    }
    return sum / this.actors.size
  }

  isComplete() {
    if (!this.active) return true
    if (!this.allActorsDone()) return false
    if (this.holdStartedAt === null) return false

    const minEnd = this.holdStartedAt + this.holdDuration
    if (this.useIntroCinematic) {
      return this.elapsed >= Math.max(minEnd, getIntroSequenceDuration())
    }
    return this.elapsed >= minEnd
  }

  /** Entrada inicial (intro) ou retorno após intervalo */
  startEnter(bounds: FieldBounds, options?: { intro?: boolean }) {
    const intro = options?.intro ?? false
    this.mode = intro ? 'intro-enter' : 'half-enter'
    this.useIntroCinematic = intro
    this.walkSpeed = intro ? INTRO_WALK_SPEED : WALK_SPEED
    this.holdDuration = intro ? POST_ARRIVAL_HOLD : HALF_TIME_ENTER_HOLD
    this.anthemReleaseAt = null
    this.active = true
    this.elapsed = 0
    this.holdStartedAt = null
    this.actors.clear()

    let maxAnthemArrival = 0

    for (const team of ['home', 'away'] as const) {
      const baseDelay = team === 'away' ? AWAY_ROW_DELAY : 0
      getTeamFormationSlots(team)
        .slice(0, PLAYERS_PER_TEAM)
        .forEach((slot, i) => {
        const id = playerId(team, i)
        const formation = getFormationSpawn(team, slot, bounds)
        const delay = baseDelay + i * STAGGER_SEC

        const points = intro
          ? this.buildIntroPath(team, i, formation, bounds)
          : [this.tunnelStart(team, i, bounds), { x: formation.x, z: formation.z }]

        const actor = this.createActor(id, points, delay, intro ? 3 : -1)
        this.actors.set(id, actor)

        if (intro && actor.distToAnthem > 0) {
          maxAnthemArrival = Math.max(
            maxAnthemArrival,
            delay + actor.distToAnthem / this.walkSpeed,
          )
        }
      })
    }

    if (intro) {
      // Só liberam a linha depois que a câmera do hino terminar de passar nos rostos
      this.anthemReleaseAt = Math.max(
        maxAnthemArrival + ANTHEM_HOLD_MIN_SEC,
        getIntroAnthemShotEnd() + 0.35,
      )
      this.addRefereeIntro(bounds)
    } else {
      this.addRefereeHalfEnter(bounds)
    }
  }

  start(bounds: FieldBounds) {
    this.startEnter(bounds, { intro: true })
  }

  startExit(bounds: FieldBounds) {
    this.mode = 'exit'
    this.useIntroCinematic = false
    this.walkSpeed = WALK_SPEED
    this.holdDuration = HALF_TIME_EXIT_HOLD
    this.anthemReleaseAt = null
    this.active = true
    this.elapsed = 0
    this.holdStartedAt = null
    this.actors.clear()

    for (const team of ['home', 'away'] as const) {
      const baseDelay = team === 'away' ? AWAY_ROW_DELAY * 0.5 : 0
      getTeamFormationSlots(team)
        .slice(0, PLAYERS_PER_TEAM)
        .forEach((slot, i) => {
        const id = playerId(team, i)
        const live = playerRegistry.get(id)
        const start = live
          ? { x: live.position.x, z: live.position.z }
          : getFormationSpawn(team, slot, bounds)
        const target = this.tunnelExit(team, i, bounds)
        this.actors.set(id, this.createActor(id, [start, target], baseDelay + i * STAGGER_SEC))
      })
    }

    const refStart = { x: refereeState.x, z: refereeState.z }
    const refTarget = {
      x: bounds.minX - TUNNEL_OFFSET * 0.85,
      z: bounds.center.z,
    }
    this.actors.set(
      '__referee__',
      this.createActor('__referee__', [refStart, refTarget], REFEREE_DELAY * 0.4),
    )
  }

  startFinalExit(bounds: FieldBounds) {
    this.startExit(bounds)
    this.holdDuration = FULL_TIME_EXIT_HOLD
  }

  finish() {
    this.active = false
    this.holdStartedAt = null
    this.anthemReleaseAt = null
    this.actors.clear()
  }

  update(delta: number) {
    if (!this.active) return

    this.elapsed += delta

    for (const actor of this.actors.values()) {
      if (actor.done) continue
      const travel = this.getActorTravel(actor)
      actor.done = travel >= actor.totalLength - 0.02
    }

    if (this.allActorsDone() && this.holdStartedAt === null) {
      this.holdStartedAt = this.elapsed
    }
  }

  getActor(id: string): EntranceActorState | null {
    const actor = this.actors.get(id)
    if (!actor) return null

    const travel = this.getActorTravel(actor)
    const sample = this.samplePath(actor, travel)
    const holdingAnthem = this.useIntroCinematic && this.isAnthemHold(travel, actor)
    const rotation = holdingAnthem ? this.anthemRotation(actor.id) : sample.rotation
    const moving =
      this.elapsed >= actor.delay &&
      !actor.done &&
      !holdingAnthem

    return {
      x: sample.x,
      z: sample.z,
      rotation: rotation,
      moving,
      done: actor.done,
    }
  }

  getRefereeState(): EntranceActorState | null {
    return this.getActor('__referee__')
  }

  private buildIntroPath(
    team: TeamId,
    index: number,
    formation: PathPoint,
    bounds: FieldBounds,
  ): PathPoint[] {
    return [
      this.tunnelStart(team, index, bounds),
      this.tunnelMouth(team, bounds),
      this.anthemApproach(team, index, bounds),
      this.anthemSpot(team, index, bounds),
      this.formationDispersal(formation, bounds),
      { x: formation.x, z: formation.z },
    ]
  }

  private formationDispersal(formation: PathPoint, bounds: FieldBounds): PathPoint {
    return {
      x: this.anthemLineX(bounds) + ANTHEM_FORMATION_MARCH,
      z: formation.z,
    }
  }

  private anthemLineX(bounds: FieldBounds) {
    return getAnthemLineLayout(bounds).lineX
  }

  private anthemLineIndex(team: TeamId, index: number) {
    return team === 'home' ? index : PLAYERS_PER_TEAM + index
  }

  private anthemApproach(team: TeamId, index: number, bounds: FieldBounds): PathPoint {
    const spot = this.anthemSpot(team, index, bounds)
    return {
      x: bounds.minX + 3.6 * FIELD_SCALE,
      z: spot.z,
    }
  }

  private teamLineZ(team: TeamId, bounds: FieldBounds) {
    return team === 'home'
      ? bounds.center.z - LINE_SEPARATION * 0.5
      : bounds.center.z + LINE_SEPARATION * 0.5
  }

  private tunnelStart(team: TeamId, index: number, bounds: FieldBounds): PathPoint {
    return {
      x: bounds.minX - TUNNEL_OFFSET - index * STAGGER_ALONG_TUNNEL,
      z: this.teamLineZ(team, bounds),
    }
  }

  private tunnelMouth(team: TeamId, bounds: FieldBounds): PathPoint {
    return {
      x: bounds.minX + 1.35 * FIELD_SCALE,
      z: this.teamLineZ(team, bounds),
    }
  }

  private anthemSpot(team: TeamId, index: number, bounds: FieldBounds): PathPoint {
    const total = PLAYERS_PER_TEAM * 2
    const lineIndex = this.anthemLineIndex(team, index)
    const lineLength = (total - 1) * ANTHEM_PLAYER_SPACING
    const startZ = bounds.center.z - lineLength * 0.5
    return {
      x: this.anthemLineX(bounds),
      z: startZ + lineIndex * ANTHEM_PLAYER_SPACING,
    }
  }

  /** Todos olham para o túnel (minX) */
  private anthemRotation(_actorId: string): number {
    return -Math.PI / 2
  }

  private tunnelExit(team: TeamId, index: number, bounds: FieldBounds): PathPoint {
    return {
      x: bounds.minX - TUNNEL_OFFSET - index * STAGGER_ALONG_TUNNEL * 0.65,
      z: this.teamLineZ(team, bounds),
    }
  }

  private createActor(
    id: string,
    points: PathPoint[],
    delay: number,
    anthemPointIndex = -1,
  ): EntranceActor {
    const segmentLengths: number[] = []
    let distToAnthem = 0
    let totalLength = 0
    const stopIndex =
      anthemPointIndex >= 0
        ? anthemPointIndex
        : this.useIntroCinematic && points.length >= 4
          ? points.length - 2
          : -1

    for (let i = 0; i < points.length - 1; i++) {
      const len = Math.hypot(points[i + 1].x - points[i].x, points[i + 1].z - points[i].z)
      segmentLengths.push(Math.max(0.01, len))
      totalLength += segmentLengths[i]
      if (stopIndex > 0 && i < stopIndex) {
        distToAnthem += segmentLengths[i]
      }
    }

    return {
      id,
      points,
      segmentLengths,
      distToAnthem,
      totalLength: Math.max(0.01, totalLength),
      delay,
      done: false,
    }
  }

  private addRefereeIntro(bounds: FieldBounds) {
    const start: PathPoint = {
      x: bounds.minX - TUNNEL_OFFSET * 0.85,
      z: bounds.center.z,
    }
    const mouth: PathPoint = {
      x: bounds.minX + 1.35 * FIELD_SCALE,
      z: bounds.center.z,
    }
    const anthem: PathPoint = {
      x: this.anthemLineX(bounds) - 0.6 * FIELD_SCALE,
      z: bounds.center.z,
    }
    const target: PathPoint = {
      x: bounds.center.x + 2.2,
      z: bounds.center.z - 2.4,
    }

    const actor = this.createActor('__referee__', [start, mouth, anthem, target], REFEREE_DELAY, 2)
    this.actors.set('__referee__', actor)

    if (this.anthemReleaseAt !== null && actor.distToAnthem > 0) {
      const arrival = REFEREE_DELAY + actor.distToAnthem / this.walkSpeed
      this.anthemReleaseAt = Math.max(
        this.anthemReleaseAt,
        arrival + ANTHEM_HOLD_MIN_SEC,
        getIntroAnthemShotEnd() + 0.35,
      )
    }
  }

  private addRefereeHalfEnter(bounds: FieldBounds) {
    const refTarget = { x: bounds.center.x + 2.2, z: bounds.center.z - 2.4 }
    const refStart = {
      x: bounds.minX - TUNNEL_OFFSET * 0.85,
      z: bounds.center.z,
    }
    this.actors.set(
      '__referee__',
      this.createActor('__referee__', [refStart, refTarget], REFEREE_DELAY),
    )
  }

  private getActorTravel(actor: EntranceActor): number {
    if (this.elapsed < actor.delay) return 0

    const walkTime = this.elapsed - actor.delay
    let travel = walkTime * this.walkSpeed

    if (this.useIntroCinematic && this.anthemReleaseAt !== null && actor.distToAnthem > 0) {
      if (this.elapsed < this.anthemReleaseAt) {
        travel = Math.min(travel, actor.distToAnthem)
      } else {
        const postAnthemTime = this.elapsed - this.anthemReleaseAt
        travel = actor.distToAnthem + postAnthemTime * this.walkSpeed
      }
    }

    return Math.min(actor.totalLength, Math.max(0, travel))
  }

  private isAnthemHold(travel: number, actor: EntranceActor): boolean {
    if (!this.useIntroCinematic || this.anthemReleaseAt === null) return false
    return (
      travel >= actor.distToAnthem - 0.05 &&
      this.elapsed < this.anthemReleaseAt &&
      actor.distToAnthem > 0
    )
  }

  private samplePath(actor: EntranceActor, travel: number) {
    const { points, segmentLengths } = actor
    if (points.length === 0) {
      return { x: 0, z: 0, rotation: 0 }
    }
    if (points.length === 1 || travel <= 0) {
      return {
        x: points[0].x,
        z: points[0].z,
        rotation: this.segmentRotation(points[0], points[1] ?? points[0]),
      }
    }

    let remaining = travel
    for (let i = 0; i < segmentLengths.length; i++) {
      const segLen = segmentLengths[i]
      if (remaining <= segLen || i === segmentLengths.length - 1) {
        const t = segLen > 0 ? Math.min(1, remaining / segLen) : 1
        const a = points[i]
        const b = points[i + 1]
        return {
          x: a.x + (b.x - a.x) * t,
          z: a.z + (b.z - a.z) * t,
          rotation: this.segmentRotation(a, b),
        }
      }
      remaining -= segLen
    }

    const last = points[points.length - 1]
    const prev = points[points.length - 2]
    return {
      x: last.x,
      z: last.z,
      rotation: this.segmentRotation(prev, last),
    }
  }

  private segmentRotation(from: PathPoint, to: PathPoint) {
    const dx = to.x - from.x
    const dz = to.z - from.z
    if (Math.abs(dx) + Math.abs(dz) < 0.001) return 0
    return Math.atan2(dx, dz)
  }

  private allActorsDone() {
    for (const actor of this.actors.values()) {
      if (!actor.done) return false
    }
    return this.actors.size > 0
  }
}

export const entranceSystem = new TeamEntranceSystem()
