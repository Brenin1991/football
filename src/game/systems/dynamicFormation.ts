import type { BallPossession, PassIntent } from '../store/gameStore'
import { useGameStore } from '../store/gameStore'
import type { FieldBounds, FormationSlot, PlayerRole, TeamId, Vec3 } from '../types'
import { MARKER_SWITCH_MARGIN, OWN_PASS_CONTEST_DIST, OWN_PASS_TARGET_CONTEST_DIST, WORLD_SCALE } from '../constants'
import { ballRef, playerRegistry, type PlayerRef } from './entityRegistry'
import { getHeldBallPoint, scorePassInterceptPosition } from './possession'
import { adjustInterceptScore, getMatchDifficulty, scaleCompactDefense, scalePressWeight, shouldAssignCoverPresser, shouldSkipBallPressure } from './difficulty'
import { getUserTeam } from '../store/gameStore'
import { isGkBallProtected } from './goalkeeper'
import { distance2D } from './rules'
import { GOAL_MOUTH_BUFFER, clampForwardFromGoalMouth, getOffsideLineZ } from './offside'
import {
  getAttackingGoalZ,
  getAttackSign,
  getDefensiveGoalZ,
  isBallInDefensiveThird,
} from './teamField'
import {
  getPlayerInstructions,
  getTacticsMultipliers,
  isFormationWideSlot,
} from './teamTactics'

export type TeamPhase = 'attack' | 'defense' | 'neutral'

export { getMarkerPursuitIntensity } from './difficulty'

/** Passe do próprio time ainda em voo */
export function isOwnPassInFlight(team: TeamId): boolean {
  const store = useGameStore.getState()
  const pi = store.passIntent
  if (!pi) return false
  return pi.passingTeam === team || store.lastTouchTeam === team
}

/** Passe adversário ainda em voo */
export function isOpponentPassInFlight(team: TeamId): boolean {
  const store = useGameStore.getState()
  const pi = store.passIntent
  if (!pi) return false
  const passerTeam = pi.passingTeam ?? store.lastTouchTeam
  return passerTeam != null && passerTeam !== team
}

/** Posse efetiva para marcação — inclui portador durante passe em voo */
function getThreatPossession(
  possession: BallPossession | null,
): BallPossession | null {
  if (possession) return possession

  const store = useGameStore.getState()
  if (!store.passIntent) return null

  const passerId = store.passBlockPlayerId
  const passerTeam = store.passIntent.passingTeam ?? store.lastTouchTeam
  if (!passerId || !passerTeam) return null

  const passer = playerRegistry.get(passerId)
  if (!passer || passer.team !== passerTeam) return null

  return { playerId: passerId, team: passerTeam }
}

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

/** Lateral largo (LB/RB/LM/RM/pontas) — lane L/R ou |slot.x| alto */
function isWideSlot(slot: FormationSlot): boolean {
  return isFormationWideSlot(slot)
}

/** Largura lateral a partir do slot — laterais/pontas seguram faixa, não colapsam na bola */
function getFormationX(
  slot: FormationSlot,
  bounds: FieldBounds,
  ball: Vec3,
  lateralPull: number,
  team?: TeamId,
): number {
  const widthScale = team ? getTacticsMultipliers(team).widthScale : 1
  const halfW = ((bounds.maxX - bounds.minX) / 2 - 0.55) * widthScale
  const baseX = bounds.center.x + slot.x * halfW
  const ballSide = ball.x >= bounds.center.x ? 1 : -1
  const onBallSide = (slot.x >= 0 && ballSide > 0) || (slot.x <= 0 && ballSide < 0)
  const wide = isWideSlot(slot)

  // Fraco: quase não puxa. Forte: puxa pouco. Laterais: ainda menos.
  let sideMul = onBallSide ? 0.85 : 0.28
  if (wide) sideMul *= onBallSide ? 0.45 : 0.2

  let pull = lateralPull * sideMul
  if (wide) pull *= 0.35

  let x = baseX + (ball.x - baseX) * pull

  // Piso de largura — laterais/pontas não entram no miolo
  if (wide) {
    const minAbs = Math.abs(slot.x) * halfW * 0.72
    const fromCenter = x - bounds.center.x
    if (Math.abs(fromCenter) < minAbs) {
      x = bounds.center.x + Math.sign(slot.x || fromCenter || 1) * minAbs
    }
  }

  return clamp(x, bounds.minX + 0.8, bounds.maxX - 0.8)
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

/** Linha tática por função — ataque: zaga segura, meias/pontas sobem */
function getAttackLineProgress(
  role: PlayerRole,
  ballProgress: number,
): number {
  const lines: Record<PlayerRole, number> = {
    gk: 0.07,
    // Zaga acompanha o ataque para compactar o bloco, mantendo rest defense
    // (fica atrás da bola). Com a bola no ataque, sobe até ~meio-campo adversário.
    def: Math.min(0.52, Math.max(0.16, ballProgress * 0.56 - 0.04)),
    // Meio sobe mais cedo que a zaga — evita bloco de 4+3 no mesmo Z
    mid: Math.min(0.84, Math.max(0.36, ballProgress * 0.78 + 0.12)),
    fwd: Math.min(0.88, ballProgress + 0.2),
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

  // Cap na linha — evita zaga no meio-campo abrindo contra-ataque
  const lines: Record<PlayerRole, number> = {
    gk: 0.06,
    def: Math.min(0.36, ballProgress * 0.28 + 0.08),
    mid: Math.min(0.48, ballProgress * 0.38 + 0.12),
    fwd: Math.min(0.58, ballProgress * 0.42 + 0.12),
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

  const store = useGameStore.getState()
  const passTeam = store.passIntent?.passingTeam ?? lastTouch

  if (store.passIntent && passTeam === team) return 'attack'
  if (store.passIntent && passTeam && passTeam !== team) return 'defense'

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
  const tactics = getTacticsMultipliers(team)

  let lineProgress: number
  let lateralPull: number

  if (phase === 'attack') {
    lineProgress = blendRoleWithSlot(getAttackLineProgress(slot.role, ballProgress), slot, slot.role)
    lateralPull = slot.role === 'def' ? 0.1 : slot.role === 'mid' ? 0.14 : 0.18
  } else if (phase === 'defense') {
    lineProgress = blendRoleWithSlot(
      getDefenseLineProgress(slot.role, ballProgress, inOwnThird),
      slot,
      slot.role,
    )
    lateralPull =
      slot.role === 'def'
        ? inOwnThird
          ? 0.1
          : 0.06
        : slot.role === 'mid'
          ? inOwnThird
            ? 0.14
            : 0.1
          : inOwnThird
            ? 0.16
            : 0.12
  } else {
    lineProgress = getNeutralLineProgress(slot.role, slot)
    lateralPull = 0.08
  }

  lineProgress = clamp(lineProgress + tactics.lineDepthBias, 0.04, 0.96)

  return {
    x: getFormationX(slot, bounds, ball, lateralPull, team),
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
  const halfW = (bounds.maxX - bounds.minX) / 2 - 0.55
  const tactics = getTacticsMultipliers(team)
  const instr = playerId ? getPlayerInstructions(playerId) : null

  let lineProgress: number
  if (slot.role === 'fwd') {
    lineProgress = Math.min(0.92, ballProgress + 0.28)
  } else if (slot.role === 'mid') {
    // Meias sobem com a posse — não ficam colados na zaga
    lineProgress = isWideSlot(slot)
      ? Math.min(0.86, ballProgress + 0.2)
      : Math.min(0.82, Math.max(0.42, ballProgress + 0.16))
  } else if (slot.role === 'def') {
    // Zaga acompanha o ataque para compactar (sobe até ~meio-campo adversário),
    // mas mantém rest defense atrás da bola.
    lineProgress = Math.min(0.5, Math.max(0.16, ballProgress * 0.52 - 0.02))
  } else {
    lineProgress = 0.07
  }

  if (instr?.supportRuns === 'stay_back') {
    lineProgress -= slot.role === 'mid' ? 0.14 : 0.1
  } else if (instr?.supportRuns === 'get_forward') {
    lineProgress += slot.role === 'mid' ? 0.2 : 0.1
  } else if (instr?.supportRuns === 'free_roam') {
    lineProgress += slot.role === 'mid' ? 0.12 : 0.06
  }
  lineProgress = clamp(
    lineProgress + tactics.chanceCreationForward * 0.35 + tactics.lineDepthBias,
    0.05,
    0.94,
  )

  // Menos pull pro portador — evita todo mundo colar nele
  const pull = isWideSlot(slot)
    ? slot.role === 'fwd'
      ? 0.06
      : 0.04
    : slot.role === 'fwd'
      ? 0.12
      : 0.08
  let x = getFormationX(slot, bounds, carrier, pull, team)
  // Força faixa do slot (pontas/laterais não entram no miolo)
  const slotX = bounds.center.x + slot.x * halfW * tactics.widthScale
  if (isWideSlot(slot)) {
    x = x * 0.35 + slotX * 0.65
  } else {
    x = x * 0.7 + slotX * 0.3
  }

  if (instr?.attackingRuns === 'stay_central') {
    x = x * 0.55 + bounds.center.x * 0.45
  } else if (instr?.attackingRuns === 'get_in_behind' && isWideSlot(slot)) {
    x = x * 0.7 + slotX * 0.3
  } else if (instr?.attackingRuns === 'false_9') {
    lineProgress = Math.max(0.28, lineProgress - 0.12)
    x = x * 0.75 + bounds.center.x * 0.25
  } else if (instr?.attackingRuns === 'target_man') {
    lineProgress = Math.min(0.9, lineProgress + 0.06)
    x = x * 0.65 + bounds.center.x * 0.35
  }

  let z = progressToZ(lineProgress, team, bounds)

  if (slot.role === 'fwd') {
    const maxZ = atkGoalZ - attackSign * GOAL_MOUTH_BUFFER
    // Profundidade por slot — não todos no mesmo Z do portador
    const depthMul = 2.6 + (slot.z - 0.45) * 2.2 + Math.abs(slot.x) * 0.8
    let runZ = carrier.z + attackSign * depthMul

    const makingRun = !!playerId && isForwardMakingRun(playerId, team)
    const lineZ = getOffsideLineZ(team, bounds)

    if (makingRun) {
      // Corrida cronometrada: pode romper a linha para atacar o espaço
      const beyond = getForwardRunBeyondLine(team)
      const offsideRunZ = lineZ + attackSign * (0.35 + beyond)
      runZ =
        attackSign > 0
          ? Math.max(runZ, offsideRunZ)
          : Math.min(runZ, offsideRunZ)

      if (isWideSlot(slot) && ballProgress > 0.38) {
        const bylineZ = atkGoalZ - attackSign * 2.4
        runZ =
          attackSign > 0
            ? Math.max(runZ, bylineZ - attackSign * 3.5)
            : Math.min(runZ, bylineZ + attackSign * 3.5)
      }
    } else {
      // Sem corrida ativa: segura no limite do impedimento (onside) para ficar
      // disponível ao passe e achar a brecha, em vez de estacionar em impedimento.
      const holdZ = lineZ - attackSign * 0.7
      runZ = attackSign > 0 ? Math.min(runZ, holdZ) : Math.max(runZ, holdZ)
    }

    z = attackSign > 0 ? Math.max(z, runZ) : Math.min(z, runZ)
    const minAdvanceZ = progressToZ(0.3, team, bounds)
    z =
      attackSign > 0
        ? clamp(z, minAdvanceZ, maxZ)
        : clamp(z, maxZ, minAdvanceZ)
    // Trava final onside quando não está rompendo — mantém o atacante jogável
    if (!makingRun) {
      const holdZ = lineZ - attackSign * 0.7
      z = attackSign > 0 ? Math.min(z, holdZ) : Math.max(z, holdZ)
    }
    z = clampForwardFromGoalMouth(team, z, bounds)
  } else if (slot.role === 'mid') {
    const support = instr?.supportRuns ?? 'balanced'
    // slot.z alto ≈ CDM; baixo ≈ CAM — afeta o quanto sobe com a bola
    const attackingBias = clamp(1 - slot.z, 0.22, 0.88)

    if (isWideSlot(slot)) {
      if (support === 'stay_back') {
        const holdZ = carrier.z - attackSign * (1.1 + (1 - slot.z) * 0.9)
        z = attackSign > 0 ? Math.min(z, holdZ) : Math.max(z, holdZ)
      } else if (support === 'get_forward' || support === 'free_roam') {
        const pushZ =
          carrier.z + attackSign * (2.6 + Math.abs(slot.x) * 0.55 + attackingBias * 1.4)
        z = attackSign > 0 ? Math.max(z, pushZ) : Math.min(z, pushZ)
      } else if (ballProgress > 0.3) {
        const pushZ = carrier.z + attackSign * (1.6 + Math.abs(slot.x) * 0.5)
        z = attackSign > 0 ? Math.max(z, pushZ) : Math.min(z, pushZ)
      }
    } else if (support === 'stay_back') {
      // Volante explícito: fica atrás do portador
      const dropZ = carrier.z - attackSign * (2.0 + (1 - slot.z) * 1.1)
      z = attackSign > 0 ? Math.min(z, dropZ) : Math.max(z, dropZ)
    } else if (support === 'get_forward') {
      // Avançar: sobe no ombro / à frente do portador — não cola na zaga
      const pushZ = carrier.z + attackSign * (1.8 + attackingBias * 2.4)
      z = attackSign > 0 ? Math.max(z, pushZ) : Math.min(z, pushZ)
    } else if (support === 'free_roam') {
      const roamZ = carrier.z + attackSign * (1.0 + attackingBias * 2.0)
      z = attackSign > 0 ? Math.max(z, roamZ) : Math.min(z, roamZ)
    } else if (slot.z >= 0.52) {
      // CDM equilibrado: leve drop, sem 2m+ atrás forçado
      const dropZ = carrier.z - attackSign * (0.7 + (slot.z - 0.45) * 1.5)
      z = attackSign > 0 ? Math.min(Math.max(z, dropZ - 0.8), dropZ) : Math.max(Math.min(z, dropZ + 0.8), dropZ)
    } else {
      // CM/CAM equilibrado: ao lado ou levemente à frente do portador
      const camZ = carrier.z + attackSign * (0.5 + attackingBias * 1.6)
      z = attackSign > 0 ? Math.max(z, camZ) : Math.min(z, camZ)
    }
  }

  let target = {
    x: clamp(x, bounds.minX + 0.8, bounds.maxX - 0.8),
    z,
  }
  if (playerId) {
    target = spreadAwayFromTeammates(playerId, team, bounds, target, 2.15)
  }
  return target
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
  const lateralPull = isWideSlot(slot)
    ? 0.1
    : slot.role === 'fwd'
      ? 0.2
      : slot.role === 'mid'
        ? 0.16
        : 0.1
  let z = progressToZ(lineProgress, team, bounds)

  if (slot.role === 'fwd') {
    const pushZ = anchor.z + attackSign * 1.6
    z = attackSign > 0 ? Math.max(z, pushZ) : Math.min(z, pushZ)
    z = clampForwardFromGoalMouth(team, z, bounds)
  } else if (slot.role === 'mid') {
    const pushZ = anchor.z + attackSign * 0.5
    z = attackSign > 0 ? Math.max(z, pushZ) : Math.min(z, pushZ)
  } else if (slot.role === 'def') {
    // Zaga segura — não sobe atrás da bola solta
    const restZ = progressToZ(
      Math.min(0.36, getBallProgress(ball, team, bounds) - 0.18),
      team,
      bounds,
    )
    z = attackSign > 0 ? Math.min(z, restZ) : Math.max(z, restZ)
  }

  return {
    x: getFormationX(slot, bounds, anchor, lateralPull, team),
    z,
  }
}

/** Apoio durante passe em voo — mantém altura ofensiva, nunca recua o bloco */
export function getPassFlightSupportPosition(
  team: TeamId,
  slot: FormationSlot,
  bounds: FieldBounds,
  passIntent: { targetX: number; targetZ: number },
  playerId?: string,
): { x: number; z: number } {
  const attackSign = getAttackSign(team, bounds)
  const halfW = (bounds.maxX - bounds.minX) / 2 - 0.55
  const anchor = {
    x: passIntent.targetX,
    y: 0,
    z: passIntent.targetZ,
  }
  const base = getLooseBallAttackPosition(team, slot, bounds, anchor, passIntent)
  // Abre pelo slot — não todos no alvo do passe
  const slotX = bounds.center.x + slot.x * halfW
  let x = base.x * 0.45 + slotX * 0.55
  // Não cola no ponto de queda (só o receptor vai lá)
  const dx = x - passIntent.targetX
  const distX = Math.abs(dx)
  if (distX < 2.8) {
    const push = (2.8 - distX) * (dx >= 0 ? 1 : -1) * (isWideSlot(slot) ? 1.1 : 0.85)
    x += push === 0 ? (slot.x >= 0 ? 2.4 : -2.4) : push
  }

  let z = base.z
  if (slot.role === 'fwd') {
    const pushZ = passIntent.targetZ + attackSign * (2.0 + (1 - slot.z) * 1.4)
    z = clampForwardFromGoalMouth(
      team,
      attackSign > 0 ? Math.max(base.z, pushZ) : Math.min(base.z, pushZ),
      bounds,
    )
  } else if (slot.role === 'mid') {
    const support = playerId
      ? getPlayerInstructions(playerId).supportRuns
      : 'balanced'
    const attackingBias = clamp(1 - slot.z, 0.22, 0.88)
    if (support === 'get_forward' || support === 'free_roam') {
      const pushZ =
        passIntent.targetZ +
        attackSign * ((isWideSlot(slot) ? 1.4 : 1.1) + attackingBias * 1.6)
      z =
        attackSign > 0
          ? Math.max(base.z, pushZ)
          : Math.min(base.z, pushZ)
    } else if (support === 'stay_back') {
      const holdZ = passIntent.targetZ - attackSign * (isWideSlot(slot) ? 0.8 : 2.0)
      z =
        attackSign > 0
          ? Math.min(Math.max(base.z, holdZ - 0.6), holdZ)
          : Math.max(Math.min(base.z, holdZ + 0.6), holdZ)
    } else {
      const pushZ = passIntent.targetZ + attackSign * (0.6 + Math.abs(slot.x) * 0.5)
      const holdZ = isWideSlot(slot)
        ? pushZ
        : passIntent.targetZ - attackSign * (slot.z >= 0.52 ? 1.2 : 0.35)
      z =
        attackSign > 0
          ? isWideSlot(slot) || slot.z < 0.52
            ? Math.max(base.z, holdZ)
            : Math.min(Math.max(base.z, holdZ), passIntent.targetZ - attackSign * 0.2)
          : isWideSlot(slot) || slot.z < 0.52
            ? Math.min(base.z, holdZ)
            : Math.max(Math.min(base.z, holdZ), passIntent.targetZ + attackSign * 0.2)
    }
  }

  let target = {
    x: clamp(x, bounds.minX + 0.8, bounds.maxX - 0.8),
    z,
  }
  if (playerId) {
    target = spreadAwayFromTeammates(playerId, team, bounds, target, 2.4)
  }
  return target
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
  const tactics = getTacticsMultipliers(team)
  const lineProgress = clamp(
    blendRoleWithSlot(
      getDefenseLineProgress(slot.role, ballProgress, inOwnThird),
      slot,
      slot.role,
    ) + tactics.lineDepthBias,
    0.04,
    0.96,
  )
  const lateralPull =
    slot.role === 'def'
      ? inOwnThird
        ? 0.1
        : 0.06
      : slot.role === 'mid'
        ? inOwnThird
          ? 0.14
          : 0.1
        : inOwnThird
          ? 0.16
          : 0.12

  const base = {
    x: getFormationX(slot, bounds, ball, lateralPull, team),
    z: progressToZ(lineProgress, team, bounds) + getSlotDepthOffset(slot, bounds, team),
  }

  // Compacto suave — laterais quase não colapsam no miolo
  const compactXMul = isWideSlot(slot) ? 0.04 : 0.1
  const compactPoint: Vec3 = {
    x: base.x + (ball.x - base.x) * compactXMul,
    y: 0,
    z: base.z + (ball.z - base.z) * 0.06,
  }
  const w = scaleCompactDefense(
    getDefensiveCompactWeight(slot.role, ball, team, bounds) * tactics.compactWeight,
    team,
  )
  return getBlendedTarget(base, compactPoint, w)
}

/** Segundo homem na pressão — sombra entre formação e portador */
export function getCoverPressTarget(
  team: TeamId,
  slot: FormationSlot,
  bounds: FieldBounds,
  carrier: PlayerRef,
  shapeBase: { x: number; z: number },
): { x: number; z: number } {
  const goalDir = -getAttackSign(team, bounds)
  const shadow: Vec3 = {
    x: carrier.position.x * 0.38 + shapeBase.x * 0.62,
    y: 0,
    z: carrier.position.z + goalDir * (slot.role === 'mid' ? 1.85 : 1.55),
  }
  const w = scalePressWeight(
    (slot.role === 'mid' ? 0.92 : slot.role === 'fwd' ? 0.8 : 0.72) *
      getTacticsMultipliers(team).pressWeight,
    team,
  )
  return getBlendedTarget(shapeBase, shadow, w)
}

export function getPressBallWeight(
  isMarker: boolean,
  phase: TeamPhase,
  distBall: number,
  team: TeamId,
): number {
  if (!isMarker) return 0
  const base = 0.88
  const phaseBoost = phase === 'defense' ? 0.07 : phase === 'neutral' ? 0.04 : 0
  const closeBoost = distBall < 4 ? 0.06 : distBall < 7 ? 0.03 : 0
  return scalePressWeight(
    clamp((base + phaseBoost + closeBoost) * getTacticsMultipliers(team).pressWeight, 0, 0.96),
    team,
  )
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
  return role === 'def' ? 0.16 : role === 'mid' ? 0.12 : 0.08
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
  const x = getFormationX(slot, bounds, ball, lateralPull, team)

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
    if (carrier) {
      const held = getHeldBallPoint(carrier, possession.playerId)
      return { x: held.x, y: ball.y, z: held.z }
    }
  }
  return ball
}

export function getHolderFacing(carrier: PlayerRef): { x: number; z: number } {
  const speed = Math.hypot(carrier.velocity.x, carrier.velocity.z)
  if (speed > 0.22) {
    return { x: carrier.velocity.x / speed, z: carrier.velocity.z / speed }
  }
  return { x: Math.sin(carrier.rotation), z: Math.cos(carrier.rotation) }
}

/** Dot produto: >0 = marcador na frente do portador (hemisfério de ataque). */
export function getMarkerFrontDot(
  markerPos: { x: number; z: number },
  holderPos: { x: number; z: number },
  face: { x: number; z: number },
): number {
  const toX = markerPos.x - holderPos.x
  const toZ = markerPos.z - holderPos.z
  const len = Math.hypot(toX, toZ)
  if (len < 0.08) return 1
  return (toX * face.x + toZ * face.z) / len
}

export function isMarkerBehindHolder(
  markerPos: { x: number; z: number },
  carrier: PlayerRef,
): boolean {
  return getMarkerFrontDot(markerPos, carrier.position, getHolderFacing(carrier)) < 0.08
}

export function getTackleTarget(
  possession: BallPossession,
  _defendingTeam: TeamId,
  bounds: FieldBounds,
  ball?: Vec3,
  _markerPos?: { x: number; z: number },
): { x: number; z: number } {
  const carrier = playerRegistry.get(possession.playerId)
  if (carrier) {
    const held = getHeldBallPoint(carrier, possession.playerId)
    return { x: held.x, z: held.z }
  }
  const fallback = ball ?? { x: bounds.center.x, y: 0, z: bounds.center.z }
  return { x: fallback.x, z: fallback.z }
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
const markerCommitUntil: Record<TeamId, number> = { home: 0, away: 0 }
let lastPossessionKey = ''
let markerCacheFrame = -1
const markerByTeam: Record<TeamId, string | null> = { home: null, away: null }
const coverPresserByTeam: Record<TeamId, string | null> = { home: null, away: null }
const passLaneBlockerByTeam: Record<TeamId, string | null> = { home: null, away: null }
const passInterceptorByTeam: Record<TeamId, string | null> = { home: null, away: null }
const passInterceptorSecondaryByTeam: Record<TeamId, string | null> = { home: null, away: null }
const looseBallChaserByTeam: Record<TeamId, string | null> = { home: null, away: null }
/** 2º homem sticky na bola solta (evita ir/voltar no limiar de distância) */
const looseBallAssistByTeam: Record<TeamId, string | null> = { home: null, away: null }
/** Após ombro/desarme — este cara tem preferência na bola solta */
const bodyDuelClaimPriorityUntil = new Map<string, number>()
let preferredLooseChaserId: string | null = null
let preferredLooseChaserUntil = 0

export function markBodyDuelClaimPriority(playerId: string, ms = 980) {
  const until = performance.now() + ms
  bodyDuelClaimPriorityUntil.set(playerId, until)
  preferredLooseChaserId = playerId
  preferredLooseChaserUntil = until
}

export function hasBodyDuelClaimPriority(playerId: string): boolean {
  return performance.now() < (bodyDuelClaimPriorityUntil.get(playerId) ?? 0)
}

export function getPreferredLooseBallChaser(): string | null {
  if (performance.now() >= preferredLooseChaserUntil) {
    preferredLooseChaserId = null
    return null
  }
  return preferredLooseChaserId
}

/** Quem disputa o passe próprio — travado no startedAt do passe */
const ownPassChaseLockByTeam: Record<
  TeamId,
  { key: number; ids: Set<string> } | null
> = { home: null, away: null }

// --- Marcação individual (man-marking) -------------------------------------
// defenderId -> opponentId. Cada time defensor cola seus zagueiros/meias nos
// atacantes mais perigosos, goal-side, enquanto o marcador da bola pressiona.
const manMarkByTeam: Record<TeamId, Map<string, string>> = {
  home: new Map(),
  away: new Map(),
}
/** Tempo mínimo que uma marcação individual persiste antes de reavaliar. */
const MAN_MARK_STICK = 2.85 * WORLD_SCALE
/** Só marca adversários dentro deste alcance do defensor. */
const MAN_MARK_MAX_DIST = 18.5 * WORLD_SCALE
/** Deslocamento goal-side (fica entre o marcado e o próprio gol). */
const MAN_MARK_GOALSIDE = 1.35 * WORLD_SCALE

function resolveManMarking(
  team: TeamId,
  possession: BallPossession | null,
): void {
  const assignments = manMarkByTeam[team]
  const store = useGameStore.getState()

  // Marca individualmente quando o adversário controla a bola ou está no passe deles.
  const threat = getThreatPossession(possession)
  const defending = threat != null && threat.team !== team
  if (
    !defending ||
    store.ballFrozen ||
    store.phase !== 'playing'
  ) {
    assignments.clear()
    return
  }

  const carrierId = threat!.playerId
  const carrier = playerRegistry.get(carrierId)
  const primary = markerByTeam[team]
  const cover = coverPresserByTeam[team]
  const bounds = store.fieldBounds
  const inOwnThird =
    bounds != null &&
    carrier != null &&
    isBallInDefensiveThird(carrier.position, team, bounds)

  // Defensores elegíveis: zagueiros e meias; atacantes entram no próprio terço.
  const defenders = [...playerRegistry.values()].filter(
    (p) =>
      p.team === team &&
      (p.role === 'def' ||
        p.role === 'mid' ||
        (p.role === 'fwd' && inOwnThird)) &&
      p.id !== primary &&
      p.id !== cover,
  )

  // Alvos: adversários de linha, menos o goleiro e o portador (esse é do
  // marcador da bola).
  const targets = [...playerRegistry.values()].filter(
    (p) => p.team !== team && p.role !== 'gk' && p.id !== carrierId,
  )

  if (defenders.length === 0 || targets.length === 0) {
    assignments.clear()
    return
  }

  // Custo por par (defensor, alvo) com "aderência": pares já existentes ganham
  // desconto pra não ficar trocando de marcado a cada frame (evita indecisão).
  type Pair = { d: string; o: string; cost: number; raw: number }
  const pairs: Pair[] = []
  for (const d of defenders) {
    const prev = assignments.get(d.id)
    for (const o of targets) {
      const raw = distance2D(d.position, o.position)
      if (raw > MAN_MARK_MAX_DIST) continue
      let danger = 0
      if (bounds && carrier) {
        const fwd = (o.position.z - carrier.position.z) * getAttackSign(o.team, bounds)
        danger += clamp(fwd, 0, 10) * 0.14
        if (o.role === 'fwd') danger += 1.5
        else if (o.role === 'mid') danger += 0.75
        if (isForwardMakingRun(o.id, o.team)) danger += 1.9
      }
      const cost = (prev === o.id ? raw - MAN_MARK_STICK : raw) - danger
      pairs.push({ d: d.id, o: o.id, cost, raw })
    }
  }
  pairs.sort((a, b) => a.cost - b.cost)

  const next = new Map<string, string>()
  const usedD = new Set<string>()
  const usedO = new Set<string>()
  for (const pair of pairs) {
    if (usedD.has(pair.d) || usedO.has(pair.o)) continue
    next.set(pair.d, pair.o)
    usedD.add(pair.d)
    usedO.add(pair.o)
  }

  assignments.clear()
  for (const [d, o] of next) assignments.set(d, o)
}

export function getManMarkOpponentId(team: TeamId, playerId: string): string | null {
  return manMarkByTeam[team].get(playerId) ?? null
}

/** Posição de marcação: goal-side do adversário, levemente puxada pra bola. */
export function getManMarkTarget(
  playerId: string,
  team: TeamId,
  bounds: FieldBounds,
  ball: Vec3,
): { x: number; z: number } | null {
  const oppId = manMarkByTeam[team].get(playerId)
  if (!oppId) return null
  const opp = playerRegistry.get(oppId)
  if (!opp) return null

  const attackSign = getAttackSign(team, bounds)
  const z = opp.position.z - attackSign * MAN_MARK_GOALSIDE
  const ballSide = ball.x >= opp.position.x ? 1 : -1
  const x = clamp(
    opp.position.x + ballSide * 0.34 * WORLD_SCALE,
    bounds.minX + 0.8,
    bounds.maxX - 0.8,
  )
  return { x, z }
}

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

const RUN_WINDOW_MS = 4200
const RUN_DURATION_BASE_MS = 3000
const RUN_CHANCE = 0.88

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
      (state.possessionKey === key ||
        (store.passIntent &&
          (store.passIntent.passingTeam === team || store.lastTouchTeam === team)))
    ) {
      const runner = playerRegistry.get(state.runnerId)
      if (!runner || runner.team !== team || runner.role !== 'fwd') {
        state.runnerId = null
      }
      continue
    }

    state.runnerId = null

    if (!possession || possession.team !== team) {
      if (
        !(
          store.passIntent &&
          (store.passIntent.passingTeam === team || store.lastTouchTeam === team)
        )
      ) {
        continue
      }
    }

    const ballProgress = getBallProgress(ball, team, bounds)
    if (ballProgress < 0.2) continue

    const forwards = [...playerRegistry.values()]
      .filter((p) => p.team === team && p.role === 'fwd')
      .sort((a, b) => {
        const wideA = Math.abs(a.position.x - bounds.center.x)
        const wideB = Math.abs(b.position.x - bounds.center.x)
        if (wideA !== wideB) return wideB - wideA
        return a.id.localeCompare(b.id)
      })
    if (forwards.length === 0) continue

    if (lastRunRollBucket[team] === bucket) continue
    lastRunRollBucket[team] = bucket

    if (pseudoRandom(team, bucket, 1) > RUN_CHANCE + getTacticsMultipliers(team).chanceCreationForward) {
      continue
    }

    const eligible = forwards.filter((fwd) => {
      const runs = getPlayerInstructions(fwd.id).attackingRuns
      return runs !== 'false_9' && runs !== 'target_man'
    })
    const pool = eligible.length > 0 ? eligible : forwards
    const pickIdx = Math.floor(pseudoRandom(team, bucket, 2) * pool.length)
    const runner = pool[pickIdx]

    state.runnerId = runner.id
    state.until = now + RUN_DURATION_BASE_MS + pseudoRandom(team, bucket, 3) * 1600
    const behindBonus =
      getPlayerInstructions(runner.id).attackingRuns === 'get_in_behind' ? 0.55 : 0
    state.beyondLine =
      0.85 + pseudoRandom(team, bucket, 4) * 1.35 + behindBonus + getTacticsMultipliers(team).chanceCreationForward
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
  const store = useGameStore.getState()
  if (store.passIntent) {
    const pt = store.passIntent.passingTeam ?? store.lastTouchTeam ?? '?'
    return `pass:${pt}:${store.passIntent.receiverId}`
  }
  return possession ? `${possession.team}:${possession.playerId}` : 'loose'
}

/** Ponto de disputa — portador, zona de receção ou bola */
function getContestPoint(
  possession: BallPossession | null,
  ball: Vec3,
): Vec3 {
  if (possession) {
    const carrier = playerRegistry.get(possession.playerId)
    if (carrier) {
      const held = getHeldBallPoint(carrier, possession.playerId)
      return { x: held.x, y: 0, z: held.z }
    }
  }

  const store = useGameStore.getState()
  const pi = store.passIntent
  if (pi) {
    const blend = 0.62
    return {
      x: ball.x * (1 - blend) + pi.targetX * blend,
      y: 0,
      z: ball.z * (1 - blend) + pi.targetZ * blend,
    }
  }

  return ball
}

function scoreMarkerCandidate(
  player: { role: PlayerRole; id: string },
  dist: number,
  userCarrier: boolean,
): number {
  if (!userCarrier) return -dist
  let score = -dist
  if (player.role === 'def') score += 2.4
  else if (player.role === 'mid') score += 1.5
  else if (player.role === 'fwd') score -= 3.2
  return score
}

function findClosestMarkerCandidate(
  team: TeamId,
  contestPoint: Vec3,
  possession: BallPossession | null,
): { id: string | null; dist: number } {
  if (shouldSkipBallPressure(team)) {
    return { id: null, dist: Infinity }
  }

  const carrier = possession ? playerRegistry.get(possession.playerId) : null
  const userCarrier = carrier?.team === getUserTeam()

  let bestId: string | null = null
  let bestScore = -Infinity
  let minDist = Infinity

  for (const p of playerRegistry.values()) {
    if (p.team !== team || p.role === 'gk') continue
    const d = distance2D(p.position, contestPoint)
    if (userCarrier && p.role === 'fwd' && d > 2.6) continue

    const score = scoreMarkerCandidate(p, d, userCarrier)
    if (score > bestScore) {
      bestScore = score
      bestId = p.id
      minDist = d
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

  if (isGkBallProtected(possession)) {
    activeMarker[team] = null
    return null
  }

  const key = possessionKey(possession)
  const possessionChanged = key !== lastPossessionKey
  if (possessionChanged && !store.passIntent) {
    activeMarker.home = null
    activeMarker.away = null
  }
  if (possessionChanged) {
    lastPossessionKey = key
    if (possession && possession.team === getUserTeam()) {
      markerCommitUntil[team] = 0
      if (team !== getUserTeam()) {
        activeMarker[team] = null
      }
    }
  }

  const contestPoint = getContestPoint(possession, ball)
  const { id: closestId, dist: closestDist } = findClosestMarkerCandidate(
    team,
    contestPoint,
    possession,
  )

  if (!closestId) {
    activeMarker[team] = null
    return null
  }

  const now = performance.now()
  const current = activeMarker[team]
  if (!possessionChanged && current && current !== closestId) {
    const currentP = playerRegistry.get(current)
    if (currentP && currentP.team === team && currentP.role !== 'gk') {
      const currentDist = distance2D(currentP.position, contestPoint)
      // Compromisso temporal: logo após assumir a marcação, exige que o novo
      // candidato esteja MUITO mais perto pra trocar — evita o clássico
      // "começa a perseguir a bola e desiste" quando dois defensores ficam
      // quase equidistantes do portador.
      const committed = now < markerCommitUntil[team]
      const passInFlight = !!store.passIntent
      const margin = passInFlight
        ? MARKER_SWITCH_MARGIN * 0.55
        : committed
          ? MARKER_SWITCH_MARGIN + 1.4 * WORLD_SCALE
          : MARKER_SWITCH_MARGIN
      if (closestDist > currentDist - margin) {
        return current
      }
    }
  }

  if (activeMarker[team] !== closestId) {
    markerCommitUntil[team] = now + 550
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
  const threat = getThreatPossession(possession)
  if (!threat || threat.team === team || !primaryMarker) return null
  if (isGkBallProtected(threat)) return null
  if (!shouldAssignCoverPresser(team, threat.team)) return null
  // Tática: chance de segundo homem (antes da camada de dificuldade)
  const coverChance = getTacticsMultipliers(team).coverPresserChance
  const roll =
    Math.abs(
      (threat.playerId.charCodeAt(0) * 17 + team.charCodeAt(0) * 31 + primaryMarker.length * 13) %
        100,
    ) / 100
  if (roll > coverChance) return null
  const contest = getContestPoint(possession, ball)
  const ranked = [...playerRegistry.values()]
    .filter((p) => p.team === team && p.role !== 'gk')
    .map((p) => ({ id: p.id, dist: distance2D(p.position, contest), role: p.role }))
    .sort((a, b) => a.dist - b.dist)

  if (ranked.length < 2) return null
  const second = ranked.find((c) => c.id !== primaryMarker) ?? ranked[1]
  if (!second || second.dist > 17) return null
  if (second.role === 'fwd' && second.dist > 12.5) return null
  return second.id
}

function resolvePassLaneBlocker(
  team: TeamId,
  possession: BallPossession | null,
): string | null {
  const threat = getThreatPossession(possession)
  if (!threat || threat.team === team) return null
  const marker = markerByTeam[team]
  const cover = coverPresserByTeam[team]
  const carrier = playerRegistry.get(threat.playerId)
  if (!carrier) return null

  const bounds = useGameStore.getState().fieldBounds
  if (!bounds) return null

  const oppTeammates = [...playerRegistry.values()].filter(
    (p) => p.team === carrier.team && p.role !== 'gk' && p.id !== carrier.id,
  )
  if (oppTeammates.length === 0) return null

  const attackSign = getAttackSign(carrier.team, bounds)
  let bestId: string | null = null
  let bestScore = -Infinity

  for (const p of playerRegistry.values()) {
    if (p.team !== team || p.role === 'gk' || p.id === marker || p.id === cover) continue
    if (p.role !== 'def' && p.role !== 'mid') continue

    for (const mate of oppTeammates) {
      const fwd = (mate.position.z - carrier.position.z) * attackSign
      if (fwd < 0.4) continue

      const cutT = 0.4
      const laneX = carrier.position.x + (mate.position.x - carrier.position.x) * cutT
      const laneZ = carrier.position.z + (mate.position.z - carrier.position.z) * cutT
      const distToLane = distance2D(p.position, { x: laneX, y: 0, z: laneZ })
      if (distToLane > 9.5) continue

      const roleBonus = p.role === 'mid' ? 0.55 : 0.35
      const score = fwd * 1.15 - distToLane * 0.42 + roleBonus
      if (score > bestScore) {
        bestScore = score
        bestId = p.id
      }
    }
  }

  return bestScore > -0.5 ? bestId : null
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
  if (store.ballPossession?.team === team) return
  if (passIntent.passingTeam === team) return

  const vel = ballRef.velocity
  const hardPlus =
    getMatchDifficulty() === 'hard' || getMatchDifficulty() === 'expert'
  const scoreFloor = hardPlus ? -6.4 : -4.4
  const secondaryGap = hardPlus ? 4.0 : 3.0
  const candidates = [...playerRegistry.values()]
    .filter((p) => p.team === team && p.role !== 'gk')
    .map((p) => {
      const instr = getPlayerInstructions(p.id)
      let score = adjustInterceptScore(
        scorePassInterceptPosition(p, ball, vel, passIntent),
        team,
      )
      if (instr.interceptions === 'aggressive') score += 1.15
      else if (instr.interceptions === 'conservative') score -= 1.35
      return { id: p.id, score }
    })
    .filter((c) => c.score > scoreFloor)
    .sort((a, b) => b.score - a.score)

  if (candidates.length > 0) passInterceptorByTeam[team] = candidates[0].id
  if (candidates.length > 1 && candidates[1].score > candidates[0].score - secondaryGap) {
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

  resolveManMarking('home', possession)
  resolveManMarking('away', possession)

  const passIntent = useGameStore.getState().passIntent
  if (!passIntent) {
    ownPassChaseLockByTeam.home = null
    ownPassChaseLockByTeam.away = null
  }
  if (possession) {
    looseBallAssistByTeam.home = null
    looseBallAssistByTeam.away = null
  }

  resolvePassInterceptors('home', passIntent, ball)
  resolvePassInterceptors('away', passIntent, ball)

  looseBallChaserByTeam.home = computeLooseBallChaser('home', ball)
  looseBallChaserByTeam.away = computeLooseBallChaser('away', ball)

  const bounds = useGameStore.getState().fieldBounds
  if (bounds) refreshForwardRuns(possession, ball, bounds)
}

export function buildPassRunnerIds(
  passerId: string,
  team: TeamId,
  receiverId: string,
  target: { x: number; z: number },
  passType: 'pass' | 'through' | 'cross' = 'pass',
): string[] {
  if (passType !== 'cross') return []

  const bounds = useGameStore.getState().fieldBounds
  if (!bounds) return []
  const attackSign = getAttackSign(team, bounds)
  const runners: string[] = []

  for (const p of playerRegistry.values()) {
    if (p.team !== team || p.id === passerId || p.id === receiverId || p.role === 'gk') {
      continue
    }
    if (isForwardMakingRun(p.id, team)) {
      runners.push(p.id)
      continue
    }
    if (p.role === 'fwd') {
      const ahead =
        attackSign > 0 ? p.position.z >= target.z - 3 : p.position.z <= target.z + 3
      if (ahead) runners.push(p.id)
      continue
    }
    if (p.role === 'mid') {
      const dist = distance2D(p.position, { x: target.x, y: 0, z: target.z })
      if (dist > 2.5 && dist < 16) runners.push(p.id)
    }
  }

  return runners
    .sort((a, b) => {
      const pa = playerRegistry.get(a)!
      const pb = playerRegistry.get(b)!
      return distance2D(pa.position, { x: target.x, y: 0, z: target.z }) -
        distance2D(pb.position, { x: target.x, y: 0, z: target.z })
    })
    .slice(0, 3)
}

export function resolveLooseBallChaser(
  team: TeamId,
  _ball: Vec3,
): string | null {
  if (markerCacheFrame >= 0) {
    return looseBallChaserByTeam[team]
  }
  return computeLooseBallChaser(team, _ball)
}

function computeLooseBallChaser(team: TeamId, ball: Vec3): string | null {
  const store = useGameStore.getState()
  if (store.ballPossession || store.ballFrozen) return null
  // Durante passe: receptor/lock em shouldChaseOwnPassBall — não disputa “solta”
  if (store.passIntent) {
    const passerTeam = store.passIntent.passingTeam ?? store.lastTouchTeam
    if (passerTeam === team) return null
    const contest = getContestPoint(null, ball)
    return findClosestMarkerCandidate(team, contest, null).id
  }
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

  return pickStickyLooseChaser(team, ball, looseBallChaserByTeam[team])
}

/** Ranking + histerese — evita trocar de perseguidor a cada frame. */
function pickStickyLooseChaser(
  team: TeamId,
  ball: Vec3,
  prevId: string | null,
): string | null {
  const store = useGameStore.getState()
  const preferred = getPreferredLooseBallChaser()
  if (preferred) {
    const pref = playerRegistry.get(preferred)
    if (pref && pref.team === team && pref.role !== 'gk') {
      if (!store.sentOffPlayers.includes(preferred)) {
        return preferred
      }
    }
  }

  const ranked: { id: string; d: number }[] = []
  for (const p of playerRegistry.values()) {
    if (p.team !== team || p.role === 'gk') continue
    if (store.sentOffPlayers.includes(p.id)) continue
    let d = distance2D(p.position, ball)
    if (hasBodyDuelClaimPriority(p.id)) d *= 0.55
    ranked.push({ id: p.id, d })
  }
  ranked.sort((a, b) => a.d - b.d)
  const best = ranked[0]
  if (!best) return null

  if (prevId) {
    const prev = ranked.find((r) => r.id === prevId)
    // Margem larga — troca só se o outro estiver bem mais perto
    if (prev && prev.d < 12) {
      if (best.id !== prevId && best.d + MARKER_SWITCH_MARGIN * 2.2 < prev.d) {
        return best.id
      }
      return prevId
    }
  }
  return best.id
}

/**
 * 2º homem na bola solta — sticky: entra perto, só larga longe.
 */
export function shouldAssistLooseBallChase(
  playerId: string,
  team: TeamId,
  ball: Vec3,
): boolean {
  const store = useGameStore.getState()
  if (store.ballPossession || store.ballFrozen) return false
  if (store.phase !== 'playing') return false
  if (store.passIntent) return false
  const player = playerRegistry.get(playerId)
  if (!player || player.role === 'gk' || player.team !== team) return false

  const primary = resolveLooseBallChaser(team, ball)
  if (primary === playerId) return false

  const dist = distance2D(player.position, ball)
  const sticky = looseBallAssistByTeam[team]

  if (sticky === playerId) {
    if (dist < 7.4) return true
    looseBallAssistByTeam[team] = null
    return false
  }

  if (sticky && sticky !== playerId) {
    const stickyP = playerRegistry.get(sticky)
    if (stickyP && distance2D(stickyP.position, ball) < 7.4) return false
  }

  if (dist > 4.6) return false

  const ranked: { id: string; d: number }[] = []
  for (const p of playerRegistry.values()) {
    if (p.team !== team || p.role === 'gk') continue
    if (store.sentOffPlayers.includes(p.id)) continue
    ranked.push({ id: p.id, d: distance2D(p.position, ball) })
  }
  ranked.sort((a, b) => a.d - b.d)
  if (ranked[1]?.id === playerId && ranked[1].d < 4.6) {
    looseBallAssistByTeam[team] = playerId
    return true
  }
  return false
}

/** Este jogador deve perseguir a bola solta automaticamente (sem stick). */
export function shouldAutoChaseLooseBall(playerId: string, team: TeamId): boolean {
  const store = useGameStore.getState()
  if (store.ballPossession || store.ballFrozen) return false
  if (store.phase !== 'playing') return false
  const ball = ballRef.current
  if (store.passIntent) {
    return shouldChaseOwnPassBall(playerId, team, store.passIntent, ball)
  }
  return (
    resolveLooseBallChaser(team, ball) === playerId ||
    shouldAssistLooseBallChase(playerId, team, ball)
  )
}

/**
 * Passe do próprio time: decisão TRAVADA no início do passe.
 * Ranking pelo alvo fixo — não recalcula com a bola voando (fim do ir/voltar).
 */
export function shouldChaseOwnPassBall(
  playerId: string,
  team: TeamId,
  passIntent: PassIntent | null,
  ball: Vec3,
): boolean {
  if (!passIntent) {
    ownPassChaseLockByTeam[team] = null
    return false
  }
  const passerTeam = passIntent.passingTeam ?? useGameStore.getState().lastTouchTeam
  if (passerTeam !== team) return false

  const lock = ownPassChaseLockByTeam[team]
  if (lock && lock.key === passIntent.startedAt) {
    return lock.ids.has(playerId)
  }

  const store = useGameStore.getState()
  const ids = new Set<string>()
  if (passIntent.receiverId) ids.add(passIntent.receiverId)

  // Passe pro jogador (pedido de bola / Be a Pro): só o receptor disputa.
  // Outras IAs iam na bola, não dominavam e desviavam — bugava o domínio.
  if (passIntent.soloReceive) {
    ownPassChaseLockByTeam[team] = { key: passIntent.startedAt, ids }
    return ids.has(playerId)
  }

  // Passe rasteiro: SÓ o receptor (e runners de through/cross) — sem enxame
  if (passIntent.passType === 'pass' || !passIntent.passType) {
    ownPassChaseLockByTeam[team] = { key: passIntent.startedAt, ids }
    return ids.has(playerId)
  }

  for (const r of passIntent.runnerIds ?? []) ids.add(r)

  // Âncora FIXA no alvo do passe — não na bola ao vivo
  const anchor = { x: passIntent.targetX, y: 0, z: passIntent.targetZ }
  const ranked: { id: string; d: number }[] = []
  for (const p of playerRegistry.values()) {
    if (p.team !== team || p.role === 'gk') continue
    if (store.sentOffPlayers.includes(p.id)) continue
    const dTgt = distance2D(p.position, anchor)
    const dBall = distance2D(p.position, ball)
    if (dTgt > OWN_PASS_TARGET_CONTEST_DIST && dBall > OWN_PASS_CONTEST_DIST) {
      continue
    }
    ranked.push({ id: p.id, d: dTgt })
  }
  ranked.sort((a, b) => a.d - b.d)
  // Through/cross: no máx. 1 apoio além do receptor
  for (const r of ranked.slice(0, 2)) {
    if (r.id !== passIntent.receiverId) ids.add(r.id)
    if (ids.size >= 2) break
  }

  ownPassChaseLockByTeam[team] = { key: passIntent.startedAt, ids }
  return ids.has(playerId)
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
  // Raio menor — micro-ajusta em vez de congelar no posto
  if (isMarker) return 0.22
  if (!defending) {
    if (role === 'def') return 0.48
    if (role === 'mid') return 0.42
    if (role === 'fwd') return 0.38
    return 0.42
  }
  if (role === 'def') return 0.55
  if (role === 'mid') return 0.48
  if (role === 'fwd') return 0.42
  return 0.48
}

function playerFloatSeed(playerId: string): number {
  let h = 0
  for (let i = 0; i < playerId.length; i++) h = ((h << 5) - h + playerId.charCodeAt(i)) | 0
  return (Math.abs(h) % 997) / 997
}

/** Empurra alvo longe de companheiros próximos — evita encavalamento */
function spreadAwayFromTeammates(
  playerId: string,
  team: TeamId,
  bounds: FieldBounds,
  target: { x: number; z: number },
  radius: number,
): { x: number; z: number } {
  let x = target.x
  let z = target.z
  for (const other of playerRegistry.values()) {
    if (other.id === playerId || other.team !== team || other.role === 'gk') continue
    const dx = x - other.position.x
    const dz = z - other.position.z
    const d = Math.hypot(dx, dz)
    if (d >= radius || d < 1e-4) continue
    const push = (radius - d) / radius
    x += (dx / d) * push * 1.35
    z += (dz / d) * push * 1.1
  }
  // Também evita dois alvos no mesmo ponto (pelo id seed)
  const h = playerFloatSeed(playerId)
  x += (h - 0.5) * 0.85
  z += (playerFloatSeed(playerId + 'z') - 0.5) * 0.55
  return {
    x: clamp(x, bounds.minX + 0.8, bounds.maxX - 0.8),
    z: clamp(z, bounds.minZ + 0.8, bounds.maxZ - 0.8),
  }
}

export function applyPlayerSlotBias(
  playerId: string,
  slot: FormationSlot,
  bounds: FieldBounds,
  team: TeamId,
  target: { x: number; z: number },
): { x: number; z: number } {
  const h = playerFloatSeed(playerId)
  const halfW = (bounds.maxX - bounds.minX) / 2
  const instr = getPlayerInstructions(playerId)
  const freedom =
    instr.positioningFreedom === 'free' ? 1.45 : instr.positioningFreedom === 'stick' ? 0.55 : 1
  const roleSpread = (slot.role === 'def' ? 0.75 : slot.role === 'mid' ? 1.05 : 1.25) * freedom
  let lateral = (h - 0.5) * halfW * 0.12 * roleSpread
  if (instr.attackingRuns === 'stay_central') lateral *= 0.35
  const depth = (playerFloatSeed(playerId + ':d') - 0.5) * 1.1 * roleSpread
  const biased = {
    x: clamp(target.x + lateral, bounds.minX + 0.8, bounds.maxX - 0.8),
    z: target.z + depth,
  }
  return spreadAwayFromTeammates(playerId, team, bounds, biased, 1.95)
}

/** @deprecated Flutuação perto do slot → órbita; não usar na formação. */
export function applyTacticalFloat(
  playerId: string,
  target: { x: number; z: number },
  _dist: number,
  _maxFloat = 0.55,
): { x: number; z: number } {
  void playerId
  return target
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
