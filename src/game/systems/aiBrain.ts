import type { FieldBounds, PlayerRole, TeamId, Vec3 } from '../types'
import type { PlayerRef } from './entityRegistry'
import { ballRef, playerRegistry } from './entityRegistry'
import { isOffsideAtPass } from './offside'
import { isForwardMakingRun, type TeamPhase } from './dynamicFormation'
import { QUICK_PASS_POWER } from './shotPower'
import { distance2D, normalize2D } from './rules'
import {
  getAttackingGoalZ,
  getAttackSign,
  getDefensiveGoalZ,
  isBallInDefensiveThird,
} from './teamField'
import { getCrossSetupDribbleDir, isWideCarrier, shouldAICross, type CrossKind } from './aiCross'
import { useGameStore } from '../store/gameStore'
import { getPlayerStamina, isSprintWinded } from './playerStamina'
import { getPlayerAttrMultipliers } from './playerAttributes'
import { getTacticsMultipliers } from './teamTactics'
import { STAMINA_TIRED, STAMINA_WINDING } from '../constants'

export type CarrierAction = 'dribble' | 'pass' | 'shoot' | 'cross'

export type AIPassStyle = {
  power: number
  quickPass: boolean
  through: boolean
}

export interface CarrierDecision {
  action: CarrierAction
  dribbleDir: { x: number; z: number }
  passTarget: PlayerRef | null
  crossTarget: PlayerRef | null
  crossKind: CrossKind
  shootDir: { x: number; z: number }
}

export interface CarrierContext {
  carrier: PlayerRef
  teammates: PlayerRef[]
  opponents: PlayerRef[]
  bounds: FieldBounds
  ball: Vec3
  role: PlayerRole
}

type PassScoreOpts = {
  preferSafety?: boolean
  underPressure?: boolean
  heavyPressure?: boolean
  holdUpRecycle?: boolean
}

const AI_SHOT_RANGE: Record<PlayerRole, number> = {
  gk: 0,
  def: 10.5,
  mid: 15.5,
  fwd: 18.5,
}

const AI_PASS_MIN = 2
const AI_PASS_MAX = 22
const PRESSURE_DIST = 3.25
const HEAVY_PRESSURE_DIST = 1.95
const MARKED_DIST = 2.0
const OPEN_SPACE_MIN = 2.6
/** Score mínimo absoluto para considerar um alvo de passe */
const MIN_VIABLE_PASS_SCORE = 1.45
const MIN_VIABLE_PASS_SCORE_PRESSURE = 1.15

/** Tempo mínimo com a bola antes de considerar passe (exceto emergência / saída de bola) */
export const MIN_HOLD_BEFORE_PASS_MS = 420
/** Tempo mínimo com a bola antes de chutar (exceto cara-a-cara com o gol) */
export const MIN_HOLD_BEFORE_SHOOT_MS = 380
/** Após esse tempo com a bola, força passe se houver alvo */
const FORCE_PASS_HOLD_MS: Record<PlayerRole, number> = {
  gk: 1800,
  def: 720,
  mid: 900,
  /** Atacante quase nunca força passe — vai pro gol */
  fwd: 99999,
}
const ROLE_PASS_HOLD_MS: Record<PlayerRole, number> = {
  gk: 600,
  def: 320,
  mid: 380,
  fwd: 99999,
}
const ROLE_PASS_MIN_SCORE: Record<PlayerRole, number> = {
  gk: 1.8,
  def: 0.75,
  mid: 1.25,
  fwd: 99,
}
const TAP_IN_SHOOT_DIST = 6.4
const FORCE_SHOOT_DIST: Record<PlayerRole, number> = {
  gk: 0,
  def: 9,
  mid: 13,
  fwd: 16.5,
}
const DRIBBLE_STOP_BEFORE_GOAL = 4

/** Direção de drible filtrada por jogador (evita viradas secas) */
const smoothedDribbleDir = new Map<string, { x: number; z: number }>()

/**
 * Stick virtual da IA — meia-lua no marcador + corte, como o player gira o analógico.
 * Nunca snap: só gira o ângulo do stick com rad/s humano.
 */
type AiStickPhase = 'drive' | 'arc' | 'cut'
type AiStickState = {
  sx: number
  sz: number
  side: number
  phase: AiStickPhase
  phaseUntil: number
  markerId: string | null
  lastT: number
  arcAngle: number
  arcFrom: number
  arcTo: number
  arcDur: number
  arcElapsed: number
  /** Ondulação lenta em campo aberto */
  weavePhase: number
  weaveSide: number
  cooldownUntil: number
}

const aiStickById = new Map<string, AiStickState>()

function angleDiff(from: number, to: number): number {
  let d = to - from
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return d
}

function rotateStickToward(
  sx: number,
  sz: number,
  tx: number,
  tz: number,
  maxRad: number,
): { x: number; z: number } {
  const cur = Math.atan2(sx, sz)
  const want = Math.atan2(tx, tz)
  const d = angleDiff(cur, want)
  const step = clamp(d, -maxRad, maxRad)
  const a = cur + step
  return { x: Math.sin(a), z: Math.cos(a) }
}

/** Ease suave tipo stick humano (mais lento no começo/fim) */
function easeInOutQuad(t: number): number {
  const x = clamp(t, 0, 1)
  return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2
}

function getOrInitAiStick(
  id: string,
  toGoal: { x: number; z: number },
  now: number,
): AiStickState {
  let st = aiStickById.get(id)
  if (!st) {
    st = {
      sx: toGoal.x,
      sz: toGoal.z,
      side: Math.random() < 0.5 ? 1 : -1,
      phase: 'drive',
      phaseUntil: 0,
      markerId: null,
      lastT: now,
      arcAngle: Math.atan2(toGoal.x, toGoal.z),
      arcFrom: Math.atan2(toGoal.x, toGoal.z),
      arcTo: Math.atan2(toGoal.x, toGoal.z),
      arcDur: 1.2,
      arcElapsed: 0,
      weavePhase: Math.random() * Math.PI * 2,
      weaveSide: Math.random() < 0.5 ? 1 : -1,
      cooldownUntil: 0,
    }
    aiStickById.set(id, st)
  }
  return st
}

/**
 * Emula analógico: curva contínua → meia-lua no corpo → corte.
 * Stick nunca teleporta; só rota com rad/s limitado.
 */
function emulateAiDribbleStick(
  ctx: CarrierContext,
  bias: { x: number; z: number },
): { x: number; z: number; phase: AiStickPhase } {
  const { carrier, opponents, bounds } = ctx
  const now = performance.now()
  const toGoal = normalize2D(
    bounds.center.x - carrier.position.x,
    getAttackingGoalZ(carrier.team, bounds) - carrier.position.z,
  )
  const st = getOrInitAiStick(carrier.id, toGoal, now)
  const dt = clamp((now - st.lastT) / 1000, 0.008, 0.05)
  st.lastT = now

  const nearest = getNearestOpponent(carrier, opponents)
  const dist = nearest?.dist ?? 99
  const opp = nearest?.opponent ?? null

  let ahead = 0
  if (opp) {
    const toOpp = normalize2D(
      opp.position.x - carrier.position.x,
      opp.position.z - carrier.position.z,
    )
    ahead = toGoal.x * toOpp.x + toGoal.z * toOpp.z
  }

  const pickSide = () => {
    if (!opp) return st.side
    const latX = -toGoal.z
    const latZ = toGoal.x
    const leftProbe = {
      x: carrier.position.x + latX * 2.6 + toGoal.x * 0.8,
      y: 0,
      z: carrier.position.z + latZ * 2.6 + toGoal.z * 0.8,
    }
    const rightProbe = {
      x: carrier.position.x - latX * 2.6 + toGoal.x * 0.8,
      y: 0,
      z: carrier.position.z - latZ * 2.6 + toGoal.z * 0.8,
    }
    const leftOpen = spaceAround(leftProbe, opponents)
    const rightOpen = spaceAround(rightProbe, opponents)
    if (Math.abs(leftOpen - rightOpen) < 0.4) return st.side
    return leftOpen >= rightOpen ? 1 : -1
  }

  /** Começa do ângulo ATUAL do stick — sem snap seco pro lado */
  const startArc = (marker: PlayerRef) => {
    st.phase = 'arc'
    st.markerId = marker.id
    st.side = pickSide()
    const cur = Math.atan2(st.sx, st.sz)
    const base = Math.atan2(toGoal.x, toGoal.z)
    // Abre bem pro lado (~70–110°) e fecha quase no gol (~8–20°)
    const open = 1.15 + Math.random() * 0.55
    const close = 0.12 + Math.random() * 0.18
    const peak = base + st.side * open
    // Se já está do lado certo, não volta: continua do cur em direção ao pico
    const toPeak = angleDiff(cur, peak)
    st.arcFrom = cur
    st.arcTo = Math.abs(toPeak) > 0.2 ? peak : base + st.side * close
    // Arco longo — meia-lua legível
    st.arcDur = 1.15 + Math.random() * 0.75
    st.arcElapsed = 0
    st.arcAngle = cur
    st.phaseUntil = now + st.arcDur * 1000
    // NÃO seta sx/sz — gira até lá
  }

  const startCut = () => {
    st.phase = 'cut'
    // Corte suave, não flick seco
    st.phaseUntil = now + 480 + Math.random() * 320
    st.markerId = null
    st.cooldownUntil = now + 900 + Math.random() * 600
  }

  // Transições — entra na meia-lua CEDO (ainda longe)
  if (st.phase === 'drive') {
    if (
      opp &&
      now >= st.cooldownUntil &&
      dist < 4.2 &&
      dist > 0.7 &&
      ahead > -0.05
    ) {
      startArc(opp)
    }
  } else if (st.phase === 'arc') {
    const marker = st.markerId ? playerRegistry.get(st.markerId) : null
    const mDist = marker ? distance2D(carrier.position, marker.position) : 99
    const pastMarker =
      marker != null &&
      (() => {
        const toM = normalize2D(
          marker.position.x - carrier.position.x,
          marker.position.z - carrier.position.z,
        )
        return toGoal.x * toM.x + toGoal.z * toM.z < -0.08
      })()
    // Só corta no fim do arco (ou se já passou limpo) — não aborta cedo
    if (st.arcElapsed >= st.arcDur * 0.92 || pastMarker) {
      startCut()
    } else if (!marker || mDist > 5.5) {
      startCut()
    } else if (
      opp &&
      opp.id !== st.markerId &&
      dist < 1.35 &&
      ahead > 0.55 &&
      st.arcElapsed > st.arcDur * 0.35
    ) {
      // Novo corpo: continua o arco pro outro lado sem reset seco
      st.markerId = opp.id
      st.side = pickSide()
      const base = Math.atan2(toGoal.x, toGoal.z)
      st.arcTo = base + st.side * (0.35 + Math.random() * 0.25)
      st.arcFrom = st.arcAngle
      st.arcElapsed = 0
      st.arcDur = 0.7 + Math.random() * 0.4
    }
  } else if (st.phase === 'cut') {
    if (now >= st.phaseUntil) {
      st.phase = 'drive'
      st.markerId = null
    }
  }

  let wantX = bias.x
  let wantZ = bias.z
  // ~100–140°/s — stick humano, não robô
  let maxTurn = 2.2 * dt

  if (st.phase === 'arc' && st.markerId) {
    st.arcElapsed += dt
    const marker = playerRegistry.get(st.markerId)
    const t = easeInOutQuad(st.arcElapsed / Math.max(st.arcDur, 0.35))

    // 1ª metade: abre pro lado (arcFrom → peak lateral)
    // 2ª metade: fecha pro gol (peak → close)
    const base = Math.atan2(toGoal.x, toGoal.z)
    const peak = base + st.side * (1.05 + (st.arcDur > 1.4 ? 0.25 : 0))
    const close = base + st.side * 0.14
    if (t < 0.55) {
      const u = easeInOutQuad(t / 0.55)
      st.arcAngle = st.arcFrom + angleDiff(st.arcFrom, peak) * u
    } else {
      const u = easeInOutQuad((t - 0.55) / 0.45)
      st.arcAngle = peak + angleDiff(peak, close) * u
    }

    // Tangente em volta do marcador (círculo) + ângulo do arco
    let circleX = Math.sin(st.arcAngle)
    let circleZ = Math.cos(st.arcAngle)
    if (marker) {
      const away = normalize2D(
        carrier.position.x - marker.position.x,
        carrier.position.z - marker.position.z,
      )
      const tangent = normalize2D(-away.z * st.side, away.x * st.side)
      // Meia-lua = tangente do corpo + peito no arco
      const tw = 0.38 + t * 0.22
      circleX = circleX * (1 - tw) + tangent.x * tw
      circleZ = circleZ * (1 - tw) + tangent.z * tw
      const cl = Math.hypot(circleX, circleZ) || 1
      circleX /= cl
      circleZ /= cl
    }

    // Quase zero de gol no começo; só no fim puxa
    const goalW = 0.06 + t * t * 0.28
    wantX = circleX * (1 - goalW) + toGoal.x * goalW
    wantZ = circleZ * (1 - goalW) + toGoal.z * goalW
    const wLen = Math.hypot(wantX, wantZ) || 1
    wantX /= wLen
    wantZ /= wLen
    maxTurn = 1.85 * dt
  } else if (st.phase === 'cut') {
    // Fecha a meia-lua pro gol — giro moderado (não 9 rad/s seco)
    const latX = -toGoal.z * st.side
    const latZ = toGoal.x * st.side
    const cutT = 1 - clamp((st.phaseUntil - now) / 700, 0, 1)
    wantX = toGoal.x * (0.55 + cutT * 0.35) + latX * (0.35 - cutT * 0.28) + bias.x * 0.1
    wantZ = toGoal.z * (0.55 + cutT * 0.35) + latZ * (0.35 - cutT * 0.28) + bias.z * 0.1
    const wLen = Math.hypot(wantX, wantZ) || 1
    wantX /= wLen
    wantZ /= wLen
    maxTurn = 3.6 * dt
  } else {
    // Campo aberto: serpentina lenta (meia-luas pequenas contínuas)
    st.weavePhase += dt * (0.55 + Math.random() * 0.08)
    if (st.weavePhase > Math.PI * 2) {
      st.weavePhase -= Math.PI * 2
      if (Math.random() < 0.35) st.weaveSide *= -1
    }
    const latX = -toGoal.z
    const latZ = toGoal.x
    const weave = Math.sin(st.weavePhase) * 0.42 * st.weaveSide
    // Pré-curva se tem alguém à frente longe
    let preX = 0
    let preZ = 0
    if (opp && dist < 6.5 && ahead > 0.2) {
      const side = pickSide()
      preX = (-toGoal.z * side) * clamp((6.5 - dist) / 6.5, 0, 1) * 0.55
      preZ = (toGoal.x * side) * clamp((6.5 - dist) / 6.5, 0, 1) * 0.55
    }
    wantX = bias.x * 0.55 + toGoal.x * 0.35 + latX * weave + preX
    wantZ = bias.z * 0.55 + toGoal.z * 0.35 + latZ * weave + preZ
    const wLen = Math.hypot(wantX, wantZ) || 1
    wantX /= wLen
    wantZ /= wLen
    maxTurn = 1.65 * dt
  }

  const next = rotateStickToward(st.sx, st.sz, wantX, wantZ, maxTurn)
  st.sx = next.x
  st.sz = next.z
  return { x: st.sx, z: st.sz, phase: st.phase }
}

export function clearAiDribbleStick(playerId: string) {
  aiStickById.delete(playerId)
  smoothedDribbleDir.delete(playerId)
}

/** Fase do stick virtual (meia-lua / corte) — pra imunidade de ombro */
export function getAiDribbleStickPhase(playerId: string): AiStickPhase | null {
  return aiStickById.get(playerId)?.phase ?? null
}

/**
 * Proteção contra jogo de corpo durante meia-lua/corte da IA
 * (mesmo espírito da finta do player).
 */
export function getAiDribbleStickProtect(playerId: string): number {
  const st = aiStickById.get(playerId)
  if (!st) return 0
  if (st.phase === 'cut') return 0.92
  if (st.phase === 'arc') {
    // No meio do arco já está “driblando” o marcador
    const t = st.arcElapsed / Math.max(st.arcDur, 0.2)
    return 0.55 + clamp(t, 0, 1) * 0.35
  }
  return 0
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v))
}

export function getCarrierContext(
  carrierId: string,
  role: PlayerRole,
  bounds: FieldBounds,
  ball: Vec3,
): CarrierContext | null {
  const carrier = playerRegistry.get(carrierId)
  if (!carrier) return null

  const teammates: PlayerRef[] = []
  const opponents: PlayerRef[] = []

  for (const p of playerRegistry.values()) {
    if (p.id === carrierId) continue
    if (p.team === carrier.team) {
      if (p.role !== 'gk') teammates.push(p)
    } else if (p.role !== 'gk') {
      opponents.push(p)
    }
  }

  return { carrier, teammates, opponents, bounds, ball, role }
}

export function getNearestOpponent(
  carrier: PlayerRef,
  opponents: PlayerRef[],
): { opponent: PlayerRef; dist: number } | null {
  let best: PlayerRef | null = null
  let min = Infinity
  for (const o of opponents) {
    const d = distance2D(carrier.position, o.position)
    if (d < min) {
      min = d
      best = o
    }
  }
  return best ? { opponent: best, dist: min } : null
}

function distToAttackingGoal(team: TeamId, pos: Vec3, bounds: FieldBounds): number {
  const sign = getAttackSign(team, bounds)
  const goalZ = getAttackingGoalZ(team, bounds)
  return (goalZ - pos.z) * sign
}

function forwardProgress(
  team: TeamId,
  from: Vec3,
  to: Vec3,
  bounds: FieldBounds,
): number {
  const sign = getAttackSign(team, bounds)
  return (to.z - from.z) * sign
}

function opponentsOnPassLane(
  from: Vec3,
  to: Vec3,
  opponents: PlayerRef[],
  laneWidth = 1.15,
): number {
  const dx = to.x - from.x
  const dz = to.z - from.z
  const len = Math.hypot(dx, dz)
  if (len < 0.5) return 0

  let blockers = 0
  for (const o of opponents) {
    const ox = o.position.x - from.x
    const oz = o.position.z - from.z
    const t = clamp((ox * dx + oz * dz) / (len * len), 0, 1)
    // Ignora marcador colado no passador/receptor — não é bloqueio de linha
    if (t < 0.14 || t > 0.86) continue
    const px = from.x + dx * t
    const pz = from.z + dz * t
    const lateral = Math.hypot(o.position.x - px, o.position.z - pz)
    if (lateral < laneWidth) blockers++
  }
  return blockers
}

/**
 * Probabilidade de completar o passe (0–1) — estilo xPass / pitch-echo:
 * decaimento por distância × linha limpa × espaço no receptor.
 */
function estimatePassCompletion(
  from: Vec3,
  to: Vec3,
  opponents: PlayerRef[],
  dist: number,
): number {
  const blockers = opponentsOnPassLane(from, to, opponents)
  const open = spaceAround(to, opponents)
  // Distância ideal ~6–14m
  const distFactor =
    dist < 4
      ? 0.72
      : dist <= 14
        ? 1
        : dist <= 18
          ? 0.82
          : clamp(1 - (dist - 18) * 0.06, 0.35, 0.82)
  const laneFactor = blockers === 0 ? 1 : blockers === 1 ? 0.42 : 0.12
  const spaceFactor = clamp(0.45 + open * 0.18, 0.4, 1.15)
  return clamp(distFactor * laneFactor * spaceFactor, 0.05, 1)
}

function spaceAround(pos: Vec3, opponents: PlayerRef[]): number {
  let min = Infinity
  for (const o of opponents) {
    const d = distance2D(pos, o.position)
    if (d < min) min = d
  }
  return min === Infinity ? 10 : min
}

function countOpponentsNear(pos: Vec3, opponents: PlayerRef[], radius: number): number {
  let n = 0
  for (const o of opponents) {
    if (distance2D(pos, o.position) < radius) n++
  }
  return n
}

function isMateMarked(mate: PlayerRef, opponents: PlayerRef[], markDist = MARKED_DIST): boolean {
  return spaceAround(mate.position, opponents) < markDist
}

function lateralSpread(from: Vec3, to: Vec3): number {
  return Math.abs(to.x - from.x)
}

export function scorePassTarget(
  ctx: CarrierContext,
  mate: PlayerRef,
  opts: PassScoreOpts = {},
): number {
  const { carrier, opponents, bounds, ball } = ctx
  const { preferSafety = false, underPressure = false, heavyPressure = false } = opts
  const carrierRole = ctx.role
  const dist = distance2D(carrier.position, mate.position)
  if (dist < AI_PASS_MIN || dist > AI_PASS_MAX) return -10

  if (isOffsideAtPass(carrier.team, mate, bounds, ball.z)) return -12

  const fwd = forwardProgress(carrier.team, carrier.position, mate.position, bounds)
  const open = spaceAround(mate.position, opponents)
  const blockers = opponentsOnPassLane(carrier.position, mate.position, opponents)
  const marked = isMateMarked(mate, opponents)
  const inOwnThird = isBallInDefensiveThird(carrier.position, carrier.team, bounds)
  const completion = estimatePassCompletion(
    carrier.position,
    mate.position,
    opponents,
    dist,
  )

  // Pass Score ≈ completion × progressão (modelo tipo xPass × xT lite)
  const progress =
    fwd > 0.4
      ? clamp(0.35 + fwd * 0.12, 0.35, 1.35)
      : fwd > -0.2
        ? 0.28
        : heavyPressure || (preferSafety && inOwnThird)
          ? 0.18
          : 0.05
  const spaceMul = clamp(0.55 + open * 0.12, 0.55, 1.25)

  let score = completion * progress * spaceMul * 8.5 - 1.2
  score *= 0.88 + getPlayerAttrMultipliers(carrier.id).vision * 0.12

  // Linha suja: penaliza, mas 1 marcador no meio não zera opção boa
  if (blockers >= 2) score -= 4.5
  else if (blockers === 1) score -= 1.6

  if (marked) score -= open > OPEN_SPACE_MIN + 0.8 ? 1.1 : 2.2
  if (isForwardMakingRun(mate.id, mate.team) && blockers === 0) {
    score += marked ? 1.2 : 2.8
  }

  if (mate.role === 'fwd' && !marked && fwd > 0.8) score += 1.4
  else if (mate.role === 'mid' && !marked && fwd > 0.3) score += 0.9
  else if (mate.role === 'def') score += preferSafety || heavyPressure ? 1.2 : -0.8

  // Combo aberto à frente
  if (!marked && blockers === 0 && open > 2.4 && fwd > 0.25) {
    score += 2.2
    if (carrierRole !== 'fwd') score += 0.9
  }

  // Distância doce (toque curto/médio completa mais)
  if (dist >= 4.5 && dist <= 14) score += 1.4
  else if (dist < 3.2) score -= 1.8
  else if (dist > 18) score -= 1.4

  const mateGoalDist = distToAttackingGoal(carrier.team, mate.position, bounds)
  if (mateGoalDist < 8 && !marked && blockers === 0) score += 1.6

  // Build-up: valoriza saída pra frente
  const carrierGoalDist = distToAttackingGoal(carrier.team, carrier.position, bounds)
  if (inOwnThird || carrierGoalDist > 28) {
    if (carrierRole === 'def' && (mate.role === 'mid' || mate.role === 'fwd') && fwd > 0.3) {
      score += 2.2
    }
    if (carrierRole === 'mid' && mate.role === 'fwd' && fwd > 0.8) score += 1.6
  }

  // Pra trás: meia/ataque no campo de ataque quase nunca
  if (fwd < 0.2) {
    const attackRole = carrierRole === 'mid' || carrierRole === 'fwd'
    if (heavyPressure || (preferSafety && inOwnThird)) {
      if (fwd < -0.2) score += clamp(-fwd * 0.25, 0, 1.0)
    } else if (attackRole && !inOwnThird) {
      score -= fwd < -0.2 ? 9 : 6
    } else if (!underPressure) {
      score -= 2.8
    } else {
      score -= 1.4
    }
  }

  const lateral = lateralSpread(carrier.position, mate.position)
  // Troca de lado completa e útil
  if (lateral > 7 && blockers === 0 && completion > 0.55 && dist >= 6) {
    score += 1.8
    if (fwd > 0.2) score += 0.6
  }

  const facing = facingAlignment(carrier, mate.position)
  if (facing < -0.1) score -= 1.6
  else if (facing < 0.2) score -= 0.6
  else score += facing * 0.85

  if (heavyPressure && !marked && blockers === 0 && completion > 0.55) score += 1.4

  if (opts.holdUpRecycle && carrierRole === 'fwd' && fwd < 0.2) {
    score += clamp(-fwd * 0.9, 0, 4)
    if (mate.role === 'mid') score += 2.4
  }

  // Completion baixa = passe que vai ser interceptado — mata a opção
  if (completion < 0.35 && !heavyPressure) score -= 3.5
  if (completion < 0.22) score -= 4

  return score
}

/** Quão bom é seguir conduzindo em vez de passar */
function isDeepBuildUp(ctx: CarrierContext): boolean {
  const { carrier, bounds, role } = ctx
  const goalDist = distToAttackingGoal(carrier.team, carrier.position, bounds)
  const inOwnThird = isBallInDefensiveThird(carrier.position, carrier.team, bounds)
  if (role === 'def' && (inOwnThird || goalDist > 26)) return true
  if (role === 'mid' && (inOwnThird || goalDist > 28)) return true
  if (role === 'mid' && goalDist > 34) return true
  return false
}

function shouldPlayAsTeam(ctx: CarrierContext): boolean {
  const { role, bounds, carrier } = ctx
  // Só build-up no terço próprio — atacante/ponta sempre buscam o gol
  if (role === 'def') return true
  if (role === 'fwd') return false
  if (role === 'mid') {
    if (isWideCarrier(carrier, bounds)) return false
    return isBallInDefensiveThird(carrier.position, carrier.team, bounds)
  }
  return false
}

/** Atacante cercado por marcação — não deve ir sozinho ao gol */
export function isCarrierSurrounded(ctx: CarrierContext): boolean {
  const { carrier, opponents, role } = ctx
  if (role !== 'fwd') return false

  const open = spaceAround(carrier.position, opponents)
  const pressZone = countOpponentsNear(carrier.position, opponents, 3.4)
  const close = countOpponentsNear(carrier.position, opponents, 4.5)

  if (pressZone >= 2 && open < 3.4) return true
  if (close >= 3) return true
  if (close >= 2 && open < 2.5) return true
  return false
}

/** Atacante com espaço — pode ir direto ao gol */
export function isCarrierIsolated(ctx: CarrierContext): boolean {
  const { carrier, opponents, role } = ctx
  if (role !== 'fwd') return false
  const open = spaceAround(carrier.position, opponents)
  const close = countOpponentsNear(carrier.position, opponents, 5.2)
  return open >= 3.6 && close <= 1
}

/** Espaço livre na direção do gol (não só ao redor do portador) */
function spaceAheadTowardGoal(ctx: CarrierContext, lookAhead = 5.5): number {
  const { carrier, opponents, bounds } = ctx
  const sign = getAttackSign(carrier.team, bounds)
  const probe = {
    x: carrier.position.x,
    y: 0,
    z: carrier.position.z + sign * lookAhead,
  }
  return spaceAround(probe, opponents)
}

/**
 * Tem corredor pra correr ao gol — NÃO deve tocar pra trás.
 * Atacante no campo de ataque: SEMPRE drive (fodasse a marcação).
 */
export function canDriveAtGoal(ctx: CarrierContext): boolean {
  const { carrier, opponents, bounds, role } = ctx
  if (role === 'gk') return false
  if (role === 'def' && isBallInDefensiveThird(carrier.position, carrier.team, bounds)) {
    return false
  }

  const nearest = getNearestOpponent(carrier, opponents)
  const pressure = nearest?.dist ?? 10
  const inOwnThird = isBallInDefensiveThird(carrier.position, carrier.team, bounds)
  const wide = isWideCarrier(carrier, bounds)
  const ahead = spaceAheadTowardGoal(ctx, role === 'fwd' || wide ? 4.2 : 5.2)
  const around = spaceAround(carrier.position, opponents)
  const goalDist = distToAttackingGoal(carrier.team, carrier.position, bounds)

  // Atacante fora do terço próprio: SEMPRE vai pro gol
  if (role === 'fwd' && !inOwnThird) return true

  // Ponta no ataque: mesma ideia
  if (wide && !inOwnThird && goalDist < 42) return true

  if (role === 'mid' && !inOwnThird && goalDist < 34) {
    if (pressure < HEAVY_PRESSURE_DIST * 0.85) return false
    if (ahead >= 2.4 || goalDist < 26) return true
  }

  if (pressure < HEAVY_PRESSURE_DIST * 0.92) return false

  if (goalDist > 36 && ahead < 2.8) return false

  if (ahead >= 2.8 && around >= 1.8) return true
  if (ahead >= 2.4 && pressure > PRESSURE_DIST * 0.85 && goalDist < 30) return true
  if (role === 'fwd' && isCarrierIsolated(ctx)) return true
  if (role === 'mid' && ahead >= 2.6 && goalDist < 32) return true
  return false
}

function findRecyclePassTarget(ctx: CarrierContext): PlayerRef | null {
  const opts: PassScoreOpts = {
    preferSafety: true,
    underPressure: true,
    heavyPressure: true,
    holdUpRecycle: true,
  }
  let best: PlayerRef | null = null
  let bestScore = 0.85

  for (const mate of ctx.teammates) {
    const fwd = forwardProgress(
      ctx.carrier.team,
      ctx.carrier.position,
      mate.position,
      ctx.bounds,
    )
    if (fwd > 1.2) continue
    if (isMateMarked(mate, ctx.opponents)) continue
    if (opponentsOnPassLane(ctx.carrier.position, mate.position, ctx.opponents) > 0) continue

    let score = scorePassTarget(ctx, mate, opts)
    if (mate.role === 'mid') score += 1.4
    if (mate.role === 'def') score += 0.8
    if (fwd < -1.5) score += 1.2

    if (score > bestScore) {
      bestScore = score
      best = mate
    }
  }

  return best
}

function getHoldUpLookDir(ctx: CarrierContext): { x: number; z: number } {
  const { carrier, bounds } = ctx
  const team = carrier.team
  const recycle = findRecyclePassTarget(ctx)
  if (recycle) {
    return normalize2D(
      recycle.position.x - carrier.position.x,
      recycle.position.z - carrier.position.z,
    )
  }
  const sign = getAttackSign(team, bounds)
  return { x: 0, z: -sign }
}

/** Recua com a bola pro meio-campo — não para no lugar */
function getHoldUpMoveDir(ctx: CarrierContext): { x: number; z: number } {
  const { carrier, opponents, bounds } = ctx
  const team = carrier.team
  const goalZ = getAttackingGoalZ(team, bounds)
  const goalX = bounds.center.x
  const toGoal = normalize2D(goalX - carrier.position.x, goalZ - carrier.position.z)
  const lateralX = -toGoal.z
  const lateralZ = toGoal.x
  const backward = { x: -toGoal.x, z: -toGoal.z }

  const recycle = findRecyclePassTarget(ctx)
  if (recycle) {
    const toMate = normalize2D(
      recycle.position.x - carrier.position.x,
      recycle.position.z - carrier.position.z,
    )
    const nearest = getNearestOpponent(carrier, opponents)
    if (nearest) {
      const dodge = pickPressureDodge(carrier, nearest, lateralX, lateralZ)
      return normalize2D(toMate.x * 0.78 + dodge.x * 0.14 + backward.x * 0.08, toMate.z * 0.78 + dodge.z * 0.14 + backward.z * 0.08)
    }
    return toMate
  }

  const nearest = getNearestOpponent(carrier, opponents)
  if (nearest) {
    const dodge = pickPressureDodge(carrier, nearest, lateralX, lateralZ)
    return normalize2D(backward.x * 0.72 + dodge.x * 0.28, backward.z * 0.72 + dodge.z * 0.28)
  }

  const wideX = clamp(
    bounds.center.x + (carrier.position.x < bounds.center.x ? 2.8 : -2.8),
    bounds.minX + 1.2,
    bounds.maxX - 1.2,
  )
  const sign = getAttackSign(team, bounds)
  const dropZ = carrier.position.z - sign * 2.4
  const dropShape = normalize2D(wideX - carrier.position.x, dropZ - carrier.position.z)
  return normalize2D(backward.x * 0.62 + dropShape.x * 0.38, backward.z * 0.62 + dropShape.z * 0.38)
}

function evaluateCarryValue(ctx: CarrierContext): number {
  const { carrier, opponents, bounds, role } = ctx
  const open = spaceAround(carrier.position, opponents)
  const ahead = spaceAheadTowardGoal(ctx)
  const goalDist = distToAttackingGoal(carrier.team, carrier.position, bounds)
  const nearest = getNearestOpponent(carrier, opponents)
  const pressure = nearest?.dist ?? 10
  const heavyPressure = pressure < HEAVY_PRESSURE_DIST
  const underPressure = pressure < PRESSURE_DIST
  const inOwnThird = isBallInDefensiveThird(carrier.position, carrier.team, bounds)
  const drive = canDriveAtGoal(ctx)

  let score = 0.2

  if (open >= 4.5) score += 1.2
  else if (open >= OPEN_SPACE_MIN + 0.6) score += 0.55
  else if (open < MARKED_DIST) score -= 2.8

  // Corredor pro gol vale ouro — conduzir > passe
  if (ahead >= 4) score += 3.2
  else if (ahead >= 3.2) score += 2.2
  else if (ahead >= 2.6) score += 1.2

  if (drive) score += 3.8

  if (!underPressure) score += 0.55
  else if (!heavyPressure) score += 0.15
  else score -= 1.6

  if (role === 'fwd') {
    // Atacante: conduzir SEMPRE — marcação não importa
    score += 8
    if (isCarrierIsolated(ctx)) score += 2
    if (goalDist < 12) score += 3
    else if (goalDist < 18) score += 2.2
    else if (goalDist < 26) score += 1.6
    else score += 1.2
  } else if (role === 'mid') {
    if (goalDist < 14) score += 2.0
    else if (goalDist < 20) score += 1.4
    else if (goalDist < 28) score += 1.0
    if (inOwnThird) score -= 1.2
    else if (drive) score += 2.4
  } else if (role === 'def') {
    if (inOwnThird) score -= 6.5
    else if (goalDist > 30) score -= 4.5
    else if (goalDist > 22) score -= 3.2
    else if (goalDist > 16) score -= 1.8
    else if (goalDist > 12) score -= 0.8
  }

  if (inOwnThird && role !== 'fwd') score -= 2
  if (role === 'mid' && !inOwnThird) {
    // Sem teto baixo — meia com espaço conduz
    if (!drive && goalDist > 30) score = Math.min(score, 1.4)
  } else if (role !== 'fwd' && goalDist > 18 && !drive) {
    score = Math.min(score, role === 'mid' ? 1.1 : 0.35)
  }
  if (role === 'def' && goalDist > 14) score = Math.min(score, -0.5)

  const stamina = getPlayerStamina(carrier.id)
  if (stamina <= STAMINA_TIRED || isSprintWinded(carrier.id)) score -= 1.6
  else if (stamina <= STAMINA_WINDING) score -= 0.6

  return score
}

function facingAlignment(carrier: PlayerRef, target: Vec3): number {
  const speed = Math.hypot(carrier.velocity.x, carrier.velocity.z)
  const fx = speed > 0.22 ? carrier.velocity.x / speed : Math.sin(carrier.rotation)
  const fz = speed > 0.22 ? carrier.velocity.z / speed : Math.cos(carrier.rotation)
  const dx = target.x - carrier.position.x
  const dz = target.z - carrier.position.z
  const dist = Math.hypot(dx, dz)
  if (dist < 0.01) return 1
  return (dx * fx + dz * fz) / dist
}

/** Mesmo sistema do jogador: passe rápido (toque) na maioria dos casos */
export function getAIPassParams(
  ctx: CarrierContext,
  target: PlayerRef,
  opts?: { underPressure?: boolean; recycle?: boolean; tired?: boolean },
): AIPassStyle {
  const { carrier, bounds } = ctx
  const dist = distance2D(carrier.position, target.position)
  const fwd = forwardProgress(carrier.team, carrier.position, target.position, bounds)
  const recycle = opts?.recycle ?? fwd < -0.5
  const tired = opts?.tired ?? false
  const runInBehind =
    isForwardMakingRun(target.id, target.team) &&
    fwd > 1.2 &&
    dist >= 5.5 &&
    !recycle &&
    !tired &&
    !opts?.underPressure

  if (runInBehind && dist >= 6) {
    return {
      power: 0.72 + Math.min(dist * 0.008, 0.18),
      quickPass: false,
      through: true,
    }
  }

  if (opts?.underPressure || tired) {
    return {
      power: QUICK_PASS_POWER,
      quickPass: true,
      through: false,
    }
  }

  if (dist >= 16) {
    return {
      power: 0.78 + Math.min(dist * 0.012, 0.14),
      quickPass: false,
      through: false,
    }
  }

  if (recycle) {
    return { power: 0.52, quickPass: true, through: false }
  }

  // Passe curto/médio: toque rápido com potência coerente com a distância
  if (dist < 14) {
    return { power: QUICK_PASS_POWER, quickPass: true, through: false }
  }

  return { power: 0.68, quickPass: false, through: false }
}

/**
 * Pedido de bola (Be a Pro): só libera o passe se a linha/espaço permitir.
 * Sob pressão forte pode arriscar; senão o portador prepara ângulo primeiro.
 */
export function evaluateBallCallDelivery(
  ctx: CarrierContext,
  caller: PlayerRef,
): {
  ready: boolean
  score: number
  underPressure: boolean
  heavyPressure: boolean
  blockers: number
} {
  const nearest = getNearestOpponent(ctx.carrier, ctx.opponents)
  const pressDist = nearest?.dist ?? 99
  const underPressure = pressDist < 3.55
  const heavyPressure = pressDist < 2.15
  const dist = distance2D(ctx.carrier.position, caller.position)

  if (caller.role === 'gk' || dist < 3.6 || dist > 30) {
    return { ready: false, score: -99, underPressure, heavyPressure, blockers: 99 }
  }

  const blockers = opponentsOnPassLane(
    ctx.carrier.position,
    caller.position,
    ctx.opponents,
  )
  const open = spaceAround(caller.position, ctx.opponents)
  const marked = isMateMarked(caller, ctx.opponents)
  let score = scorePassTarget(ctx, caller, {
    underPressure,
    heavyPressure,
    preferSafety: underPressure || heavyPressure,
  })
  // Pediu a bola — prioriza, sem ignorar marcação/linha
  score += 2.2

  let ready = score >= 2.15
  if (blockers >= 2 && !heavyPressure) ready = false
  if (blockers >= 1 && score < 4.2 && !heavyPressure) ready = false
  if (marked && open < 2.35 && !heavyPressure) ready = false
  if (marked && open < 1.7 && heavyPressure && blockers > 0) ready = false
  // Pressão leve + linha suja: primeiro abre ângulo
  if (underPressure && !heavyPressure && blockers > 0 && score < 5) ready = false

  return { ready, score, underPressure, heavyPressure, blockers }
}

/** Enquanto o pedido não está pronto: foge do marcador / abre a linha pro caller. */
export function getBallCallPrepMoveDir(
  ctx: CarrierContext,
  caller: PlayerRef,
): { x: number; z: number } | null {
  const nearest = getNearestOpponent(ctx.carrier, ctx.opponents)
  const toCaller = normalize2D(
    caller.position.x - ctx.carrier.position.x,
    caller.position.z - ctx.carrier.position.z,
  )
  const blockers = opponentsOnPassLane(
    ctx.carrier.position,
    caller.position,
    ctx.opponents,
  )

  if (nearest && nearest.dist < 3.9) {
    const away = normalize2D(
      ctx.carrier.position.x - nearest.opponent.position.x,
      ctx.carrier.position.z - nearest.opponent.position.z,
    )
    return normalize2D(away.x * 0.72 + toCaller.x * 0.28, away.z * 0.72 + toCaller.z * 0.28)
  }

  if (blockers > 0) {
    const sideA = { x: -toCaller.z, z: toCaller.x }
    const sideB = { x: toCaller.z, z: -toCaller.x }
    const probe = (s: { x: number; z: number }) => {
      const px = ctx.carrier.position.x + s.x * 2.2
      const pz = ctx.carrier.position.z + s.z * 2.2
      return spaceAround({ x: px, y: 0, z: pz }, ctx.opponents)
    }
    const side = probe(sideA) >= probe(sideB) ? sideA : sideB
    return normalize2D(side.x * 0.78 + toCaller.x * 0.22, side.z * 0.78 + toCaller.z * 0.22)
  }

  return null
}

/**
 * Companheiro pede bola ao jogador (Be a Pro): livre, boa posição, linha ok.
 * Score baixo = não pede (evita flood).
 */
export function scoreTeammateBallAsk(
  mate: PlayerRef,
  holder: PlayerRef,
  opponents: PlayerRef[],
  bounds: FieldBounds,
  ballZ: number,
): number {
  if (mate.role === 'gk' || mate.id === holder.id) return -99
  const dist = distance2D(mate.position, holder.position)
  if (dist < 5.5 || dist > 24) return -10

  const open = spaceAround(mate.position, opponents)
  const marked = isMateMarked(mate, opponents)
  if (marked || open < OPEN_SPACE_MIN + 0.15) return -8

  const blockers = opponentsOnPassLane(holder.position, mate.position, opponents)
  if (blockers > 0) return -6

  if (isOffsideAtPass(mate.team, mate, bounds, ballZ)) return -12

  const fwd = forwardProgress(holder.team, holder.position, mate.position, bounds)
  let score = 1.2
  score += clamp((open - OPEN_SPACE_MIN) * 1.4, 0, 4.5)
  if (fwd > 1.2) score += clamp(fwd * 0.55, 0, 3.2)
  else if (fwd > 0.2) score += 0.6
  else if (fwd < -1.5) score -= 1.8

  if (dist >= 7 && dist <= 16) score += 1.1
  if (mate.role === 'fwd' && fwd > 1) score += 1.35
  else if (mate.role === 'mid') score += 0.55

  if (isForwardMakingRun(mate.id, mate.team) && fwd > 0.8) score += 1.6

  const lat = Math.abs(mate.position.x - holder.position.x)
  if (lat > 5 && open > OPEN_SPACE_MIN + 0.4) score += 0.7

  return score
}

let lastAiBallCallTickAt = 0
let lastAiBallCallAt = 0

/** 1 pedido por vez — só o melhor companheiro livre, com cooldown. */
export function tickTeammateBallCalls(): void {
  const store = useGameStore.getState()
  if (store.controlMode !== 'pro') return
  if (store.phase !== 'playing' || store.ballFrozen) return

  const now = performance.now()
  if (now - lastAiBallCallTickAt < 380) return
  lastAiBallCallTickAt = now

  if (store.ballCall && now < store.ballCall.until) return
  if (now - lastAiBallCallAt < 3200) return

  const poss = store.ballPossession
  if (!poss || poss.team !== store.userTeam) return
  if (poss.playerId !== store.activePlayerId) return

  const holder = playerRegistry.get(poss.playerId)
  const bounds = store.fieldBounds
  if (!holder || !bounds || holder.role === 'gk') return

  const opponents = [...playerRegistry.values()].filter(
    (p) => p.team !== holder.team && p.role !== 'gk',
  )

  let bestId: string | null = null
  let bestScore = -Infinity
  for (const mate of playerRegistry.values()) {
    if (mate.team !== holder.team || mate.role === 'gk') continue
    if (mate.id === holder.id) continue
    if (store.sentOffPlayers.includes(mate.id)) continue
    const s = scoreTeammateBallAsk(
      mate,
      holder,
      opponents,
      bounds,
      ballRef.current.z,
    )
    if (s > bestScore) {
      bestScore = s
      bestId = mate.id
    }
  }

  // Só pede se estiver bem livre / bem colocado
  if (!bestId || bestScore < 4.6) return
  // Chance — não dispara todo cooldown
  if (Math.random() > 0.42) return

  if (store.requestAiBallCall(bestId)) {
    lastAiBallCallAt = now
  }
}

export function getPassLeadPosition(
  mate: PlayerRef,
  from: Vec3,
  passSpeed: number,
  _bounds?: FieldBounds,
): Vec3 {
  const dx = mate.position.x - from.x
  const dz = mate.position.z - from.z
  const dist = Math.hypot(dx, dz)
  const travelTime = dist / Math.max(passSpeed, 4)
  const lead = Math.min(travelTime * 0.95, 1.55)
  const vx = mate.velocity?.x ?? 0
  const vz = mate.velocity?.z ?? 0
  const speed2 = Math.hypot(vx, vz)
  // Parado: lead na direção do passe (pés), NÃO no peito/facing (errava atrás)
  const toMate = dist > 0.01 ? { x: dx / dist, z: dz / dist } : { x: 0, z: 1 }
  const stillLead = speed2 < 0.35 ? Math.min(0.18 + travelTime * 0.1, 0.32) : 0
  return {
    x: mate.position.x + vx * lead + toMate.x * stillLead,
    y: 0,
    z: mate.position.z + vz * lead + toMate.z * stillLead,
  }
}

export function findBestPassTarget(ctx: CarrierContext): PlayerRef | null {
  const nearest = getNearestOpponent(ctx.carrier, ctx.opponents)
  const pressure = nearest?.dist ?? 10
  const underPressure = pressure < PRESSURE_DIST
  const heavyPressure = pressure < HEAVY_PRESSURE_DIST
  const crowded = countOpponentsNear(ctx.carrier.position, ctx.opponents, 3.4) >= 2
  const inOwnThirdForSafety = isBallInDefensiveThird(
    ctx.carrier.position,
    ctx.carrier.team,
    ctx.bounds,
  )
  const preferSafety =
    heavyPressure ||
    (crowded && inOwnThirdForSafety) ||
    (underPressure && inOwnThirdForSafety)

  const opts: PassScoreOpts = { preferSafety, underPressure, heavyPressure }
  const inOwnThird = inOwnThirdForSafety
  const drive = canDriveAtGoal(ctx)
  const attackRole = ctx.role === 'mid' || ctx.role === 'fwd'
  const deepCarrier = ctx.role === 'def' || (ctx.role === 'mid' && inOwnThird)
  let best: PlayerRef | null = null
  let bestScore = deepCarrier
    ? 0.85
    : preferSafety
      ? MIN_VIABLE_PASS_SCORE_PRESSURE
      : MIN_VIABLE_PASS_SCORE

  for (const mate of ctx.teammates) {
    const fwd = forwardProgress(
      ctx.carrier.team,
      ctx.carrier.position,
      mate.position,
      ctx.bounds,
    )
    // Atacante: nunca considera passe pra trás / lateral (só à frente claro)
    if (ctx.role === 'fwd' && !inOwnThird && fwd < 2.5) continue
    // Com espaço pro gol: só toque claramente à frente
    if (drive && attackRole && fwd < 1.4 && !heavyPressure) continue
    if (attackRole && !inOwnThird && !heavyPressure && fwd < 0.45) continue

    const s = scorePassTarget(ctx, mate, opts)
    if (s > bestScore) {
      bestScore = s
      best = mate
    }
  }

  return best
}

export function findOpenPassTarget(ctx: CarrierContext): PlayerRef | null {
  const nearest = getNearestOpponent(ctx.carrier, ctx.opponents)
  const pressure = nearest?.dist ?? 10
  const underPressure = pressure < PRESSURE_DIST
  const heavyPressure = pressure < HEAVY_PRESSURE_DIST
  const crowded = countOpponentsNear(ctx.carrier.position, ctx.opponents, 3.4) >= 2
  const inOwnThird = isBallInDefensiveThird(
    ctx.carrier.position,
    ctx.carrier.team,
    ctx.bounds,
  )
  // NÃO usar crowded no meio-campo como safety (bug que gerava toque pra trás)
  const preferSafety =
    heavyPressure || (crowded && inOwnThird) || (underPressure && inOwnThird)
  const opts: PassScoreOpts = { preferSafety, underPressure, heavyPressure }
  const drive = canDriveAtGoal(ctx)
  const attackRole = ctx.role === 'mid' || ctx.role === 'fwd'

  let best: PlayerRef | null = null
  let bestScore = MIN_VIABLE_PASS_SCORE_PRESSURE - 0.15

  for (const mate of ctx.teammates) {
    if (isMateMarked(mate, ctx.opponents)) continue
    const fwd = forwardProgress(
      ctx.carrier.team,
      ctx.carrier.position,
      mate.position,
      ctx.bounds,
    )
    if (ctx.role === 'fwd' && !inOwnThird && fwd < 2.5) continue
    if (drive && attackRole && fwd < 1.6 && !heavyPressure) continue
    if (attackRole && !inOwnThird && !heavyPressure && fwd < 0.55) continue

    const s = scorePassTarget(ctx, mate, opts)
    if (s > bestScore) {
      bestScore = s
      best = mate
    }
  }
  return best
}

export function evaluateShot(ctx: CarrierContext): {
  shouldShoot: boolean
  score: number
  dir: { x: number; z: number }
} {
  const { carrier, opponents, bounds, role } = ctx
  const team = carrier.team
  const goalZ = getAttackingGoalZ(team, bounds)
  const goalX = bounds.center.x
  const dist = distToAttackingGoal(team, carrier.position, bounds)
  const dir = normalize2D(goalX - carrier.position.x, goalZ - carrier.position.z)

  const maxRange = AI_SHOT_RANGE[role]
  if (dist > maxRange || role === 'gk') {
    return { shouldShoot: false, score: 0, dir }
  }

  if (role === 'def' && (dist > 4.5 || isBallInDefensiveThird(carrier.position, team, bounds))) {
    return { shouldShoot: false, score: 0, dir }
  }

  if (dist <= TAP_IN_SHOOT_DIST) {
    return { shouldShoot: true, score: 99, dir }
  }

  const blockers = opponentsOnPassLane(
    carrier.position,
    { x: goalX, y: 0, z: goalZ },
    opponents,
    1.4,
  )

  let score = 0
  score += clamp((maxRange - dist) * 1.4, 0, 8)
  score -= blockers * 4
  score += spaceAround(carrier.position, opponents) * 0.55

  if (role === 'fwd') score += 2.5
  else if (role === 'mid') score += 0.8
  else score -= 1

  if (dist < 6) score += 2
  if (dist < 3.5) score += 3

  const threshold = role === 'fwd' ? 4.2 : role === 'mid' ? 5.1 : 6.4

  return {
    shouldShoot: score >= threshold && dist <= maxRange * 0.92,
    score,
    dir,
  }
}

/** Nunca dribla para trás — no mínimo avança um pouco em direção ao gol */
function ensureForwardDribbleDir(
  team: TeamId,
  bounds: FieldBounds,
  dir: { x: number; z: number },
  toGoal: { x: number; z: number },
  minForward = 0.38,
): { x: number; z: number } {
  const sign = getAttackSign(team, bounds)
  let dx = dir.x
  let dz = dir.z
  const fwd = dz * sign

  if (fwd >= minForward) return normalize2D(dx, dz)

  const need = minForward - Math.max(fwd, -0.05)
  const blend = clamp(need / 0.55, 0.35, 0.82)
  dx = dx * (1 - blend) + toGoal.x * blend
  dz = dz * (1 - blend) + toGoal.z * blend

  if (dz * sign < minForward) {
    dz = sign * minForward
  }

  return normalize2D(dx, dz)
}

function pickPressureDodge(
  carrier: PlayerRef,
  nearest: { opponent: PlayerRef },
  lateralX: number,
  lateralZ: number,
): { x: number; z: number } {
  const away = normalize2D(
    carrier.position.x - nearest.opponent.position.x,
    carrier.position.z - nearest.opponent.position.z,
  )
  const latSign = away.x * lateralX + away.z * lateralZ >= 0 ? 1 : -1
  return normalize2D(lateralX * latSign, lateralZ * latSign)
}

/**
 * Desvia só de quem está NO CAMINHO — raio curto, lado sticky.
 * Versão anterior lateralizava demais e a IA andava igual burro.
 */
const steerDodgeSide = new Map<string, { sign: number; until: number }>()

export function steerAiMoveDir(
  selfId: string,
  dirX: number,
  dirZ: number,
  opts?: { withBall?: boolean; light?: boolean },
): { x: number; z: number } {
  const self = playerRegistry.get(selfId)
  if (!self) return normalize2D(dirX, dirZ)

  const len = Math.hypot(dirX, dirZ)
  if (len < 0.06) return { x: 0, z: 0 }

  let dx = dirX / len
  let dz = dirZ / len
  const withBall = opts?.withBall === true
  const light = opts?.light === true

  let avoidX = 0
  let avoidZ = 0
  let closestAhead = Infinity
  let bestLatSign = 0

  const now = performance.now()
  const sticky = steerDodgeSide.get(selfId)
  const stickySign =
    sticky && now < sticky.until ? sticky.sign : 0

  for (const other of playerRegistry.values()) {
    if (other.id === selfId) continue

    const ox = self.position.x - other.position.x
    const oz = self.position.z - other.position.z
    const dist = Math.hypot(ox, oz)
    const sameTeam = other.team === self.team
    // Companheiros: raio maior pra não se atropelar no apoio
    const radius = sameTeam
      ? withBall
        ? 1.85
        : light
          ? 1.75
          : 2.15
      : withBall
        ? 2.05
        : 1.85
    if (dist > radius || dist < 1e-4) continue

    const toOtherX = -ox / dist
    const toOtherZ = -oz / dist
    const ahead = dx * toOtherX + dz * toOtherZ

    // Companheiro: desvia mesmo se estiver um pouco ao lado (não só cone estreito)
    const aheadMin = sameTeam ? (light ? 0.2 : -0.15) : light ? 0.45 : 0.32
    if (ahead < aheadMin) continue
    if (!sameTeam && dist > (light ? 1.7 : 2.1) && ahead < 0.55) continue

    const awayX = ox / dist
    const awayZ = oz / dist
    const latX = -dz
    const latZ = dx
    let latSign = awayX * latX + awayZ * latZ >= 0 ? 1 : -1
    if (stickySign !== 0) latSign = stickySign

    const proximity = 1 - dist / radius
    const pathThreat = 0.7 + Math.max(ahead, 0) * 0.9
    const weight =
      proximity * proximity * pathThreat * (sameTeam ? 1.45 : 1.0) * (dist < 1.25 ? 1.4 : 1)

    avoidX += (latX * latSign * 0.85 + awayX * 0.15) * weight
    avoidZ += (latZ * latSign * 0.85 + awayZ * 0.15) * weight

    if (dist < closestAhead) {
      closestAhead = dist
      bestLatSign = latSign
    }
  }

  if (bestLatSign !== 0) {
    steerDodgeSide.set(selfId, { sign: bestLatSign, until: now + 520 })
  }

  const avoidLen = Math.hypot(avoidX, avoidZ)
  if (avoidLen < 0.05) return { x: dx, z: dz }

  const ax = avoidX / avoidLen
  const az = avoidZ / avoidLen
  const maxW = light ? 0.28 : withBall ? 0.42 : 0.52
  const minW = light ? 0.1 : withBall ? 0.16 : 0.22
  const urgency = closestAhead < 1.2 ? 0.7 : closestAhead < 1.6 ? 0.5 : 0.32
  const avoidW = clamp(avoidLen * 0.28 + urgency * 0.22, minW, maxW)

  const mixed = normalize2D(dx * (1 - avoidW) + ax * avoidW, dz * (1 - avoidW) + az * avoidW)
  const keep = light ? 0.55 : withBall ? 0.42 : 0.28
  return normalize2D(mixed.x * (1 - keep) + dx * keep, mixed.z * (1 - keep) + dz * keep)
}

function blendDirTowardMate(
  carrier: PlayerRef,
  base: { x: number; z: number },
  mate: PlayerRef,
  weight: number,
): { x: number; z: number } {
  const toMate = normalize2D(
    mate.position.x - carrier.position.x,
    mate.position.z - carrier.position.z,
  )
  return normalize2D(
    base.x * (1 - weight) + toMate.x * weight,
    base.z * (1 - weight) + toMate.z * weight,
  )
}

export function getDribbleDirection(ctx: CarrierContext): { x: number; z: number } {
  const raw = computeDribbleDirectionRaw(ctx)
  const stick = emulateAiDribbleStick(ctx, raw)
  const toGoal = normalize2D(
    ctx.bounds.center.x - ctx.carrier.position.x,
    getAttackingGoalZ(ctx.carrier.team, ctx.bounds) - ctx.carrier.position.z,
  )

  // Stick manda SEMPRE — sem steer bruto (secava a meia-lua)
  const steered = { x: stick.x, z: stick.z }

  // No arco: lateral livre. No cut/drive: só um piso leve pra frente
  if (stick.phase === 'arc') {
    // Zero force-forward — senão vira linha reta
    const prev = smoothedDribbleDir.get(ctx.carrier.id)
    const blend = 0.18
    if (!prev) {
      smoothedDribbleDir.set(ctx.carrier.id, steered)
      return steered
    }
    const x = prev.x + (steered.x - prev.x) * blend
    const z = prev.z + (steered.z - prev.z) * blend
    const outLen = Math.hypot(x, z) || 1
    const out = { x: x / outLen, z: z / outLen }
    smoothedDribbleDir.set(ctx.carrier.id, out)
    return out
  }

  const kept = ensureForwardDribbleDir(
    ctx.carrier.team,
    ctx.bounds,
    steered,
    toGoal,
    stick.phase === 'cut' ? 0.12 : 0.22,
  )

  const prev = smoothedDribbleDir.get(ctx.carrier.id)
  if (!prev) {
    smoothedDribbleDir.set(ctx.carrier.id, { x: kept.x, z: kept.z })
    return kept
  }
  const blend = stick.phase === 'cut' ? 0.22 : 0.14
  const x = prev.x + (kept.x - prev.x) * blend
  const z = prev.z + (kept.z - prev.z) * blend
  const outLen = Math.hypot(x, z) || 1
  const out = { x: x / outLen, z: z / outLen }
  smoothedDribbleDir.set(ctx.carrier.id, out)
  return out
}

function computeDribbleDirectionRaw(ctx: CarrierContext): { x: number; z: number } {
  const { carrier, opponents, bounds, role } = ctx
  const team = carrier.team
  const sign = getAttackSign(team, bounds)
  const goalZ = getAttackingGoalZ(team, bounds)
  const goalX = bounds.center.x
  const goalDist = distToAttackingGoal(team, carrier.position, bounds)
  const inOwnThird = isBallInDefensiveThird(carrier.position, team, bounds)

  const toGoal = normalize2D(goalX - carrier.position.x, goalZ - carrier.position.z)
  const nearest = getNearestOpponent(carrier, opponents)
  const heavyPressure = (nearest?.dist ?? 10) < HEAVY_PRESSURE_DIST
  const underPressure = (nearest?.dist ?? 10) < PRESSURE_DIST
  const crowded = countOpponentsNear(carrier.position, opponents, 3.2) >= 2

  const lateralX = -toGoal.z
  const lateralZ = toGoal.x
  const lateral = normalize2D(lateralX, lateralZ)

  // Atacante: bias = gol. Meia-lua / corte vêm do stick virtual (emulateAiDribbleStick).
  if (role === 'fwd') {
    return ensureForwardDribbleDir(team, bounds, toGoal, toGoal, 0.55)
  }

  // Meia com corredor: bias pro gol — stick faz o arco no marcador
  if (role === 'mid' && canDriveAtGoal(ctx)) {
    return ensureForwardDribbleDir(team, bounds, toGoal, toGoal, 0.45)
  }

  // Zagueiro/volante atrás: lateraliza na formação — não avança sozinho ao gol
  if ((role === 'def' || (role === 'mid' && goalDist > 28)) && inOwnThird) {
    const wideX = clamp(
      bounds.center.x + (carrier.position.x < bounds.center.x ? -3.5 : 3.5),
      bounds.minX + 1.2,
      bounds.maxX - 1.2,
    )
    const shapeDir = normalize2D(wideX - carrier.position.x, sign * 2.2)
    const dx = lateral.x * 0.32 + shapeDir.x * 0.28 + toGoal.x * 0.4
    const dz = lateral.z * 0.32 + shapeDir.z * 0.28 + toGoal.z * 0.4
    return ensureForwardDribbleDir(team, bounds, normalize2D(dx, dz), toGoal, 0.28)
  }

  if (role === 'mid' && inOwnThird && goalDist > 22) {
    const dx = toGoal.x * 0.55 + lateral.x * 0.28
    const dz = toGoal.z * 0.55 + lateral.z * 0.28
    return ensureForwardDribbleDir(team, bounds, normalize2D(dx, dz), toGoal, 0.32)
  }

  // Pressão: desvia lateralmente mas SEMPRE avança — nunca corre para trás
  if (nearest && (heavyPressure || crowded || underPressure)) {
    const dodge = pickPressureDodge(carrier, nearest, lateralX, lateralZ)
    const lateralWeight = heavyPressure ? 0.55 : crowded ? 0.48 : 0.4
    const dx = toGoal.x * (1 - lateralWeight) + dodge.x * lateralWeight
    const dz = toGoal.z * (1 - lateralWeight) + dodge.z * lateralWeight
    return ensureForwardDribbleDir(
      team,
      bounds,
      normalize2D(dx, dz),
      toGoal,
      heavyPressure ? 0.32 : 0.42,
    )
  }

  let dx = toGoal.x
  let dz = toGoal.z

  if (goalDist < DRIBBLE_STOP_BEFORE_GOAL) {
    // Perto do gol: abre ângulo, mas não vira 100% lateral parado
    const latLen = Math.hypot(lateralX, lateralZ) || 1
    const lx = lateralX / latLen
    const lz = lateralZ / latLen
    return ensureForwardDribbleDir(
      team,
      bounds,
      normalize2D(lx * 0.62 + toGoal.x * 0.38, lz * 0.62 + toGoal.z * 0.38),
      toGoal,
      0.22,
    )
  }

  if (goalDist < DRIBBLE_STOP_BEFORE_GOAL + 2.5) {
    const slow = clamp((goalDist - DRIBBLE_STOP_BEFORE_GOAL) / 2.5, 0.25, 1)
    dx *= slow
    dz *= slow
  }

  if (isBallInDefensiveThird(carrier.position, team, bounds)) {
    const ownGoalZ = getDefensiveGoalZ(team, bounds)
    const awayOwnGoal = normalize2D(
      carrier.position.x - bounds.center.x,
      carrier.position.z - (ownGoalZ + sign * 2),
    )
    dx = dx * 0.55 + awayOwnGoal.x * 0.2 + toGoal.x * 0.25
    dz = dz * 0.55 + awayOwnGoal.z * 0.2 + toGoal.z * 0.25
  }

  let dir = ensureForwardDribbleDir(team, bounds, normalize2D(dx, dz), toGoal, 0.3)

  const crossDir = getCrossSetupDribbleDir(ctx)
  if (crossDir && goalDist < 34 && goalDist > 7) {
    const depth = goalDist
    // Lateral/ponta: prioriza fundo de campo pra cruzar
    const w = isWideCarrier(carrier, bounds)
      ? depth < 18
        ? 0.72
        : 0.78
      : 0.44
    const mixed = normalize2D(
      dir.x * (1 - w) + crossDir.x * w,
      dir.z * (1 - w) + crossDir.z * w,
    )
    dir = ensureForwardDribbleDir(team, bounds, mixed, toGoal, 0.2)
  }

  if (shouldPlayAsTeam(ctx) && !canDriveAtGoal(ctx)) {
    const mate = findBestPassTarget(ctx)
    if (mate) {
      const blend =
        role === 'def' ? 0.62 : role === 'mid' ? 0.48 : goalDist > 24 ? 0.28 : 0.12
      const minFwd = role === 'def' ? 0.06 : role === 'mid' ? 0.1 : 0.18
      dir = ensureForwardDribbleDir(
        team,
        bounds,
        blendDirTowardMate(carrier, dir, mate, blend),
        toGoal,
        minFwd,
      )
    }
  }

  return dir
}

/** Portador deve correr com a bola — recuo sob marcação é trote, não parada */
export function shouldCarrierSprint(ctx: CarrierContext, phase: TeamPhase): boolean {
  if (ctx.role === 'gk') return false
  if (phase === 'defense') return false
  const inOwnThird = isBallInDefensiveThird(
    ctx.carrier.position,
    ctx.carrier.team,
    ctx.bounds,
  )
  if ((ctx.role === 'fwd' || ctx.role === 'mid') && !inOwnThird) return true
  if (isWideCarrier(ctx.carrier, ctx.bounds) && !inOwnThird) return true
  if (ctx.role === 'fwd' && isCarrierIsolated(ctx)) return true
  return true
}

export type CarrierMoveIntent = {
  dirX: number
  dirZ: number
  sprint: boolean
  holdUp: boolean
  lookDir: { x: number; z: number } | null
}

export function getCarrierMoveIntent(ctx: CarrierContext, phase: TeamPhase): CarrierMoveIntent {
  const inOwnThird = isBallInDefensiveThird(
    ctx.carrier.position,
    ctx.carrier.team,
    ctx.bounds,
  )
  const holdUp =
    ctx.role === 'fwd' &&
    inOwnThird &&
    isCarrierSurrounded(ctx) &&
    !isCarrierIsolated(ctx)
  const dir = holdUp ? getHoldUpMoveDir(ctx) : getDribbleDirection(ctx)
  const sprint = holdUp ? false : shouldCarrierSprint(ctx, phase)
  return {
    dirX: dir.x,
    dirZ: dir.z,
    sprint,
    holdUp,
    lookDir: holdUp ? getHoldUpLookDir(ctx) : null,
  }
}

export function getDribbleTarget(
  ctx: CarrierContext,
  lookahead = 3.5,
): { x: number; z: number } {
  const dir = getDribbleDirection(ctx)
  const { carrier, bounds, role } = ctx
  const team = carrier.team
  const sign = getAttackSign(team, bounds)
  const goalZ = getAttackingGoalZ(team, bounds)
  const stopZ = goalZ - sign * DRIBBLE_STOP_BEFORE_GOAL
  const goalDist = distToAttackingGoal(team, carrier.position, bounds)
  const inOwnThird = isBallInDefensiveThird(carrier.position, team, bounds)

  let effectiveLookahead = lookahead
  if (role === 'def' && inOwnThird) effectiveLookahead = 1.5
  else if (role === 'mid' && inOwnThird && goalDist > 22) effectiveLookahead = 2.1
  else if (role === 'def' && goalDist > 28) effectiveLookahead = 2

  let x = carrier.position.x + dir.x * effectiveLookahead
  let z = carrier.position.z + dir.z * effectiveLookahead

  if (sign > 0) z = Math.min(z, stopZ)
  else z = Math.max(z, stopZ)

  // Limita avanço de zagueiros no terço defensivo
  if (role === 'def' && inOwnThird) {
    const maxFwd = carrier.position.z + sign * 4.5
    if (sign > 0) z = Math.min(z, maxFwd)
    else z = Math.max(z, maxFwd)
  }

  const margin = 0.85
  x = clamp(x, bounds.minX + margin, bounds.maxX - margin)
  z = clamp(z, bounds.minZ + margin, bounds.maxZ - margin)

  return { x, z }
}

export function decideCarrierAction(
  ctx: CarrierContext,
  holdMs = 0,
): CarrierDecision {
  const { carrier, role, bounds, opponents } = ctx
  const tactics = getTacticsMultipliers(carrier.team)
  const dribbleDir = getDribbleDirection(ctx)
  const shot = evaluateShot(ctx)
  const nearest = getNearestOpponent(carrier, opponents)
  const pressure = nearest?.dist ?? 10
  const underPressure = pressure < PRESSURE_DIST
  const heavyPressure = pressure < HEAVY_PRESSURE_DIST
  const crowded = countOpponentsNear(carrier.position, opponents, 3.4) >= 2
  const inOwnThirdEarly = isBallInDefensiveThird(carrier.position, carrier.team, bounds)
  const preferSafety =
    heavyPressure ||
    (crowded && inOwnThirdEarly) ||
    tactics.buildUpPassPrefer > 0.05
  const stamina = getPlayerStamina(carrier.id)
  const tired = stamina <= STAMINA_TIRED || isSprintWinded(carrier.id)
  const winding = stamina <= STAMINA_WINDING
  const fwdSurrounded =
    role === 'fwd' &&
    inOwnThirdEarly &&
    isCarrierSurrounded(ctx) &&
    !isCarrierIsolated(ctx)
  const recycleTarget = fwdSurrounded ? findRecyclePassTarget(ctx) : null
  const recycleScore = recycleTarget
    ? scorePassTarget(ctx, recycleTarget, {
        preferSafety: true,
        underPressure,
        heavyPressure,
        holdUpRecycle: true,
      })
    : 0

  const carryScore = evaluateCarryValue(ctx)
  const passTarget = findBestPassTarget(ctx)
  const passScore = passTarget
    ? scorePassTarget(ctx, passTarget, { preferSafety, underPressure, heavyPressure })
    : 0
  const openTarget = findOpenPassTarget(ctx)
  const openPassScore = openTarget
    ? scorePassTarget(ctx, openTarget, { preferSafety, underPressure, heavyPressure })
    : 0

  const goalDist = distToAttackingGoal(carrier.team, carrier.position, bounds)
  const tapIn = goalDist < TAP_IN_SHOOT_DIST
  const canShootYet = holdMs >= MIN_HOLD_BEFORE_SHOOT_MS || tapIn

  if (canShootYet && role !== 'gk' && tapIn && shot.shouldShoot) {
    return { action: 'shoot', dribbleDir, passTarget: null, crossTarget: null, crossKind: 'box', shootDir: shot.dir }
  }

  if (shot.shouldShoot && canShootYet && goalDist <= FORCE_SHOOT_DIST[role] * 0.88) {
    return { action: 'shoot', dribbleDir, passTarget: null, crossTarget: null, crossKind: 'box', shootDir: shot.dir }
  }

  // Atacante fora do terço próprio: NÃO PASSA — só chuta, cruza ou corre pro gol
  if (role === 'fwd' && !inOwnThirdEarly) {
    const crossChance = shouldAICross(ctx, holdMs, 0)
    if (crossChance?.target) {
      return {
        action: 'cross',
        dribbleDir,
        passTarget: null,
        crossTarget: crossChance.target,
        crossKind: crossChance.kind,
        shootDir: shot.dir,
      }
    }
    return {
      action: 'dribble',
      dribbleDir,
      passTarget: null,
      crossTarget: null,
      crossKind: 'box',
      shootDir: shot.dir,
    }
  }

  // Preferir companheiro LIVRE — o "melhor" marcado travava a IA no drible eterno
  let chosenPass: PlayerRef | null = null
  if (
    openTarget &&
    (openPassScore >= passScore - (tired || heavyPressure ? 0.85 : 0.35) ||
      (passTarget != null && isMateMarked(passTarget, opponents)))
  ) {
    chosenPass = openTarget
  } else if (passTarget && !isMateMarked(passTarget, opponents)) {
    chosenPass = passTarget
  } else if (openTarget) {
    chosenPass = openTarget
  } else if (passTarget && (heavyPressure || tired || preferSafety)) {
    // Sob pressão/cansaço: passa mesmo marcado (melhor que driblar parado)
    chosenPass = passTarget
  } else {
    chosenPass = passTarget
  }

  if (
    fwdSurrounded &&
    recycleTarget &&
    recycleScore >= Math.max(passScore, openPassScore) - 0.35
  ) {
    chosenPass = recycleTarget
  }
  const chosenScore = chosenPass
    ? scorePassTarget(ctx, chosenPass, { preferSafety, underPressure, heavyPressure })
    : 0
  const mateOpen = chosenPass != null && !isMateMarked(chosenPass, opponents)
  const matePlayable =
    chosenPass != null &&
    (mateOpen || heavyPressure || tired || (preferSafety && winding))
  const laneOk = (maxBlockers: number) =>
    blockersOnPass(chosenPass, ctx) <= maxBlockers
  const recycle =
    chosenPass != null &&
    forwardProgress(carrier.team, carrier.position, chosenPass.position, bounds) < -0.5

  const inOwnThird = inOwnThirdEarly
  const deepBuildUp = isDeepBuildUp(ctx)
  const teamPlay = shouldPlayAsTeam(ctx)

  const forceHoldMul = tired ? 0.55 : winding ? 0.72 : 1
  const tempoMul = tactics.tempoThinkScale
  const emergencyHold = heavyPressure && holdMs >= (tired ? 260 : 360) * tempoMul
  const pressureHold = underPressure && holdMs >= (tired ? 360 : 480) * tempoMul
  const normalHold = holdMs >= MIN_HOLD_BEFORE_PASS_MS * (tired ? 0.7 : 1) * tempoMul
  const buildUpHoldBase = role === 'def' ? 420 : role === 'mid' ? 520 : MIN_HOLD_BEFORE_PASS_MS
  const buildUpHold =
    buildUpHoldBase *
    tempoMul *
    (tactics.buildUpPassPrefer > 0 ? 0.88 : tactics.buildUpPassPrefer < 0 ? 1.12 : 1)
  const roleHold = holdMs >= ROLE_PASS_HOLD_MS[role] * (tired ? 0.75 : 1) * tempoMul
  const passFwd =
    chosenPass != null
      ? forwardProgress(carrier.team, carrier.position, chosenPass.position, bounds)
      : 0
  const wideCarrier = isWideCarrier(carrier, bounds)
  const attackCarrier = role === 'fwd' || role === 'mid' || wideCarrier
  // Meia/ataque/ponta: bloqueia reciclagem pra trás fora do terço defensivo
  const attackNoRecycle =
    attackCarrier &&
    !inOwnThird &&
    !heavyPressure &&
    passFwd < 0.15 - tactics.chanceCreationForward * 0.4
  const drive = canDriveAtGoal(ctx)
  // Com corredor: só toque claramente à frente
  const driveBlocksPass =
    drive &&
    attackCarrier &&
    !heavyPressure &&
    passFwd < 0.55 + tactics.buildUpPassPrefer * 0.35 &&
    tactics.buildUpPassPrefer <= 0.08

  if (role === 'gk') {
    if (passTarget && passScore >= 2.4 && holdMs >= 700) {
      return { action: 'pass', dribbleDir, passTarget, crossTarget: null, crossKind: 'box', shootDir: shot.dir }
    }
    if (holdMs >= 2200 && passTarget && passScore >= 1.8) {
      return { action: 'pass', dribbleDir, passTarget, crossTarget: null, crossKind: 'box', shootDir: shot.dir }
    }
    return { action: 'dribble', dribbleDir, passTarget: null, crossTarget: null, crossKind: 'box', shootDir: shot.dir }
  }

  // Espaço pro gol: conduz — passe só se for claramente à frente
  if (drive && attackCarrier && !heavyPressure) {
    const easyComplete =
      chosenPass &&
      mateOpen &&
      passFwd > 1.2 &&
      chosenScore >= 2.4 &&
      laneOk(0) &&
      holdMs >= 380
    const greatForward =
      chosenPass &&
      mateOpen &&
      passFwd > 2.4 &&
      chosenScore >= carryScore + 1.8 &&
      laneOk(0) &&
      holdMs >= 420
    if (!easyComplete && !greatForward && holdMs < FORCE_PASS_HOLD_MS[role] * 0.85) {
      return {
        action: 'dribble',
        dribbleDir,
        passTarget: null,
        crossTarget: null,
        crossKind: 'box',
        shootDir: shot.dir,
      }
    }
  }

  let passThreshold =
    role === 'def' ? 1.05 : role === 'mid' ? 1.35 : 1.5

  if (heavyPressure) passThreshold -= 0.35
  else if (underPressure) passThreshold -= 0.15
  if (deepBuildUp) passThreshold -= 0.35
  if (teamPlay && role === 'def') passThreshold -= 0.35
  if (tired) passThreshold -= 0.3
  else if (winding) passThreshold -= 0.12
  if (drive) passThreshold += 0.55
  if (attackCarrier && !inOwnThird && goalDist < 30) passThreshold += 0.45

  let beatCarryBy = heavyPressure ? 0.05 : preferSafety ? 0.15 : 0.4
  if (tired) beatCarryBy -= 0.2
  else if (winding) beatCarryBy -= 0.08
  if (deepBuildUp && role === 'def') beatCarryBy += 3.5
  else if (role === 'def' && goalDist > 20) beatCarryBy += 3
  else if (drive) beatCarryBy += 1.35
  else if (attackCarrier && !inOwnThird) beatCarryBy += 0.95

  const chosenOpen = chosenPass ? spaceAround(chosenPass.position, opponents) : 0
  const maxBlock = tired || heavyPressure ? 1 : 0
  const allowPass =
    !attackNoRecycle &&
    !driveBlocksPass &&
    !(
      attackCarrier &&
      !inOwnThird &&
      !heavyPressure &&
      passFwd < 0.35
    )

  const roleReleasePass =
    roleHold &&
    chosenPass &&
    matePlayable &&
    chosenScore >= ROLE_PASS_MIN_SCORE[role] &&
    allowPass &&
    laneOk(maxBlock)

  const defExitPass =
    role === 'def' &&
    inOwnThird &&
    holdMs >= (tired ? 380 : 480) &&
    chosenPass &&
    matePlayable &&
    chosenScore >= 0.8 &&
    passFwd > 0.2 &&
    laneOk(maxBlock)

  const buildUpPass =
    deepBuildUp &&
    holdMs >= buildUpHold * (tired ? 0.75 : 1) &&
    chosenPass &&
    matePlayable &&
    chosenScore >= (role === 'def' ? 0.85 : 1.35) &&
    (role === 'def' || passFwd > 0.5) &&
    allowPass &&
    laneOk(maxBlock)

  const linkPass =
    role === 'mid' &&
    goalDist > 20 &&
    holdMs >= (tired ? 420 : 560) &&
    chosenPass &&
    matePlayable &&
    chosenScore >= 1.6 &&
    passFwd > 0.8 &&
    allowPass &&
    laneOk(maxBlock)

  const comboPass =
    role === 'fwd' &&
    !fwdSurrounded &&
    holdMs >= (tired ? 480 : 620) &&
    chosenPass &&
    mateOpen &&
    chosenScore >= 1.55 &&
    passFwd > 0.8 &&
    (isForwardMakingRun(chosenPass.id, chosenPass.team) ||
      chosenOpen > OPEN_SPACE_MIN + 0.9) &&
    allowPass &&
    laneOk(0)

  const holdUpRecyclePass =
    fwdSurrounded &&
    recycleTarget &&
    chosenPass === recycleTarget &&
    matePlayable &&
    holdMs >= 320 &&
    recycleScore >= 0.9 &&
    laneOk(maxBlock)

  const fwdMarkedPass =
    role === 'fwd' &&
    fwdSurrounded &&
    holdMs >= 420 &&
    chosenPass &&
    matePlayable &&
    chosenScore >= 1.05 &&
    chosenOpen > OPEN_SPACE_MIN - 0.2 &&
    laneOk(maxBlock)

  const teamBuildingPass =
    chosenPass &&
    role === 'def' &&
    holdMs >= 420 * (tired ? 0.75 : 1) &&
    matePlayable &&
    chosenScore >= 0.88 &&
    passFwd > 0.2 &&
    laneOk(maxBlock)

  const emergencyPass =
    emergencyHold &&
    matePlayable &&
    chosenScore >= MIN_VIABLE_PASS_SCORE_PRESSURE - (tired ? 0.2 : 0) &&
    laneOk(1)

  const pressurePass =
    pressureHold &&
    matePlayable &&
    chosenScore >= passThreshold - 0.4 &&
    allowPass &&
    laneOk(maxBlock)

  const openMatePass =
    normalHold &&
    mateOpen &&
    chosenOpen > OPEN_SPACE_MIN + 0.35 &&
    chosenScore >= passThreshold - 0.35 &&
    passFwd > (attackCarrier && !inOwnThird ? 0.35 : -0.15) &&
    allowPass &&
    laneOk(0)

  const buildingPass =
    normalHold &&
    matePlayable &&
    chosenScore >= passThreshold &&
    chosenScore >= carryScore + beatCarryBy &&
    laneOk(maxBlock) &&
    allowPass &&
    passFwd > (attackCarrier && !inOwnThird ? 0.35 : -0.15)

  const safetyRecycle =
    preferSafety &&
    inOwnThird &&
    (heavyPressure || fwdSurrounded) &&
    normalHold &&
    recycle &&
    matePlayable &&
    chosenScore >= (fwdSurrounded ? 0.9 : 1.8) &&
    laneOk(maxBlock)

  const forcePass =
    holdMs >= FORCE_PASS_HOLD_MS[role] * forceHoldMul &&
    matePlayable &&
    chosenScore >= (role === 'def' ? 0.75 : role === 'mid' ? 1.5 : 1.7) &&
    allowPass &&
    passFwd > (attackCarrier && !inOwnThird ? 0.35 : -0.2) &&
    laneOk(tired || heavyPressure ? 1 : 0)

  // Cansaço: só dump se não tiver corredor; senão conduz
  const tiredDumpPass =
    tired &&
    !drive &&
    holdMs >= 480 &&
    chosenPass &&
    matePlayable &&
    chosenScore >= 0.7 &&
    allowPass &&
    laneOk(1)

  const crossChance = shouldAICross(ctx, holdMs, chosenScore)
  if (crossChance?.target) {
    return {
      action: 'cross',
      dribbleDir,
      passTarget: null,
      crossTarget: crossChance.target,
      crossKind: crossChance.kind,
      shootDir: shot.dir,
    }
  }

  if (
    roleReleasePass ||
    defExitPass ||
    buildUpPass ||
    linkPass ||
    comboPass ||
    holdUpRecyclePass ||
    fwdMarkedPass ||
    teamBuildingPass ||
    emergencyPass ||
    pressurePass ||
    openMatePass ||
    buildingPass ||
    safetyRecycle ||
    forcePass ||
    tiredDumpPass
  ) {
    return {
      action: 'pass',
      dribbleDir,
      passTarget: chosenPass,
      crossTarget: null,
      crossKind: 'box',
      shootDir: shot.dir,
    }
  }

  return {
    action: 'dribble',
    dribbleDir,
    passTarget: null,
    crossTarget: null,
    crossKind: 'box',
    shootDir: shot.dir,
  }
}

function blockersOnPass(target: PlayerRef | null, ctx: CarrierContext): number {
  if (!target) return 99
  return opponentsOnPassLane(ctx.carrier.position, target.position, ctx.opponents)
}

/** Revalida linha de passe no instante da soltura */
export function isPassLaneClearEnough(
  ctx: CarrierContext,
  target: PlayerRef,
  maxBlockers = 0,
): boolean {
  return opponentsOnPassLane(ctx.carrier.position, target.position, ctx.opponents) <= maxBlockers
}

/** Posição para cortar linha de passe adversária */
export function getPassLaneBlockTarget(
  team: TeamId,
  bounds: FieldBounds,
  carrier: PlayerRef,
  _ball: Vec3,
): { x: number; z: number } | null {
  const oppTeammates = [...playerRegistry.values()].filter(
    (p) => p.team === carrier.team && p.role !== 'gk' && p.id !== carrier.id,
  )
  const defenders = [...playerRegistry.values()].filter(
    (p) => p.team === team && p.role !== 'gk',
  )
  if (oppTeammates.length === 0) return null

  const carrierPos = carrier.position
  let bestLane: { x: number; z: number } | null = null
  let bestScore = 0

  for (const mate of oppTeammates) {
    const fwd = forwardProgress(carrier.team, carrierPos, mate.position, bounds)
    if (fwd < 0.5) continue

    const covered = opponentsOnPassLane(carrierPos, mate.position, defenders, 1.05)
    if (covered > 0) continue

    const cutT = 0.38
    const laneX = carrierPos.x + (mate.position.x - carrierPos.x) * cutT
    const laneZ = carrierPos.z + (mate.position.z - carrierPos.z) * cutT
    const laneOpen = spaceAround({ x: laneX, y: 0, z: laneZ }, defenders)
    const runBonus = isForwardMakingRun(mate.id, mate.team) ? 1.4 : 0
    const score = fwd + laneOpen + runBonus

    if (score > bestScore) {
      bestScore = score
      bestLane = { x: laneX, z: laneZ }
    }
  }

  return bestLane
}
