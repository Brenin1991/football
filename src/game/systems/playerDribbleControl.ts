import * as THREE from 'three'
import { WORLD_SCALE } from '../constants'
import type { PlayerLocoAnim } from '../types'

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
}

export type DribbleControlOutput = {
  speedMul: number
  sprintBlocked: boolean
  turnRateMul: number
  forcedYaw: number | null
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
   * 0..1 — quão brusca foi a última finta/corte. Usado pelo sistema de bola
   * (dribbleBall.ts) pra simular uma perda momentânea de controle fino em
   * cortes fechados, em vez de a bola ficar sempre "colada" no pé.
   */
  touchSeverity: number
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
  stopFeintOldDirX: number
  stopFeintOldDirZ: number
  stopFeintTurnSign: number
  stopFeintStartSpeed: number
  /** 0..1 — quão forte foi a freada que originou a finta (escala pelo sprint) */
  stopFeintIntensity: number
  // --- corte em corrida (running cut) ---
  cutCooldown: number
  runCutTimer: number
  runCutDuration: number
  runCutFromYaw: number
  runCutTurnSign: number
  runCutStartSpeed: number
  runCutTouchFired: boolean
  /** 0..1 — quão fechado foi o ângulo do corte */
  runCutSeverity: number
  // --- alternância de passadas ---
  footParity: boolean
}

const runtimes = new Map<string, Runtime>()

const STOP_FEINT_DURATION = 0.44
const STOP_FEINT_MIN_SPEED = 0.45 * WORLD_SCALE
const STOP_FEINT_COOLDOWN = 0.45
const TOUCH_COOLDOWN = 0.28
// Toques sutis de "ajeitar a bola" enquanto corre/sprinta e faz pequenas
// correções de direção — não é finta nem corte, é só o pézinho acompanhando.
const SPRINT_TOUCH_MIN_SPEED = 0.22 * WORLD_SCALE
const SPRINT_TOUCH_COOLDOWN = 0.22
const SPRINT_TOUCH_DURATION = 0.2
const FEINT_BALL_BACK = 0.72 * WORLD_SCALE
const FEINT_BALL_LATERAL = 0.18 * WORLD_SCALE
const SPRINT_RELEASE_WINDOW = 0.42
// Referência de velocidade "rápida" pra escalar a intensidade da finta de
// parada — parar vindo de um sprint forte precisa doer mais que parar de trote.
const STOP_FEINT_FAST_REF = 1.35 * WORLD_SCALE

// Corte em corrida: virada de ângulo médio mantendo a velocidade (não é freada,
// é o jogador "cortando" a marcação/direção sem perder ritmo).
const RUN_CUT_MIN_SPEED = 0.32 * WORLD_SCALE
const RUN_CUT_COOLDOWN = 0.22
const RUN_CUT_DURATION = 0.26
const RUN_CUT_BALL_PUSH = 0.42 * WORLD_SCALE
const RUN_CUT_MAX_TURN_RATE = 2.4
// Faixa de dot-product que define o quão "fechado" é o corte: perto de
// RUN_CUT_DOT_MAX é quase reto (corte raso), perto de RUN_CUT_DOT_MIN é quase
// reversão (corte fechado — isso já beira o território da finta de parada).
const RUN_CUT_DOT_MAX = 0.88
const RUN_CUT_DOT_MIN = -0.55

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
    stopFeintOldDirX: 0,
    stopFeintOldDirZ: 0,
    stopFeintTurnSign: 1,
    stopFeintStartSpeed: 0,
    stopFeintIntensity: 0,
    cutCooldown: 0,
    runCutTimer: 0,
    runCutDuration: 0,
    runCutFromYaw: 0,
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
  }
}

// ---------------------------------------------------------------------------
// Finta de parada (reversão total após soltar o sprint)
// ---------------------------------------------------------------------------

function buildStopFeintOutput(rt: Runtime): DribbleControlOutput {
  const out = makeDefaultOutput()
  out.sprintBlocked = true
  out.forcedYaw = rt.stopFeintTargetYaw
  out.snapFacing = true
  out.stopFeintActive = true
  out.feintMoveSpeed = rt.stopFeintStartSpeed
  out.touchSeverity = rt.stopFeintIntensity

  const t = 1 - rt.stopFeintTimer / rt.stopFeintDuration

  // Quanto mais forte a intensidade (parada vindo de sprint), mais o "amasso"
  // no ritmo se sente — parar de um trote é quase imperceptível na fala,
  // parar de um sprint pesa de verdade.
  const dipFloor = THREE.MathUtils.lerp(0.97, 0.86, rt.stopFeintIntensity)
  out.speedMul = t < 0.1 ? dipFloor : THREE.MathUtils.lerp(dipFloor, 1, easeOutQuad((t - 0.1) / 0.9))
  out.feintMoveSpeed = rt.stopFeintStartSpeed * out.speedMul
  out.feintKeepRun = rt.stopFeintStartSpeed > STOP_FEINT_MIN_SPEED * 1.02

  // Curva assimétrica: puxa a bola pra trás rápido (plantar o pé), depois solta
  // suavemente. A distância do arrasto também escala com a intensidade —
  // sprint forte joga a bola mais longe antes de recolher.
  const backPhase =
    t < 0.3
      ? THREE.MathUtils.lerp(1, 0.55, easeOutQuad(t / 0.3))
      : Math.max(0, 0.55 * (1 - easeInQuad((t - 0.3) / 0.7)))

  const ballBack = FEINT_BALL_BACK * THREE.MathUtils.lerp(0.78, 1.3, rt.stopFeintIntensity)
  const sideX = -rt.stopFeintOldDirZ * rt.stopFeintTurnSign
  const sideZ = rt.stopFeintOldDirX * rt.stopFeintTurnSign

  out.ballOffsetX = -rt.stopFeintOldDirX * ballBack * backPhase + sideX * FEINT_BALL_LATERAL * backPhase
  out.ballOffsetZ = -rt.stopFeintOldDirZ * ballBack * backPhase + sideZ * FEINT_BALL_LATERAL * backPhase

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
): boolean {
  const moveDirX = speed > 0.12 ? moveVelX / speed : Math.sin(rotation)
  const moveDirZ = speed > 0.12 ? moveVelZ / speed : Math.cos(rotation)

  let inputDirX = rawDirX
  let inputDirZ = rawDirZ
  if (rawIntentLen < 0.2) {
    inputDirX = moveDirX
    inputDirZ = moveDirZ
  }

  const inputDotMove = inputDirX * moveDirX + inputDirZ * moveDirZ
  const inReleaseWindow =
    !sprint && rt.sprintReleaseActive && rt.sprintReleaseAge < SPRINT_RELEASE_WINDOW

  if (
    !inReleaseWindow ||
    speed < STOP_FEINT_MIN_SPEED ||
    rawIntentLen < 0.22 ||
    inputDotMove > -0.18 ||
    rt.feintCooldown > 0
  ) {
    return false
  }

  const intensity = THREE.MathUtils.clamp(
    (speed - STOP_FEINT_MIN_SPEED) / (STOP_FEINT_FAST_REF - STOP_FEINT_MIN_SPEED),
    0,
    1,
  )
  rt.stopFeintIntensity = intensity
  // Sprint forte também demora mais pra concluir a reversão — não é só mais
  // longe, é mais devagar pra "assentar" antes de sair de novo.
  rt.stopFeintDuration = humanize(THREE.MathUtils.lerp(STOP_FEINT_DURATION * 0.9, STOP_FEINT_DURATION * 1.3, intensity))
  rt.stopFeintTimer = rt.stopFeintDuration
  rt.stopFeintStartSpeed = Math.max(speed, STOP_FEINT_MIN_SPEED)
  rt.stopFeintTargetYaw =
    rawIntentLen > 0.2 ? Math.atan2(rawDirX, rawDirZ) : Math.atan2(-moveDirX, -moveDirZ)
  rt.stopFeintOldDirX = moveDirX
  rt.stopFeintOldDirZ = moveDirZ
  const cross = moveDirX * inputDirZ - moveDirZ * inputDirX
  rt.stopFeintTurnSign = cross >= 0 ? 1 : -1
  rt.feintCooldown = STOP_FEINT_COOLDOWN
  rt.touchCooldown = rt.stopFeintDuration * 0.85
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
  out.touchSeverity = severity

  // Pequeno "engolir" de velocidade no plante do pé, recuperando logo depois.
  // Corte raso mal se sente; corte fechado pesa de verdade.
  const dipFloor = THREE.MathUtils.lerp(0.95, 0.76, severity)
  out.speedMul = THREE.MathUtils.lerp(dipFloor, 1, eased)
  out.feintMoveSpeed = rt.runCutStartSpeed * out.speedMul
  out.feintKeepRun = true

  // Vira mais rápido que o normal enquanto o corte está ativo — quanto mais
  // fechado o ângulo, maior o pico de giro — mas sem "teleportar" a rotação.
  const turnPeak = THREE.MathUtils.lerp(1.6, RUN_CUT_MAX_TURN_RATE * 1.3, severity)
  out.turnRateMul = THREE.MathUtils.lerp(turnPeak, 1.15, eased)

  // Empurra a bola pro lado do corte, com pico no meio do movimento e
  // retorno suave ao centro. Cortes fechados empurram mais longe.
  const pushPhase = Math.sin(Math.min(1, t) * Math.PI)
  const pushMag = RUN_CUT_BALL_PUSH * THREE.MathUtils.lerp(0.68, 1.35, severity)
  const rightX = Math.cos(rt.runCutFromYaw)
  const rightZ = -Math.sin(rt.runCutFromYaw)
  out.ballOffsetX = rightX * pushMag * pushPhase * rt.runCutTurnSign
  out.ballOffsetZ = rightZ * pushMag * pushPhase * rt.runCutTurnSign

  // Dispara a animação de toque uma única vez, no início do corte.
  if (!rt.runCutTouchFired) {
    rt.runCutTouchFired = true
    out.touchAnim = rt.runCutTurnSign > 0 ? 'player_right' : 'player_left'
    out.touchDuration = humanize(rt.runCutDuration * 0.9)
  }

  return out
}

function tryStartRunningCut(
  rt: Runtime,
  dirX: number,
  dirZ: number,
  intentLen: number,
  speed: number,
  rotation: number,
  moveVelX: number,
  moveVelZ: number,
): boolean {
  if (
    speed < RUN_CUT_MIN_SPEED ||
    intentLen < 0.35 ||
    rt.cutCooldown > 0 ||
    rt.stopFeintTimer > 0
  ) {
    return false
  }

  const moveDirX = speed > 0.12 ? moveVelX / speed : Math.sin(rotation)
  const moveDirZ = speed > 0.12 ? moveVelZ / speed : Math.cos(rotation)

  const dot = dirX * moveDirX + dirZ * moveDirZ
  // Ignora quase-reto (não é virada de verdade) e quase-reversão total
  // (isso é papel da finta de parada, que soma freio + snap de facing).
  if (dot > RUN_CUT_DOT_MAX || dot < RUN_CUT_DOT_MIN) return false

  const severity = computeCutSeverity(dot)
  const cross = moveDirX * dirZ - moveDirZ * dirX
  rt.runCutTurnSign = cross >= 0 ? 1 : -1
  rt.runCutFromYaw = rotation
  rt.runCutSeverity = severity
  // Corte fechado demora mais pra "assentar" que um corte raso e rápido.
  rt.runCutDuration = humanize(THREE.MathUtils.lerp(RUN_CUT_DURATION * 0.62, RUN_CUT_DURATION * 1.6, severity))
  rt.runCutTimer = rt.runCutDuration
  rt.runCutStartSpeed = speed
  rt.runCutTouchFired = false
  rt.cutCooldown = RUN_CUT_COOLDOWN
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
  } = input

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

  // 2) Tenta iniciar finta de parada (reversão após soltar sprint)
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
    )
  ) {
    rt.wasSprinting = sprint
    return buildStopFeintOutput(rt)
  }

  // 3) Corte em corrida em andamento — mantém o corte mesmo enquanto sprinta
  if (rt.runCutTimer > 0) {
    rt.runCutTimer = Math.max(0, rt.runCutTimer - delta)
    const cutOut = buildRunningCutOutput(rt)
    rt.wasSprinting = sprint
    if (intentLen > 0.12) {
      rt.lastDirX = dirX
      rt.lastDirZ = dirZ
    }
    return cutOut
  }

  // 4) Tenta iniciar um corte em corrida (virada de ângulo médio, mantendo velocidade)
  if (tryStartRunningCut(rt, dirX, dirZ, intentLen, speed, rotation, moveVelX, moveVelZ)) {
    rt.wasSprinting = sprint
    return buildRunningCutOutput(rt)
  }

  // 5) Caso normal: toques de drible + leve resposta de giro proporcional ao
  // quanto a direção pedida difere da direção atual — dá uma sensação mais
  // viva pra correções pequenas, sem precisar de nenhum estado especial.
  const out = makeDefaultOutput()
  if (sprint) {
    trySprintSubtleTouch(rt, out, dirX, dirZ, intentLen, speed, rotation, delta)
  } else {
    tryDribbleTouch(rt, out, sprint, dirX, dirZ, intentLen, speed, rotation, delta)
  }

  if (intentLen > 0.1 && speed > 0.12) {
    const moveDirX = moveVelX / speed
    const moveDirZ = moveVelZ / speed
    const dot = dirX * moveDirX + dirZ * moveDirZ
    const mismatch = THREE.MathUtils.clamp(1 - dot, 0, 1)
    out.turnRateMul = 1 + mismatch * 0.35
  }

  if (intentLen > 0.12) {
    rt.lastDirX = dirX
    rt.lastDirZ = dirZ
  }

  rt.wasSprinting = sprint
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