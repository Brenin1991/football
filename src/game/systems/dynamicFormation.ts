import type { BallPossession, PassIntent } from '../store/gameStore'
import { useGameStore } from '../store/gameStore'
import type { FieldBounds, FormationSlot, PlayerRole, TeamId, Vec3 } from '../types'
import { MARKER_SWITCH_MARGIN, STEAL_DISTANCE } from '../constants'
import { ballRef, playerRegistry } from './entityRegistry'
import { getBallAtFeet, scorePassInterceptPosition } from './possession'
import { distance2D } from './rules'
import { GOAL_MOUTH_BUFFER, clampForwardFromGoalMouth, getOffsideLineZ } from './offside'
import {
  getAttackingGoalZ,
  getAttackSign,
  getDefensiveGoalZ,
  isBallInDefensiveThird,
} from './teamField'

export type TeamPhase = 'attack' | 'defense' | 'neutral'

/** Progresso da bola: 0 = gol próprio, 1 = gol adversário */
function getBallProgress(ball: Vec3, team: TeamId, bounds: FieldBounds): number {
  const attackSign = getAttackSign(team, bounds)
  const defGoalZ = getDefensiveGoalZ(team, bounds)
  const pitchLen = bounds.maxZ - bounds.minZ
  return clamp((ball.z - defGoalZ) * attackSign / pitchLen, 0, 1)
}

function progressToZ(
  progress: number,
  team: TeamId,
  bounds: FieldBounds,
): number {
  const attackSign = getAttackSign(team, bounds)
  const defGoalZ = getDefensiveGoalZ(team, bounds)
  const pitchLen = bounds.maxZ - bounds.minZ
  return defGoalZ + attackSign * pitchLen * progress
}

/** Largura lateral a partir do slot — puxa mais o lado da bola (bloco assimétrico) */
function getFormationX(
  slot: FormationSlot,
  bounds: FieldBounds,
  ball: Vec3,
  lateralPull: number,
): number {
  const halfW = (bounds.maxX - bounds.minX) / 2 - 0.55
  const baseX = bounds.center.x + slot.x * halfW
  const ballSide = ball.x >= bounds.center.x ? 1 : -1
  const onBallSide = (slot.x >= 0 && ballSide > 0) || (slot.x <= 0 && ballSide < 0)
  const sideMul = onBallSide ? 1.22 : 0.72
  const pull = lateralPull * sideMul
  return clamp(
    baseX + (ball.x - baseX) * pull,
    bounds.minX + 0.8,
    bounds.maxX - 0.8,
  )
}

/** Escalonamento de profundidade dentro da mesma linha tática */
function getSlotDepthOffset(
  slot: FormationSlot,
  bounds: FieldBounds,
  team: TeamId,
): number {
  const attackSign = getAttackSign(team, bounds)
  const pitchLen = bounds.maxZ - bounds.minZ
  return attackSign * (slot.z - 0.55) * pitchLen * 0.12
}

function blendRoleWithSlot(
  roleLine: number,
  slot: FormationSlot,
  role: PlayerRole,
): number {
  const slotLine = getNeutralLineProgress(role, slot)
  return roleLine * 0.68 + slotLine * 0.32
}

/** Linha tática por função — ataque: bloco acompanha a bola, sem recuar demais */
function getAttackLineProgress(
  role: PlayerRole,
  ballProgress: number,
): number {
  const lines: Record<PlayerRole, number> = {
    gk: 0.07,
    def: Math.max(0.18, ballProgress - 0.08),
    mid: Math.max(0.32, ballProgress + 0.06),
    fwd: Math.min(0.88, ballProgress + 0.22),
  }
  return lines[role]
}

/** Linha tática por função — defesa: bloco entre bola e gol, sem perseguir ao ataque */
function getDefenseLineProgress(
  role: PlayerRole,
  ballProgress: number,
  ballInOwnThird: boolean,
): number {
  if (ballInOwnThird) {
    const lines: Record<PlayerRole, number> = {
      gk: 0.05,
      def: 0.1 + ballProgress * 0.12,
      mid: 0.16 + ballProgress * 0.14,
      fwd: 0.22 + ballProgress * 0.12,
    }
    return lines[role]
  }

  const lines: Record<PlayerRole, number> = {
    gk: 0.06,
    def: ballProgress * 0.38 + 0.08,
    mid: ballProgress * 0.48 + 0.12,
    fwd: ballProgress * 0.52 + 0.1,
  }
  return lines[role]
}

/** Posição neutra — formação equilibrada no meio-campo */
function getNeutralLineProgress(role: PlayerRole, slot: FormationSlot): number {
  const fromFormation = (1 - slot.z) * 0.5
  const roleBias: Record<PlayerRole, number> = {
    gk: -0.03,
    def: -0.06,
    mid: 0,
    fwd: 0.06,
  }
  return clamp(fromFormation + roleBias[role], 0.06, 0.58)
}

export function getTeamPhase(
  team: TeamId,
  possession: BallPossession | null,
  lastTouch: TeamId | null,
): TeamPhase {
  if (possession?.team === team) return 'attack'
  if (possession && possession.team !== team) return 'defense'
  if (lastTouch === team) return 'attack'
  if (lastTouch) return 'defense'
  return 'neutral'
}

export function predictBallPosition(
  ball: Vec3,
  velocity: Vec3,
  horizon = 0.45,
): Vec3 {
  return {
    x: ball.x + velocity.x * horizon,
    y: ball.y,
    z: ball.z + velocity.z * horizon,
  }
}

export function getDynamicPosition(
  team: TeamId,
  slot: FormationSlot,
  bounds: FieldBounds,
  ball: Vec3,
  possession: BallPossession | null,
  lastTouch: TeamId | null,
): { x: number; z: number } {
  const phase = getTeamPhase(team, possession, lastTouch)
  const ballProgress = getBallProgress(ball, team, bounds)
  const inOwnThird = isBallInDefensiveThird(ball, team, bounds)

  let lineProgress: number
  let lateralPull: number

  if (phase === 'attack') {
    lineProgress = blendRoleWithSlot(getAttackLineProgress(slot.role, ballProgress), slot, slot.role)
    lateralPull = slot.role === 'def' ? 0.22 : slot.role === 'mid' ? 0.3 : 0.38
  } else if (phase === 'defense') {
    lineProgress = blendRoleWithSlot(
      getDefenseLineProgress(slot.role, ballProgress, inOwnThird),
      slot,
      slot.role,
    )
    lateralPull =
      slot.role === 'def'
        ? inOwnThird
          ? 0.2
          : 0.14
        : slot.role === 'mid'
          ? inOwnThird
            ? 0.26
            : 0.18
          : inOwnThird
            ? 0.3
            : 0.22
  } else {
    lineProgress = getNeutralLineProgress(slot.role, slot)
    lateralPull = 0.2
  }

  return {
    x: getFormationX(slot, bounds, ball, lateralPull),
    z: progressToZ(lineProgress, team, bounds) + getSlotDepthOffset(slot, bounds, team),
  }
}

/** Apoio ofensivo — atacantes avançam, meias abrem, zagueiros seguram */
export function getSupportPosition(
  team: TeamId,
  slot: FormationSlot,
  bounds: FieldBounds,
  ball: Vec3,
  carrier: Vec3,
  playerId?: string,
): { x: number; z: number } {
  const attackSign = getAttackSign(team, bounds)
  const ballProgress = getBallProgress(ball, team, bounds)
  const atkGoalZ = getAttackingGoalZ(team, bounds)

  let lineProgress: number
  if (slot.role === 'fwd') {
    lineProgress = Math.min(0.86, ballProgress + 0.2)
  } else if (slot.role === 'mid') {
    lineProgress = Math.max(0.36, ballProgress + 0.12)
  } else if (slot.role === 'def') {
    lineProgress = Math.max(0.2, ballProgress - 0.06)
  } else {
    lineProgress = 0.07
  }

  const x = getFormationX(slot, bounds, carrier, slot.role === 'fwd' ? 0.42 : 0.32)
  let z = progressToZ(lineProgress, team, bounds)

  if (slot.role === 'fwd') {
    const maxZ = atkGoalZ - attackSign * GOAL_MOUTH_BUFFER
    let runZ = carrier.z + attackSign * 2.0

    if (playerId && isForwardMakingRun(playerId, team)) {
      const lineZ = getOffsideLineZ(team, bounds)
      const beyond = getForwardRunBeyondLine(team)
      const offsideRunZ = lineZ + attackSign * (0.35 + beyond)
      runZ =
        attackSign > 0
          ? Math.max(runZ, offsideRunZ)
          : Math.min(runZ, offsideRunZ)
    }

    z = attackSign > 0 ? Math.max(z, runZ) : Math.min(z, runZ)
    z = clamp(z, progressToZ(0.3, team, bounds), maxZ)
    z = clampForwardFromGoalMouth(team, z, bounds)
  }

  return { x, z }
}

/** Bola solta após passe do time — mantém altura ofensiva, não recua para formação */
export function getLooseBallAttackPosition(
  team: TeamId,
  slot: FormationSlot,
  bounds: FieldBounds,
  ball: Vec3,
  passIntent?: { targetX: number; targetZ: number } | null,
): { x: number; z: number } {
  const attackSign = getAttackSign(team, bounds)
  const anchor: Vec3 = passIntent
    ? {
        x: passIntent.targetX * 0.55 + ball.x * 0.45,
        y: ball.y,
        z: passIntent.targetZ * 0.6 + ball.z * 0.4,
      }
    : ball
  const ballProgress = Math.max(
    getBallProgress(ball, team, bounds),
    getBallProgress(anchor, team, bounds),
  )
  const lineProgress = getAttackLineProgress(slot.role, ballProgress)
  const lateralPull = slot.role === 'fwd' ? 0.4 : slot.role === 'mid' ? 0.34 : 0.24
  let z = progressToZ(lineProgress, team, bounds)

  if (slot.role === 'fwd') {
    const pushZ = anchor.z + attackSign * 1.6
    z = attackSign > 0 ? Math.max(z, pushZ) : Math.min(z, pushZ)
    z = clampForwardFromGoalMouth(team, z, bounds)
  } else if (slot.role === 'mid') {
    const pushZ = anchor.z + attackSign * 0.5
    z = attackSign > 0 ? Math.max(z, pushZ) : Math.min(z, pushZ)
  }

  return {
    x: getFormationX(slot, bounds, anchor, lateralPull),
    z,
  }
}

/** Apoio durante passe em voo — companheiros avançam para a zona do recebedor */
export function getPassFlightSupportPosition(
  team: TeamId,
  slot: FormationSlot,
  bounds: FieldBounds,
  passIntent: { targetX: number; targetZ: number },
): { x: number; z: number } {
  const attackSign = getAttackSign(team, bounds)
  const targetZ = passIntent.targetZ
  const targetX = passIntent.targetX
  const halfW = (bounds.maxX - bounds.minX) / 2 - 0.8
  const wideX = bounds.center.x + slot.x * halfW * 0.9

  if (slot.role === 'fwd') {
    const z = targetZ + attackSign * (1.4 + (1 - slot.z) * 1.2)
    return {
      x: clamp(wideX + (targetX - wideX) * 0.25, bounds.minX + 0.8, bounds.maxX - 0.8),
      z: clampForwardFromGoalMouth(team, z, bounds),
    }
  }

  if (slot.role === 'mid') {
    const z = targetZ + attackSign * (0.2 + Math.abs(slot.x) * 0.35)
    return {
      x: clamp(wideX, bounds.minX + 0.8, bounds.maxX - 0.8),
      z,
    }
  }

  if (slot.role === 'def') {
    const z = targetZ - attackSign * (2.8 + Math.abs(slot.x) * 0.4)
    return {
      x: clamp(wideX, bounds.minX + 0.8, bounds.maxX - 0.8),
      z,
    }
  }

  return getLooseBallAttackPosition(team, slot, bounds, { x: targetX, y: 0, z: targetZ }, passIntent)
}

/** Posição defensiva — bloco compacto com deslocamento lateral à bola */
export function getDefensiveShapePosition(
  team: TeamId,
  slot: FormationSlot,
  bounds: FieldBounds,
  ball: Vec3,
): { x: number; z: number } {
  const ballProgress = getBallProgress(ball, team, bounds)
  const inOwnThird = isBallInDefensiveThird(ball, team, bounds)
  const lineProgress = blendRoleWithSlot(
    getDefenseLineProgress(slot.role, ballProgress, inOwnThird),
    slot,
    slot.role,
  )
  const lateralPull =
    slot.role === 'def'
      ? inOwnThird
        ? 0.22
        : 0.16
      : slot.role === 'mid'
        ? inOwnThird
          ? 0.3
          : 0.22
        : inOwnThird
          ? 0.34
          : 0.26

  const base = {
    x: getFormationX(slot, bounds, ball, lateralPull),
    z: progressToZ(lineProgress, team, bounds) + getSlotDepthOffset(slot, bounds, team),
  }

  const compactPoint: Vec3 = {
    x: base.x + (ball.x - base.x) * 0.32,
    y: 0,
    z: base.z + (ball.z - base.z) * 0.12,
  }
  const w = getDefensiveCompactWeight(slot.role, ball, team, bounds)
  return getBlendedTarget(base, compactPoint, w)
}

/** Segundo homem na pressão — sombra entre formação e portador */
export function getCoverPressTarget(
  team: TeamId,
  slot: FormationSlot,
  bounds: FieldBounds,
  carrier: Vec3,
  shapeBase: { x: number; z: number },
): { x: number; z: number } {
  const goalDir = -getAttackSign(team, bounds)
  const shadow: Vec3 = {
    x: carrier.x * 0.38 + shapeBase.x * 0.62,
    y: 0,
    z: carrier.z + goalDir * (slot.role === 'mid' ? 2.1 : 1.55),
  }
  const w = slot.role === 'mid' ? 0.58 : slot.role === 'fwd' ? 0.48 : 0.4
  return getBlendedTarget(shapeBase, shadow, w)
}

export function getPressBallWeight(
  isMarker: boolean,
  phase: TeamPhase,
  distBall: number,
): number {
  if (!isMarker) return 0
  const base = 0.88
  const phaseBoost = phase === 'defense' ? 0.07 : phase === 'neutral' ? 0.04 : 0
  const closeBoost = distBall < 4 ? 0.05 : 0
  return clamp(base + phaseBoost + closeBoost, 0, 0.96)
}

export function getDefensiveCompactWeight(
  role: PlayerRole,
  ball: Vec3,
  team: TeamId,
  bounds: FieldBounds,
): number {
  const inOwn = isBallInDefensiveThird(ball, team, bounds)
  if (inOwn) {
    return role === 'def' ? 0.22 : role === 'mid' ? 0.18 : 0.12
  }
  return role === 'def' ? 0.14 : role === 'mid' ? 0.1 : 0.06
}

export function getBlendedTarget(
  formation: { x: number; z: number },
  ball: Vec3,
  ballWeight: number,
): { x: number; z: number } {
  const w = clamp(ballWeight, 0, 1)
  return {
    x: formation.x * (1 - w) + ball.x * w,
    z: formation.z * (1 - w) + ball.z * w,
  }
}

export function getDynamicGKPosition(
  team: TeamId,
  slot: FormationSlot,
  bounds: FieldBounds,
  ball: Vec3,
  possession: BallPossession | null,
  lastTouch: TeamId | null,
): { x: number; z: number } {
  const phase = getTeamPhase(team, possession, lastTouch)
  const inOwnThird = isBallInDefensiveThird(ball, team, bounds)
  const distToGoal = Math.abs(ball.z - getDefensiveGoalZ(team, bounds))
  const lateralPull =
    phase === 'defense' && inOwnThird ? 0.62 : inOwnThird ? 0.48 : 0.38
  const x = getFormationX(slot, bounds, ball, lateralPull)

  let depth = 0.09
  if (phase === 'attack') {
    depth = 0.12
  } else if (phase === 'defense') {
    if (inOwnThird) {
      if (distToGoal < 8) depth = 0.14
      else if (distToGoal < 14) depth = 0.1
      else if (distToGoal < 22) depth = 0.075
      else depth = 0.085
    } else {
      depth = 0.1
    }
  }
  if (possession?.team === team) depth = 0.13

  const halfW = bounds.goalWidth / 2
  const clampedX = clamp(x, bounds.center.x - halfW * 0.95, bounds.center.x + halfW * 0.95)

  return {
    x: clampedX,
    z: progressToZ(depth, team, bounds),
  }
}

export function getCarrierTarget(
  team: TeamId,
  slot: FormationSlot,
  bounds: FieldBounds,
  ball: Vec3,
): { x: number; z: number } {
  const attackSign = getAttackSign(team, bounds)
  const atkGoalZ = getAttackingGoalZ(team, bounds)
  const halfW = (bounds.maxX - bounds.minX) / 2 - 0.8
  const baseX = bounds.center.x + slot.x * halfW * 0.85

  const push = slot.role === 'fwd' ? 2.2 : slot.role === 'mid' ? 1.8 : 1.2
  let z = ball.z + attackSign * push
  const minFromGoal = slot.role === 'fwd' ? GOAL_MOUTH_BUFFER : 2.2
  z = attackSign > 0 ? Math.min(z, atkGoalZ - minFromGoal) : Math.max(z, atkGoalZ + minFromGoal)

  return {
    x: clamp(baseX + (ball.x - baseX) * 0.12, bounds.minX + 0.8, bounds.maxX - 0.8),
    z,
  }
}

export function getMarkingPoint(
  possession: BallPossession | null,
  ball: Vec3,
): Vec3 {
  if (possession) {
    const carrier = playerRegistry.get(possession.playerId)
    if (carrier) return carrier.position
  }
  return ball
}

/** Alvo de pressão 1:1 — cola na bola no pé do portador para disputar */
export function getTackleTarget(
  possession: BallPossession,
  defendingTeam: TeamId,
  bounds: FieldBounds,
  ball?: Vec3,
): { x: number; z: number } {
  const carrier = playerRegistry.get(possession.playerId)
  if (!carrier) {
    const fallback = ball ?? { x: bounds.center.x, y: 0, z: bounds.center.z }
    return { x: fallback.x, z: fallback.z }
  }

  const foot = getBallAtFeet(carrier)
  const goalDir = -getAttackSign(defendingTeam, bounds)

  return {
    x: foot.x,
    z: foot.z + goalDir * STEAL_DISTANCE * 0.25,
  }
}

/** Ponto de marcação em bola solta */
export function getMarkerTarget(
  _team: TeamId,
  _bounds: FieldBounds,
  markPoint: Vec3,
): { x: number; z: number } {
  return {
    x: markPoint.x,
    z: markPoint.z,
  }
}

const activeMarker: Record<TeamId, string | null> = { home: null, away: null }
let lastPossessionKey = ''
let markerCacheFrame = -1
const markerByTeam: Record<TeamId, string | null> = { home: null, away: null }
const coverPresserByTeam: Record<TeamId, string | null> = { home: null, away: null }
const passLaneBlockerByTeam: Record<TeamId, string | null> = { home: null, away: null }
const passInterceptorByTeam: Record<TeamId, string | null> = { home: null, away: null }
const passInterceptorSecondaryByTeam: Record<TeamId, string | null> = { home: null, away: null }

type ForwardRunState = {
  runnerId: string | null
  until: number
  beyondLine: number
  possessionKey: string
}

const forwardRunByTeam: Record<TeamId, ForwardRunState> = {
  home: { runnerId: null, until: 0, beyondLine: 0, possessionKey: '' },
  away: { runnerId: null, until: 0, beyondLine: 0, possessionKey: '' },
}
const lastRunRollBucket: Record<TeamId, number> = { home: -1, away: -1 }

const RUN_WINDOW_MS = 5200
const RUN_DURATION_BASE_MS = 2600
const RUN_CHANCE = 0.38

function pseudoRandom(team: TeamId, bucket: number, salt: number): number {
  const s = `${team}:${bucket}:${salt}`
  let h = 0
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0
  return (Math.abs(h) % 997) / 997
}

function refreshForwardRuns(
  possession: BallPossession | null,
  ball: Vec3,
  bounds: FieldBounds,
) {
  const now = performance.now()
  const store = useGameStore.getState()
  if (store.phase !== 'playing' || store.ballFrozen) {
    for (const team of ['home', 'away'] as TeamId[]) {
      forwardRunByTeam[team].runnerId = null
    }
    return
  }

  const key = possessionKey(possession)
  const bucket = Math.floor(now / RUN_WINDOW_MS)

  for (const team of ['home', 'away'] as TeamId[]) {
    const state = forwardRunByTeam[team]

    if (
      state.runnerId &&
      now < state.until &&
      state.possessionKey === key
    ) {
      const runner = playerRegistry.get(state.runnerId)
      if (!runner || runner.team !== team || runner.role !== 'fwd') {
        state.runnerId = null
      }
      continue
    }

    state.runnerId = null

    if (!possession || possession.team !== team) continue

    const ballProgress = getBallProgress(ball, team, bounds)
    if (ballProgress < 0.4) continue

    const forwards = [...playerRegistry.values()]
      .filter((p) => p.team === team && p.role === 'fwd')
      .sort((a, b) => a.id.localeCompare(b.id))
    if (forwards.length === 0) continue

    if (lastRunRollBucket[team] === bucket) continue
    lastRunRollBucket[team] = bucket

    if (pseudoRandom(team, bucket, 1) > RUN_CHANCE) continue

    const pickIdx = Math.floor(pseudoRandom(team, bucket, 2) * forwards.length)
    const runner = forwards[pickIdx]

    state.runnerId = runner.id
    state.until = now + RUN_DURATION_BASE_MS + pseudoRandom(team, bucket, 3) * 1400
    state.beyondLine = 0.65 + pseudoRandom(team, bucket, 4) * 1.05
    state.possessionKey = key
  }
}

export function isForwardMakingRun(playerId: string, team: TeamId): boolean {
  const state = forwardRunByTeam[team]
  return state.runnerId === playerId && performance.now() < state.until
}

function getForwardRunBeyondLine(team: TeamId): number {
  return forwardRunByTeam[team].beyondLine
}

export function resetTeamMarkers() {
  activeMarker.home = null
  activeMarker.away = null
  lastPossessionKey = ''
  markerCacheFrame = -1
  markerByTeam.home = null
  markerByTeam.away = null
  coverPresserByTeam.home = null
  coverPresserByTeam.away = null
  passLaneBlockerByTeam.home = null
  passLaneBlockerByTeam.away = null
  passInterceptorByTeam.home = null
  passInterceptorByTeam.away = null
  passInterceptorSecondaryByTeam.home = null
  passInterceptorSecondaryByTeam.away = null
  forwardRunByTeam.home = { runnerId: null, until: 0, beyondLine: 0, possessionKey: '' }
  forwardRunByTeam.away = { runnerId: null, until: 0, beyondLine: 0, possessionKey: '' }
  lastRunRollBucket.home = -1
  lastRunRollBucket.away = -1
}

function possessionKey(possession: BallPossession | null): string {
  return possession ? `${possession.team}:${possession.playerId}` : 'loose'
}

/** Ponto de disputa — bola no pé do portador ou posição da bola solta */
function getContestPoint(
  possession: BallPossession | null,
  ball: Vec3,
): Vec3 {
  if (possession) {
    const carrier = playerRegistry.get(possession.playerId)
    if (carrier) return getBallAtFeet(carrier)
  }
  return ball
}

function findClosestMarkerCandidate(
  team: TeamId,
  contestPoint: Vec3,
): { id: string | null; dist: number } {
  let bestId: string | null = null
  let minDist = Infinity

  for (const p of playerRegistry.values()) {
    if (p.team !== team || p.role === 'gk') continue
    const d = distance2D(p.position, contestPoint)
    if (d < minDist) {
      minDist = d
      bestId = p.id
    }
  }

  return { id: bestId, dist: minDist }
}

export function resolveTeamMarker(
  team: TeamId,
  possession: BallPossession | null,
  ball: Vec3,
): string | null {
  const store = useGameStore.getState()
  if (store.ballFrozen) return null
  if (
    store.phase === 'throw-in' ||
    store.phase === 'corner' ||
    store.phase === 'goal-kick'
  ) {
    return null
  }
  if (store.setPieceGuardPos && performance.now() < store.setPieceGuardUntil) {
    if (!store.passIntent && distance2D(ball, store.setPieceGuardPos) < 5) return null
  }

  const key = possessionKey(possession)
  const possessionChanged = key !== lastPossessionKey
  if (possessionChanged) {
    activeMarker.home = null
    activeMarker.away = null
    lastPossessionKey = key
  }

  const contestPoint = getContestPoint(possession, ball)
  const { id: closestId, dist: closestDist } = findClosestMarkerCandidate(
    team,
    contestPoint,
  )

  if (!closestId) {
    activeMarker[team] = null
    return null
  }

  const current = activeMarker[team]
  if (!possessionChanged && current && current !== closestId) {
    const currentP = playerRegistry.get(current)
    if (currentP && currentP.team === team && currentP.role !== 'gk') {
      const currentDist = distance2D(currentP.position, contestPoint)
      if (closestDist > currentDist - MARKER_SWITCH_MARGIN) {
        return current
      }
    }
  }

  activeMarker[team] = closestId
  return closestId
}

function resolveCoverPresser(
  team: TeamId,
  possession: BallPossession | null,
  ball: Vec3,
  primaryMarker: string | null,
): string | null {
  if (!possession || possession.team === team || !primaryMarker) return null
  const contest = getContestPoint(possession, ball)
  const ranked = [...playerRegistry.values()]
    .filter((p) => p.team === team && p.role !== 'gk')
    .map((p) => ({ id: p.id, dist: distance2D(p.position, contest), role: p.role }))
    .sort((a, b) => a.dist - b.dist)

  if (ranked.length < 2) return null
  const second = ranked.find((c) => c.id !== primaryMarker) ?? ranked[1]
  if (!second || second.dist > 15.5) return null
  if (second.role === 'fwd' && second.dist > 11) return null
  return second.id
}

function resolvePassLaneBlocker(
  team: TeamId,
  possession: BallPossession | null,
): string | null {
  if (!possession || possession.team === team) return null
  const marker = markerByTeam[team]
  const carrier = playerRegistry.get(possession.playerId)
  if (!carrier) return null

  let bestId: string | null = null
  let bestDist = Infinity

  for (const p of playerRegistry.values()) {
    if (p.team !== team || p.role !== 'mid' || p.id === marker) continue
    const d = distance2D(p.position, carrier.position)
    if (d < bestDist) {
      bestDist = d
      bestId = p.id
    }
  }

  return bestId
}

function resolvePassInterceptors(
  team: TeamId,
  passIntent: PassIntent | null,
  ball: Vec3,
): void {
  passInterceptorByTeam[team] = null
  passInterceptorSecondaryByTeam[team] = null
  if (!passIntent) return

  const store = useGameStore.getState()
  if (store.ballPossession || store.lastTouchTeam === team) return

  const vel = ballRef.velocity
  const candidates = [...playerRegistry.values()]
    .filter((p) => p.team === team && p.role !== 'gk')
    .map((p) => ({
      id: p.id,
      score: scorePassInterceptPosition(p, ball, vel, passIntent),
    }))
    .filter((c) => c.score > -1.5)
    .sort((a, b) => b.score - a.score)

  if (candidates.length > 0) passInterceptorByTeam[team] = candidates[0].id
  if (candidates.length > 1 && candidates[1].score > candidates[0].score - 1.8) {
    passInterceptorSecondaryByTeam[team] = candidates[1].id
  }
}

export function refreshMarkerCache(
  frame: number,
  possession: BallPossession | null,
  ball: Vec3,
) {
  if (frame === markerCacheFrame) return
  markerCacheFrame = frame
  markerByTeam.home = resolveTeamMarker('home', possession, ball)
  markerByTeam.away = resolveTeamMarker('away', possession, ball)
  coverPresserByTeam.home = resolveCoverPresser(
    'home',
    possession,
    ball,
    markerByTeam.home,
  )
  coverPresserByTeam.away = resolveCoverPresser(
    'away',
    possession,
    ball,
    markerByTeam.away,
  )
  passLaneBlockerByTeam.home = resolvePassLaneBlocker('home', possession)
  passLaneBlockerByTeam.away = resolvePassLaneBlocker('away', possession)

  const passIntent = useGameStore.getState().passIntent
  resolvePassInterceptors('home', passIntent, ball)
  resolvePassInterceptors('away', passIntent, ball)

  const bounds = useGameStore.getState().fieldBounds
  if (bounds) refreshForwardRuns(possession, ball, bounds)
}

export function resolveLooseBallChaser(
  team: TeamId,
  ball: Vec3,
): string | null {
  const store = useGameStore.getState()
  if (store.ballPossession || store.ballFrozen) return null
  if (store.passIntent) return null
  if (
    store.phase === 'throw-in' ||
    store.phase === 'corner' ||
    store.phase === 'goal-kick'
  ) {
    return null
  }
  if (store.setPieceGuardPos && performance.now() < store.setPieceGuardUntil) {
    if (distance2D(ball, store.setPieceGuardPos) < 5) return null
  }

  return findClosestMarkerCandidate(team, ball).id
}

export function getCachedTeamMarker(team: TeamId): string | null {
  return markerByTeam[team]
}

export function isTeamMarker(
  playerId: string,
  team: TeamId,
  _possession: BallPossession | null,
  _ball: Vec3,
): boolean {
  return markerByTeam[team] === playerId
}

export function isPassLaneBlocker(playerId: string, team: TeamId): boolean {
  return passLaneBlockerByTeam[team] === playerId
}

export function isPassInterceptor(playerId: string, team: TeamId): boolean {
  return (
    passInterceptorByTeam[team] === playerId ||
    passInterceptorSecondaryByTeam[team] === playerId
  )
}

export function isPrimaryPassInterceptor(playerId: string, team: TeamId): boolean {
  return passInterceptorByTeam[team] === playerId
}

export function isCoverPresser(playerId: string, team: TeamId): boolean {
  return coverPresserByTeam[team] === playerId
}

export function getRoleArriveDist(
  role: PlayerRole,
  defending: boolean,
  isMarker: boolean,
): number {
  if (isMarker) return 0.16
  if (!defending) return 0.12
  if (role === 'def') return 0.22
  if (role === 'mid') return 0.18
  if (role === 'fwd') return 0.15
  return 0.2
}

function playerFloatSeed(playerId: string): number {
  let h = 0
  for (let i = 0; i < playerId.length; i++) h = ((h << 5) - h + playerId.charCodeAt(i)) | 0
  return (Math.abs(h) % 997) / 997
}

export function applyPlayerSlotBias(
  playerId: string,
  slot: FormationSlot,
  bounds: FieldBounds,
  _team: TeamId,
  target: { x: number; z: number },
): { x: number; z: number } {
  const h = playerFloatSeed(playerId)
  const halfW = (bounds.maxX - bounds.minX) / 2
  const roleSpread = slot.role === 'def' ? 0.55 : slot.role === 'mid' ? 0.75 : 1
  const lateral = (h - 0.5) * halfW * 0.065 * roleSpread
  return {
    x: clamp(target.x + lateral, bounds.minX + 0.8, bounds.maxX - 0.8),
    z: target.z,
  }
}

/** Micro-flutuação só quando já parado no slot — alvo oscilante durante corrida causa tremor */
export function applyTacticalFloat(
  playerId: string,
  target: { x: number; z: number },
  dist: number,
  maxFloat = 0.55,
): { x: number; z: number } {
  if (dist > maxFloat) return target
  const t = performance.now() * 0.001
  const h = playerFloatSeed(playerId)
  const fade = 1 - dist / maxFloat
  const amp = fade * 0.28
  return {
    x: target.x + Math.sin(t * 0.9 + h * 6.28) * amp,
    z: target.z + Math.cos(t * 0.7 + h * 12.56) * amp * 0.72,
  }
}

export function getPresserRank(
  playerId: string,
  team: TeamId,
  possession: BallPossession | null,
  ball: Vec3,
): number {
  const marker = resolveTeamMarker(team, possession, ball)
  if (!marker) return -1
  return marker === playerId ? 0 : 1
}

export function shouldPressBall(
  playerId: string,
  team: TeamId,
  role: PlayerRole,
  possession: BallPossession | null,
  ball: Vec3,
): boolean {
  if (role === 'gk') return false
  return isTeamMarker(playerId, team, possession, ball)
}

export function smoothToward(
  current: { x: number; z: number },
  target: { x: number; z: number },
  delta: number,
  smoothness = 1.8,
): { x: number; z: number } {
  const t = 1 - Math.exp(-smoothness * delta)
  return {
    x: current.x + (target.x - current.x) * t,
    z: current.z + (target.z - current.z) * t,
  }
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v))
}
