import {
  GK_CATCH_MAX_SPEED,
  GK_CLAIM_BOX_SPEED,
  GK_HOLD_MS,
  GK_REACH_DIVE,
  GK_REACH_HEIGHT,
  GK_REACH_STANDING,
  GK_RUSH_SPEED,
  GK_SAVE_COOLDOWN_MS,
  getGoalkeeperId,
} from '../constants'
import { useGameStore } from '../store/gameStore'
import type { FieldBounds, GoalZone, TeamId, Vec3 } from '../types'
import { applyBallVelocity } from './ballPhysics'
import { ballRef, playerRegistry, type PlayerRef } from './entityRegistry'
import { getBallAtFeet } from './possession'
import { distance2D } from './rules'
import { replaySystem } from './replaySystem'
import { sfx } from './sfx'
import {
  getAttackSign,
  getDefensiveGoalZ,
  isInPenaltyArea,
} from './teamField'

export type GkMode = 'idle' | 'set' | 'rush' | 'catch' | 'parry' | 'punch' | 'hold'

export interface GkRuntimeState {
  mode: GkMode
  until: number
  diveTarget: { x: number; z: number } | null
  faceAngle: number | null
}

export interface ShotThreat {
  defendingTeam: TeamId
  attackingTeam: TeamId
  goalZ: number
  goalCenterX: number
  goalHalfWidth: number
  goalMaxY: number
  timeToGoal: number
  interceptX: number
  interceptZ: number
  interceptY: number
  ballSpeed: number
  urgency: number
  wideAngle: number
}

export type GkSaveOutcome = 'catch' | 'parry' | 'punch' | 'miss'

const gkRuntime = new Map<string, GkRuntimeState>()
const gkCooldownUntil = new Map<string, number>()
const gkPositionSnap = new Map<string, { x: number; z: number }>()
const lastThreatTeam = new Map<TeamId, ShotThreat | null>([
  ['home', null],
  ['away', null],
])

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v))
}

function getGoalZoneForDefender(
  defendingTeam: TeamId,
  goalZones: GoalZone[],
  bounds: FieldBounds,
): GoalZone | null {
  const defGoalZ = getDefensiveGoalZ(defendingTeam, bounds)
  let best: GoalZone | null = null
  let bestDist = Infinity
  for (const zone of goalZones) {
    const z = (zone.minZ + zone.maxZ) / 2
    const d = Math.abs(z - defGoalZ)
    if (d < bestDist) {
      bestDist = d
      best = zone
    }
  }
  return best
}

/** Detecta chute/cruzamento perigoso em direção ao gol */
export function assessShotThreat(
  ball: Vec3,
  velocity: Vec3,
  bounds: FieldBounds,
  goalZones: GoalZone[],
): ShotThreat | null {
  const horizSpeed = Math.hypot(velocity.x, velocity.z)
  if (horizSpeed < 1.1) return null

  let best: ShotThreat | null = null
  let bestTime = Infinity

  for (const defTeam of ['home', 'away'] as TeamId[]) {
    const goalZ = getDefensiveGoalZ(defTeam, bounds)
    const intoField = getAttackSign(defTeam, bounds)
    const distToLine = (goalZ - ball.z) * intoField
    if (distToLine < -0.75) continue

    const closingSpeed = velocity.z * (-intoField)
    if (closingSpeed < 0.85) continue

    const timeToGoal =
      distToLine <= 0.1
        ? Math.max(0.06, distToLine / Math.max(closingSpeed, 0.85))
        : distToLine / closingSpeed
    if (timeToGoal > 3.8 || timeToGoal < 0.02) continue

    const interceptX = ball.x + velocity.x * timeToGoal
    const interceptY = Math.max(
      0,
      ball.y + velocity.y * timeToGoal - 4.2 * timeToGoal * timeToGoal,
    )

    const zone = getGoalZoneForDefender(defTeam, goalZones, bounds)
    const halfW = bounds.goalWidth / 2
    const centerX = bounds.center.x
    const distFromCenter = Math.abs(interceptX - centerX)

    if (distFromCenter > halfW + 2.4) continue
    if (zone && interceptY > zone.maxY + 0.85) continue

    const atkTeam: TeamId = defTeam === 'home' ? 'away' : 'home'
    const wideAngle = clamp(distFromCenter / (halfW + 0.01), 0, 1)
    const urgency = clamp(
      (2.6 - timeToGoal) / 2.6 * 0.55 +
        clamp(horizSpeed / 12, 0, 1) * 0.35 +
        (1 - wideAngle) * 0.1,
      0,
      1,
    )

    if (timeToGoal < bestTime) {
      bestTime = timeToGoal
      best = {
        defendingTeam: defTeam,
        attackingTeam: atkTeam,
        goalZ,
        goalCenterX: centerX,
        goalHalfWidth: halfW,
        goalMaxY: zone?.maxY ?? bounds.goalHeight,
        timeToGoal,
        interceptX,
        interceptZ: goalZ + intoField * 0.55,
        interceptY,
        ballSpeed: horizSpeed,
        urgency,
        wideAngle,
      }
    }
  }

  if (best) lastThreatTeam.set(best.defendingTeam, best)
  return best
}

function isShotOnTarget(threat: ShotThreat): boolean {
  return (
    Math.abs(threat.interceptX - threat.goalCenterX) <= threat.goalHalfWidth + 0.4 &&
    threat.interceptY <= threat.goalMaxY + 0.55
  )
}

function shouldCommitSave(
  gk: PlayerRef,
  threat: ShotThreat,
  ball: Vec3,
): boolean {
  if (!isShotOnTarget(threat)) return false
  if (ball.y > GK_REACH_HEIGHT + 0.65) return false

  const distBall = distance2D(gk.position, ball)
  const distIntercept = distance2D(gk.position, {
    x: threat.interceptX,
    y: 0,
    z: threat.interceptZ,
  })

  if (distBall < GK_REACH_DIVE * 1.55) return true
  if (threat.timeToGoal < 0.65) return true
  if (threat.timeToGoal < 2.2 && distIntercept < GK_REACH_DIVE * 2.4) return true
  return (
    threat.timeToGoal < 3.2 &&
    distIntercept / GK_RUSH_SPEED <= threat.timeToGoal + 0.65
  )
}

function snapGkTowardSave(
  gkId: string,
  threat: ShotThreat,
  team: TeamId,
  bounds: FieldBounds,
) {
  const gk = playerRegistry.get(gkId)
  if (!gk) return

  const intoField = getAttackSign(team, bounds)
  const targetX = threat.interceptX
  const targetZ = threat.goalZ + intoField * 0.72
  const blend = threat.timeToGoal < 0.5 ? 0.88 : 0.72

  const x = gk.position.x * (1 - blend) + targetX * blend
  const z = gk.position.z * (1 - blend) + targetZ * blend

  gk.position.x = x
  gk.position.z = z
  gkPositionSnap.set(gkId, { x, z })
}

export function consumeGkPositionSnap(gkId: string): { x: number; z: number } | null {
  const snap = gkPositionSnap.get(gkId)
  if (!snap) return null
  gkPositionSnap.delete(gkId)
  return snap
}

/** Posicionamento profissional — bisecta o ângulo e fecha o primeiro poste */
export function getThreatAwareGkPosition(
  gkPos: Vec3,
  threat: ShotThreat,
  bounds: FieldBounds,
  team: TeamId,
): { x: number; z: number } {
  const intoField = getAttackSign(team, bounds)
  const goalZ = threat.goalZ

  const postNear = threat.interceptX >= threat.goalCenterX
    ? threat.goalCenterX + threat.goalHalfWidth * 0.92
    : threat.goalCenterX - threat.goalHalfWidth * 0.92

  const bisectX =
    threat.interceptX * 0.72 +
    postNear * 0.18 +
    threat.goalCenterX * 0.1

  const depth =
    threat.timeToGoal < 0.45
      ? 0.65
      : threat.timeToGoal < 0.85
        ? 0.95
        : threat.urgency > 0.55
          ? 1.25
          : threat.wideAngle > 0.5
            ? 1.45
            : 1.85

  const targetZ = goalZ + intoField * depth
  const targetX = clamp(
    threat.timeToGoal < 0.9 ? threat.interceptX * 0.88 + bisectX * 0.12 : bisectX,
    bounds.center.x - threat.goalHalfWidth * 1.15,
    bounds.center.x + threat.goalHalfWidth * 1.15,
  )

  const blend = threat.urgency > 0.45 || threat.timeToGoal < 1 ? 0.94 : 0.78
  return {
    x: gkPos.x * (1 - blend) + targetX * blend,
    z: gkPos.z * (1 - blend) + targetZ * blend,
  }
}

export function getGkRuntime(gkId: string): GkRuntimeState | null {
  const state = gkRuntime.get(gkId)
  if (!state) return null
  if (performance.now() >= state.until && state.mode !== 'rush') {
    gkRuntime.delete(gkId)
    return null
  }
  return state
}

export function isGkBodyLocked(gkId: string): boolean {
  const state = getGkRuntime(gkId)
  if (!state) return false
  return (
    state.mode === 'catch' ||
    state.mode === 'parry' ||
    state.mode === 'punch' ||
    state.mode === 'hold'
  )
}

function setGkRuntime(gkId: string, state: GkRuntimeState) {
  gkRuntime.set(gkId, state)
}

function startCooldown(gkId: string) {
  gkCooldownUntil.set(gkId, performance.now() + GK_SAVE_COOLDOWN_MS)
}

function isGkOnCooldown(gkId: string): boolean {
  return performance.now() < (gkCooldownUntil.get(gkId) ?? 0)
}

function rollSaveOutcome(
  gk: PlayerRef,
  threat: ShotThreat,
  ball: Vec3,
  committed: boolean,
): GkSaveOutcome {
  const distBall = distance2D(gk.position, ball)
  const distIntercept = distance2D(gk.position, {
    x: threat.interceptX,
    y: 0,
    z: threat.interceptZ,
  })
  const dist2d = Math.min(distBall, distIntercept)
  const heightOk = ball.y < GK_REACH_HEIGHT + 0.45

  if (committed && heightOk && isShotOnTarget(threat)) {
    if (threat.ballSpeed > 10.5 || threat.interceptY > 1.9) return 'punch'
    if (threat.ballSpeed > 6.8 || threat.interceptY > 1.25) return 'parry'
    return 'catch'
  }

  const inReach =
    dist2d <
    (threat.ballSpeed > GK_CATCH_MAX_SPEED * 0.65
      ? GK_REACH_DIVE * 1.25
      : GK_REACH_STANDING * 1.15)

  if (!inReach || !heightOk) {
    if (threat.timeToGoal < 0.28 && dist2d < GK_REACH_DIVE * 1.5) return 'parry'
    return 'miss'
  }

  let skill = 0.95
  skill -= clamp(threat.ballSpeed / 18, 0, 0.12)
  skill -= threat.wideAngle * 0.08
  skill -= clamp(dist2d / GK_REACH_DIVE, 0, 0.08)

  const roll = Math.random()
  if (roll > skill + 0.02) return 'parry'
  if (threat.ballSpeed > 8.5 || threat.wideAngle > 0.55) {
    return roll > skill - 0.1 ? 'parry' : 'punch'
  }
  if (threat.ballSpeed > 5.5 || threat.interceptY > 1.25) {
    return roll > skill - 0.04 ? 'parry' : 'catch'
  }
  return 'catch'
}

function executeCatch(gkId: string, team: TeamId) {
  const gk = playerRegistry.get(gkId)
  if (!gk) return

  const foot = getBallAtFeet(gk)
  ballRef.current = { x: foot.x, y: foot.y, z: foot.z }
  applyBallVelocity(0, 0, 0)

  const store = useGameStore.getState()
  store.setPossession(gkId, team)
  store.setLastTouch(team)

  setGkRuntime(gkId, {
    mode: 'hold',
    until: performance.now() + GK_HOLD_MS,
    diveTarget: null,
    faceAngle: gk.rotation,
  })
  startCooldown(gkId)
  replaySystem.notifyGoalkeeperSave(team)
}

function executeParryOrPunch(
  gkId: string,
  team: TeamId,
  kind: 'parry' | 'punch',
) {
  const bounds = useGameStore.getState().fieldBounds!
  const ball = ballRef.current
  const vel = ballRef.velocity
  const intoField = getAttackSign(team, bounds)
  const lateral = ball.x - bounds.center.x
  const speed = Math.hypot(vel.x, vel.z)

  const push =
    kind === 'punch'
      ? speed * (0.38 + Math.random() * 0.12)
      : speed * (0.28 + Math.random() * 0.1)

  applyBallVelocity(
    lateral * 0.55 + vel.x * 0.15,
    kind === 'punch' ? Math.min(2.8, ball.y * 0.25 + 1.1) : Math.min(1.6, ball.y * 0.2 + 0.45),
    intoField * push,
  )

  useGameStore.getState().setLastTouch(team)

  const gk = playerRegistry.get(gkId)
  setGkRuntime(gkId, {
    mode: kind,
    until: performance.now() + (kind === 'punch' ? 620 : 520),
    diveTarget: null,
    faceAngle: gk
      ? Math.atan2(ball.x - gk.position.x, ball.z - gk.position.z)
      : null,
  })
  startCooldown(gkId)
  sfx.playKick()
  replaySystem.notifyGoalkeeperSave(team)
}

export function tickGoalkeeperDefense(): void {
  const store = useGameStore.getState()
  if (store.phase !== 'playing' || store.ballFrozen || store.ballPossession) return
  if (!store.fieldBounds || store.goalZones.length === 0) return

  const ball = ballRef.current
  const vel = ballRef.velocity
  const threat = assessShotThreat(ball, vel, store.fieldBounds, store.goalZones)
  if (!threat) return

  const gkId = getGoalkeeperId(threat.defendingTeam)
  const urgent = threat.timeToGoal < 0.5
  if (isGkOnCooldown(gkId) && !urgent) return

  const gk = playerRegistry.get(gkId)
  if (!gk) return

  const intoField = getAttackSign(threat.defendingTeam, store.fieldBounds)
  const rushDepth =
    threat.timeToGoal < 0.55 ? 0.65 : threat.timeToGoal < 1.1 ? 0.95 : 1.35
  const diveTarget = {
    x: threat.interceptX,
    z: threat.goalZ + intoField * rushDepth,
  }

  setGkRuntime(gkId, {
    mode: 'rush',
    until: performance.now() + threat.timeToGoal * 1000 + 750,
    diveTarget,
    faceAngle: Math.atan2(ball.x - gk.position.x, ball.z - gk.position.z),
  })

  const committed = shouldCommitSave(gk, threat, ball)
  const distGkBall = distance2D(gk.position, ball)
  const reach = GK_REACH_DIVE * 1.5
  const inWindow = committed || distGkBall < reach

  if (!inWindow) return

  if (committed) {
    snapGkTowardSave(gkId, threat, threat.defendingTeam, store.fieldBounds)
  }

  const outcome = rollSaveOutcome(gk, threat, ball, committed)

  switch (outcome) {
    case 'catch':
      executeCatch(gkId, threat.defendingTeam)
      break
    case 'parry':
      executeParryOrPunch(gkId, threat.defendingTeam, 'parry')
      break
    case 'punch':
      executeParryOrPunch(gkId, threat.defendingTeam, 'punch')
      break
    case 'miss':
      setGkRuntime(gkId, {
        mode: 'parry',
        until: performance.now() + 380,
        diveTarget,
        faceAngle: Math.atan2(ball.x - gk.position.x, ball.z - gk.position.z),
      })
      break
  }
}

/** Goleiro pega bola lenta dentro da área */
export function tryGoalkeeperBoxClaim(players: PlayerRef[]): PlayerRef | null {
  const store = useGameStore.getState()
  if (store.phase !== 'playing' || store.ballFrozen || store.ballPossession) return null
  if (!store.fieldBounds) return null

  const ball = ballRef.current
  const speed = Math.hypot(ballRef.velocity.x, ballRef.velocity.z)
  if (speed > GK_CLAIM_BOX_SPEED) return null

  let best: PlayerRef | null = null
  let minDist = Infinity

  for (const p of players) {
    if (p.role !== 'gk') continue
    if (!store.canPlayerClaimBall(p.id)) continue
    if (!isInPenaltyArea(ball, p.team, store.fieldBounds)) continue
    const d = distance2D(p.position, ball)
    if (d < GK_REACH_DIVE * 0.92 && d < minDist) {
      minDist = d
      best = p
    }
  }

  return best
}

export function getLastThreatForTeam(team: TeamId): ShotThreat | null {
  return lastThreatTeam.get(team) ?? null
}

export function clearGoalkeeperState(gkId: string) {
  gkRuntime.delete(gkId)
  gkCooldownUntil.delete(gkId)
}

export function resetAllGoalkeeperState() {
  gkRuntime.clear()
  gkCooldownUntil.clear()
  gkPositionSnap.clear()
  lastThreatTeam.clear()
}
