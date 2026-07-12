import { getGoalkeeperId, SHOT_SPEED, WORLD_SCALE } from '../constants'
import { useGameStore } from '../store/gameStore'
import type { FieldBounds, FormationSlot, MatchPhase, TeamId, Vec3 } from '../types'
import { playerRegistry } from './entityRegistry'
import { applyBallVelocity, ensureBallDynamic, markSetPieceLaunch } from './ballPhysics'
import { resetTeamMarkers } from './dynamicFormation'
import { distance2D, normalize2D } from './rules'
import { setPieceSpeedMul, shotLoftFromPower, shotSpeedFromPower } from './shotPower'
import { sfx } from './sfx'
import { clampZForSetPiece, clampForwardFromGoalMouth } from './offside'
import {
  directionToCenter,
  getAttackingGoalZ,
  getAttackSign,
  getDefensiveGoalZ,
  getFieldFacingRotation,
  getFormationSpawn,
  PENALTY_BOX_DEPTH,
} from './teamField'

const GK_FORMATION_SLOT: FormationSlot = { x: 0, z: 0.93, role: 'gk' }

/** Velocidade horizontal (m/s) e impulso vertical (m/s) */
const SET_PIECE_KICK = {
  'throw-in': { speed: 7.2 * WORLD_SCALE, vy: 8.2 * WORLD_SCALE },
  corner: { speed: 8.2 * WORLD_SCALE, vy: 9.8 * WORLD_SCALE },
  'goal-kick': { speed: 7.0 * WORLD_SCALE, vy: 7.5 * WORLD_SCALE },
  'free-kick': { speed: 9.4 * WORLD_SCALE, vy: 4.2 * WORLD_SCALE },
  penalty: { speed: SHOT_SPEED, vy: 2.8 * WORLD_SCALE },
} as const

export function isActiveSetPiecePhase(phase: MatchPhase | string): boolean {
  return (
    phase === 'throw-in' ||
    phase === 'corner' ||
    phase === 'goal-kick' ||
    phase === 'free-kick' ||
    phase === 'penalty'
  )
}

const SET_PIECE_KICKER_CLAIM_BLOCK_MS = 3200
export function pickSetPieceKicker(
  team: TeamId,
  position: Vec3,
  phase?: MatchPhase,
): string | null {
  if (phase === 'goal-kick') return getGoalkeeperId(team)
  if (phase === 'penalty') return pickPenaltyKicker(team)
  let best: string | null = null
  let min = Infinity
  for (const p of playerRegistry.values()) {
    if (p.team !== team) continue
    if (p.role === 'gk') continue
    const d = distance2D(p.position, position)
    if (d < min) {
      min = d
      best = p.id
    }
  }
  return best
}

function pickPenaltyKicker(team: TeamId): string | null {
  let best: string | null = null
  let bestScore = -Infinity
  for (const p of playerRegistry.values()) {
    if (p.team !== team || p.role === 'gk') continue
    const roleScore = p.role === 'fwd' ? 3 : p.role === 'mid' ? 2 : 1
    if (roleScore > bestScore) {
      bestScore = roleScore
      best = p.id
    }
  }
  return best
}

/** Companheiros na direção da mira para correrem à bola após lateral/escanteio */
export function pickSetPieceReceivers(
  team: TeamId,
  ballSpot: Vec3,
  aimAngle: number,
  kickerId: string,
): { receiverId: string | null; runnerIds: string[] } {
  const fx = Math.sin(aimAngle)
  const fz = Math.cos(aimAngle)

  const scored: { id: string; score: number }[] = []

  for (const p of playerRegistry.values()) {
    if (p.team !== team || p.id === kickerId || p.role === 'gk') continue

    const dx = p.position.x - ballSpot.x
    const dz = p.position.z - ballSpot.z
    const dist = Math.hypot(dx, dz)
    if (dist < 1.2 || dist > 26) continue

    const forward = dx * fx + dz * fz
    if (forward < 1.5) continue

    const dot = forward / dist
    if (dot < 0.5) continue

    const lateral = Math.abs(dx * fz - dz * fx)
    if (lateral > forward * 0.65 && lateral > 2) continue

    scored.push({ id: p.id, score: dot * 3 - dist * 0.04 })
  }

  scored.sort((a, b) => b.score - a.score)
  const receiverId = scored[0]?.id ?? null
  const runnerIds = scored.slice(0, 4).map((s) => s.id)

  return { receiverId, runnerIds }
}

/** Cobrador fica ATRÁS da bola, na direção oposta à mira */
export function getKickerStandPosition(
  phase: MatchPhase,
  ballSpot: Vec3,
  _bounds: FieldBounds,
  aimAngle: number,
): { x: number; z: number } {
  const behind = phase === 'goal-kick' ? 0.78 : phase === 'penalty' ? 0.62 : 0.68
  return {
    x: ballSpot.x - Math.sin(aimAngle) * behind,
    z: ballSpot.z - Math.cos(aimAngle) * behind,
  }
}

const THROW_IN_MIN_BALL_DIST = 3.2

/** Posição tática na lateral — formação espalhada no campo, viés só perto da bola */
function getThrowInFormationSpot(
  team: TeamId,
  slot: FormationSlot,
  bounds: FieldBounds,
  ballSpot: Vec3,
  isKickingTeam: boolean,
): { x: number; z: number } {
  const spawn = getFormationSpawn(team, slot, bounds)
  const intoField = ballSpot.x <= bounds.center.x ? 1 : -1
  const sidelineX = intoField > 0 ? bounds.minX + 1.05 : bounds.maxX - 1.05

  const pitchHalf = (bounds.maxZ - bounds.minZ) / 2
  const zDist = Math.abs(spawn.z - ballSpot.z)
  const proximity = 1 - Math.min(1, zDist / (pitchHalf * 0.92))

  const zBias = isKickingTeam ? 0.12 + proximity * 0.42 : 0.08 + proximity * 0.22
  const targetZ = spawn.z + (ballSpot.z - spawn.z) * zBias

  const touchPullByRole: Record<FormationSlot['role'], number> = isKickingTeam
    ? { gk: 0, def: 0.1, mid: 0.24, fwd: 0.06 }
    : { gk: 0, def: 0.05, mid: 0.09, fwd: 0.04 }
  const touchPull = touchPullByRole[slot.role] * (0.3 + proximity * 0.7)
  const targetX = spawn.x + (sidelineX - spawn.x) * touchPull

  return {
    x: clamp(targetX, bounds.minX + 1.1, bounds.maxX - 1.1),
    z: clamp(targetZ, bounds.minZ + 1.2, bounds.maxZ - 1.2),
  }
}
const FREE_KICK_MIN_BALL_DIST = 2.5
/** ~9,15 m proporcional ao campo (comprimento ~28,5 u) */
const WALL_DISTANCE = 2.48
const DANGEROUS_FK_GOAL_DIST = 7.8

const DEF_SLOT_X = [-0.78, -0.28, 0.28, 0.78] as const
const WALL_LATERAL = [-0.58, -0.2, 0.2, 0.58] as const

function zFromBallTowardGoal(ballZ: number, fz: number, dist: number): number {
  return ballZ + fz * dist
}

function zFromBallTowardCenter(ballZ: number, centerZ: number, dist: number): number {
  const sign = centerZ >= ballZ ? 1 : -1
  return ballZ + sign * dist
}

function distToAttackingGoal(ballSpot: Vec3, kickingTeam: TeamId, bounds: FieldBounds): number {
  return Math.abs(getAttackingGoalZ(kickingTeam, bounds) - ballSpot.z)
}

function getWallSpot(
  ballSpot: Vec3,
  fx: number,
  fz: number,
  wallIndex: number,
): { x: number; z: number } {
  const px = -fz
  const pz = fx
  const lat = WALL_LATERAL[wallIndex] ?? 0
  return {
    x: ballSpot.x + fx * WALL_DISTANCE + px * lat,
    z: ballSpot.z + fz * WALL_DISTANCE + pz * lat,
  }
}

function getDefWallIndex(slot: FormationSlot): number {
  if (slot.role !== 'def') return -1
  const idx = DEF_SLOT_X.findIndex((x) => Math.abs(x - slot.x) < 0.12)
  return idx
}

function getFreeKickSetupTarget(
  team: TeamId,
  slot: FormationSlot,
  bounds: FieldBounds,
  kickingTeam: TeamId,
  ballSpot: Vec3,
  playerId: string,
  kickerId: string | null,
  aimAngle: number,
): { x: number; z: number } {
  if (isSetPieceGoalkeeper(playerId, team, slot, 'free-kick', kickerId)) {
    return getGoalkeeperSetPieceSpot(team, bounds)
  }

  if (playerId === kickerId) {
    return getKickerStandPosition('free-kick', ballSpot, bounds, aimAngle)
  }

  const fx = Math.sin(aimAngle)
  const fz = Math.cos(aimAngle)
  const px = -fz
  const nearGoal = distToAttackingGoal(ballSpot, kickingTeam, bounds) < DANGEROUS_FK_GOAL_DIST
  const wallBackZ = zFromBallTowardGoal(ballSpot.z, fz, WALL_DISTANCE + 1.3)

  if (team !== kickingTeam) {
    const wallIdx = getDefWallIndex(slot)

    if (slot.role === 'def' && wallIdx >= 0) {
      if (nearGoal) {
        return pushMinDistanceFromBall(
          ballSpot,
          getWallSpot(ballSpot, fx, fz, wallIdx),
          FREE_KICK_MIN_BALL_DIST,
        )
      }
      if (wallIdx === 1 || wallIdx === 2) {
        const compactIdx = wallIdx === 1 ? 1 : 2
        return pushMinDistanceFromBall(
          ballSpot,
          getWallSpot(ballSpot, fx, fz, compactIdx),
          FREE_KICK_MIN_BALL_DIST,
        )
      }
    }

    if (nearGoal) {
      if (slot.role === 'def') {
        return pushMinDistanceFromBall(
          ballSpot,
          {
            x: clamp(bounds.center.x + slot.x * 2.4, bounds.minX + 1.2, bounds.maxX - 1.2),
            z: wallBackZ,
          },
          FREE_KICK_MIN_BALL_DIST,
        )
      }

      if (slot.role === 'mid') {
        return pushMinDistanceFromBall(
          ballSpot,
          {
            x: clamp(ballSpot.x + px * (2.6 + slot.x * 1.4), bounds.minX + 1.2, bounds.maxX - 1.2),
            z: zFromBallTowardGoal(ballSpot.z, fz, WALL_DISTANCE + 0.35),
          },
          FREE_KICK_MIN_BALL_DIST,
        )
      }

      return pushMinDistanceFromBall(
        ballSpot,
        {
          x: clamp(bounds.center.x + slot.x * 3.6, bounds.minX + 1.2, bounds.maxX - 1.2),
          z: zFromBallTowardCenter(ballSpot.z, bounds.center.z, 3.8),
        },
        FREE_KICK_MIN_BALL_DIST,
      )
    }

    const spawn = getFormationSpawn(team, slot, bounds)
    return pushMinDistanceFromBall(
      ballSpot,
      {
        x: spawn.x + (ballSpot.x - spawn.x) * 0.18,
        z: spawn.z + (ballSpot.z - spawn.z) * 0.22,
      },
      FREE_KICK_MIN_BALL_DIST,
    )
  }

  const spawn = getFormationSpawn(team, slot, bounds)
  const fkZ = (z: number) => clampZForSetPiece(kickingTeam, z, bounds, ballSpot.z)

  if (slot.role === 'fwd') {
    const lateral = slot.x < 0 ? -2.6 : 2.6
    let z = fkZ(ballSpot.z + fz * (nearGoal ? 2.2 : 3.0))
    z = clampForwardFromGoalMouth(kickingTeam, z, bounds)
    return pushMinDistanceFromBall(
      ballSpot,
      {
        x: clamp(ballSpot.x + px * lateral, bounds.minX + 1.2, bounds.maxX - 1.2),
        z,
      },
      FREE_KICK_MIN_BALL_DIST,
    )
  }

  if (slot.role === 'mid') {
    const wide = slot.x * 3.2
    let z = fkZ(ballSpot.z + fz * (nearGoal ? 1.6 : 2.4))
    return pushMinDistanceFromBall(
      ballSpot,
      {
        x: clamp(ballSpot.x + px * wide, bounds.minX + 1.2, bounds.maxX - 1.2),
        z,
      },
      FREE_KICK_MIN_BALL_DIST,
    )
  }

  return pushMinDistanceFromBall(
    ballSpot,
    {
      x: spawn.x,
      z: fkZ(zFromBallTowardCenter(ballSpot.z, bounds.center.z, nearGoal ? 5.0 : 7.0)),
    },
    FREE_KICK_MIN_BALL_DIST,
  )
}

const CORNER_MIN_BALL_DIST = 6.5

function pushMinDistanceFromBall(
  ball: { x: number; z: number },
  target: { x: number; z: number },
  minDist: number,
): { x: number; z: number } {
  const dx = target.x - ball.x
  const dz = target.z - ball.z
  const d = Math.hypot(dx, dz)
  if (d >= minDist) return target
  if (d < 0.001) return { x: ball.x + minDist, z: ball.z }
  const s = minDist / d
  return { x: ball.x + dx * s, z: ball.z + dz * s }
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v))
}

function getGoalkeeperSetPieceSpot(team: TeamId, bounds: FieldBounds): { x: number; z: number } {
  const spawn = getFormationSpawn(team, GK_FORMATION_SLOT, bounds)
  return { x: spawn.x, z: spawn.z }
}

function isSetPieceGoalkeeper(
  playerId: string,
  team: TeamId,
  slot: FormationSlot,
  phase: MatchPhase,
  kickerId: string | null,
): boolean {
  if (phase === 'goal-kick' && playerId === kickerId) return false
  return slot.role === 'gk' || playerId === getGoalkeeperId(team)
}

export function getThrowInSetupTarget(
  team: TeamId,
  slot: FormationSlot,
  bounds: FieldBounds,
  kickingTeam: TeamId,
  ballSpot: Vec3,
  playerId: string,
  kickerId: string | null,
  aimAngle: number,
): { x: number; z: number } {
  if (isSetPieceGoalkeeper(playerId, team, slot, 'throw-in', kickerId)) {
    return getGoalkeeperSetPieceSpot(team, bounds)
  }

  if (playerId === kickerId) {
    return getKickerStandPosition('throw-in', ballSpot, bounds, aimAngle)
  }

  const raw = getThrowInFormationSpot(
    team,
    slot,
    bounds,
    ballSpot,
    team === kickingTeam,
  )
  return pushMinDistanceFromBall(ballSpot, raw, THROW_IN_MIN_BALL_DIST)
}

export function getCornerSetupTarget(
  team: TeamId,
  slot: FormationSlot,
  bounds: FieldBounds,
  kickingTeam: TeamId,
  ballSpot: Vec3,
  playerId: string,
  kickerId: string | null,
  aimAngle: number,
): { x: number; z: number } {
  if (isSetPieceGoalkeeper(playerId, team, slot, 'corner', kickerId)) {
    return getGoalkeeperSetPieceSpot(team, bounds)
  }

  if (playerId === kickerId) {
    return getKickerStandPosition('corner', ballSpot, bounds, aimAngle)
  }

  const goalZ = getAttackingGoalZ(kickingTeam, bounds)
  const intoField = goalZ > bounds.center.z ? -1 : 1
  const boxNearZ = goalZ + intoField * 0.45
  const boxFarZ = goalZ + intoField * 5.4
  const boxMinZ = Math.min(boxNearZ, boxFarZ)
  const boxMaxZ = Math.max(boxNearZ, boxFarZ)
  const penaltySpotZ = goalZ + intoField * 3.6
  const boxHalfW = 4.5

  const xSpread = bounds.center.x + slot.x * 3.2
  const zSpread = penaltySpotZ - intoField * slot.z * 1.4

  const raw = {
    x: clamp(xSpread, bounds.center.x - boxHalfW, bounds.center.x + boxHalfW),
    z: clamp(zSpread, boxMinZ + 0.5, boxMaxZ - 0.5),
  }
  return pushMinDistanceFromBall(ballSpot, raw, CORNER_MIN_BALL_DIST)
}

function getPenaltySetupTarget(
  team: TeamId,
  slot: FormationSlot,
  bounds: FieldBounds,
  kickingTeam: TeamId,
  ballSpot: Vec3,
  playerId: string,
  kickerId: string | null,
  aimAngle: number,
): { x: number; z: number } {
  const defendingTeam = kickingTeam === 'home' ? 'away' : 'home'
  const goalZ = getAttackingGoalZ(kickingTeam, bounds)
  const intoField = getAttackSign(kickingTeam, bounds)
  const boxFarZ = goalZ + intoField * PENALTY_BOX_DEPTH

  if (playerId === getGoalkeeperId(defendingTeam)) {
    return { x: bounds.center.x, z: goalZ + intoField * 0.32 }
  }

  if (playerId === kickerId) {
    return getKickerStandPosition('penalty', ballSpot, bounds, aimAngle)
  }

  if (team === kickingTeam) {
    const waitZ = boxFarZ + intoField * (2.2 + slot.z * 1.1)
    return {
      x: clamp(bounds.center.x + slot.x * 3.2, bounds.minX + 1.2, bounds.maxX - 1.2),
      z: waitZ,
    }
  }

  const arcZ = boxFarZ + intoField * (0.85 + slot.z * 0.45)
  return {
    x: clamp(bounds.center.x + slot.x * 5.2, bounds.minX + 1.2, bounds.maxX - 1.2),
    z: arcZ,
  }
}

export function getSetPiecePlayerSpot(
  playerId: string,
  team: TeamId,
  slot: FormationSlot,
  bounds: FieldBounds,
  phase: MatchPhase,
  kickingTeam: TeamId,
  ballSpot: Vec3,
  kickerId: string | null,
  aimAngle: number,
): { x: number; z: number } {
  if (isSetPieceGoalkeeper(playerId, team, slot, phase, kickerId)) {
    return getGoalkeeperSetPieceSpot(team, bounds)
  }

  if (phase === 'goal-kick') {
    if (playerId === kickerId) {
      return getKickerStandPosition('goal-kick', ballSpot, bounds, aimAngle)
    }
    return getGoalKickPushTarget(team, slot, bounds, kickingTeam)
  }
  if (phase === 'throw-in') {
    return getThrowInSetupTarget(
      team,
      slot,
      bounds,
      kickingTeam,
      ballSpot,
      playerId,
      kickerId,
      aimAngle,
    )
  }
  if (phase === 'corner') {
    return getCornerSetupTarget(
      team,
      slot,
      bounds,
      kickingTeam,
      ballSpot,
      playerId,
      kickerId,
      aimAngle,
    )
  }
  if (phase === 'free-kick') {
    return getFreeKickSetupTarget(
      team,
      slot,
      bounds,
      kickingTeam,
      ballSpot,
      playerId,
      kickerId,
      aimAngle,
    )
  }
  if (phase === 'penalty') {
    return getPenaltySetupTarget(
      team,
      slot,
      bounds,
      kickingTeam,
      ballSpot,
      playerId,
      kickerId,
      aimAngle,
    )
  }
  return { x: ballSpot.x, z: ballSpot.z }
}

export function getSetPieceFacing(
  phase: MatchPhase,
  team: TeamId,
  position: Vec3,
  bounds: FieldBounds,
): number {
  if (phase === 'goal-kick') {
    return getFieldFacingRotation(team, bounds)
  }
  const dir = directionToCenter(position, bounds)
  const n = normalize2D(dir.x, dir.z)
  return Math.atan2(n.x, n.z)
}

export function getSetPieceKickFromAim(
  phase: 'throw-in' | 'corner' | 'goal-kick' | 'free-kick' | 'penalty',
  aimAngle: number,
): { dirX: number; dirZ: number; speed: number; vy: number } {
  const cfg = SET_PIECE_KICK[phase]
  return {
    dirX: Math.sin(aimAngle),
    dirZ: Math.cos(aimAngle),
    speed: cfg.speed,
    vy: cfg.vy,
  }
}

/** Lançamento parabólico — vy alto, horizontal moderado */
export function launchSetPieceBall(
  dirX: number,
  dirZ: number,
  speed: number,
  vy: number,
) {
  const horiz = Math.hypot(dirX, dirZ)
  const nx = horiz > 0.001 ? dirX / horiz : 0
  const nz = horiz > 0.001 ? dirZ / horiz : 1
  ensureBallDynamic()
  applyBallVelocity(nx * speed, vy, nz * speed)
  markSetPieceLaunch()
  sfx.playKick()
}

export function getGoalKickPushTarget(
  team: TeamId,
  slot: FormationSlot,
  bounds: FieldBounds,
  kickingTeam: TeamId,
): { x: number; z: number } {
  if (slot.role === 'gk') {
    return getGoalkeeperSetPieceSpot(team, bounds)
  }

  const sign = getAttackSign(team, bounds)
  const pitchLen = bounds.maxZ - bounds.minZ
  const halfW = (bounds.maxX - bounds.minX) / 2 - 0.55
  const x = bounds.center.x + slot.x * halfW * 0.88
  const defGoalZ = getDefensiveGoalZ(team, bounds)

  if (team === kickingTeam) {
    const progress: Record<FormationSlot['role'], number> = {
      gk: 0,
      def: 0.34,
      mid: 0.5,
      fwd: 0.64,
    }
    return {
      x,
      z: defGoalZ + sign * pitchLen * progress[slot.role],
    }
  }

  const progress: Record<FormationSlot['role'], number> = {
    gk: 0,
    def: 0.38,
    mid: 0.48,
    fwd: 0.55,
  }
  return {
    x,
    z: defGoalZ + sign * pitchLen * progress[slot.role],
  }
}

export function startFreeKickSetPiece(
  team: TeamId,
  position: Vec3,
  message: string,
  refereeSignal?: { card: 'yellow' | 'red' | null; at: number; playerId: string } | null,
) {
  beginSetPiece('free-kick', team, position, message)
  if (refereeSignal) {
    useGameStore.setState({ refereeSignal })
  }
}

export function startPenaltySetPiece(
  team: TeamId,
  position: Vec3,
  message: string,
  refereeSignal?: { card: 'yellow' | 'red' | null; at: number; playerId: string } | null,
) {
  beginSetPiece('penalty', team, position, message)
  if (refereeSignal) {
    useGameStore.setState({ refereeSignal })
  }
}

export function beginSetPiece(
  phase: MatchPhase,
  team: TeamId,
  position: Vec3,
  message: string,
) {
  const store = useGameStore.getState()
  const bounds = store.fieldBounds
  const aim =
    bounds && (phase === 'free-kick' || phase === 'penalty')
      ? initAiSetPieceAim(phase, team, position, bounds)
      : bounds &&
          (phase === 'throw-in' || phase === 'corner' || phase === 'goal-kick')
        ? getSetPieceFacing(phase, team, position, bounds)
        : 0

  store.startSetPiece(phase, team, position, message)

  resetTeamMarkers()

  const kickerId = pickSetPieceKicker(team, position, phase)
  useGameStore.setState({
    setPieceKickerId: kickerId,
    setPieceAimAngle: aim,
  })
  store.clearPossession()
}

export function executeSetPieceKick(power = 1): boolean {
  const store = useGameStore.getState()
  const { phase, setPieceTeam, setPieceKickerId, setPiecePosition } = store

  if (
    !setPieceTeam ||
    !setPieceKickerId ||
    !setPiecePosition ||
    (phase !== 'throw-in' &&
      phase !== 'corner' &&
      phase !== 'goal-kick' &&
      phase !== 'free-kick' &&
      phase !== 'penalty')
  ) {
    return false
  }

  if (phase === 'throw-in') {
    useGameStore.setState({
      setPieceThrowAnim: {
        kickerId: setPieceKickerId,
        at: performance.now(),
        power,
      },
      setPieceKickPending: false,
    })
    return true
  }

  return finishSetPieceKickLaunch(power)
}

function finishSetPieceKickLaunch(power = 1): boolean {
  const store = useGameStore.getState()
  const { phase, setPieceTeam, setPieceKickerId, setPiecePosition, setPieceAimAngle } =
    store

  if (
    !setPieceTeam ||
    !setPieceKickerId ||
    !setPiecePosition ||
    (phase !== 'throw-in' &&
      phase !== 'corner' &&
      phase !== 'goal-kick' &&
      phase !== 'free-kick' &&
      phase !== 'penalty')
  ) {
    return false
  }

  const kick = getSetPieceKickFromAim(phase, setPieceAimAngle)
  const speedMul = setPieceSpeedMul(power)
  const kickerId = setPieceKickerId
  const useShootAnim =
    phase === 'corner' || phase === 'goal-kick' || phase === 'penalty'

  store.setBallFrozen(false)
  store.setPhase('playing')

  if (phase === 'penalty') {
    const speed = shotSpeedFromPower(power) * 1.02
    const vy = shotLoftFromPower(power) * SHOT_SPEED * 0.38
    launchSetPieceBall(kick.dirX, kick.dirZ, speed, vy)
  } else {
    launchSetPieceBall(
      kick.dirX,
      kick.dirZ,
      kick.speed * speedMul,
      kick.vy * (0.55 + power * 0.55),
    )
  }

  store.blockPasserClaim(kickerId, SET_PIECE_KICKER_CLAIM_BLOCK_MS)
  store.setLastTouch(setPieceTeam)
  store.clearPossession()
  store.setMessage('')

  const receivers =
    phase === 'penalty'
      ? { receiverId: null, runnerIds: [] as string[] }
      : pickSetPieceReceivers(
          setPieceTeam,
          setPiecePosition,
          setPieceAimAngle,
          kickerId,
        )
  if (receivers.receiverId) {
    const primary = playerRegistry.get(receivers.receiverId)
    if (primary) {
      const landing = {
        x: setPiecePosition.x + kick.dirX * 9,
        z: setPiecePosition.z + kick.dirZ * 9,
      }
      store.setPassIntent({
        receiverId: receivers.receiverId,
        targetX: landing.x,
        targetZ: landing.z,
        startedAt: performance.now(),
        runnerIds: receivers.runnerIds,
      })
    }
  }

  useGameStore.setState({
    setPieceKickerId: null,
    setPieceTeam: null,
    setPiecePosition: null,
    setPieceAimAngle: 0,
    setPieceKickPending: false,
    setPieceThrowAnim: null,
    setPieceShootAnim: useShootAnim
      ? { kickerId, at: performance.now() }
      : null,
    setPieceGuardUntil: performance.now() + 900,
    setPieceGuardPos: { x: setPiecePosition.x, y: setPiecePosition.y, z: setPiecePosition.z },
  })

  return true
}

/** Lateral — lança a bola no contato da animação player_throw_in */
export function executeThrowInLaunch(power = 1): boolean {
  return finishSetPieceKickLaunch(power)
}

export function isKickerReadyForSetPiece(
  kickerId: string,
  spot: Vec3,
  phase: MatchPhase,
  bounds: FieldBounds,
  aimAngle: number,
  maxDist = 1.5,
): boolean {
  const kicker = playerRegistry.get(kickerId)
  if (!kicker) return false
  const stand = getKickerStandPosition(phase, spot, bounds, aimAngle)
  return distance2D(kicker.position, { x: stand.x, y: 0, z: stand.z }) <= maxDist
}

export function initAiSetPieceAim(
  phase: MatchPhase,
  team: TeamId,
  position: Vec3,
  bounds: FieldBounds,
): number {
  if (phase === 'corner') {
    const goalZ = getAttackingGoalZ(team, bounds)
    const n = normalize2D(bounds.center.x - position.x, goalZ - position.z)
    return Math.atan2(n.x, n.z)
  }
  if (phase === 'free-kick') {
    const goalZ = getAttackingGoalZ(team, bounds)
    const n = normalize2D(bounds.center.x - position.x, goalZ - position.z)
    return Math.atan2(n.x, n.z)
  }
  if (phase === 'penalty') {
    const goalZ = getAttackingGoalZ(team, bounds)
    const spreadX = (Math.random() - 0.5) * 0.22
    const n = normalize2D(spreadX, goalZ - position.z)
    return Math.atan2(n.x, n.z)
  }
  return getSetPieceFacing(phase, team, position, bounds)
}
