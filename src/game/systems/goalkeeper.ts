import {
  BALL_RADIUS,
  GK_BODY_SAVE_STEP,
  GK_CATCH_MAX_SPEED,
  GK_CLAIM_BOX_SPEED,
  GK_CLOSE_ATTACKER_DIST,
  GK_DISTRIBUTE_DELAY_MS,
  GK_FACING_CLAMP,
  GK_HAND_RADIUS,
  GK_HOLD_MS,
  GK_MAX_STEP_FROM_LINE,
  GK_REACH_HEIGHT,
  GK_SAVE_COOLDOWN_MS,
  SHOT_SPEED,
} from '../constants'
import { ballRef, playerRegistry, type PlayerRef } from './entityRegistry'
import { distance2D, normalize2D } from './rules'
import { useGameStore } from '../store/gameStore'
import { getAttackSign, getDefensiveGoalZ, getFieldFacingRotation, isInPenaltyArea } from './teamField'
import type { FieldBounds, GoalkeeperAnim, GoalZone, TeamId, Vec3 } from '../types'
import { minGkHandDist, testGkHandContact } from './goalkeeperHands'

export type GkSaveKind = 'catch' | 'parry'
export type GkMode = 'idle' | 'save' | 'hold' | 'distribute'

export type GkRuntime = {
  mode: GkMode
  saveAnim: GoalkeeperAnim | null
  saveKind: GkSaveKind | null
  saveSide: 'left' | 'right' | null
  interceptTarget: { x: number; z: number } | null
  holdUntil: number
  saveLockedUntil: number
  lastSaveAt: number
  handContactResolved: boolean
  allowStep: boolean
  stepDepth: number
  faceAngle: number | null
  distributing: boolean
}

const gkRuntimes = new Map<string, GkRuntime>()

// Nunca deixamos o goleiro travado numa animação/estado que "esqueceram" de
// terminar. Isso é só uma rede de segurança — bem maior que qualquer defesa
// real — pra garantir que ele sempre volte a reagir.
const GK_SAVE_FAILSAFE_MS = 1500
const GK_DISTRIBUTE_FAILSAFE_MS = GK_DISTRIBUTE_DELAY_MS + 4000

function defaultRuntime(): GkRuntime {
  return {
    mode: 'idle',
    saveAnim: null,
    saveKind: null,
    saveSide: null,
    interceptTarget: null,
    holdUntil: 0,
    saveLockedUntil: 0,
    lastSaveAt: 0,
    handContactResolved: false,
    allowStep: false,
    stepDepth: GK_MAX_STEP_FROM_LINE,
    faceAngle: null,
    distributing: false,
  }
}

export function getGkRuntime(gkId: string): GkRuntime | undefined {
  return gkRuntimes.get(gkId)
}

export function isGkBodyLocked(gkId: string): boolean {
  const rt = gkRuntimes.get(gkId)
  if (!rt) return false
  if (rt.mode === 'hold' || rt.mode === 'distribute') return true
  if (rt.mode === 'save') return !rt.allowStep
  return performance.now() < rt.saveLockedUntil
}

export type ShotThreat = {
  defendingTeam: TeamId
  goalZ: number
  goalMinX: number
  goalMaxX: number
  interceptX: number
  interceptY: number
  timeToGoal: number
  urgency: number
  ballSpeed: number
}

export function assessShotThreat(
  ball: Vec3,
  vel: Vec3,
  bounds: FieldBounds,
  zones: GoalZone[],
): ShotThreat | null {
  const speed = Math.hypot(vel.x, vel.z)
  if (speed < 1.8) return null
  if (ball.y > GK_REACH_HEIGHT + 0.55 && vel.y > -0.8) return null

  let best: ShotThreat | null = null

  for (const zone of zones) {
    // zone.team = quem MARCA nesse gol; quem defende é o adversário
    const defendingTeam = zone.team === 'home' ? 'away' : 'home'
    const goalZ = getDefensiveGoalZ(defendingTeam, bounds)
    const intoField = getAttackSign(defendingTeam, bounds)

    const toGoal = (ball.z - goalZ) * intoField
    if (toGoal < 0.2 || toGoal > 38) continue

    const closingSpeed = -(vel.z * intoField)
    if (closingSpeed < 0.25) continue

    const timeToGoal = toGoal / Math.max(closingSpeed, 0.35)
    if (timeToGoal > 3.2) continue

    const predictX = ball.x + vel.x * timeToGoal
    const predictY = ball.y + vel.y * timeToGoal - 0.5 * 9.81 * timeToGoal * timeToGoal * 0.012
    const margin = 3.2
    if (predictX < zone.minX - margin || predictX > zone.maxX + margin) continue

    const interceptX = Math.max(zone.minX + 0.12, Math.min(zone.maxX - 0.12, predictX))
    const urgency = Math.min(1, (speed / SHOT_SPEED) * (1.6 / Math.max(timeToGoal, 0.15)))

    const threat: ShotThreat = {
      defendingTeam,
      goalZ,
      goalMinX: zone.minX,
      goalMaxX: zone.maxX,
      interceptX,
      interceptY: Math.max(0.06, predictY),
      timeToGoal,
      urgency,
      ballSpeed: speed,
    }

    if (!best || threat.urgency > best.urgency) best = threat
  }

  return best
}

function pickSaveSide(gkX: number, targetX: number, velX: number): 'left' | 'right' {
  const dx = targetX - gkX
  if (Math.abs(dx) > 0.04) return dx > 0 ? 'right' : 'left'
  return velX >= 0 ? 'right' : 'left'
}

/** Onde a bola cruza o plano Z do goleiro (com gravidade simplificada) */
export function predictBallAtZ(ball: Vec3, vel: Vec3, targetZ: number): Vec3 | null {
  if (Math.abs(vel.z) < 0.08) return null
  const t = (targetZ - ball.z) / vel.z
  if (t < 0.02 || t > 2.8) return null
  const g = 9.81 * 0.012
  return {
    x: ball.x + vel.x * t,
    y: Math.max(0.04, ball.y + vel.y * t - 0.5 * g * t * t),
    z: targetZ,
  }
}

function gkLineZ(team: TeamId, bounds: FieldBounds, depth = 0.11): number {
  const goalZ = getDefensiveGoalZ(team, bounds)
  return goalZ + getAttackSign(team, bounds) * depth
}

/** Pega vs espalma — regra fixa pela trajetória, sem sorteio */
function chooseSaveKind(
  predictedY: number,
  ballSpeed: number,
  distToGk: number,
  close1v1: boolean,
): GkSaveKind {
  if (close1v1 || distToGk < 1.65) return 'parry'
  if (ballSpeed > GK_CATCH_MAX_SPEED * 0.92) return 'parry'
  if (predictedY < 0.45) return 'parry'
  if (predictedY > GK_REACH_HEIGHT + 0.15) return 'parry'
  if (distToGk < 2.4 && ballSpeed > 6.5) return 'parry'
  if (predictedY >= 0.5 && predictedY <= 1.55 && ballSpeed <= GK_CATCH_MAX_SPEED) return 'catch'
  return predictedY <= 1.2 ? 'parry' : 'catch'
}

type SaveDecision = {
  kind: GkSaveKind
  side: 'left' | 'right'
  anim: GoalkeeperAnim
  target: Vec3
}

function decideGkSave(
  gk: PlayerRef,
  ball: Vec3,
  vel: Vec3,
  bounds: FieldBounds,
  opts?: { force1v1?: boolean; aim?: Vec3 },
): SaveDecision {
  const lineZ = gkLineZ(gk.team, bounds)
  const predicted = predictBallAtZ(ball, vel, lineZ) ?? opts?.aim ?? ball
  const speed = Math.hypot(vel.x, vel.z)
  const dist = distance2D(gk.position, ball)
  const side = pickSaveSide(gk.position.x, predicted.x, vel.x)
  const kind = chooseSaveKind(
    predicted.y,
    speed,
    dist,
    opts?.force1v1 ?? false,
  )
  return {
    kind,
    side,
    anim: pickSaveAnim(kind, side),
    target: { x: predicted.x, y: predicted.y, z: lineZ },
  }
}

function pickSaveAnim(kind: GkSaveKind, side: 'left' | 'right'): GoalkeeperAnim {
  if (kind === 'catch') {
    return side === 'left' ? 'gk_diving_save_left' : 'gk_diving_save_right'
  }
  return side === 'left' ? 'gk_body_save_left' : 'gk_body_save_right'
}

export function clampGkFacing(
  team: TeamId,
  bounds: FieldBounds,
  gkPos: Vec3,
  lookAt: Vec3,
): number {
  const base = getFieldFacingRotation(team, bounds)
  const toTarget = Math.atan2(lookAt.x - gkPos.x, lookAt.z - gkPos.z)
  let delta = toTarget - base
  while (delta > Math.PI) delta -= Math.PI * 2
  while (delta < -Math.PI) delta += Math.PI * 2
  delta = Math.max(-GK_FACING_CLAMP, Math.min(GK_FACING_CLAMP, delta))
  return base + delta
}

export function clampGkPosition(
  pos: Vec3,
  team: TeamId,
  bounds: FieldBounds,
  maxDepth = GK_MAX_STEP_FROM_LINE,
): { x: number; z: number } {
  const goalZ = getDefensiveGoalZ(team, bounds)
  const intoField = getAttackSign(team, bounds)
  const halfW = bounds.goalWidth / 2
  const x = Math.max(
    bounds.center.x - halfW * 0.92,
    Math.min(bounds.center.x + halfW * 0.92, pos.x),
  )
  const nearLine = goalZ + intoField * 0.06
  const farLine = goalZ + intoField * maxDepth
  const z =
    intoField > 0
      ? Math.max(nearLine, Math.min(farLine, pos.z))
      : Math.min(nearLine, Math.max(farLine, pos.z))
  return { x, z }
}

function findCloseAttacker(gk: PlayerRef, team: TeamId, bounds: FieldBounds): PlayerRef | null {
  const store = useGameStore.getState()
  const poss = store.ballPossession
  let best: PlayerRef | null = null
  let bestDist = Infinity

  for (const p of playerRegistry.values()) {
    if (p.team === team || p.role === 'gk') continue
    const d = distance2D(gk.position, p.position)
    if (d > GK_CLOSE_ATTACKER_DIST) continue
    if (!isInPenaltyArea(p.position, team, bounds)) continue

    const hasBall = poss?.playerId === p.id
    const nearBall = distance2D(p.position, ballRef.current) < 0.85
    if (!hasBall && !nearBall) continue

    if (d < bestDist) {
      bestDist = d
      best = p
    }
  }
  return best
}

function startGkSave(
  gkId: string,
  team: TeamId,
  bounds: FieldBounds,
  ball: Vec3,
  vel: Vec3,
  opts?: { allowStep?: boolean; stepDepth?: number; force1v1?: boolean; aim?: Vec3 },
) {
  const gk = playerRegistry.get(gkId)
  if (!gk) return

  const decision = decideGkSave(gk, ball, vel, bounds, {
    force1v1: opts?.force1v1,
    aim: opts?.aim,
  })
  const rt = gkRuntimes.get(gkId) ?? defaultRuntime()

  rt.mode = 'save'
  rt.saveAnim = decision.anim
  rt.saveKind = decision.kind
  rt.saveSide = decision.side
  rt.interceptTarget = { x: decision.target.x, z: decision.target.z }
  rt.handContactResolved = false
  rt.allowStep = opts?.allowStep ?? decision.kind === 'parry'
  rt.stepDepth = opts?.stepDepth ?? (decision.kind === 'parry' ? GK_BODY_SAVE_STEP : GK_MAX_STEP_FROM_LINE)
  rt.saveLockedUntil = performance.now() + 900
  rt.lastSaveAt = performance.now()
  rt.faceAngle = clampGkFacing(team, bounds, gk.position, decision.target)
  rt.distributing = false

  gkRuntimes.set(gkId, rt)
}

function applyGkCatch(gkId: string, team: TeamId) {
  const store = useGameStore.getState()
  if (!store.canPlayerClaimBall(gkId)) return

  store.setPossession(gkId, team)
  store.setLastTouch(team)
  ballRef.velocity = { x: 0, y: 0, z: 0 }

  const gk = playerRegistry.get(gkId)
  if (gk) {
    ballRef.current.x = gk.position.x
    ballRef.current.y = 1.05
    ballRef.current.z = gk.position.z + 0.22
  }

  const rt = gkRuntimes.get(gkId) ?? defaultRuntime()
  rt.mode = 'hold'
  rt.saveAnim = null
  rt.saveKind = null
  rt.interceptTarget = null
  rt.holdUntil = performance.now() + GK_HOLD_MS
  rt.saveLockedUntil = rt.holdUntil
  rt.allowStep = false
  gkRuntimes.set(gkId, rt)
}

function applyGkParry(gkId: string, team: TeamId, side: 'left' | 'right') {
  const store = useGameStore.getState()
  store.setLastTouch(team)

  const sign = side === 'left' ? -1 : 1
  const spd = Math.min(Math.hypot(ballRef.velocity.x, ballRef.velocity.z), 14)
  const n = normalize2D(ballRef.velocity.x, ballRef.velocity.z)
  const bounds = store.fieldBounds!
  const deflectX = n.x * 0.35 + sign * 0.72
  const deflectZ = n.z * 0.35 + getAttackSign(team, bounds) * 0.55
  const len = Math.hypot(deflectX, deflectZ) || 1

  ballRef.velocity = {
    x: (deflectX / len) * Math.max(spd * 0.55, 3.5),
    y: 0.22,
    z: (deflectZ / len) * Math.max(spd * 0.55, 3.5),
  }

  const rt = gkRuntimes.get(gkId) ?? defaultRuntime()
  rt.mode = 'idle'
  rt.saveAnim = null
  rt.saveKind = null
  rt.interceptTarget = null
  rt.saveLockedUntil = performance.now() + GK_SAVE_COOLDOWN_MS
  rt.allowStep = false
  gkRuntimes.set(gkId, rt)
}

function onSaveAnimFinished(gkId: string) {
  const rt = gkRuntimes.get(gkId)
  if (!rt || rt.mode !== 'save') return
  if (rt.handContactResolved) return

  rt.mode = 'idle'
  rt.saveAnim = null
  rt.saveKind = null
  rt.interceptTarget = null
  rt.saveLockedUntil = performance.now() + GK_SAVE_COOLDOWN_MS * 0.35
  rt.allowStep = false
  gkRuntimes.set(gkId, rt)
}

export function notifyGkSaveFinished(gkId: string) {
  onSaveAnimFinished(gkId)
}

/** Avalia ameaças e dispara animações — roda cedo no frame */
export function tickGoalkeeperDefense() {
  const store = useGameStore.getState()
  if (store.phase !== 'playing' || store.ballFrozen || !store.fieldBounds) return

  const bounds = store.fieldBounds
  const ball = ballRef.current
  const vel = ballRef.velocity
  const speed = Math.hypot(vel.x, vel.z)
  const now = performance.now()
  const poss = store.ballPossession

  for (const gk of playerRegistry.values()) {
    if (gk.role !== 'gk') continue
    const rt = gkRuntimes.get(gk.id) ?? defaultRuntime()
    gkRuntimes.set(gk.id, rt)

    // --- Failsafes: nada aqui deve travar o goleiro pra sempre --------------

    // Se o callback de fim de animação de defesa nunca chegou (bug de anim,
    // evento perdido etc.), força a volta pro idle depois de um tempo bem
    // maior que qualquer defesa real dura.
    if (rt.mode === 'save' && now - rt.lastSaveAt > GK_SAVE_FAILSAFE_MS) {
      onSaveAnimFinished(gk.id)
    }

    // Se ele não está mais de posse da bola mas ficou marcado como
    // 'hold'/'distribute' (por exemplo, perdeu a bola num desarme), esse
    // estado não faz mais sentido — solta o goleiro imediatamente.
    if ((rt.mode === 'hold' || rt.mode === 'distribute') && poss?.playerId !== gk.id) {
      rt.mode = 'idle'
      rt.distributing = false
      rt.holdUntil = 0
    } else if (
      rt.mode === 'distribute' &&
      now - rt.lastSaveAt > GK_DISTRIBUTE_FAILSAFE_MS
    ) {
      // Rede de segurança extra: distribuição que nunca terminou.
      finishGkDistribution(gk.id)
    }

    if (poss?.playerId === gk.id) {
      tickGkHoldAndRelease()
      continue
    }

    if (rt.mode === 'hold' || rt.mode === 'distribute' || rt.mode === 'save') continue

    const lineZ = gkLineZ(gk.team, bounds)

    // Sempre atualiza pra onde o goleiro está olhando, mesmo quando não é
    // hora de avaliar chute — antes disso só acontecia aqui dentro, e a
    // função inteira podia ser pulada (veja abaixo), deixando o goleiro
    // "cego" parado numa direção velha.
    rt.faceAngle = clampGkFacing(gk.team, bounds, gk.position, predictBallAtZ(ball, vel, lineZ) ?? ball)

    const inCooldown = now - rt.lastSaveAt < GK_SAVE_COOLDOWN_MS
    const ballWithOther = !!poss // outro jogador (não o goleiro) está de posse

    if (inCooldown || ballWithOther) {
      // Não pode iniciar outra defesa agora (cooldown) ou a bola está
      // controlada por alguém (não dá pra calcular "chute" ainda), mas
      // continua acompanhando/reposicionando em vez de simplesmente parar
      // de atualizar o alvo — isso é o que deixava o interceptTarget velho
      // e o goleiro "travado" olhando pra um ponto sem sentido.
      if (isInPenaltyArea(ball, gk.team, bounds) && distance2D(gk.position, ball) < 8) {
        const predicted = predictBallAtZ(ball, vel, lineZ)
        if (predicted) {
          rt.interceptTarget = clampGkPosition({ x: predicted.x, y: 0, z: lineZ }, gk.team, bounds)
        }
      } else {
        rt.interceptTarget = null
      }
      continue
    }

    const closeAtt = findCloseAttacker(gk, gk.team, bounds)
    if (closeAtt) {
      startGkSave(gk.id, gk.team, bounds, ball, vel, {
        force1v1: true,
        allowStep: true,
        stepDepth: GK_BODY_SAVE_STEP,
      })
      continue
    }

    const threat =
      store.goalZones.length > 0
        ? assessShotThreat(ball, vel, bounds, store.goalZones)
        : null

    const distToBall = distance2D(gk.position, ball)
    const inBox = isInPenaltyArea(ball, gk.team, bounds)

    if (threat && threat.defendingTeam === gk.team) {
      const aimX = threat.interceptX
      rt.interceptTarget = clampGkPosition({ x: aimX, y: 0, z: lineZ }, gk.team, bounds)

      const lateralError = Math.abs(gk.position.x - aimX)
      const aligned = lateralError < 0.42
      const urgent =
        threat.timeToGoal < 0.72 ||
        distToBall < 2.1 ||
        minGkHandDist(gk.id, ball) < GK_HAND_RADIUS + BALL_RADIUS + 0.45

      const shouldSave =
        urgent ||
        aligned ||
        threat.timeToGoal < 1.05 ||
        distToBall < 3.2

      if (shouldSave && (aligned || urgent || threat.timeToGoal < 1.35)) {
        startGkSave(gk.id, gk.team, bounds, ball, vel, {
          aim: { x: aimX, y: threat.interceptY, z: lineZ },
        })
      }
      continue
    }

    if (inBox && distToBall < 4.5 && speed > 1.0) {
      const predicted = predictBallAtZ(ball, vel, lineZ)
      if (predicted) {
        rt.interceptTarget = clampGkPosition(
          { x: predicted.x, y: 0, z: lineZ },
          gk.team,
          bounds,
        )
        const aligned = Math.abs(gk.position.x - predicted.x) < 0.5
        if (aligned || distToBall < 2.5 || speed > 4) {
          startGkSave(gk.id, gk.team, bounds, ball, vel, { aim: predicted })
        }
      }
      continue
    }

    rt.interceptTarget = null
  }
}

/** Contato bola ↔ mãos + fallback por proximidade durante defesa */
export function resolveGkHandContacts() {
  const store = useGameStore.getState()
  if (store.phase !== 'playing' || store.ballFrozen || store.ballPossession) return

  const ball = ballRef.current

  for (const gk of playerRegistry.values()) {
    if (gk.role !== 'gk') continue
    const rt = gkRuntimes.get(gk.id)
    if (!rt || rt.mode !== 'save' || rt.handContactResolved) continue

    let side = testGkHandContact(gk.id, ball)

    if (!side) {
      const handDist = minGkHandDist(gk.id, ball)
      const bodyDist = distance2D(gk.position, ball)
      const reach = GK_HAND_RADIUS + BALL_RADIUS + 0.85
      if (handDist > reach && bodyDist > reach) continue
      side = rt.saveSide ?? pickSaveSide(gk.position.x, ball.x, ballRef.velocity.x)
    }

    rt.handContactResolved = true
    const kind = rt.saveKind ?? 'parry'

    if (kind === 'catch') {
      applyGkCatch(gk.id, gk.team)
    } else {
      applyGkParry(gk.id, gk.team, side)
    }
  }
}

function tickGkHoldAndRelease() {
  const store = useGameStore.getState()
  const poss = store.ballPossession
  if (!poss) return

  const gk = playerRegistry.get(poss.playerId)
  if (!gk || gk.role !== 'gk') return

  const rt = gkRuntimes.get(gk.id) ?? defaultRuntime()
  gkRuntimes.set(gk.id, rt)

  if (rt.mode !== 'hold' && rt.mode !== 'distribute') {
    rt.mode = 'hold'
    rt.holdUntil = performance.now() + GK_HOLD_MS
  }

  const now = performance.now()
  if (now < rt.holdUntil) return
  if (rt.distributing) return

  rt.distributing = true
  rt.mode = 'distribute'
  rt.lastSaveAt = now
  rt.saveLockedUntil = now + GK_DISTRIBUTE_DELAY_MS + 600
}

export function tryGoalkeeperRelease(gkId: string): boolean {
  const rt = gkRuntimes.get(gkId)
  return !!(rt && rt.mode === 'distribute' && rt.distributing)
}

export function finishGkDistribution(gkId: string) {
  const rt = gkRuntimes.get(gkId) ?? defaultRuntime()
  rt.mode = 'idle'
  rt.distributing = false
  rt.saveAnim = null
  rt.holdUntil = 0
  rt.saveLockedUntil = performance.now() + 400
  gkRuntimes.set(gkId, rt)
}

export function tryGoalkeeperBoxClaim(players: PlayerRef[]): PlayerRef | null {
  const store = useGameStore.getState()
  if (!store.fieldBounds || store.ballPossession) return null

  const ball = ballRef.current
  const vel = ballRef.velocity
  const speed = Math.hypot(vel.x, vel.z)
  if (speed > GK_CLAIM_BOX_SPEED) return null
  if (ball.y > GK_REACH_HEIGHT) return null

  let best: PlayerRef | null = null
  let bestDist = Infinity

  for (const p of players) {
    if (p.role !== 'gk') continue
    const rt = gkRuntimes.get(p.id)
    if (rt?.mode === 'save') continue

    if (!isInPenaltyArea(ball, p.team, store.fieldBounds)) continue

    const handDist = minGkHandDist(p.id, ball)
    const bodyDist = distance2D(p.position, ball)
    const d = Math.min(handDist, bodyDist)
    if (d > 0.95) continue

    if (d < bestDist) {
      bestDist = d
      best = p
    }
  }

  return best
}

export function getThreatAwareGkPosition(
  gkPos: Vec3,
  _threat: ShotThreat,
  bounds: FieldBounds,
  team: TeamId,
): { x: number; z: number } {
  return clampGkPosition(gkPos, team, bounds, GK_MAX_STEP_FROM_LINE)
}

export function getGkPositionTarget(
  gkId: string,
  team: TeamId,
  bounds: FieldBounds,
  ball: Vec3,
  vel: Vec3,
): { x: number; z: number } | null {
  const rt = gkRuntimes.get(gkId)
  if (rt?.interceptTarget) return rt.interceptTarget

  const store = useGameStore.getState()
  const threat =
    store.goalZones.length > 0
      ? assessShotThreat(ball, vel, bounds, store.goalZones)
      : null
  const lineZ = gkLineZ(team, bounds)

  if (threat && threat.defendingTeam === team) {
    return clampGkPosition({ x: threat.interceptX, y: 0, z: lineZ }, team, bounds)
  }

  if (isInPenaltyArea(ball, team, bounds)) {
    const predicted = predictBallAtZ(ball, vel, lineZ)
    if (predicted) {
      return clampGkPosition({ x: predicted.x, y: 0, z: lineZ }, team, bounds)
    }
  }

  return null
}

export function getGkMoveTarget(
  gkId: string,
  team: TeamId,
  bounds: FieldBounds,
  _ball: Vec3,
): { x: number; z: number } | null {
  const rt = gkRuntimes.get(gkId)
  if (!rt?.allowStep || rt.mode !== 'save') return null

  if (rt.interceptTarget) {
    return clampGkPosition(
      { x: rt.interceptTarget.x, y: 0, z: rt.interceptTarget.z },
      team,
      bounds,
      rt.stepDepth,
    )
  }

  const gk = playerRegistry.get(gkId)
  if (!gk) return null

  const intoField = getAttackSign(team, bounds)
  const goalZ = getDefensiveGoalZ(team, bounds)
  const tz = goalZ + intoField * Math.min(rt.stepDepth, GK_BODY_SAVE_STEP)
  return clampGkPosition({ x: gk.position.x, y: 0, z: tz }, team, bounds, rt.stepDepth)
}