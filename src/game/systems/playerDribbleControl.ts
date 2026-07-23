import * as THREE from 'three'
import { WORLD_SCALE } from '../constants'
import type { PlayerLocoAnim } from '../types'
import { getPlayerAttrMultipliers } from './playerAttributes'

export type DribbleTouchAnim = 'player_left' | 'player_right' | 'player_backward'

export type DribbleControlInput = {
  delta: number
  enabled: boolean
  sprint: boolean
  dirX: number
  dirZ: number
  intentLen: number
  /** Analógico/teclado sem suavização — detecção da finta */
  rawDirX: number
  rawDirZ: number
  rawIntentLen: number
  speed: number
  rotation: number
  moveVelX: number
  moveVelZ: number
  /** IA com bola — limiares mais baixos pra 180/corte (input já vem suave) */
  aiCarrier?: boolean
  /** Be a Pro sem bola: só viradas 180/corte, sem toque de drible */
  offBallLoco?: boolean
}

export type DribbleControlOutput = {
  speedMul: number
  sprintBlocked: boolean
  turnRateMul: number
  forcedYaw: number | null
  /** @deprecated — finta não usa mais snap; yaw é progressivo */
  snapFacing: boolean
  ballOffsetX: number
  ballOffsetZ: number
  touchAnim: DribbleTouchAnim | null
  touchDuration: number
  stopFeintActive: boolean
  locomotionOverride: DribbleTouchAnim | null
  /** Velocidade alvo durante a finta — mantém momentum da corrida */
  feintMoveSpeed: number
  /** Animação de corrida durante finta após sprint */
  feintKeepRun: boolean
  /**
   * 0..1 — brusquidão da finta/corte. Bola perde cola nos pés.
   */
  touchSeverity: number
  /** Inclinação lateral do tronco (−1…1, esquerda/direita) */
  bodyLean: number
  /** Inclinação freio / plant (− = freia pra frente, + = acelera) */
  bodyPitch: number
  /** Acabou de iniciar finta de parada neste frame */
  fintaStarted: boolean
  /** Acabou de iniciar corte 180 neste frame */
  finta180Started: boolean
  /** Corte em corrida ativo */
  runCutActive: boolean
  /** Toque inicial do 180 — direção/velocidade da rolagem */
  ballPushX: number
  ballPushZ: number
  ballPushSpeed: number
}

type Runtime = {
  wasSprinting: boolean
  sprintReleaseAge: number
  sprintReleaseActive: boolean
  feintCooldown: number
  touchCooldown: number
  stepPhase: number
  lastDirX: number
  lastDirZ: number
  stopFeintTimer: number
  stopFeintDuration: number
  stopFeintTargetYaw: number
  stopFeintFromYaw: number
  stopFeintOldDirX: number
  stopFeintOldDirZ: number
  stopFeintTurnSign: number
  stopFeintStartSpeed: number
  /** 0..1 — quão forte foi a freada que originou a finta (escala pelo sprint) */
  stopFeintIntensity: number
  stopFeintPlantFired: boolean
  stopFeintPivotFired: boolean
  // --- corte em corrida (running cut) ---
  cutCooldown: number
  runCutTimer: number
  runCutDuration: number
  runCutFromYaw: number
  runCutTargetYaw: number
  runCutTurnSign: number
  runCutStartSpeed: number
  runCutTouchFired: boolean
  /** 0..1 — quão fechado foi o ângulo do corte */
  runCutSeverity: number
  // --- alternância de passadas ---
  footParity: boolean
}

const runtimes = new Map<string, Runtime>()

/** ~0.58 s após time-scale: acompanha a duração real do player_finta_180. */
const STOP_FEINT_DURATION = 0.56
const STOP_FEINT_MIN_SPEED = 0.55 * WORLD_SCALE
/** Cooldown longo — evita spam de 180 com stick nervoso */
const STOP_FEINT_COOLDOWN = 1.15
const TOUCH_COOLDOWN = 0.24
const SPRINT_TOUCH_MIN_SPEED = 0.22 * WORLD_SCALE
const SPRINT_TOUCH_COOLDOWN = 0.2
const SPRINT_TOUCH_DURATION = 0.18
/** Toque que deixa a bola seguindo antes do jogador completar o giro. */
const FEINT_BALL_TOUCH_FORWARD = 2.52 * WORLD_SCALE
const FEINT_BALL_LATERAL = 0.1 * WORLD_SCALE
/** Velocidade mínima do toque no 180 (m/s) */
const FEINT_BALL_PUSH_MIN = 2.35 * WORLD_SCALE
const FEINT_BALL_PUSH_MAX = 3.6 * WORLD_SCALE
/** Janela curta após soltar sprint — evita finta “fantasma” segundos depois */
const SPRINT_RELEASE_WINDOW = 0.42
const STOP_FEINT_FAST_REF = 5.2 * WORLD_SCALE
/** Stick tem que estar comprometido — viradinha não conta */
const FEINT_STICK_COMMIT = 0.58
/** Dot máximo (input·movimento) pra considerar reversão real (~135°+) */
const FEINT_REVERSE_DOT = -0.72

const RUN_CUT_MIN_SPEED = 0.45 * WORLD_SCALE
const RUN_CUT_COOLDOWN = 0.55
const RUN_CUT_DURATION = 0.2
const RUN_CUT_BALL_PUSH = 0.2 * WORLD_SCALE
const RUN_CUT_MAX_TURN_RATE = 2.85
/** Só corta de verdade — correção leve fica no locomotion */
const RUN_CUT_DOT_MAX = 0.38
const RUN_CUT_DOT_MIN = -0.35
/** Só anima 180 no corte se for quase reversão */
const RUN_CUT_FINTA180_SEVERITY = 0.78

/** Pequena variação humana pra tirar a cadência de metrônomo dos toques. */
function humanize(base: number, spread = 0.16): number {
  return base * (1 + (Math.random() - 0.5) * spread)
}

function createRuntime(): Runtime {
  return {
    wasSprinting: false,
    sprintReleaseAge: 999,
    sprintReleaseActive: false,
    feintCooldown: 0,
    touchCooldown: 0,
    stepPhase: 0,
    lastDirX: 0,
    lastDirZ: 0,
    stopFeintTimer: 0,
    stopFeintDuration: 0,
    stopFeintTargetYaw: 0,
    stopFeintFromYaw: 0,
    stopFeintOldDirX: 0,
    stopFeintOldDirZ: 0,
    stopFeintTurnSign: 1,
    stopFeintStartSpeed: 0,
    stopFeintIntensity: 0,
    stopFeintPlantFired: false,
    stopFeintPivotFired: false,
    cutCooldown: 0,
    runCutTimer: 0,
    runCutDuration: 0,
    runCutFromYaw: 0,
    runCutTargetYaw: 0,
    runCutTurnSign: 1,
    runCutStartSpeed: 0,
    runCutTouchFired: false,
    runCutSeverity: 0,
    footParity: false,
  }
}

function getRuntime(id: string): Runtime {
  let rt = runtimes.get(id)
  if (!rt) {
    rt = createRuntime()
    runtimes.set(id, rt)
  }
  return rt
}

export function clearPlayerDribbleControl(id: string) {
  runtimes.delete(id)
}

function localFromWorld(dirX: number, dirZ: number, facing: number) {
  const len = Math.hypot(dirX, dirZ)
  if (len < 0.02) return { f: 0, r: 0 }
  const wx = dirX / len
  const wz = dirZ / len
  const sin = Math.sin(facing)
  const cos = Math.cos(facing)
  return { f: wx * sin + wz * cos, r: wx * cos - wz * sin }
}

function easeOutQuad(t: number) {
  const c = THREE.MathUtils.clamp(t, 0, 1)
  return 1 - (1 - c) * (1 - c)
}

function easeInQuad(t: number) {
  const c = THREE.MathUtils.clamp(t, 0, 1)
  return c * c
}

function makeDefaultOutput(): DribbleControlOutput {
  return {
    speedMul: 1,
    sprintBlocked: false,
    turnRateMul: 1,
    forcedYaw: null,
    snapFacing: false,
    ballOffsetX: 0,
    ballOffsetZ: 0,
    touchAnim: null,
    touchDuration: 0,
    stopFeintActive: false,
    locomotionOverride: null,
    feintMoveSpeed: 0,
    feintKeepRun: false,
    touchSeverity: 0,
    bodyLean: 0,
    bodyPitch: 0,
    fintaStarted: false,
    finta180Started: false,
    runCutActive: false,
    ballPushX: 0,
    ballPushZ: 0,
    ballPushSpeed: 0,
  }
}

function lerpYaw(from: number, to: number, t: number): number {
  let d = to - from
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return from + d * THREE.MathUtils.clamp(t, 0, 1)
}

// ---------------------------------------------------------------------------
// Finta de parada — plant → pivot → drive (corpo sente, sem snap)
// ---------------------------------------------------------------------------

function buildStopFeintOutput(rt: Runtime): DribbleControlOutput {
  const out = makeDefaultOutput()
  out.sprintBlocked = true
  out.stopFeintActive = true
  out.feintMoveSpeed = rt.stopFeintStartSpeed
  out.touchSeverity = rt.stopFeintIntensity

  const t = 1 - rt.stopFeintTimer / rt.stopFeintDuration
  const intensity = rt.stopFeintIntensity

  // Fase 1 plant (0–0.32): freia, tronco pra frente, yaw ainda no impulso
  // Fase 2 pivot (0.32–0.62): gira o peito, bola lateral, lean
  // Fase 3 drive (0.62–1): sai na direção nova
  const plantEnd = 0.32
  const pivotEnd = 0.62

  let yawT: number
  if (t < plantEnd) {
    yawT = easeInQuad(t / plantEnd) * 0.18
    out.bodyPitch = -THREE.MathUtils.lerp(0.12, 0.28, intensity) * (1 - t / plantEnd)
    out.bodyLean = rt.stopFeintTurnSign * THREE.MathUtils.lerp(0.08, 0.18, intensity) * (t / plantEnd)
    out.turnRateMul = THREE.MathUtils.lerp(1.1, 1.45, intensity)
    out.feintKeepRun = false
    if (!rt.stopFeintPlantFired) rt.stopFeintPlantFired = true
  } else if (t < pivotEnd) {
    const u = (t - plantEnd) / (pivotEnd - plantEnd)
    yawT = 0.18 + easeOutQuad(u) * 0.72
    out.bodyPitch = -THREE.MathUtils.lerp(0.04, 0.1, intensity) * (1 - u)
    out.bodyLean = rt.stopFeintTurnSign * THREE.MathUtils.lerp(0.22, 0.42, intensity) * Math.sin(u * Math.PI)
    out.turnRateMul = THREE.MathUtils.lerp(2.1, 3.4, intensity)
    out.feintKeepRun = false
    if (!rt.stopFeintPivotFired) rt.stopFeintPivotFired = true
  } else {
    const u = (t - pivotEnd) / (1 - pivotEnd)
    yawT = 0.9 + easeOutQuad(u) * 0.1
    out.bodyPitch = THREE.MathUtils.lerp(0.02, 0.06, intensity) * u
    out.bodyLean = rt.stopFeintTurnSign * THREE.MathUtils.lerp(0.12, 0.22, intensity) * (1 - u)
    out.turnRateMul = THREE.MathUtils.lerp(1.8, 1.2, u)
    out.feintKeepRun = rt.stopFeintStartSpeed > STOP_FEINT_MIN_SPEED * 1.05
  }

  out.forcedYaw = lerpYaw(rt.stopFeintFromYaw, rt.stopFeintTargetYaw, yawT)
  out.snapFacing = false

  const dipFloor = THREE.MathUtils.lerp(0.82, 0.62, intensity)
  if (t < plantEnd) {
    out.speedMul = THREE.MathUtils.lerp(1, dipFloor, easeOutQuad(t / plantEnd))
  } else if (t < pivotEnd) {
    out.speedMul = dipFloor
  } else {
    out.speedMul = THREE.MathUtils.lerp(dipFloor, 1, easeOutQuad((t - pivotEnd) / (1 - pivotEnd)))
  }
  out.feintMoveSpeed = rt.stopFeintStartSpeed * out.speedMul

  // Bola no 180:
  // 1) dá um toque à frente no sentido em que vinha;
  // 2) a bola continua ali enquanto o corpo gira;
  // 3) o offset fecha e o jogador reencontra a bola já virado.
  let forwardPhase: number
  if (t < plantEnd) {
    const u = t / plantEnd
    forwardPhase = THREE.MathUtils.lerp(0.48, 1, easeOutQuad(u))
  } else if (t < pivotEnd) {
    const u = (t - plantEnd) / (pivotEnd - plantEnd)
    forwardPhase = THREE.MathUtils.lerp(1, 0.82, easeInQuad(u))
  } else {
    const u = (t - pivotEnd) / (1 - pivotEnd)
    forwardPhase = THREE.MathUtils.lerp(0.82, 0, easeOutQuad(u))
  }

  const ballForward =
    FEINT_BALL_TOUCH_FORWARD * THREE.MathUtils.lerp(0.85, 1.25, intensity)
  const sideAmp = FEINT_BALL_LATERAL * THREE.MathUtils.lerp(0.9, 1.35, intensity)
  const sideX = -rt.stopFeintOldDirZ * rt.stopFeintTurnSign
  const sideZ = rt.stopFeintOldDirX * rt.stopFeintTurnSign
  const sidePhase =
    t < pivotEnd
      ? Math.sin(Math.min(1, t / pivotEnd) * Math.PI) * 0.55
      : Math.max(0, 0.55 * (1 - (t - pivotEnd) / (1 - pivotEnd)))

  out.ballOffsetX =
    rt.stopFeintOldDirX * ballForward * forwardPhase +
    sideX * sideAmp * sidePhase
  out.ballOffsetZ =
    rt.stopFeintOldDirZ * ballForward * forwardPhase +
    sideZ * sideAmp * sidePhase

  // Direção/velocidade do toque (Player chama pushDribbleBallRoll no start)
  out.ballPushX = rt.stopFeintOldDirX
  out.ballPushZ = rt.stopFeintOldDirZ
  out.ballPushSpeed = THREE.MathUtils.lerp(
    FEINT_BALL_PUSH_MIN,
    FEINT_BALL_PUSH_MAX,
    intensity,
  )

  // Severidade temporal: fica alta no meio (bola livre) e só cai no reencontro
  out.touchSeverity =
    intensity *
    (t < pivotEnd
      ? THREE.MathUtils.lerp(0.85, 1, t / pivotEnd)
      : THREE.MathUtils.lerp(1, 0.12, easeOutQuad((t - pivotEnd) / (1 - pivotEnd))))

  return out
}

function tryStartStopFeint(
  rt: Runtime,
  sprint: boolean,
  rawDirX: number,
  rawDirZ: number,
  rawIntentLen: number,
  speed: number,
  rotation: number,
  moveVelX: number,
  moveVelZ: number,
  aiCarrier = false,
  _offBallLoco = false,
): boolean {
  // 180 só em sprint (ou na janela curta ao soltar o sprint) — andando vira normal
  if (!sprint && !rt.sprintReleaseActive) return false
  if (rt.feintCooldown > 0 || speed < STOP_FEINT_MIN_SPEED) return false
  // Stick fraco / viradinha — nunca (IA um pouco mais fácil pra emular corte)
  const commit = aiCarrier ? FEINT_STICK_COMMIT * 0.78 : FEINT_STICK_COMMIT
  const reverseDot = aiCarrier ? FEINT_REVERSE_DOT + 0.18 : FEINT_REVERSE_DOT
  if (rawIntentLen < commit) return false

  const moveDirX = speed > 0.12 ? moveVelX / speed : Math.sin(rotation)
  const moveDirZ = speed > 0.12 ? moveVelZ / speed : Math.cos(rotation)
  const inputDirX = rawDirX / rawIntentLen
  const inputDirZ = rawDirZ / rawIntentLen
  const inputDotMove = inputDirX * moveDirX + inputDirZ * moveDirZ

  const inReleaseWindow =
    !sprint && rt.sprintReleaseActive && rt.sprintReleaseAge < SPRINT_RELEASE_WINDOW
  if (!sprint && !inReleaseWindow) return false

  const lateral = Math.abs(moveDirX * inputDirZ - moveDirZ * inputDirX)

  // Stop-and-play: soltou sprint e cortou ~90°+ com stick firme
  const stopAndPlay =
    inReleaseWindow && inputDotMove < -0.08 && lateral > (aiCarrier ? 0.42 : 0.55)

  // Reversão clássica após soltar sprint
  const sprintReverse = inReleaseWindow && inputDotMove < reverseDot

  // Reversão brusca — só enquanto sprinta, quase 180
  const hardReverse = sprint && inputDotMove < reverseDot

  // Flick: última direção vs nova tem que ser bem oposta (não ruído de stick)
  const lastLen = Math.hypot(rt.lastDirX, rt.lastDirZ)
  const flickDot =
    lastLen > 0.01
      ? (rt.lastDirX / lastLen) * inputDirX + (rt.lastDirZ / lastLen) * inputDirZ
      : 1
  const flickReverse =
    (sprint || inReleaseWindow) &&
    lastLen > (aiCarrier ? 0.4 : 0.55) &&
    rawIntentLen > (aiCarrier ? 0.5 : 0.65) &&
    flickDot < reverseDot

  if (!stopAndPlay && !sprintReverse && !hardReverse && !flickReverse) {
    return false
  }

  const intensity = THREE.MathUtils.clamp(
    (speed - STOP_FEINT_MIN_SPEED) / (STOP_FEINT_FAST_REF - STOP_FEINT_MIN_SPEED),
    0.25,
    1,
  )
  rt.stopFeintIntensity = intensity
  rt.stopFeintDuration = humanize(
    THREE.MathUtils.lerp(STOP_FEINT_DURATION * 0.85, STOP_FEINT_DURATION * 1.25, intensity),
  )
  rt.stopFeintTimer = rt.stopFeintDuration
  rt.stopFeintStartSpeed = Math.max(speed, STOP_FEINT_MIN_SPEED)
  rt.stopFeintFromYaw = rotation
  rt.stopFeintTargetYaw = Math.atan2(rawDirX, rawDirZ)
  rt.stopFeintOldDirX = moveDirX
  rt.stopFeintOldDirZ = moveDirZ
  const cross = moveDirX * inputDirZ - moveDirZ * inputDirX
  rt.stopFeintTurnSign = cross >= 0 ? 1 : -1
  rt.stopFeintPlantFired = false
  rt.stopFeintPivotFired = false
  rt.feintCooldown = STOP_FEINT_COOLDOWN
  rt.touchCooldown = rt.stopFeintDuration * 0.7
  rt.stepPhase = 0
  rt.sprintReleaseActive = false
  return true
}

// ---------------------------------------------------------------------------
// Corte em corrida — virada de ângulo médio SEM soltar velocidade, o
// comportamento que faltava para "viradas mesmo correndo". Empurra a bola
// pro lado do corte e acelera a rotação, mas sem travar a locomoção de corrida.
//
// A severidade do corte (quão fechado é o ângulo) escala duração, dip de
// velocidade, pico de giro e empurrão de bola — um corte raso de 20° e um
// corte fechado de 100° não podem parecer a mesma animação com sinal trocado.
// ---------------------------------------------------------------------------

function computeCutSeverity(dot: number): number {
  const t = THREE.MathUtils.clamp((RUN_CUT_DOT_MAX - dot) / (RUN_CUT_DOT_MAX - RUN_CUT_DOT_MIN), 0, 1)
  return easeInQuad(t)
}

function buildRunningCutOutput(rt: Runtime): DribbleControlOutput {
  const out = makeDefaultOutput()

  const t = 1 - rt.runCutTimer / rt.runCutDuration // 0 -> 1
  const eased = easeOutQuad(t)
  const severity = rt.runCutSeverity
  out.touchSeverity = severity * (t < 0.55 ? THREE.MathUtils.lerp(0.6, 1, t / 0.55) : THREE.MathUtils.lerp(1, 0.25, (t - 0.55) / 0.45))

  const dipFloor = THREE.MathUtils.lerp(0.92, 0.7, severity)
  out.speedMul = THREE.MathUtils.lerp(dipFloor, 1, eased)
  out.feintMoveSpeed = rt.runCutStartSpeed * out.speedMul
  out.feintKeepRun = true

  // Yaw progressivo no corpo — não só mul inútil
  const yawT = easeOutQuad(THREE.MathUtils.clamp(t / 0.72, 0, 1))
  out.forcedYaw = lerpYaw(rt.runCutFromYaw, rt.runCutTargetYaw, yawT)
  const turnPeak = THREE.MathUtils.lerp(1.85, RUN_CUT_MAX_TURN_RATE * 1.45, severity)
  out.turnRateMul = THREE.MathUtils.lerp(turnPeak, 1.25, eased)

  // Lean no plant do corte
  const leanPulse = Math.sin(Math.min(1, t / 0.55) * Math.PI)
  out.bodyLean = rt.runCutTurnSign * THREE.MathUtils.lerp(0.14, 0.38, severity) * leanPulse
  out.bodyPitch = -THREE.MathUtils.lerp(0.03, 0.1, severity) * (1 - eased) * 0.85

  const pushPhase = Math.sin(Math.min(1, t) * Math.PI)
  const pushMag = RUN_CUT_BALL_PUSH * THREE.MathUtils.lerp(0.75, 1.45, severity)
  const rightX = Math.cos(rt.runCutFromYaw)
  const rightZ = -Math.sin(rt.runCutFromYaw)
  out.ballOffsetX = rightX * pushMag * pushPhase * rt.runCutTurnSign
  out.ballOffsetZ = rightZ * pushMag * pushPhase * rt.runCutTurnSign

  if (!rt.runCutTouchFired) {
    rt.runCutTouchFired = true
    // Animação real: player_finta_180 (Player.tsx); sem touch left/right
  }

  return out
}

function tryStartRunningCut(
  rt: Runtime,
  sprint: boolean,
  dirX: number,
  dirZ: number,
  intentLen: number,
  speed: number,
  rotation: number,
  moveVelX: number,
  moveVelZ: number,
  aiCarrier = false,
  _offBallLoco = false,
): boolean {
  // Corte com finta: só em sprint
  if (!sprint) return false
  const commit = aiCarrier ? FEINT_STICK_COMMIT * 0.72 : FEINT_STICK_COMMIT
  const cutDotMax = aiCarrier ? RUN_CUT_DOT_MAX + 0.12 : RUN_CUT_DOT_MAX
  if (
    speed < RUN_CUT_MIN_SPEED ||
    intentLen < commit ||
    rt.cutCooldown > 0 ||
    rt.stopFeintTimer > 0 ||
    rt.feintCooldown > 0
  ) {
    return false
  }

  const moveDirX = speed > 0.12 ? moveVelX / speed : Math.sin(rotation)
  const moveDirZ = speed > 0.12 ? moveVelZ / speed : Math.cos(rotation)

  const dot = dirX * moveDirX + dirZ * moveDirZ
  // Ângulo fechado de verdade — curva leve não entra
  if (dot > cutDotMax || dot < RUN_CUT_DOT_MIN) return false

  const severity = computeCutSeverity(dot)
  const cross = moveDirX * dirZ - moveDirZ * dirX
  rt.runCutTurnSign = cross >= 0 ? 1 : -1
  rt.runCutFromYaw = rotation
  rt.runCutTargetYaw = Math.atan2(dirX, dirZ)
  rt.runCutSeverity = severity
  rt.runCutDuration = humanize(THREE.MathUtils.lerp(RUN_CUT_DURATION * 0.7, RUN_CUT_DURATION * 1.75, severity))
  rt.runCutTimer = rt.runCutDuration
  rt.runCutStartSpeed = speed
  rt.runCutTouchFired = false
  rt.cutCooldown = RUN_CUT_COOLDOWN * THREE.MathUtils.lerp(0.9, 1.25, severity)
  return true
}

// ---------------------------------------------------------------------------
// Toques de drible em corrida normal (sem finta/corte ativos)
// ---------------------------------------------------------------------------

function tryDribbleTouch(
  rt: Runtime,
  out: DribbleControlOutput,
  sprint: boolean,
  dirX: number,
  dirZ: number,
  intentLen: number,
  speed: number,
  rotation: number,
  delta: number,
) {
  if (sprint || intentLen < 0.25 || speed < 0.18 || rt.touchCooldown > 0) return

  const local = localFromWorld(dirX, dirZ, rotation)
  const absF = Math.abs(local.f)
  const absR = Math.abs(local.r)

  if (absR > 0.58 && absR > absF * 0.85) {
    out.touchAnim = local.r < 0 ? 'player_left' : 'player_right'
    out.touchDuration = humanize(0.34)
    rt.touchCooldown = humanize(TOUCH_COOLDOWN)
    return
  }

  if (local.f < -0.45 && absF > absR * 0.8) {
    out.touchAnim = 'player_backward'
    out.touchDuration = humanize(0.36)
    rt.touchCooldown = humanize(TOUCH_COOLDOWN + 0.08)
    return
  }

  if (absF > 0.55 && absR < 0.42) {
    rt.stepPhase += delta * (0.9 + speed * 0.22)
    if (rt.stepPhase >= 1) {
      rt.stepPhase = 0
      if (local.r < -0.18) {
        out.touchAnim = 'player_left'
      } else if (local.r > 0.18) {
        out.touchAnim = 'player_right'
      } else {
        // Alterna com a passada em vez de usar seno da rotação — isso fazia o
        // pé "escolher" o lado de forma meio aleatória/travada quando o
        // jogador ia reto. Agora segue o ritmo real de esquerda-direita.
        rt.footParity = !rt.footParity
        out.touchAnim = rt.footParity ? 'player_right' : 'player_left'
      }
      out.touchDuration = humanize(0.28)
      rt.touchCooldown = humanize(TOUCH_COOLDOWN)
    }
    return
  }

  if (
    rt.lastDirX * dirX + rt.lastDirZ * dirZ < 0.55 &&
    intentLen > 0.4 &&
    Math.hypot(rt.lastDirX, rt.lastDirZ) > 0.2
  ) {
    const cross = rt.lastDirX * dirZ - rt.lastDirZ * dirX
    out.touchAnim = cross >= 0 ? 'player_right' : 'player_left'
    out.touchDuration = humanize(0.32)
    rt.touchCooldown = humanize(TOUCH_COOLDOWN)
  }
}

// ---------------------------------------------------------------------------
// Toque sutil durante o sprint — vira pouco, mas o pé ainda "ajeita" a bola
// ---------------------------------------------------------------------------

function trySprintSubtleTouch(
  rt: Runtime,
  out: DribbleControlOutput,
  dirX: number,
  dirZ: number,
  intentLen: number,
  speed: number,
  rotation: number,
  delta: number,
) {
  if (speed < SPRINT_TOUCH_MIN_SPEED || intentLen < 0.14 || rt.touchCooldown > 0) return

  const local = localFromWorld(dirX, dirZ, rotation)
  const absF = Math.abs(local.f)
  const absR = Math.abs(local.r)

  // Só pra correções leves — indo quase reto pra frente. Virada grande já é
  // corte em corrida ou finta, então não disputa espaço com esses estados.
  if (absF < 0.35 || absR > 0.55) return

  // Reto de verdade (sem nenhuma curva real no input) — nada pra "ajeitar".
  // Sem esse piso, o ruído perto de zero caía no branch de alternância e
  // tocava mesmo andando 100% em linha reta.
  if (absR < 0.09) return

  rt.stepPhase += delta * (1.15 + speed * 0.18)
  if (rt.stepPhase < 1) return
  rt.stepPhase = 0

  // absR já garantido >= 0.09 aqui, então sempre há um lado claro.
  out.touchAnim = local.r < 0 ? 'player_left' : 'player_right'
  out.touchDuration = humanize(SPRINT_TOUCH_DURATION)
  rt.touchCooldown = humanize(SPRINT_TOUCH_COOLDOWN)
}

// ---------------------------------------------------------------------------
// Update principal
// ---------------------------------------------------------------------------

export function updatePlayerDribbleControl(
  id: string,
  input: DribbleControlInput,
): DribbleControlOutput {
  if (!input.enabled) {
    const rt = runtimes.get(id)
    if (rt) {
      rt.wasSprinting = false
      rt.sprintReleaseActive = false
      rt.stopFeintTimer = 0
      rt.runCutTimer = 0
    }
    return makeDefaultOutput()
  }

  const rt = getRuntime(id)
  const {
    delta,
    sprint,
    dirX,
    dirZ,
    intentLen,
    rawDirX,
    rawDirZ,
    rawIntentLen,
    speed,
    rotation,
    moveVelX,
    moveVelZ,
    aiCarrier = false,
    offBallLoco = false,
  } = input

  const cutDirX = dirX
  const cutDirZ = dirZ
  const cutIntentLen = intentLen

  rt.feintCooldown = Math.max(0, rt.feintCooldown - delta)
  rt.touchCooldown = Math.max(0, rt.touchCooldown - delta)
  rt.cutCooldown = Math.max(0, rt.cutCooldown - delta)

  if (sprint) {
    rt.sprintReleaseAge = 0
    rt.sprintReleaseActive = false
  } else {
    if (rt.wasSprinting) {
      rt.sprintReleaseActive = true
      rt.sprintReleaseAge = 0
    } else {
      rt.sprintReleaseAge += delta
    }
    if (rt.sprintReleaseAge > SPRINT_RELEASE_WINDOW) {
      rt.sprintReleaseActive = false
    }
  }

  // 1) Finta de parada em andamento (prioridade máxima)
  if (rt.stopFeintTimer > 0) {
    rt.stopFeintTimer = Math.max(0, rt.stopFeintTimer - delta)
    const feintOut = buildStopFeintOutput(rt)
    rt.wasSprinting = sprint
    if (intentLen > 0.12) {
      rt.lastDirX = dirX
      rt.lastDirZ = dirZ
    }
    return feintOut
  }

  // 2) Tenta iniciar finta de parada (reversão / 180)
  if (
    tryStartStopFeint(
      rt,
      sprint,
      rawDirX,
      rawDirZ,
      rawIntentLen,
      speed,
      rotation,
      moveVelX,
      moveVelZ,
      aiCarrier,
      offBallLoco,
    )
  ) {
    rt.wasSprinting = sprint
    const feintOut = buildStopFeintOutput(rt)
    feintOut.fintaStarted = true
    return feintOut
  }

  // 3) Corte em corrida em andamento — mantém o corte mesmo enquanto sprinta
  if (rt.runCutTimer > 0) {
    rt.runCutTimer = Math.max(0, rt.runCutTimer - delta)
    const cutOut = buildRunningCutOutput(rt)
    cutOut.runCutActive = true
    rt.wasSprinting = sprint
    if (intentLen > 0.12) {
      rt.lastDirX = dirX
      rt.lastDirZ = dirZ
    }
    return cutOut
  }

  // 4) Tenta iniciar um corte em corrida (virada de ângulo médio, mantendo velocidade)
  if (
    tryStartRunningCut(
      rt,
      sprint,
      cutDirX,
      cutDirZ,
      cutIntentLen,
      speed,
      rotation,
      moveVelX,
      moveVelZ,
      aiCarrier,
      offBallLoco,
    )
  ) {
    rt.wasSprinting = sprint
    const cutOut = buildRunningCutOutput(rt)
    cutOut.runCutActive = true
    // 180 só em corte quase reverso — curva média não anima finta
    cutOut.finta180Started = rt.runCutSeverity >= RUN_CUT_FINTA180_SEVERITY
    return cutOut
  }

  // 5) Caso normal — sem bola: só giro; com bola: toques de drible
  const out = makeDefaultOutput()
  if (!offBallLoco) {
    if (sprint) {
      trySprintSubtleTouch(rt, out, dirX, dirZ, intentLen, speed, rotation, delta)
    } else {
      tryDribbleTouch(rt, out, sprint, dirX, dirZ, intentLen, speed, rotation, delta)
    }
  }

  if (intentLen > 0.1 && speed > 0.12) {
    const moveDirX = moveVelX / speed
    const moveDirZ = moveVelZ / speed
    const dot = dirX * moveDirX + dirZ * moveDirZ
    const mismatch = THREE.MathUtils.clamp(1 - dot, 0, 1)
    const closeMul = sprint ? 0.42 : 0.72
    out.turnRateMul = 1 + mismatch * closeMul
  }

  if (intentLen > 0.12) {
    rt.lastDirX = dirX
    rt.lastDirZ = dirZ
  }

  rt.wasSprinting = sprint
  const attr = getPlayerAttrMultipliers(id)
  out.speedMul *= THREE.MathUtils.clamp(0.92 + (attr.dribbling - 1) * 0.35, 0.88, 1.1)
  out.turnRateMul *= attr.agility * THREE.MathUtils.clamp(0.94 + (attr.dribbling - 1) * 0.25, 0.9, 1.12)
  return out
}

/** Locomoção com bola — prioriza toques laterais / trás */
export function resolveCarrierLocoClip(
  localForward: number,
  localRight: number,
  sprint: boolean,
): PlayerLocoAnim {
  const mag = Math.hypot(localForward, localRight)
  if (mag < 0.1) return 'player_idle'

  const nf = localForward / mag
  const nr = localRight / mag
  const absF = Math.abs(nf)
  const absR = Math.abs(nr)

  if (sprint && nf > 0.12) return 'player_run'
  if (nf < -0.35) return 'player_backward'
  if (absR > 0.42 && absR > absF * 0.75) return nr < 0 ? 'player_left' : 'player_right'
  if (nf > 0.18) return 'player_walking'
  return nr < 0 ? 'player_left' : 'player_right'
}