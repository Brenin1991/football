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
  // --- corte em corrida (running cut) ---
  cutCooldown: number
  runCutTimer: number
  runCutDuration: number
  runCutFromYaw: number
  runCutTurnSign: number
  runCutStartSpeed: number
  runCutTouchFired: boolean
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

// Corte em corrida: virada de ângulo médio mantendo a velocidade (não é freada,
// é o jogador "cortando" a marcação/direção sem perder ritmo).
const RUN_CUT_MIN_SPEED = 0.32 * WORLD_SCALE
const RUN_CUT_COOLDOWN = 0.22
const RUN_CUT_DURATION = 0.26
const RUN_CUT_BALL_PUSH = 0.42 * WORLD_SCALE
const RUN_CUT_MAX_TURN_RATE = 2.4

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
    cutCooldown: 0,
    runCutTimer: 0,
    runCutDuration: 0,
    runCutFromYaw: 0,
    runCutTurnSign: 1,
    runCutStartSpeed: 0,
    runCutTouchFired: false,
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
  out.feintKeepRun = rt.stopFeintStartSpeed > STOP_FEINT_MIN_SPEED * 1.02

  const t = 1 - rt.stopFeintTimer / rt.stopFeintDuration

  // Leve toque no ritmo — nunca para de fato, só "amassa" a passada
  out.speedMul = t < 0.1 ? 0.94 : THREE.MathUtils.lerp(0.94, 1, easeOutQuad((t - 0.1) / 0.9))
  out.feintMoveSpeed = rt.stopFeintStartSpeed * out.speedMul

  // Curva assimétrica: puxa a bola pra trás rápido (plantar o pé), depois solta
  // suavemente — em vez do lerp linear anterior, que ficava "mecânico".
  const backPhase =
    t < 0.3
      ? THREE.MathUtils.lerp(1, 0.55, easeOutQuad(t / 0.3))
      : Math.max(0, 0.55 * (1 - easeInQuad((t - 0.3) / 0.7)))

  const sideX = -rt.stopFeintOldDirZ * rt.stopFeintTurnSign
  const sideZ = rt.stopFeintOldDirX * rt.stopFeintTurnSign

  out.ballOffsetX =
    -rt.stopFeintOldDirX * FEINT_BALL_BACK * backPhase + sideX * FEINT_BALL_LATERAL * backPhase
  out.ballOffsetZ =
    -rt.stopFeintOldDirZ * FEINT_BALL_BACK * backPhase + sideZ * FEINT_BALL_LATERAL * backPhase

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

  rt.stopFeintTimer = STOP_FEINT_DURATION
  rt.stopFeintDuration = STOP_FEINT_DURATION
  rt.stopFeintStartSpeed = Math.max(speed, STOP_FEINT_MIN_SPEED)
  rt.stopFeintTargetYaw =
    rawIntentLen > 0.2 ? Math.atan2(rawDirX, rawDirZ) : Math.atan2(-moveDirX, -moveDirZ)
  rt.stopFeintOldDirX = moveDirX
  rt.stopFeintOldDirZ = moveDirZ
  const cross = moveDirX * inputDirZ - moveDirZ * inputDirX
  rt.stopFeintTurnSign = cross >= 0 ? 1 : -1
  rt.feintCooldown = STOP_FEINT_COOLDOWN
  rt.touchCooldown = STOP_FEINT_DURATION * 0.85
  rt.stepPhase = 0
  rt.sprintReleaseActive = false
  return true
}

// ---------------------------------------------------------------------------
// Corte em corrida — virada de ângulo médio SEM soltar velocidade, o
// comportamento que faltava para "viradas mesmo correndo". Empurra a bola
// pro lado do corte e acelera a rotação, mas sem travar a locomoção de corrida.
// ---------------------------------------------------------------------------

function buildRunningCutOutput(rt: Runtime): DribbleControlOutput {
  const out = makeDefaultOutput()

  const t = 1 - rt.runCutTimer / rt.runCutDuration // 0 -> 1
  const eased = easeOutQuad(t)

  // Pequeno "engolir" de velocidade no plante do pé, recuperando logo depois —
  // bem mais sutil que a finta de parada, pra não parecer que ele freou.
  out.speedMul = THREE.MathUtils.lerp(0.88, 1, eased)
  out.feintMoveSpeed = rt.runCutStartSpeed * out.speedMul
  out.feintKeepRun = true

  // Vira mais rápido que o normal enquanto o corte está ativo, mas sem
  // "teleportar" a rotação (sem forcedYaw/snap) — fica orgânico.
  out.turnRateMul = THREE.MathUtils.lerp(RUN_CUT_MAX_TURN_RATE, 1.15, eased)

  // Empurra a bola pro lado do corte, com pico no meio do movimento e
  // retorno suave ao centro — imita o toque lateral de quem corta em corrida.
  const pushPhase = Math.sin(Math.min(1, t) * Math.PI)
  const rightX = Math.cos(rt.runCutFromYaw)
  const rightZ = -Math.sin(rt.runCutFromYaw)
  out.ballOffsetX = rightX * RUN_CUT_BALL_PUSH * pushPhase * rt.runCutTurnSign
  out.ballOffsetZ = rightZ * RUN_CUT_BALL_PUSH * pushPhase * rt.runCutTurnSign

  // Dispara a animação de toque uma única vez, no início do corte.
  if (!rt.runCutTouchFired) {
    rt.runCutTouchFired = true
    out.touchAnim = rt.runCutTurnSign > 0 ? 'player_right' : 'player_left'
    out.touchDuration = rt.runCutDuration * 0.9
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
  if (dot > 0.88 || dot < -0.55) return false

  const cross = moveDirX * dirZ - moveDirZ * dirX
  rt.runCutTurnSign = cross >= 0 ? 1 : -1
  rt.runCutFromYaw = rotation
  rt.runCutTimer = RUN_CUT_DURATION
  rt.runCutDuration = RUN_CUT_DURATION
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
    out.touchDuration = 0.34
    rt.touchCooldown = TOUCH_COOLDOWN
    return
  }

  if (local.f < -0.45 && absF > absR * 0.8) {
    out.touchAnim = 'player_backward'
    out.touchDuration = 0.36
    rt.touchCooldown = TOUCH_COOLDOWN + 0.08
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
      out.touchDuration = 0.28
      rt.touchCooldown = TOUCH_COOLDOWN
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
    out.touchDuration = 0.32
    rt.touchCooldown = TOUCH_COOLDOWN
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
  out.touchDuration = SPRINT_TOUCH_DURATION
  rt.touchCooldown = SPRINT_TOUCH_COOLDOWN
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