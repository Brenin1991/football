import { RigidBody, type RapierRigidBody } from '@react-three/rapier'
import { useFrame } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef, type MutableRefObject } from 'react'
import * as THREE from 'three'
import { SkeletonUtils } from 'three-stdlib'
import {
  GK_SPEED,
  GK_MAX_STEP_FROM_LINE,
  GK_RUSH_SPEED,
  GK_FEET_CLAIM_MAX_HEIGHT,
  PLAYER_RADIUS,
  PLAYER_SPEED,
  PLAYER_SPRINT_SPEED,
  PLAYER_TURN_SPEED_AI,
  PLAYER_TURN_SPEED_CONTROLLED,
  PLAYER_TURN_SPEED_BALL_FOCUS,
  BALL_ATTENTION_DIST,
  PASS_CANDIDATE_ATTENTION_DIST,
  PASS_CANDIDATE_BACKPEDAL_SPEED,
  PASS_CANDIDATE_SIDE_SPEED,
  GK_TURN_SPEED,
  WORLD_SCALE,
  PASS_SPEED_MAX,
  BALL_MAX_SPEED,
} from '../constants'
import { passSpeedForDistance, releaseBallFromFeet } from './TeamController'
import { computeStrikeDirection } from '../systems/strikeAim'
import { useGLTF } from '@react-three/drei'
import { useGameStore, getUserTeam, isProFreeControl, shouldSoloReceivePass } from '../store/gameStore'
import { applyPlayerMaterials } from '../graphics/graphicsMaterials'
import { getTeamDbId, getPlayerAppearance, getTeamMatchKit, getEditionPlayerId } from '../matchRuntime'
import { getCustomPlayerGlbUrl, getPlayerGlbUrl } from '../systems/customPlayerGlb'
import { attachTeamShirtTexture, detachTeamShirtTexture } from '../psx/shirtTextureApply'
import { parsePlayerIndex } from '../data/playerRoster'
import type { FormationSlot, PlayerAnim, PlayerRole, TeamId, Vec3 } from '../types'
import { getLiveBallState } from '../systems/ballPhysics'
import { getCrossAttackerId, hasBufferedStrikeIntent, isAnticipatingShotCharge, isAutoFirstTimeStriker, isPlayerInShotChargeMode, shouldAutoRunForAnticipatedShot, shouldAutoRunForFirstTime, shouldBlockManualUserControl } from '../systems/anticipation'

/** Não roubar em pé quando o jogador está antecipando passe/chute (first-time). */
function shouldSkipPassStealForAnticipation(
  store: ReturnType<typeof useGameStore.getState>,
  playerId: string,
  isActive: boolean,
) {
  if (!isActive) return false
  if (hasBufferedStrikeIntent(store, playerId)) return true

  const userTeam = getUserTeam()
  const poss = store.ballPossession
  if (poss?.team === userTeam && poss.playerId === playerId) return false
  if (poss && poss.team !== userTeam) return false

  // Quem acabou de passar precisa de A/sprint pra jogo de corpo no marcador
  // (não tratar bola no ar como "só first-time" pra ele).
  if (
    store.passBlockPlayerId === playerId &&
    performance.now() < (store.passBlockUntil ?? 0)
  ) {
    return false
  }

  const incoming =
    store.passIntent?.receiverId === playerId ||
    (store.passIntent?.passType === 'cross' &&
      getCrossAttackerId(store) === playerId)
  // Só bloqueia roubo/ombro pro receptor (A = first-time).
  // Bola solta em geral NÃO bloqueia — senão o passador não consegue ombro.
  return !!incoming
}

import {
  ballRef,
  playerRegistry,
  setBallPosition,
  unregisterPlayer,
  type PlayerRef,
} from '../systems/entityRegistry'
import { findAssistedPassTarget, findNearestTeammate, findPassTargetInFacingDirection, getBallAtFeet, getDribbleStealProtect, getHeldBallPoint, getPassInterceptTarget } from '../systems/possession'
import {
  applyPlayerFacing,
  facingFromMovement,
  getBallFocusFacing,
  plantVelocityForYawError,
  worldToLocalMovement,
  shouldMirrorRightFootedStrike,
  PLAYER_DIR_SMOOTH_AI,
  PLAYER_DIR_SMOOTH_AI_DIRECT,
  PLAYER_DIR_SMOOTH_AI_PRESS,
  PLAYER_DIR_SMOOTH_CONTROLLED,
  PLAYER_DIR_SMOOTH_DRIBBLE,
  PLAYER_DIR_SMOOTH_DRIBBLE_AI,
  PLAYER_MOVE_ACCEL,
  PLAYER_MOVE_ACCEL_AI,
  PLAYER_MOVE_ACCEL_DRIBBLE,
  PLAYER_MOVE_DECEL,
  PLAYER_MOVE_DECEL_AI,
  PLAYER_MOVE_DECEL_DRIBBLE,
  smoothDirection2D,
  smoothVelocity2D,
} from '../systems/playerLocomotion'
import { distance2D, normalize2D, rotateTowardAngle, shortestAngleDelta } from '../systems/rules'
import { getAICrossParams } from '../systems/aiCross'
import { tickAICrossVolleyAnticipation } from '../systems/aiCrossVolley'
import {
  decideCarrierAction,
  evaluateBallCallDelivery,
  findBestPassTarget,
  getAIPassParams,
  getBallCallPrepMoveDir,
  getCarrierContext,
  getCarrierMoveIntent,
  getNearestOpponent,
  getPassLaneBlockTarget,
  getPassLeadPosition,
  getAiDribbleStickPhase,
  isCarrierSurrounded,
  isPassLaneClearEnough,
  steerAiMoveDir,
} from '../systems/aiBrain'
import { cameraState } from '../systems/cameraState'
import { getKickoffPlayerId, getKickoffFacingRotation, getKickoffKickerStand, findKickoffPassTarget, isKickoffInputLocked, startKickoff } from '../systems/kickoff'
import {
  applyPlayerSlotBias,
  buildPassRunnerIds,
  getBlendedTarget,
  getCarrierTarget,
  getCoverPressTarget,
  getDefensiveShapePosition,
  getDynamicPosition,
  getLooseBallAttackPosition,
  getManMarkOpponentId,
  getManMarkTarget,
  getMarkingPoint,
  getMarkerPursuitIntensity,
  getPassFlightSupportPosition,
  getRoleArriveDist,
  resolveLooseBallChaser,
  shouldAssistLooseBallChase,
  shouldAutoChaseLooseBall,
  shouldChaseOwnPassBall,
  getSupportPosition,
  getTeamPhase,
  isOwnPassInFlight,
  isOpponentPassInFlight,
  isCoverPresser,
  isPassLaneBlocker,
  isPassInterceptor,
  isForwardMakingRun,
  isTeamMarker,
  predictBallPosition,
  smoothToward,
} from '../systems/dynamicFormation'
import { getPlayerBodyY, getBallSpawnPosition } from '../systems/fieldData'
import { getAttackSign, getAttackingGoalZ as getGoalZ, getFieldFacingRotation, getFormationSpawn } from '../systems/teamField'
import {
  executeThrowInLaunch,
  getCornerSetupTarget,
  getGoalKickPushTarget,
  getKickerStandPosition,
  getSetPiecePlayerSpot,
  getThrowInSetupTarget,
  isActiveSetPiecePhase,
} from '../systems/setPiece'
import {
  crossLoftFromPower,
  crossSpeedFromPower,
  passLoftFromPower,
  passSpeedFromPower,
  quickPassPowerForDistance,
  QUICK_PASS_POWER,
  shotLoftFromPower,
  shotSpeedFromPower,
  getAIShotPower,
  throughSpeedFromPower,
} from '../systems/shotPower'
import {
  findThroughPassTarget,
  getThroughPassLead,
  throughPassFallbackDir,
  throughPassSpeedForDistance,
} from '../systems/throughPass'
import {
  crossLoftForDistance,
  crossSpeedForDistance,
  findCrossTargetAlongAim,
  getCrossReceiveLead,
} from '../systems/cross'
import {
  getReceiveInterceptorId,
  hasCrossVolleyIntent,
  isCrossReceiveControlActive,
  isCrossTrapActive,
  isCrossVolleyArmed,
  tryCrossBallContact,
  tryMaintainCrossTrap,
} from '../systems/crossAssist'
import {
  canEmergencySlideNearGoal,
  canSlideInPhysicalDuel,
  canSlideOnHolder,
  canSlideOnPassIntercept,
  canStartSlide,
  cleanupPhysicalStates,
  clearPlayerPhysicalState,
  getAISlideChanceNearGoal,
  getAISlideChanceOnDuel,
  getAISlideChanceOnHolder,
  getAISlideChanceOnIntercept,
  getDefenderGoalThreat,
  getSlideDirection,
  isPlayerKnockedDown,
  isPlayerSliding,
  processSlideContacts,
  startSlide,
} from '../systems/tackle'
import {
  scaleMarkBlend,
  scaleSlideChance,
  scaleSlideInterval,
  scaleStandingStealChance,
  scaleStandingStealInterval,
  shouldOpponentStandingSteal,
} from '../systems/difficulty'
import { SLIDE_AI_GOAL_BOX_MAX_DIST, SLIDE_AI_GOAL_DANGER_MAX_DIST, SLIDE_AI_GOAL_BOX_INTERVAL_MUL, SLIDE_DURATION_MS, SLIDE_AI_MAX_DIST, SLIDE_AI_MIN_DIST, SLIDE_AI_MIN_INTERVAL_MS, STANDING_STEAL_AI_CHANCE, STANDING_STEAL_AI_INTERVAL_MS, STANDING_STEAL_AI_MAX_DIST, STRIKE_WARP_TURN_SPEED, BODY_CHARGE_AI_INTERVAL_MS, BODY_CHARGE_AI_VS_PLAYER_INTERVAL_MS } from '../constants'
import { alignPlayerModelToCapsule } from '../systems/animationClips'
import { PlayerAnimController } from '../systems/playerAnimController'
import { normalizePlayerAnim, pickPassStrikeAnim, pickShotStrikeAnim } from '../systems/playerClipRegistry'
import { GoalkeeperAnimController } from '../systems/goalkeeperAnimController'
import { registerGkHands, unregisterGkHands, updateGkHandPositions, getGkHipsWorldXZ, snapshotGkSkeletonToBody, pinGkHips } from '../systems/goalkeeperHands'
import { usePlayerMixer } from '../systems/usePlayerMixer'
import { createReplayAnimDriver, type ReplayAnimDriver } from '../systems/replayAnimDriver'
import { canPlayerPlay, getOffsideFlagAtPass, getSentOffSpot } from '../systems/referee'
import { getSimDelta } from '../systems/gameTime'
import {
  clampGkFacing,
  clampGkPosition,
  computeGkCoverPosition,
  finishGkDistribution,
  getGkHoldClearTarget,
  getGkPositionTarget,
  getGkRuntime,
  isGkBallProtected,
  isGkBodyLocked,
  notifyGkSaveFinished,
  shouldGkBlendToHold,
  tryGoalkeeperRelease,
} from '../systems/goalkeeper'
import { entranceSystem } from '../systems/teamEntrance'
import { isFieldParadePhase } from '../systems/matchPhases'
import { replaySystem } from '../systems/replaySystem'
import type { ControlState } from '../hooks/useKeyboardControls'
import { clearBallShield, setBallShield } from '../systems/ballShield'
import {
  refreshShoulderChargePress,
  tryStandingStealOrBodyCharge,
  tryOffBallBodyCharge,
  tryAiBodyChargeOnHolder,
  findOffBallBodyChargeTarget,
  consumeBodyChargeKnock,
  clearBodyChargeCooldown,
  trySkillMoveBeatPressers,
} from '../systems/standingSteal'
import { consumeContactAnim, clearContactAnim } from '../systems/playerContactAnims'
import {
  getDuelOpponentId,
  getPhysicalDuelDecelMul,
  getPhysicalDuelDurationMs,
  getPhysicalDuelSpeedMul,
  isInPhysicalDuel,
  releaseBallFromBodyImbalance,
} from '../systems/playerPhysicalDuel'
import {
  registerBodyContactDuel,
  resolvePlayerBodyCollisions,
} from '../systems/playerBodyCollision'
import {
  canAiAttemptStandingSteal,
  canPlayerSprint,
  getPlayerStamina,
  getStaminaSpeedMul,
  getStaminaStealChanceMul,
  getStaminaStealIntervalMul,
  isSprintWinded,
  tickPlayerStamina,
} from '../systems/playerStamina'
import {
  applyAttrAimNoise,
  getPlayerAttrMultipliers,
} from '../systems/playerAttributes'
import {
  clearPlayerDribbleControl,
  updatePlayerDribbleControl,
  type DribbleControlOutput,
} from '../systems/playerDribbleControl'
import {
  clearPlayerSkillMoves,
  updatePlayerSkillSpin,
} from '../systems/playerSkillMoves'
import { clearDribbleFeintRoll, pushDribbleBallRoll, syncDribblePossession } from '../systems/ballDribble'
import { GkHandColliders } from './GkHandColliders'
import { PlayerBoneColliders } from './PlayerBoneColliders'
import { needsPlayerBoneSync } from '../systems/playerFootPhysics'
import {
  registerPlayerBones,
  unregisterPlayerBones,
  updatePlayerBonePositions,
  snapshotPlayerSkeletonToBody,
  pinPlayerHips,
} from '../systems/playerSkeleton'


const AI_THINK_MIN_S = 0.38
const AI_THINK_MAX_S = 0.88
const AI_DRIBBLE_THINK_MIN_S = 0.32
const AI_DRIBBLE_THINK_MAX_S = 0.68
/** Alinhamento mínimo corpo→chute antes da IA disparar */
const AI_SHOOT_FACE_DOT = 0.48
/** Alinhamento mínimo corpo→passe antes da IA soltar a bola */
const AI_PASS_FACE_DOT = 0.62

const RUN_START_THRESHOLD = 0.012
const RUN_STOP_THRESHOLD = 0.006

type PlayerProps = {
  id: string
  team: TeamId
  role: PlayerRole
  spawn: Vec3
  formation: FormationSlot
  controls?: MutableRefObject<ControlState>
  consumeAction?: (action: 'pass' | 'kick' | 'slide' | 'cross' | 'throughPass' | 'switchPlayer') => boolean
  consumePassPress?: () => boolean
}

function setOpenSpacePassIntent(
  me: PlayerRef,
  team: TeamId,
  dx: number,
  dz: number,
  passDist: number,
  passType: 'pass' | 'through' | 'cross',
) {
  const store = useGameStore.getState()
  const teammates = [...playerRegistry.values()].filter(
    (p) => p.team === team && p.id !== me.id && p.role !== 'gk',
  )
  const landX = me.position.x + dx * passDist
  const landZ = me.position.z + dz * passDist
  // Cruzamento livre: quem está perto do ponto de queda, não o mais próximo do passador
  const receiver =
    passType === 'cross'
      ? teammates.reduce<PlayerRef | null>((best, p) => {
          const d = distance2D(p.position, { x: landX, y: 0, z: landZ })
          if (d > 14) return best
          if (!best) return p
          return distance2D(best.position, { x: landX, y: 0, z: landZ }) <= d ? best : p
        }, null)
      : findNearestTeammate(me, teammates)
  if (!receiver) {
    store.setPassIntent(null)
    return
  }

  store.setPassIntent({
    receiverId: receiver.id,
    targetX: landX,
    targetZ: landZ,
    startedAt: performance.now(),
    passingTeam: team,
    passType,
    ballZAtPass: ballRef.current?.z ?? me.position.z,
    runnerIds: buildPassRunnerIds(me.id, team, receiver.id, {
      x: landX,
      z: landZ,
    }, passType),
    soloReceive: shouldSoloReceivePass(receiver.id) || undefined,
  })
}

export function Player({
  id,
  team,
  role,
  spawn,
  formation,
  controls,
  consumeAction,
  consumePassPress,
}: PlayerProps) {
  const slotIndex = parsePlayerIndex(id)
  const editionPlayerId = getEditionPlayerId(team, slotIndex)
  const glbUrl = getPlayerGlbUrl(editionPlayerId)
  const preserveSkin = getCustomPlayerGlbUrl(editionPlayerId) != null
  const { scene, animations } = useGLTF(glbUrl)
  const modelRootRef = useRef<THREE.Group>(null)
  const bodyRef = useRef<RapierRigidBody>(null)

  const cloned = useMemo(() => {
    const model = SkeletonUtils.clone(scene) as THREE.Group
    applyPlayerMaterials(
      model,
      getPlayerAppearance(team, slotIndex, role),
      false,
      { preserveSkin },
    )
    alignPlayerModelToCapsule(model)
    return model
  }, [scene, animations, team, role, slotIndex, glbUrl, preserveSkin, editionPlayerId])

  useLayoutEffect(() => {
    if (role === 'gk') {
      detachTeamShirtTexture(cloned)
      return
    }
    const teamDbId = getTeamDbId(team)
    const kitNumber = getTeamMatchKit(team)
    let cancelled = false

    void attachTeamShirtTexture(cloned, teamDbId, kitNumber).then(() => {
      if (cancelled) return
    })

    return () => {
      cancelled = true
      detachTeamShirtTexture(cloned)
    }
  }, [cloned, team, role])

  const { actions, mixer, animToClip } = usePlayerMixer(animations, modelRootRef, cloned)
  const animCtrl = useRef<PlayerAnimController | null>(null)
  const gkAnimCtrl = useRef<GoalkeeperAnimController | null>(null)
  const replayAnimDriver = useRef<ReplayAnimDriver | null>(null)
  const wasInReplay = useRef(false)
  const lastGkSaveAnim = useRef<string | null>(null)
  const lastGkFootSave = useRef(false)
  const gkDistribTriggered = useRef(false)

  const velocity = useRef(new THREE.Vector3())
  const rotation = useRef(0)
  const position = useRef(new THREE.Vector3(spawn.x, 0, spawn.z))
  const tacticalTarget = useRef({ x: spawn.x, z: spawn.z })
  const gkTarget = useRef({ x: spawn.x, z: spawn.z })
  const ballAnchor = useRef({ x: spawn.x, z: spawn.z })
  const locoMoving = useRef(false)
  const inputDir = useRef({ x: 0, z: 1 })
  const moveVel = useRef({ x: 0, z: 0 })
  /** Direção de corrida congelada no wind-up do chute — corre reto */
  const shotRunLockRef = useRef<{ x: number; z: number; sprint: boolean } | null>(null)
  const aiDirectMove = useRef(false)
  /** Sticky: chegou no posto da formação — fica parado até o alvo afastar de verdade */
  const formationHold = useRef(false)
  const aiThinkTimer = useRef(0)
  const aiSlideTimer = useRef(0)
  const aiStealTimer = useRef(0)
  const aiBodyChargeTimer = useRef(0)
  const knockdownActive = useRef(false)
  const snapshotSkeletonRef = useRef<(() => void) | null>(null)
  const gkSnapshotSkeletonRef = useRef<(() => void) | null>(null)
  const lastReplayAnim = useRef<PlayerAnim | null>(null)
  const lastPossessionSince = useRef(0)
  const dribbleBallOffset = useRef({ x: 0, z: 0 })
  const dribbleTouchSeverity = useRef(0)
  /** Direção em que o 360 arrasta a bola (fixo no início do spin). */
  const spinBallDir = useRef({ x: 0, z: 1 })
  /** Tempo decorrido / duração do 360 — arraste durante a animação. */
  const spinElapsed = useRef(0)
  const spinDuration = useRef(0.55)
  const bodyLean = useRef(0)
  const bodyPitch = useRef(0)
  const dribbleCtrl = useRef<DribbleControlOutput | null>(null)
  const wasStopFeint = useRef(false)
  const wasRunCut = useRef(false)
  const aiStickPhasePrev = useRef<'drive' | 'arc' | 'cut' | null>(null)
  const wasRunLoco = useRef(false)
  /** Yaw alvo durante animação de passe/chute — warp de corpo estilo FIFA */
  const strikeWarpYaw = useRef<number | null>(null)
  /** Chute pendente: IA vira o corpo antes de disparar */
  const aiPendingShot = useRef<{ x: number; z: number } | null>(null)
  /** Passe pendente: conduz, olha pro companheiro, depois solta */
  const aiPendingPass = useRef<{
    targetId: string
    style: { power: number; quickPass: boolean; through: boolean; cross?: boolean }
    carryUntil: number
    releaseAfter: number
  } | null>(null)
  /** Direção de olhar durante preparação de passe */
  const aiPassLook = useRef<{ x: number; z: number } | null>(null)
  /** Atacante segurando a bola sob marcação — olha para trás */
  const aiHoldUpLook = useRef<{ x: number; z: number } | null>(null)
  const receiveIntentKey = useRef(0)
  const receiveRunState = useRef({
    hardStop: false,
    approachDist: 99,
    directVel: false,
    targetSpeed: 0,
    dirX: 0,
    dirZ: 0,
  })
  const registryEntry = useRef<PlayerRef | null>(null)

  const phase = useGameStore((s) => s.phase)
  const ballFrozen = useGameStore((s) => s.ballFrozen)
  const hasBall = useGameStore((s) => s.ballPossession?.playerId === id)
  const fieldBounds = useGameStore((s) => s.fieldBounds)
  const setPieceKickerId = useGameStore((s) => s.setPieceKickerId)
  const setPieceShootAnim = useGameStore((s) => s.setPieceShootAnim)
  const setPieceThrowAnim = useGameStore((s) => s.setPieceThrowAnim)
  const kickoffStrikeAnim = useGameStore((s) => s.kickoffStrikeAnim)
  const setPiecePosition = useGameStore((s) => s.setPiecePosition)
  const setPieceAimAngle = useGameStore((s) => s.setPieceAimAngle)
  const kickoffTeam = useGameStore((s) => s.kickoffTeam)
  const kickoffResetVersion = useGameStore((s) => s.kickoffResetVersion)
  const half = useGameStore((s) => s.half)

  const isGoalkeeper = role === 'gk'

  useEffect(() => {
    const active =
      !isGoalkeeper &&
      team === getUserTeam() &&
      useGameStore.getState().activePlayerId === id
    if (hasBall && !active) {
      aiThinkTimer.current =
        AI_THINK_MIN_S * (0.55 + Math.random() * 0.65)
    }
    if (!hasBall) {
      clearPlayerDribbleControl(id)
      clearPlayerSkillMoves(id)
    }
  }, [hasBall, id, team, isGoalkeeper])

  useEffect(() => {
    if (!fieldBounds || kickoffResetVersion === 0) return
    const spot = getFormationSpawn(team, formation, fieldBounds)
    position.current.set(spot.x, 0, spot.z)
    tacticalTarget.current = { x: spot.x, z: spot.z }
    gkTarget.current = { x: spot.x, z: spot.z }
    ballAnchor.current = { x: spot.x, z: spot.z }
    rotation.current = getFieldFacingRotation(team, fieldBounds)
    moveVel.current.x = 0
    moveVel.current.z = 0
    inputDir.current.x = 0
    inputDir.current.z = 1
    bodyRef.current?.setTranslation(
      { x: spot.x, y: getPlayerBodyY(), z: spot.z },
      true,
    )
  }, [kickoffResetVersion, half, formation, team, fieldBounds, id])

  useEffect(() => {
    return () => {
      replayAnimDriver.current?.dispose()
      replayAnimDriver.current = null
    }
  }, [id])

  useEffect(() => {
    return () => {
      clearPlayerPhysicalState(id)
      clearContactAnim(id)
      // NÃO limpa stamina — remount no intervalo (key -h2) não pode zerar fadiga
      clearBodyChargeCooldown(id)
      unregisterPlayer(id)
    }
  }, [id])

  useLayoutEffect(() => {
    if (role === 'gk') {
      if (!mixer || !modelRootRef.current || !actions.gk_idle) return
      const ctrl = new GoalkeeperAnimController(actions, mixer)
      ctrl.init()
      mixer.update(0)
      gkAnimCtrl.current = ctrl
      registerGkHands(id, cloned)
      return () => {
        ctrl.dispose()
        gkAnimCtrl.current = null
        lastGkSaveAnim.current = null
        gkDistribTriggered.current = false
        unregisterGkHands(id)
      }
    }
    if (!mixer || !modelRootRef.current || !actions.player_idle) return
    const ctrl = new PlayerAnimController(actions, mixer)
    ctrl.init()
    ctrl.bindModelRoot(modelRootRef.current ?? cloned)
    ctrl.bindHoldBallIdle(actions.gk_idle_ball)
    mixer.update(0)
    animCtrl.current = ctrl
    registerPlayerBones(id, cloned)
    registerGkHands(id, cloned)
    return () => {
      ctrl.dispose()
      animCtrl.current = null
      unregisterPlayerBones(id)
      unregisterGkHands(id)
    }
  }, [actions, mixer, cloned, role, id])

  const resetLiveAnimAfterReplay = () => {
    replayAnimDriver.current?.dispose()
    replayAnimDriver.current = null
    mixer?.stopAllAction()

    if (isGoalkeeper) {
      gkAnimCtrl.current?.dispose()
      if (mixer && actions.gk_idle) {
        const boot = new GoalkeeperAnimController(actions, mixer)
        boot.init()
        mixer.update(0)
        gkAnimCtrl.current = boot
      }
    } else {
      animCtrl.current?.dispose()
      if (mixer && actions.player_idle) {
        const boot = new PlayerAnimController(actions, mixer)
        boot.init()
        boot.bindModelRoot(modelRootRef.current ?? cloned)
        boot.bindHoldBallIdle(actions.gk_idle_ball)
        mixer.update(0)
        animCtrl.current = boot
      }
    }

    lastReplayAnim.current = null
    lastGkSaveAnim.current = null
    lastGkFootSave.current = false
  }

  useEffect(() => {
    const inReplay = phase === 'replay'

    if (wasInReplay.current && !inReplay) {
      resetLiveAnimAfterReplay()
    }

    if (inReplay && !wasInReplay.current) {
      replayAnimDriver.current?.dispose()
      replayAnimDriver.current = null
      mixer?.stopAllAction()
      if (modelRootRef.current) {
        replayAnimDriver.current = createReplayAnimDriver(
          modelRootRef.current,
          animToClip,
        )
      }
    }

    wasInReplay.current = inReplay
  }, [phase, mixer, animToClip, isGoalkeeper, actions])

  useEffect(() => () => clearBallShield(id), [id])

  useEffect(() => {
    if (phase !== 'kickoff' || !fieldBounds) return
    if (id !== getKickoffPlayerId(kickoffTeam)) return
    const c = useGameStore.getState().setPiecePosition ?? getBallSpawnPosition(fieldBounds)
    const stand = getKickoffKickerStand(kickoffTeam, fieldBounds, c, id)
    position.current.set(stand.x, 0, stand.z)
    tacticalTarget.current = { x: stand.x, z: stand.z }
    rotation.current = stand.rotation
    bodyRef.current?.setTranslation({ x: stand.x, y: getPlayerBodyY(), z: stand.z }, true)
    if (modelRootRef.current) {
      modelRootRef.current.rotation.y = rotation.current
    }
  }, [phase, id, kickoffTeam, fieldBounds, kickoffResetVersion, half])

  useEffect(() => {
    if (phase !== 'goal-kick' || !setPiecePosition || !fieldBounds) return
    const kickingTeam = useGameStore.getState().setPieceTeam
    if (!kickingTeam) return
    const aim = useGameStore.getState().setPieceAimAngle

    const spot =
      id === setPieceKickerId
        ? getKickerStandPosition('goal-kick', setPiecePosition, fieldBounds, aim)
        : getGoalKickPushTarget(team, formation, fieldBounds, kickingTeam)

    position.current.set(spot.x, 0, spot.z)
    tacticalTarget.current = spot
    bodyRef.current?.setTranslation({ x: spot.x, y: getPlayerBodyY(), z: spot.z }, true)
  }, [phase, setPiecePosition, setPieceKickerId, setPieceAimAngle, id, team, formation, fieldBounds])

  useEffect(() => {
    if ((phase !== 'throw-in' && phase !== 'corner') || !setPiecePosition || !fieldBounds) return

    const kickingTeam = useGameStore.getState().setPieceTeam
    if (!kickingTeam) return
    const aim = useGameStore.getState().setPieceAimAngle

    const spot =
      id === setPieceKickerId
        ? getKickerStandPosition(phase, setPiecePosition, fieldBounds, aim)
        : phase === 'throw-in'
          ? getThrowInSetupTarget(
              team,
              formation,
              fieldBounds,
              kickingTeam,
              setPiecePosition,
              id,
              setPieceKickerId,
              aim,
            )
          : getCornerSetupTarget(
              team,
              formation,
              fieldBounds,
              kickingTeam,
              setPiecePosition,
              id,
              setPieceKickerId,
              aim,
            )

    position.current.set(spot.x, 0, spot.z)
    tacticalTarget.current = spot
    bodyRef.current?.setTranslation({ x: spot.x, y: getPlayerBodyY(), z: spot.z }, true)
  }, [phase, setPiecePosition, setPieceKickerId, setPieceAimAngle, id, team, formation, fieldBounds])

  const syncRegistry = (
    pos: { x: number; z: number },
    opts?: {
      velocity?: Vec3
      rotation?: number
      isControlled?: boolean
      anim?: PlayerAnim
      animTime?: number
      isSprinting?: boolean
      dribbleBallOffset?: { x: number; z: number }
      dribbleTouchSeverity?: number
      dribbleSpinning?: boolean
    },
  ) => {
    const outfieldCtrl = animCtrl.current
    const gkCtrlNow = gkAnimCtrl.current
    const displayAnim = isGoalkeeper
      ? ((gkCtrlNow?.getDisplayAnim() ?? 'gk_idle') as PlayerAnim)
      : (outfieldCtrl?.getDisplayAnim() ?? 'player_idle')
    const displayTime = isGoalkeeper
      ? (gkCtrlNow?.getAnimTime() ?? 0)
      : (outfieldCtrl?.getAnimTime() ?? 0)

    let entry = registryEntry.current
    if (!entry) {
      entry = {
        id,
        team,
        role,
        position: { x: pos.x, y: getPlayerBodyY(), z: pos.z },
        rotation: rotation.current,
        velocity: { x: 0, y: 0, z: 0 },
        isControlled: false,
        anim: displayAnim,
        animTime: displayTime,
      }
      registryEntry.current = entry
      playerRegistry.set(id, entry)
    }

    entry.position.x = pos.x
    entry.position.y = getPlayerBodyY()
    entry.position.z = pos.z
    entry.rotation = opts?.rotation ?? rotation.current
    entry.velocity.x = opts?.velocity?.x ?? 0
    entry.velocity.y = opts?.velocity?.y ?? 0
    entry.velocity.z = opts?.velocity?.z ?? 0
    entry.isControlled =
      opts?.isControlled ??
      (!isGoalkeeper &&
        team === getUserTeam() &&
        useGameStore.getState().activePlayerId === id)
    entry.isSprinting = opts?.isSprinting
    entry.dribbleBallOffset = opts?.dribbleBallOffset
    entry.dribbleTouchSeverity = opts?.dribbleTouchSeverity
    entry.dribbleSpinning = opts?.dribbleSpinning
    entry.anim = opts?.anim ?? displayAnim
    entry.animTime = opts?.animTime ?? displayTime
  }

  useEffect(() => {
    if (!setPieceShootAnim || setPieceShootAnim.kickerId !== id) return
    if (isGoalkeeper) {
      gkAnimCtrl.current?.playFootKick()
    } else {
      const clip = setPieceShootAnim.clip ?? 'player_shoot'
      const aim = setPieceAimAngle
      const aimX = Math.sin(aim)
      const aimZ = Math.cos(aim)
      animCtrl.current?.playStrike(clip, {
        mirror: shouldMirrorRightFootedStrike(rotation.current, aimX, aimZ),
      })
    }
    if (useGameStore.getState().setPieceShootAnim?.kickerId === id) {
      useGameStore.setState({ setPieceShootAnim: null })
    }
  }, [setPieceShootAnim?.at, id, isGoalkeeper, setPieceAimAngle])

  useEffect(() => {
    if (!setPieceThrowAnim || setPieceThrowAnim.kickerId !== id || isGoalkeeper) return
    const power = setPieceThrowAnim.power
    animCtrl.current?.playThrowIn({
      onContact: () => executeThrowInLaunch(power),
    })
    if (useGameStore.getState().setPieceThrowAnim?.kickerId === id) {
      useGameStore.setState({ setPieceThrowAnim: null })
    }
  }, [setPieceThrowAnim?.at, id, isGoalkeeper])

  useEffect(() => {
    if (!kickoffStrikeAnim || kickoffStrikeAnim.kickerId !== id) return
    // Limpa antes do passe — evita double-fire (StrictMode / re-render)
    useGameStore.setState({ kickoffStrikeAnim: null })
    performKickoffPass()
  }, [kickoffStrikeAnim?.at, id])

  useFrame((_, delta) => {
    const simDelta = getSimDelta(delta)
    const ctrl = isGoalkeeper ? null : animCtrl.current
    const gkCtrl = isGoalkeeper ? gkAnimCtrl.current : null

    if (isGoalkeeper) {
      if (!gkCtrl && modelRootRef.current && actions.gk_idle && mixer) {
        const boot = new GoalkeeperAnimController(actions, mixer)
        boot.init()
        boot.setRootMotionSnapshot(() => gkSnapshotSkeletonRef.current?.())
        gkAnimCtrl.current = boot
        registerGkHands(id, cloned)
      }
    } else if (!ctrl && modelRootRef.current && actions.player_idle && mixer) {
      const boot = new PlayerAnimController(actions, mixer)
      boot.init()
      boot.bindModelRoot(modelRootRef.current ?? cloned)
      boot.bindHoldBallIdle(actions.gk_idle_ball)
      boot.setRootMotionSnapshot(() => snapshotSkeletonRef.current?.())
      animCtrl.current = boot
      registerPlayerBones(id, cloned)
      registerGkHands(id, cloned)
    }

    gkSnapshotSkeletonRef.current = () => {
      if (!bodyRef.current || !fieldBounds) return
      modelRootRef.current?.updateMatrixWorld(true)
      updateGkHandPositions(id, modelRootRef.current ?? undefined)
      const hips = getGkHipsWorldXZ(id)
      if (!hips) return
      const gkRt = getGkRuntime(id)
      const maxDepth =
        gkRt?.allowStep && gkRt.mode === 'save' ? gkRt.stepDepth : GK_MAX_STEP_FROM_LINE
      const clamped = clampGkPosition({ x: hips.x, y: 0, z: hips.z }, team, fieldBounds, maxDepth)
      if (
        snapshotGkSkeletonToBody(
          id,
          position.current,
          bodyRef.current,
          clamped.x,
          clamped.z,
        )
      ) {
        syncRegistry(position.current, { rotation: rotation.current })
      }
    }
    gkCtrl?.setRootMotionSnapshot(() => gkSnapshotSkeletonRef.current?.())

    snapshotSkeletonRef.current = () => {
      if (!bodyRef.current || !fieldBounds) return
      modelRootRef.current?.updateMatrixWorld(true)
      updatePlayerBonePositions(id, modelRootRef.current ?? undefined)
      if (snapshotPlayerSkeletonToBody(id, position.current, bodyRef.current, fieldBounds)) {
        syncRegistry(position.current, { rotation: rotation.current })
      }
    }
    ctrl?.setRootMotionSnapshot(() => snapshotSkeletonRef.current?.())

    const animFree = isGoalkeeper ? !gkCtrl?.isLocked() : !ctrl?.isLocked()

    const finishAnimation = () => {
      const phaseNow = useGameStore.getState().phase
      if (phaseNow === 'replay') {
        const snap = replaySystem.getPlayerSnap(id)
        if (snap && replayAnimDriver.current) {
          const replayAnim = normalizePlayerAnim(snap.anim ?? 'player_idle')
          replayAnimDriver.current.sync(replayAnim, snap.animTime ?? 0)
          replayAnimDriver.current.tick()
        }
        if (isGoalkeeper) {
          updateGkHandPositions(id, modelRootRef.current ?? undefined)
        }
        return
      }

      if (isGoalkeeper) {
        gkCtrl?.update(simDelta)
      } else {
        ctrl?.update(simDelta)
      }
      mixer?.update(simDelta)
      if (isGoalkeeper) {
        updateGkHandPositions(id, modelRootRef.current ?? undefined)
        if (!gkCtrl?.absorbsRootMotion()) {
          pinGkHips(id)
        }
      } else {
        if (needsPlayerBoneSync(id)) {
          updatePlayerBonePositions(id, modelRootRef.current ?? undefined)
        }
        if (!ctrl?.absorbsRootMotion()) {
          pinPlayerHips(id)
        }
      }
    }
    try {
    if (!bodyRef.current || !fieldBounds) return

    if (!canPlayerPlay(id)) {
      const spot = getSentOffSpot(team, fieldBounds)
      position.current.set(spot.x, 0, spot.z)
      bodyRef.current.setNextKinematicTranslation({
        x: spot.x,
        y: getPlayerBodyY(),
        z: spot.z,
      })
      if (modelRootRef.current) modelRootRef.current.rotation.y = rotation.current
      if (animFree) ctrl?.forceIdle()
      syncRegistry(spot, { isControlled: false })
      return
    }

    const storeState = useGameStore.getState()
    const isUserActive =
      !isGoalkeeper && team === getUserTeam() && storeState.activePlayerId === id
    /** Pro + Livre: só stick — sem marcação/tática/perseguição auto */
    const userManualOnly = isUserActive && isProFreeControl()
    const hasBallNow = storeState.ballPossession?.playerId === id

    if (storeState.phase !== 'replay') {
      lastReplayAnim.current = null
    }

    if (isFieldParadePhase(storeState.phase)) {
      const actor = entranceSystem.getActor(id)
      if (actor) {
        position.current.set(actor.x, 0, actor.z)
        rotation.current = actor.rotation
        if (animFree) {
          // Intro / intervalo / fim — sempre walking (nunca run), GKs inclusos
          if (isGoalkeeper) {
            if (actor.moving) gkCtrl?.playLocomotion(false)
            else gkCtrl?.forceIdle()
          } else {
            ctrl?.setStrafeLocomotion({
              moving: actor.moving,
              sprint: false,
              localForward: actor.moving ? 1 : 0,
              localRight: 0,
            })
          }
        }
      }
      bodyRef.current.setNextKinematicTranslation({
        x: position.current.x,
        y: getPlayerBodyY(),
        z: position.current.z,
      })
      if (modelRootRef.current) {
        modelRootRef.current.rotation.y = rotation.current
      }
      syncRegistry(position.current, { rotation: rotation.current })
      return
    }

    if (storeState.phase === 'goal-celebration') {
      const celebTeam = replaySystem.getCelebrationTeam()
      const scorerId = replaySystem.getCelebrationScorerId()
      const gather = replaySystem.getCelebrationGather()
      const bodyY = getPlayerBodyY()
      const elapsed = replaySystem.getCelebrationElapsed()

      if (celebTeam && team === celebTeam && !isGoalkeeper) {
        const isScorer = id === scorerId
        // Autor vai pro canto; resto corre atrás dele (offsets pra não empilhar)
        let tx = gather.x
        let tz = gather.z
        if (!isScorer && scorerId) {
          const scorer = playerRegistry.get(scorerId)
          if (scorer) {
            const hash = (id.charCodeAt(id.length - 1) % 7) - 3
            const side = hash * 0.85
            const back = 1.1 + Math.abs(hash) * 0.35
            const face = Math.atan2(gather.x - scorer.position.x, gather.z - scorer.position.z)
            tx = scorer.position.x - Math.sin(face) * back + Math.cos(face) * side
            tz = scorer.position.z - Math.cos(face) * back - Math.sin(face) * side
          }
        } else if (isScorer) {
          // Autor: caminho um pouco curvo até o canto
          const wobble = Math.sin(elapsed * 2.2) * 0.35
          tx = gather.x + wobble
          tz = gather.z
        }

        const dx = tx - position.current.x
        const dz = tz - position.current.z
        const dist = Math.hypot(dx, dz)
        const sprintSpeed = isScorer ? 2.65 : 2.35 + (id.charCodeAt(0) % 5) * 0.08
        if (dist > 0.65) {
          const step = Math.min(dist, sprintSpeed * simDelta)
          position.current.x += (dx / dist) * step
          position.current.z += (dz / dist) * step
          rotation.current = Math.atan2(dx, dz)
          if (animFree) {
            ctrl?.setStrafeLocomotion({
              moving: true,
              sprint: true,
              localForward: 1,
              localRight: 0,
            })
          }
        } else if (animFree) {
          // Chegou: comemoração aleatória; se não tiver clip, idle
          if (!ctrl?.playCelebration()) {
            ctrl?.forceIdle()
          }
        }
      } else if (animFree) {
        ctrl?.forceIdle()
      }

      bodyRef.current.setNextKinematicTranslation({
        x: position.current.x,
        y: bodyY,
        z: position.current.z,
      })
      if (modelRootRef.current) {
        modelRootRef.current.rotation.y = rotation.current
      }
      syncRegistry(position.current, { rotation: rotation.current })
      return
    }

    if (storeState.phase === 'replay') {
      const snap = replaySystem.getPlayerSnap(id)
      if (snap) {
        position.current.set(snap.x, 0, snap.z)
        rotation.current = snap.rotation
        bodyRef.current.setNextKinematicTranslation({
          x: snap.x,
          y: getPlayerBodyY(),
          z: snap.z,
        })
        if (modelRootRef.current) {
          modelRootRef.current.rotation.y = rotation.current
        }
        const replayAnim = normalizePlayerAnim(snap.anim ?? 'player_idle')
        syncRegistry(
          { x: snap.x, z: snap.z },
          { rotation: snap.rotation, anim: replayAnim, animTime: snap.animTime ?? 0 },
        )
      }
      return
    }

    const isSetPieceFrozen =
      storeState.ballFrozen &&
      storeState.setPiecePosition != null &&
      storeState.setPieceTeam != null &&
      isActiveSetPiecePhase(storeState.phase)

    if (isSetPieceFrozen) {
      const spot = getSetPiecePlayerSpot(
        id,
        team,
        formation,
        fieldBounds,
        storeState.phase,
        storeState.setPieceTeam!,
        storeState.setPiecePosition!,
        storeState.setPieceKickerId,
        storeState.setPieceAimAngle,
      )
      position.current.set(spot.x, 0, spot.z)
      if (id === storeState.setPieceKickerId) {
        rotation.current = storeState.setPieceAimAngle
      }
      bodyRef.current.setNextKinematicTranslation({
        x: spot.x,
        y: getPlayerBodyY(),
        z: spot.z,
      })
      if (modelRootRef.current && id === storeState.setPieceKickerId) {
        modelRootRef.current.rotation.y = rotation.current
      }
      const isThrowInKicker =
        storeState.phase === 'throw-in' && id === storeState.setPieceKickerId
      if (isThrowInKicker && !isGoalkeeper) {
        modelRootRef.current?.updateMatrixWorld(true)
        updateGkHandPositions(id, modelRootRef.current ?? undefined)
        animCtrl.current?.bindHoldBallIdle(actions.gk_idle_ball)
        if (animFree && !animCtrl.current?.isLocked()) {
          animCtrl.current?.enterThrowInHold()
        }
      } else if (animFree) {
        animCtrl.current?.exitThrowInHold()
        ctrl?.forceIdle()
      }
      syncRegistry(spot)
      return
    }

    const isKickoffWaiting =
      storeState.phase === 'kickoff' &&
      storeState.ballFrozen &&
      storeState.setPiecePosition != null

    if (isKickoffWaiting && id === getKickoffPlayerId(storeState.kickoffTeam)) {
      const center = storeState.setPiecePosition!
      const stand = fieldBounds
        ? getKickoffKickerStand(team, fieldBounds, center, id)
        : {
            x: center.x,
            z: center.z,
            rotation: rotation.current,
          }
      position.current.set(stand.x, 0, stand.z)
      rotation.current = stand.rotation
      bodyRef.current.setNextKinematicTranslation({
        x: stand.x,
        y: getPlayerBodyY(),
        z: stand.z,
      })
      if (modelRootRef.current) {
        modelRootRef.current.rotation.y = rotation.current
      }
      if (animFree) ctrl?.forceIdle()

      const isKickerActive =
        team === getUserTeam() ? isUserActive : team === storeState.kickoffTeam
      // Só edge de passe/chute — A segurado do skip da intro não pode iniciar sozinho
      if (
        isKickerActive &&
        animFree &&
        !isKickoffInputLocked() &&
        (consumePassPress?.() || consumeAction?.('kick'))
      ) {
        startKickoff()
      }

      syncRegistry({ x: stand.x, z: stand.z }, { rotation: stand.rotation })
      return
    }

    if (
      isKickoffWaiting &&
      id !== getKickoffPlayerId(storeState.kickoffTeam) &&
      fieldBounds
    ) {
      const spot = getFormationSpawn(team, formation, fieldBounds)
      position.current.set(spot.x, 0, spot.z)
      rotation.current = getFieldFacingRotation(team, fieldBounds)
      bodyRef.current.setNextKinematicTranslation({
        x: spot.x,
        y: getPlayerBodyY(),
        z: spot.z,
      })
      if (modelRootRef.current) {
        modelRootRef.current.rotation.y = rotation.current
      }
      if (animFree) ctrl?.forceIdle()
      syncRegistry({ x: spot.x, z: spot.z }, { rotation: rotation.current })
      return
    }

    cleanupPhysicalStates()

    if (isPlayerKnockedDown(id)) {
      if (!knockdownActive.current) {
        knockdownActive.current = true
        ctrl?.playKnockdown()
      }
      bodyRef.current.setNextKinematicTranslation({
        x: position.current.x,
        y: getPlayerBodyY(),
        z: position.current.z,
      })
      velocity.current.set(0, 0, 0)
      moveVel.current.x = 0
      moveVel.current.z = 0
      syncRegistry(position.current, {
        velocity: { x: 0, y: 0, z: 0 },
      })
      return
    }

    // Roubo em pé — ombro / desequilíbrio (eventos de outros sistemas)
    if (ctrl) {
      const contactAnim = consumeContactAnim(id)
      if (contactAnim === 'shoulder_charge') ctrl.playShoulderCharge()
      else if (contactAnim === 'end_shoulder_charge') ctrl.endShoulderCharge()
      else if (contactAnim === 'imbalance') {
        ctrl.playImbalance()
        // Segurança: desequilíbrio COM bola = bola livre (sem magnetismo)
        if (hasBallNow) {
          const self = playerRegistry.get(id)
          if (self) {
            const duelOpp = getDuelOpponentId(id)
            const charger = duelOpp ? playerRegistry.get(duelOpp) : null
            releaseBallFromBodyImbalance(self, charger ?? null)
          }
        }
      } else if (contactAnim === 'imbalance_stolen') ctrl.playImbalanceStolen()
    }
    if (knockdownActive.current) {
      knockdownActive.current = false
      ctrl?.endKnockdown()
    }

    if (ctrl?.isSliding() && !isPlayerSliding(id)) {
      ctrl.endSlide()
    }

    const canMove =
      (phase === 'playing' && !ballFrozen) || (phase === 'kickoff' && !ballFrozen)

    const canStrike = !(ctrl?.isStriking() ?? false)

    if (controls?.current) {
      const manualControlBlocked = shouldBlockManualUserControl(storeState, id)
      if (
        isUserActive &&
        !manualControlBlocked &&
        !shouldSkipPassStealForAnticipation(storeState, id, isUserActive) &&
        consumePassPress?.() &&
        canMove &&
        phase === 'playing' &&
        !hasBallNow &&
        !isGoalkeeper
      ) {
        performStandingSteal()
      }
    const crossVolleyPending = hasCrossVolleyIntent(id) && !hasBallNow

      if (
        (isUserActive || storeState.pendingUserShot?.playerId === id) &&
        hasBallNow &&
        phase === 'playing' &&
        !crossVolleyPending
      ) {
        const hasBufferedPass =
          storeState.pendingUserPass?.buffered &&
          storeState.pendingUserPass.playerId === id
        const hasPendingShot = storeState.pendingUserShot?.playerId === id
        if (canStrike || hasBufferedPass || hasPendingShot) {
          const pendingPass = useGameStore.getState().consumePendingUserPass(id)
          if (pendingPass) {
            const aimDir =
              pendingPass.dirX != null && pendingPass.dirZ != null
                ? { x: pendingPass.dirX, z: pendingPass.dirZ }
                : undefined
            if (pendingPass.type === 'pass') performPass(pendingPass.power, aimDir)
            else if (pendingPass.type === 'through') {
              performThroughPass(pendingPass.power, aimDir)
            } else performCross(pendingPass.power, aimDir)
          }
          const pendingShot = useGameStore.getState().consumePendingUserShot(id)
          if (pendingShot) {
            performKick(pendingShot.power, {
              x: pendingShot.dirX,
              z: pendingShot.dirZ,
            }, pendingShot.firstTime)
          }
        }
      }
      if (
        isUserActive &&
        !manualControlBlocked &&
        consumeAction?.('slide') &&
        animFree &&
        !hasBallNow &&
        phase === 'playing' &&
        !isGoalkeeper &&
        canMove &&
        canStartSlide(id)
      ) {
        performSlideTackle()
      }
      if (
        isUserActive &&
        animFree &&
        phase === 'kickoff' &&
        storeState.ballFrozen &&
        !isKickoffInputLocked()
      ) {
        if (consumePassPress?.() || consumeAction?.('kick')) {
          startKickoff()
        }
      }
    }

    const passIntentEarly = storeState.passIntent
    const currentPossEarly = storeState.ballPossession
    const opponentHasBallEarly =
      currentPossEarly !== null && currentPossEarly.team !== team
    const isPrimaryMarkerEarly =
      isTeamMarker(id, team, currentPossEarly, ballRef.current)
    const holderEarly =
      opponentHasBallEarly && currentPossEarly
        ? playerRegistry.get(currentPossEarly.playerId)
        : null
    const distToHolderEarly = holderEarly
      ? distance2D(position.current, holderEarly.position)
      : Infinity
    const markerInFrontOfHolder =
      holderEarly != null &&
      (() => {
        const hs = Math.hypot(holderEarly.velocity.x, holderEarly.velocity.z)
        const hx = hs > 0.22 ? holderEarly.velocity.x / hs : Math.sin(holderEarly.rotation)
        const hz = hs > 0.22 ? holderEarly.velocity.z / hs : Math.cos(holderEarly.rotation)
        const toMarkX = position.current.x - holderEarly.position.x
        const toMarkZ = position.current.z - holderEarly.position.z
        const toLen = Math.hypot(toMarkX, toMarkZ)
        if (toLen < 0.08) return true
        return (toMarkX * hx + toMarkZ * hz) / toLen > 0.1
      })()
    const opponentPassEarly =
      passIntentEarly != null &&
      (passIntentEarly.passingTeam ?? storeState.lastTouchTeam) !== team
    const isPassReceiverEarly =
      passIntentEarly != null &&
      (passIntentEarly.receiverId === id ||
        passIntentEarly.runnerIds?.includes(id))
    const slideIntervalMul = role === 'def' ? 1 : role === 'mid' ? 1.25 : 1.6
    const canAiSlideBase =
      canMove &&
      !ballFrozen &&
      !isGoalkeeper &&
      !hasBallNow &&
      !isUserActive &&
      !isPassReceiverEarly &&
      animFree &&
      phase === 'playing' &&
      fieldBounds != null

    const goalThreatEarly =
      role === 'def' &&
      opponentHasBallEarly &&
      holderEarly &&
      fieldBounds
        ? getDefenderGoalThreat(
            team,
            fieldBounds,
            ballRef.current,
            holderEarly,
          )
        : null

    const canAiSlidePress =
      canAiSlideBase &&
      opponentHasBallEarly &&
      holderEarly?.role !== 'gk' &&
      (role === 'def'
        ? isPrimaryMarkerEarly
        : role === 'mid'
          ? isPrimaryMarkerEarly || isCoverPresser(id, team)
          : isPrimaryMarkerEarly) &&
      distToHolderEarly < SLIDE_AI_MAX_DIST + 0.25 &&
      distToHolderEarly > SLIDE_AI_MIN_DIST &&
      holderEarly != null &&
      canSlideOnHolder(mySnapshot(), holderEarly, fieldBounds)

    const canAiSlideEmergency =
      canAiSlideBase &&
      opponentHasBallEarly &&
      holderEarly?.role !== 'gk' &&
      goalThreatEarly != null &&
      role === 'def' &&
      holderEarly != null &&
      distToHolderEarly >
        (goalThreatEarly === 'box' ? 0.2 : SLIDE_AI_MIN_DIST * 0.85) &&
      distToHolderEarly <
        (goalThreatEarly === 'box'
          ? SLIDE_AI_GOAL_BOX_MAX_DIST + 0.12
          : SLIDE_AI_GOAL_DANGER_MAX_DIST + 0.1) &&
      canEmergencySlideNearGoal(
        mySnapshot(),
        holderEarly,
        fieldBounds,
        goalThreatEarly,
      )

    const interceptEarly =
      opponentPassEarly && passIntentEarly && isPassInterceptor(id, team)
        ? getPassInterceptTarget(
            position.current,
            ballRef.current,
            ballRef.velocity,
            passIntentEarly,
          )
        : null
    const canAiSlideIntercept =
      canAiSlideBase &&
      opponentPassEarly &&
      interceptEarly != null &&
      isPassInterceptor(id, team) &&
      canSlideOnPassIntercept(
        mySnapshot(),
        ballRef.current,
        ballRef.velocity,
        passIntentEarly!,
        interceptEarly,
      )

    const duelOpponentId = getDuelOpponentId(id)
    const duelDurationMs = getPhysicalDuelDurationMs(id)
    const canAiSlideDuel =
      canAiSlideBase &&
      opponentHasBallEarly &&
      holderEarly?.role !== 'gk' &&
      duelOpponentId != null &&
      duelOpponentId === holderEarly?.id &&
      holderEarly != null &&
      canSlideInPhysicalDuel(mySnapshot(), holderEarly, duelDurationMs)

    if (canAiSlideEmergency || canAiSlidePress || canAiSlideIntercept || canAiSlideDuel) {
      aiSlideTimer.current -= simDelta * 1000
      if (aiSlideTimer.current <= 0 && canStartSlide(id)) {
        const intervalMul = canAiSlideEmergency
          ? SLIDE_AI_GOAL_BOX_INTERVAL_MUL
          : slideIntervalMul
        aiSlideTimer.current =
          scaleSlideInterval(
            SLIDE_AI_MIN_INTERVAL_MS * intervalMul +
              Math.random() * SLIDE_AI_MIN_INTERVAL_MS * (canAiSlideEmergency ? 0.35 : 0.75),
            team,
          )

        let slideDir: { x: number; z: number } | null = null
        let rollChance = 0

        if (canAiSlideEmergency && holderEarly && goalThreatEarly) {
          rollChance = getAISlideChanceNearGoal(goalThreatEarly)
          const held = getHeldBallPoint(holderEarly, currentPossEarly?.playerId)
          slideDir = normalize2D(
            held.x - position.current.x,
            held.z - position.current.z,
          )
        } else if (canAiSlideIntercept && interceptEarly) {
          rollChance = getAISlideChanceOnIntercept(role, id)
          slideDir = normalize2D(
            ballRef.current.x - position.current.x,
            ballRef.current.z - position.current.z,
          )
        } else if (canAiSlideDuel && holderEarly) {
          rollChance = getAISlideChanceOnDuel(role)
          const held = getHeldBallPoint(holderEarly, currentPossEarly?.playerId)
          slideDir = normalize2D(
            held.x - position.current.x,
            held.z - position.current.z,
          )
        } else if (canAiSlidePress && holderEarly) {
          rollChance = getAISlideChanceOnHolder(role, isPrimaryMarkerEarly, id)
          slideDir = normalize2D(
            holderEarly.position.x - position.current.x,
            holderEarly.position.z - position.current.z,
          )
        }

        if (slideDir) {
          rollChance = scaleSlideChance(rollChance, team)
        }

        if (slideDir && Math.random() < rollChance) {
          rotation.current = Math.atan2(slideDir.x, slideDir.z)
          if (modelRootRef.current) {
            modelRootRef.current.rotation.y = rotation.current
          }
          if (startSlide(id, slideDir.x, slideDir.z, slideActiveMs())) {
            ctrl?.startSlide()
          }
        }
      }
    }

    const canAiStandingSteal =
      canMove &&
      !ballFrozen &&
      !isGoalkeeper &&
      !hasBallNow &&
      !isUserActive &&
      canAiAttemptStandingSteal(id) &&
      !(passIntentEarly != null &&
        (passIntentEarly.receiverId === id || passIntentEarly.runnerIds?.includes(id))) &&
      opponentHasBallEarly &&
      holderEarly?.role !== 'gk' &&
      (role === 'def' ||
        role === 'mid' ||
        (role === 'fwd' && distToHolderEarly < 1.05)) &&
      holderEarly != null &&
      shouldOpponentStandingSteal(holderEarly.team) &&
      animFree &&
      phase === 'playing' &&
      distToHolderEarly < STANDING_STEAL_AI_MAX_DIST + 0.22 &&
      (markerInFrontOfHolder || distToHolderEarly < 0.95) &&
      (isPrimaryMarkerEarly ||
        isCoverPresser(id, team) ||
        distToHolderEarly < 1.05)

    if (canAiStandingSteal) {
      aiStealTimer.current -= simDelta * 1000
      if (aiStealTimer.current <= 0) {
        const staminaIntervalMul = getStaminaStealIntervalMul(id)
        const intervalBase =
          (team === getUserTeam()
            ? STANDING_STEAL_AI_INTERVAL_MS * 0.68
            : STANDING_STEAL_AI_INTERVAL_MS * 0.82) * staminaIntervalMul
        aiStealTimer.current = scaleStandingStealInterval(
          intervalBase + Math.random() * intervalBase * 0.45,
          team,
        )
        const roleMul =
          role === 'def' ? 1.22 : role === 'mid' ? 1.08 : 0.72
        // Quanto mais colado no portador, mais decidido é o bote
        const proximity = THREE.MathUtils.clamp(
          1 - distToHolderEarly / (STANDING_STEAL_AI_MAX_DIST + 0.22),
          0,
          1,
        )
        let rollChance =
          STANDING_STEAL_AI_CHANCE *
          roleMul *
          (0.58 + proximity) *
          getStaminaStealChanceMul(id)
        if (!isPrimaryMarkerEarly) rollChance *= 0.82
        if (team === getUserTeam()) rollChance *= 1.45
        else rollChance = scaleStandingStealChance(rollChance, team) * 1.12
        // Não tenta roubar no meio do giro 180 / spin
        const holderProtect = holderEarly ? getDribbleStealProtect(holderEarly) : 0
        if (holderProtect > 0.72) rollChance = 0
        else if (holderProtect > 0.4) rollChance *= 1 - holderProtect * 0.9
        if (Math.random() < Math.min(0.96, rollChance)) {
          if (holderEarly) refreshShoulderChargePress(id, holderEarly.id)
          tryAiBodyChargeOnHolder(id)
        }
      }
    }

    // IA colada no portador: ombro com timeout longo (não spam)
    const canAiShoulderHolder =
      canMove &&
      !ballFrozen &&
      !isGoalkeeper &&
      !hasBallNow &&
      !isUserActive &&
      canAiAttemptStandingSteal(id) &&
      opponentHasBallEarly &&
      holderEarly != null &&
      holderEarly.role !== 'gk' &&
      shouldOpponentStandingSteal(holderEarly.team) &&
      animFree &&
      phase === 'playing' &&
      (isPrimaryMarkerEarly || isCoverPresser(id, team)) &&
      distToHolderEarly < 0.75

    if (canAiShoulderHolder && holderEarly) {
      aiBodyChargeTimer.current -= simDelta * 1000
      if (aiBodyChargeTimer.current <= 0) {
        const holderIsUser =
          holderEarly.team === getUserTeam() &&
          holderEarly.id === storeState.activePlayerId
        aiBodyChargeTimer.current = holderIsUser
          ? BODY_CHARGE_AI_VS_PLAYER_INTERVAL_MS + Math.random() * 200
          : BODY_CHARGE_AI_INTERVAL_MS + Math.random() * 1600
        let shoulderRoll =
          (role === 'def' ? 0.22 : role === 'mid' ? 0.14 : 0.08) *
          getStaminaStealChanceMul(id)
        if (holderIsUser) shoulderRoll *= 1.15
        if (team !== getUserTeam()) {
          shoulderRoll = scaleStandingStealChance(shoulderRoll, team) * 0.65
        }
        if (Math.random() < Math.min(0.35, shoulderRoll)) {
          tryAiBodyChargeOnHolder(id)
        }
      }
    }

    // IA sem bola: ombro em adversário SEM posse — bem raro
    const canAiOffBallBody =
      canMove &&
      !ballFrozen &&
      !isGoalkeeper &&
      !hasBallNow &&
      !isUserActive &&
      canAiAttemptStandingSteal(id) &&
      !opponentHasBallEarly &&
      animFree &&
      phase === 'playing' &&
      (role === 'def' || role === 'mid')

    if (canAiOffBallBody) {
      aiBodyChargeTimer.current -= simDelta * 1000
      if (aiBodyChargeTimer.current <= 0) {
        const offTarget = findOffBallBodyChargeTarget(id)
        const targetIsUser =
          !!offTarget &&
          offTarget.team === getUserTeam() &&
          offTarget.id === storeState.activePlayerId
        aiBodyChargeTimer.current = targetIsUser
          ? BODY_CHARGE_AI_VS_PLAYER_INTERVAL_MS + Math.random() * 200
          : BODY_CHARGE_AI_INTERVAL_MS * 1.35 + Math.random() * 2000
        if (offTarget) {
          let roll =
            (role === 'def' ? 0.16 : 0.1) * getStaminaStealChanceMul(id)
          if (team !== getUserTeam()) roll = scaleStandingStealChance(roll, team) * 0.55
          if (targetIsUser) roll *= 1.2
          if (Math.random() < Math.min(0.28, roll)) {
            tryOffBallBodyCharge(id, offTarget.id)
          }
        }
      }
    }

    // Roubo / jogo de corpo do player: SÓ no A (performStandingSteal) — sem auto

    if (isPlayerSliding(id)) {
      const dir = getSlideDirection(id)
      if (dir) {
        if (!ctrl?.isSliding()) ctrl?.startSlide()
        rotation.current = Math.atan2(dir.x, dir.z)
        if (modelRootRef.current) modelRootRef.current.rotation.y = rotation.current
        processSlideContacts(id)
        syncRegistry(position.current, { rotation: rotation.current })
      }
      return
    }

    const storePoss = storeState.ballPossession
    if (
      storePoss?.playerId === id &&
      storeState.possessionSince !== lastPossessionSince.current
    ) {
      lastPossessionSince.current = storeState.possessionSince
      if (!isUserActive && team !== getUserTeam()) {
        aiThinkTimer.current =
          AI_THINK_MIN_S * (0.9 + Math.random() * 0.55)
      }
    }

    if (
      storePoss?.playerId === id &&
      canMove &&
      animFree &&
      phase === 'playing' &&
      !isGoalkeeper &&
      !isUserActive
    ) {
      tickCarrierBrain(simDelta)
    }

    const bodyActionLocked = isGoalkeeper
      ? isGkBodyLocked(id)
      : (ctrl?.isBodyLocked() ?? false)
    const canUpdateLocoAnim =
      !isGoalkeeper && (animFree || (ctrl?.allowsLocomotionDuringAction() ?? false))

    let dirX = 0
    let dirZ = 0
    let sprint = false
    let moveScale = 1

    const passIntent = storeState.passIntent
    if (!passIntent || passIntent.startedAt !== receiveIntentKey.current) {
      receiveIntentKey.current = passIntent?.startedAt ?? 0
    }

    const currentPoss = storeState.ballPossession
    const isPassParticipant =
      passIntent != null &&
      (passIntent.receiverId === id || passIntent.runnerIds?.includes(id) === true)

    const crossInterceptorId =
      passIntent?.passType === 'cross' &&
      passIntent.passingTeam === team &&
      !currentPoss &&
      !hasBallNow &&
      !isGoalkeeper &&
      passIntent
        ? getReceiveInterceptorId(team, passIntent)
        : null

    if (
      !isUserActive &&
      !isGoalkeeper &&
      !hasBallNow &&
      phase === 'playing' &&
      fieldBounds &&
      passIntent?.passType === 'cross' &&
      passIntent.passingTeam === team &&
      id === crossInterceptorId
    ) {
      tickAICrossVolleyAnticipation(id, team, position.current, fieldBounds)
    }

    const chasesPassBall =
      passIntent != null &&
      (passIntent.passType !== 'cross'
        ? passIntent.receiverId === id ||
          shouldChaseOwnPassBall(id, team, passIntent, ballRef.current)
        : passIntent.receiverId === id ||
          id === crossInterceptorId ||
          hasCrossVolleyIntent(id) ||
          shouldChaseOwnPassBall(id, team, passIntent, ballRef.current))

    const opponentHasBall = currentPoss !== null && currentPoss.team !== team
    const markerPressing =
      !isUserActive &&
      !hasBallNow &&
      opponentHasBall &&
      isTeamMarker(id, team, currentPoss, ballRef.current)
    const opponentPassInFlight =
      passIntent != null &&
      !currentPoss &&
      passIntent.passingTeam !== team
    const passInterceptPressing =
      !isUserActive &&
      !hasBallNow &&
      opponentPassInFlight &&
      isPassInterceptor(id, team)
    const manMarkingActive =
      (opponentHasBall || opponentPassInFlight) &&
      !hasBallNow &&
      !isPassParticipant &&
      getManMarkOpponentId(team, id) != null
    const pressAsMarker =
      canMove &&
      !ballFrozen &&
      !isGoalkeeper &&
      !hasBallNow &&
      !isPassParticipant &&
      isTeamMarker(id, team, currentPoss, ballRef.current) &&
      (opponentHasBall || opponentPassInFlight) &&
      (currentPoss !== null || opponentPassInFlight)

    const receivingPass =
      chasesPassBall &&
      !hasBallNow &&
      canMove &&
      !currentPoss

    const autoFirstTimeRun =
      shouldAutoRunForFirstTime(storeState, id) &&
      !hasBallNow &&
      canMove &&
      !currentPoss

    const anticipatedShotRun =
      shouldAutoRunForAnticipatedShot(storeState, id) &&
      !hasBallNow &&
      canMove &&
      !currentPoss

    const userCrossReceiveControl =
      isUserActive &&
      team === getUserTeam() &&
      !hasCrossVolleyIntent(id) &&
      (isCrossTrapActive(id) || isCrossReceiveControlActive(id))

    const autoFirstTimeWithBall =
      !userCrossReceiveControl &&
      !(storeState.passIntent?.passType === 'cross' && hasCrossVolleyIntent(id)) &&
      (isAutoFirstTimeStriker(storeState, id) || hasBufferedStrikeIntent(storeState, id)) &&
      hasBallNow &&
      hasBufferedStrikeIntent(storeState, id) &&
      canMove &&
      phase === 'playing'

    const shotChargeWindUp =
      isPlayerInShotChargeMode(storeState, id) &&
      hasBallNow &&
      !hasBufferedStrikeIntent(storeState, id) &&
      canMove &&
      phase === 'playing' &&
      !isGoalkeeper
    if (!shotChargeWindUp) shotRunLockRef.current = null

    const crossVolleyAim =
      isUserActive &&
      team === getUserTeam() &&
      !isGoalkeeper &&
      !hasBallNow &&
      canMove &&
      phase === 'playing' &&
      (isCrossVolleyArmed(storeState, id) ||
        hasCrossVolleyIntent(id)) &&
      id === storeState.activePlayerId

    const anticipationShotAim =
      isUserActive &&
      team === getUserTeam() &&
      !isGoalkeeper &&
      !hasBallNow &&
      canMove &&
      phase === 'playing' &&
      isAnticipatingShotCharge(storeState, id)

    const shotAimActive =
      isUserActive &&
      team === getUserTeam() &&
      !isGoalkeeper &&
      canMove &&
      !bodyActionLocked &&
      phase === 'playing' &&
      !!controls?.current &&
      storeState.shotChargeActive &&
      storeState.powerBarMode === 'shot' &&
      ((hasBallNow && shotChargeWindUp) || crossVolleyAim || anticipationShotAim)

    const passAimActive =
      isUserActive &&
      team === getUserTeam() &&
      !isGoalkeeper &&
      hasBallNow &&
      canMove &&
      !bodyActionLocked &&
      phase === 'playing' &&
      !!controls?.current &&
      storeState.shotChargeActive &&
      storeState.powerBarMode === 'pass'

    const crossVolleyChase =
      hasCrossVolleyIntent(id) &&
      !hasBallNow &&
      canMove &&
      !currentPoss &&
      phase === 'playing'

    const anticipationChargeRun =
      isAnticipatingShotCharge(storeState, id) &&
      !hasBallNow &&
      canMove &&
      !currentPoss &&
      phase === 'playing'

    const needsAutoReceiveRun =
      !userManualOnly &&
      (receivingPass ||
        autoFirstTimeRun ||
        anticipatedShotRun ||
        crossVolleyChase ||
        anticipationChargeRun)

    const shotLockActive =
      isUserActive &&
      team === getUserTeam() &&
      !isGoalkeeper &&
      hasBallNow &&
      canMove &&
      !bodyActionLocked &&
      phase === 'playing' &&
      !!controls?.current &&
      storeState.shotChargeActive &&
      (storeState.powerBarMode === 'through' ||
        storeState.powerBarMode === 'cross')

    if (!needsAutoReceiveRun || userCrossReceiveControl) {
      receiveRunState.current = {
        hardStop: false,
        approachDist: 99,
        directVel: false,
        targetSpeed: 0,
        dirX: 0,
        dirZ: 0,
      }
    }

    if (needsAutoReceiveRun && !userCrossReceiveControl) {
      const isCrossPass = passIntent?.passType === 'cross'
      const { ball, velocity: ballVel } = getLiveBallState()

      // Receber = ir NA BOLA. Sem planejador dançando.
      const bx = ball.x - position.current.x
      const bz = ball.z - position.current.z
      const bd = Math.hypot(bx, bz) || 1
      dirX = bx / bd
      dirZ = bz / bd
      sprint = true
      moveScale = 1.08
      receiveRunState.current = {
        hardStop: false,
        approachDist: bd,
        directVel: true,
        targetSpeed: PLAYER_SPRINT_SPEED,
        dirX,
        dirZ,
      }
      aiDirectMove.current = true

      if (passIntent && isCrossPass) {
        const crossInterceptor =
          id === crossInterceptorId || hasCrossVolleyIntent(id)
        if (crossInterceptor && !hasCrossVolleyIntent(id)) {
          const horiz = Math.hypot(ball.x - position.current.x, ball.z - position.current.z)
          if (horiz < 1.55) {
            tryCrossBallContact(id, position.current, ball, ballVel)
          }
          const ballLow = (ball.y ?? 0) < 1.15
          const ballSlow = Math.hypot(ballVel.x, ballVel.z) < 5.5
          if (ballLow && ballSlow) {
            tryMaintainCrossTrap(id, team, position.current, ball, ballVel, passIntent)
          }
        }
      }
    } else if (
      hasCrossVolleyIntent(id) &&
      !hasBallNow &&
      canMove &&
      phase === 'playing' &&
      !currentPoss
    ) {
      const ball = ballRef.current
      const bx = ball.x - position.current.x
      const bz = ball.z - position.current.z
      const bd = Math.hypot(bx, bz)
      if (bd > 0.14) {
        dirX = bx / bd
        dirZ = bz / bd
        sprint = true
        moveScale = 1.05
      }
      aiDirectMove.current = true
    } else if (autoFirstTimeWithBall || shotChargeWindUp) {
      const pending = storeState.pendingUserShot
      const aim = storeState.strikeAim
      const aimDirX = pending?.dirX ?? aim?.dirX
      const aimDirZ = pending?.dirZ ?? aim?.dirZ

      // Wind-up do chute: corre RETO na direção que já tinha — stick só mira a seta
      if (shotChargeWindUp) {
        if (!shotRunLockRef.current) {
          const velLen = Math.hypot(moveVel.current.x, moveVel.current.z)
          const inLen = Math.hypot(inputDir.current.x, inputDir.current.z)
          let lx: number
          let lz: number
          if (velLen > 0.08) {
            lx = moveVel.current.x / velLen
            lz = moveVel.current.z / velLen
          } else if (inLen > 0.04) {
            lx = inputDir.current.x / inLen
            lz = inputDir.current.z / inLen
          } else {
            lx = Math.sin(rotation.current)
            lz = Math.cos(rotation.current)
          }
          shotRunLockRef.current = {
            x: lx,
            z: lz,
            sprint:
              playerRegistry.get(id)?.isSprinting === true ||
              !!controls?.current?.sprint ||
              velLen > PLAYER_SPEED * 1.06,
          }
        }
        const lock = shotRunLockRef.current
        dirX = lock.x
        dirZ = lock.z
        sprint = lock.sprint || !!controls?.current?.sprint
        moveScale = sprint ? 1.05 : 1
        inputDir.current.x = dirX
        inputDir.current.z = dirZ
        aiDirectMove.current = true
      } else {
        shotRunLockRef.current = null
        const velLen = Math.hypot(moveVel.current.x, moveVel.current.z)
        const inertiaLen = Math.hypot(inputDir.current.x, inputDir.current.z)
        const wasSprinting =
          playerRegistry.get(id)?.isSprinting === true ||
          !!controls?.current?.sprint ||
          velLen > PLAYER_SPEED * 1.06

        if (velLen > 0.08) {
          dirX = moveVel.current.x / velLen
          dirZ = moveVel.current.z / velLen
          sprint = wasSprinting || autoFirstTimeWithBall
          moveScale = sprint ? 1.05 : 1
        } else if (inertiaLen > 0.04) {
          dirX = inputDir.current.x / inertiaLen
          dirZ = inputDir.current.z / inertiaLen
          sprint = wasSprinting || autoFirstTimeWithBall
          moveScale = sprint ? 1.05 : 1
        } else if (aimDirX != null && aimDirZ != null) {
          const aimLen = Math.hypot(aimDirX, aimDirZ)
          if (aimLen > 0.01) {
            dirX = aimDirX / aimLen
            dirZ = aimDirZ / aimLen
            sprint = autoFirstTimeWithBall || wasSprinting
            moveScale = autoFirstTimeWithBall ? 1.05 : wasSprinting ? 1.02 : 0.95
          }
        }
        aiDirectMove.current = true
      }
    } else if (pressAsMarker && !userManualOnly) {
      const ai = getAIMove(simDelta)
      dirX = ai.dirX
      dirZ = ai.dirZ
      sprint = ai.sprint
      moveScale = markerPressing || passInterceptPressing
        ? Math.min(Math.max(ai.urgency, 1.02), 1.1)
        : ai.direct
          ? Math.min(Math.max(ai.urgency, 0.88), 1.02)
          : Math.max(ai.urgency, 0.94)
      aiDirectMove.current = ai.direct
    } else if (shotLockActive) {
      const lockedDirLen = Math.hypot(inputDir.current.x, inputDir.current.z)
      const lockedDirX = lockedDirLen > 0.001 ? inputDir.current.x : Math.sin(rotation.current)
      const lockedDirZ = lockedDirLen > 0.001 ? inputDir.current.z : Math.cos(rotation.current)
      const f = cameraState.forward
      const r = cameraState.right
      const c = controls?.current
      let turnDirX = 0
      let turnDirZ = 0

      if (c) {
        const stickLen = Math.hypot(c.moveX, c.moveZ)
        if (stickLen > 0.12) {
          turnDirX = f.x * c.moveZ + r.x * c.moveX
          turnDirZ = f.z * c.moveZ + r.z * c.moveX
          const len = Math.hypot(turnDirX, turnDirZ)
          if (len > 0.001) {
            turnDirX /= len
            turnDirZ /= len
          }
        } else {
          if (c.forward) {
            turnDirX += f.x
            turnDirZ += f.z
          }
          if (c.backward) {
            turnDirX -= f.x
            turnDirZ -= f.z
          }
          if (c.left) {
            turnDirX += r.x
            turnDirZ += r.z
          }
          if (c.right) {
            turnDirX -= r.x
            turnDirZ -= r.z
          }
        }
      }

      const turnBlend =
        Math.hypot(turnDirX, turnDirZ) > 0.001
          ? 0.34
          : 0
      dirX = lockedDirX * (1 - turnBlend) + turnDirX * turnBlend
      dirZ = lockedDirZ * (1 - turnBlend) + turnDirZ * turnBlend
      sprint = !!controls?.current?.sprint
      moveScale = 0.8
      aiDirectMove.current = true
    } else if (
      isUserActive &&
      controls?.current &&
      canMove &&
      !bodyActionLocked &&
      !shouldBlockManualUserControl(storeState, id) &&
      (userManualOnly || !shouldAutoChaseLooseBall(id, team))
    ) {
      const c = controls.current
      const f = cameraState.forward
      const r = cameraState.right
      const stickLen = Math.hypot(c.moveX, c.moveZ)

      if (stickLen > 0.12) {
        dirX = f.x * c.moveZ + r.x * c.moveX
        dirZ = f.z * c.moveZ + r.z * c.moveX
        const len = Math.hypot(dirX, dirZ)
        if (len > 0.001) {
          dirX /= len
          dirZ /= len
        }
        sprint = c.sprint
      } else {
        if (c.forward) {
          dirX += f.x
          dirZ += f.z
        }
        if (c.backward) {
          dirX -= f.x
          dirZ -= f.z
        }
        if (c.left) {
          dirX += r.x
          dirZ += r.z
        }
        if (c.right) {
          dirX -= r.x
          dirZ -= r.z
        }
        sprint = c.sprint
      }
      aiDirectMove.current = false
    } else if (canMove && !bodyActionLocked) {
      const ai = getAIMove(simDelta)
      // Apoio ofensivo: desvia forte de companheiro (não light)
      const supportingMate =
        !hasBallNow &&
        !!storeState.ballPossession &&
        storeState.ballPossession.team === team &&
        storeState.ballPossession.playerId !== id
      const steered = hasBallNow
        ? { x: ai.dirX, z: ai.dirZ }
        : steerAiMoveDir(id, ai.dirX, ai.dirZ, {
            withBall: false,
            light: !supportingMate,
          })
      dirX = steered.x
      dirZ = steered.z
      sprint = ai.sprint
      // Só freia se alguém está NA FRENTE no caminho — não mata sprint por estar perto
      let pathBlocked = false
      const moveLen = Math.hypot(dirX, dirZ)
      if (moveLen > 0.08) {
        const mx = dirX / moveLen
        const mz = dirZ / moveLen
        for (const other of playerRegistry.values()) {
          if (other.id === id) continue
          const dx = other.position.x - position.current.x
          const dz = other.position.z - position.current.z
          const dist = Math.hypot(dx, dz)
          const lim = other.team === team ? 1.55 : 1.45
          if (dist > lim || dist < 1e-4) continue
          const ahead = (dx / dist) * mx + (dz / dist) * mz
          if (ahead > 0.45) {
            pathBlocked = true
            // Companheiro na frente: desvia lateral em vez de só frear
            if (other.team === team) {
              const latX = -mz
              const latZ = mx
              const side =
                dx * latX + dz * latZ >= 0 ? 1 : -1
              dirX = mx * 0.35 + latX * side * 0.65
              dirZ = mz * 0.35 + latZ * side * 0.65
              const dl = Math.hypot(dirX, dirZ) || 1
              dirX /= dl
              dirZ /= dl
            }
            break
          }
        }
      }
      // Portador: NUNCA corta sprint por crowd — senão vira trote burro
      if (pathBlocked && !hasBallNow) {
        sprint = false
        moveScale = passInterceptPressing
          ? Math.min(Math.max(ai.urgency, 1.02), 1.1)
          : ai.direct
            ? Math.min(Math.max(ai.urgency, 0.88), 1.02)
            : Math.max(ai.urgency, 0.94)
        moveScale *= 0.9
      } else {
        moveScale = passInterceptPressing
          ? Math.min(Math.max(ai.urgency, 1.02), 1.1)
          : ai.direct
            ? Math.min(Math.max(ai.urgency, 0.88), 1.02)
            : Math.max(ai.urgency, 0.94)
        if (pathBlocked && hasBallNow) moveScale *= 0.94
      }
      aiDirectMove.current = ai.direct
    } else {
      aiDirectMove.current = false
    }

    if (passAimActive) {
      moveScale *= 0.92
    }
    if (crossVolleyAim) {
      moveScale *= 0.92
    }

    const shielding =
      hasBallNow &&
      isUserActive &&
      !!controls?.current?.shield &&
      canMove &&
      phase === 'playing' &&
      !bodyActionLocked &&
      animFree

    setBallShield(id, shielding)

    if (shielding) {
      dirX = 0
      dirZ = 0
      sprint = false
      moveScale = 0
      aiDirectMove.current = true
    }

    const fieldLoco = !isGoalkeeper
    const urgentMove =
      !userCrossReceiveControl &&
      ((needsAutoReceiveRun && !userCrossReceiveControl) || receivingPass)
    const rawDirLen = Math.hypot(dirX, dirZ)
    const rawDirX = rawDirLen > 0.02 ? dirX : 0
    const rawDirZ = rawDirLen > 0.02 ? dirZ : 0
    // Receive: NÃO suaviza direção — senão saracota indo/voltando
    if (receivingPass || needsAutoReceiveRun) {
      if (rawDirLen > 0.02) {
        inputDir.current.x = dirX
        inputDir.current.z = dirZ
      }
    } else if (
      !userCrossReceiveControl &&
      ((urgentMove && rawDirLen > 0.02) || receiveRunState.current.directVel)
    ) {
      const dirSmooth = receiveRunState.current.directVel
        ? PLAYER_DIR_SMOOTH_AI_DIRECT * 1.85
        : PLAYER_DIR_SMOOTH_AI_DIRECT * 1.55
      const smoothedDir = smoothDirection2D(inputDir.current, dirX, dirZ, dirSmooth, simDelta)
      inputDir.current.x = smoothedDir.x
      inputDir.current.z = smoothedDir.z
      const smLen = Math.hypot(smoothedDir.x, smoothedDir.z)
      if (smLen > 0.02) {
        dirX = smoothedDir.x / smLen
        dirZ = smoothedDir.z / smLen
      }
    } else {
      const preMoveSp = Math.hypot(moveVel.current.x, moveVel.current.z)
      let skipDirSmooth = false
      // Reversão brusca: não suaviza — senão o 180 nunca dispara (IA com bola / Be a Pro)
      if (rawDirLen > 0.2 && preMoveSp > 0.18 && (hasBallNow || isUserActive)) {
        const ix = rawDirX / rawDirLen
        const iz = rawDirZ / rawDirLen
        const mx = moveVel.current.x / preMoveSp
        const mz = moveVel.current.z / preMoveSp
        const faceX = Math.sin(rotation.current)
        const faceZ = Math.cos(rotation.current)
        const dotMove = ix * mx + iz * mz
        const dotFace = ix * faceX + iz * faceZ
        if (dotMove < -0.18 || dotFace < -0.25) {
          skipDirSmooth = true
          inputDir.current.x = ix
          inputDir.current.z = iz
          dirX = ix
          dirZ = iz
        }
      }
      if (!skipDirSmooth) {
        const dirSmooth = hasBallNow
          ? isUserActive
            ? sprint
              ? PLAYER_DIR_SMOOTH_DRIBBLE * 0.9
              : PLAYER_DIR_SMOOTH_DRIBBLE * 0.2
            : sprint
              ? PLAYER_DIR_SMOOTH_DRIBBLE_AI * 2.72
              : PLAYER_DIR_SMOOTH_DRIBBLE_AI * 3
          : isUserActive
            ? PLAYER_DIR_SMOOTH_CONTROLLED
            : markerPressing || passInterceptPressing
              ? PLAYER_DIR_SMOOTH_AI_PRESS
              : aiDirectMove.current
                ? PLAYER_DIR_SMOOTH_AI_DIRECT
                : PLAYER_DIR_SMOOTH_AI
        const smoothedDir = smoothDirection2D(inputDir.current, dirX, dirZ, dirSmooth, simDelta)
        inputDir.current.x = smoothedDir.x
        inputDir.current.z = smoothedDir.z
        if (rawDirLen > 0.02) {
          const smLen = Math.hypot(smoothedDir.x, smoothedDir.z)
          if (smLen > 0.02) {
            dirX = smoothedDir.x / smLen
            dirZ = smoothedDir.z / smLen
          }
        } else {
          const coastLen = Math.hypot(smoothedDir.x, smoothedDir.z)
          if (coastLen > 0.04) {
            dirX = smoothedDir.x / coastLen
            dirZ = smoothedDir.z / coastLen
            moveScale *= 0.88
          } else {
            dirX = 0
            dirZ = 0
          }
        }
      }
    }
    if (urgentMove && rawDirLen <= 0.02) {
      dirX = 0
      dirZ = 0
    }

    const intentLen = Math.hypot(dirX, dirZ)
    const preMoveSpeed = Math.hypot(moveVel.current.x, moveVel.current.z)

    const offBallLoco =
      isUserActive &&
      !hasBallNow &&
      !isGoalkeeper &&
      phase === 'playing' &&
      canMove &&
      !bodyActionLocked

    const dribbleEnabled =
      (hasBallNow || offBallLoco) &&
      !isGoalkeeper &&
      phase === 'playing' &&
      canMove &&
      !bodyActionLocked &&
      !shielding

    const dribbleOut = updatePlayerDribbleControl(id, {
      delta: simDelta,
      enabled: dribbleEnabled,
      sprint,
      dirX,
      dirZ,
      intentLen,
      rawDirX,
      rawDirZ,
      rawIntentLen: rawDirLen,
      speed: preMoveSpeed,
      rotation: rotation.current,
      moveVelX: moveVel.current.x,
      moveVelZ: moveVel.current.z,
      aiCarrier: !isUserActive && hasBallNow,
      offBallLoco,
    })
    dribbleCtrl.current = dribbleOut

    if (
      hasBallNow &&
      isUserActive &&
      controls?.current &&
      !storeState.shotChargeActive &&
      ctrl &&
      !ctrl.isLocked() &&
      storeState.phase !== 'free-kick' &&
      !storeState.ballFrozen
    ) {
      const spin = updatePlayerSkillSpin(
        id,
        controls.current.skillX,
        controls.current.skillZ,
        controls.current.moveX,
        controls.current.moveZ,
        simDelta,
        true,
      )
      if (spin.triggered) {
        ctrl.playSpin()
        useGameStore.getState().setStealImmunity(id, 900)
        trySkillMoveBeatPressers(id, 'spin')
        clearDribbleFeintRoll()
        spinElapsed.current = 0
        spinDuration.current = Math.max(0.35, ctrl.playbackDurationSec('player_spin'))
        const spd = Math.hypot(moveVel.current.x, moveVel.current.z)
        if (spd > 0.08) {
          spinBallDir.current.x = moveVel.current.x / spd
          spinBallDir.current.z = moveVel.current.z / spd
        } else {
          spinBallDir.current.x = Math.sin(rotation.current)
          spinBallDir.current.z = Math.cos(rotation.current)
        }
        dribbleBallOffset.current.x = 0
        dribbleBallOffset.current.z = 0
        dribbleTouchSeverity.current = 0
        const holder = registryEntry.current
        if (holder) {
          holder.dribbleSpinning = true
          holder.dribbleBallOffset = { x: 0, z: 0 }
          holder.dribbleTouchSeverity = 0
          holder.velocity.x = moveVel.current.x
          holder.velocity.z = moveVel.current.z
        }
      }
    }

    if (
      (dribbleOut.fintaStarted || dribbleOut.finta180Started) &&
      ctrl &&
      !ctrl.isLocked()
    ) {
      ctrl.playFinta180()
      if (hasBallNow) {
        // Janela blindada enquanto o giro acontece (player e IA)
        useGameStore.getState().setStealImmunity(id, 820)
        trySkillMoveBeatPressers(id, 'finta180')
        const px = dribbleOut.ballPushX
        const pz = dribbleOut.ballPushZ
        const pushLen = Math.hypot(px, pz)
        const pushSpeed = Math.max(
          dribbleOut.ballPushSpeed,
          Math.max(dribbleOut.feintMoveSpeed * 0.95, 2.4 * WORLD_SCALE),
        )
        if (pushLen > 0.01) {
          pushDribbleBallRoll(px, pz, pushSpeed)
        } else if (Math.hypot(dribbleOut.ballOffsetX, dribbleOut.ballOffsetZ) > 0.01) {
          pushDribbleBallRoll(dribbleOut.ballOffsetX, dribbleOut.ballOffsetZ, pushSpeed)
        }
      }
    } else if (dribbleOut.finta180Started && hasBallNow) {
      trySkillMoveBeatPressers(id, 'finta180')
    }

    // Corte em corrida: desvia jogo de corpo (player e IA)
    if (dribbleOut.runCutActive && !wasRunCut.current && hasBallNow) {
      useGameStore.getState().setStealImmunity(id, 640)
      trySkillMoveBeatPressers(id, 'cut')
    }
    wasRunCut.current = dribbleOut.runCutActive

    // Stick virtual da IA: meia-lua / corte = mesma imunidade da finta do player
    if (!isUserActive && hasBallNow) {
      const stickPhase = getAiDribbleStickPhase(id)
      const prev = aiStickPhasePrev.current
      if (stickPhase === 'arc') {
        useGameStore.getState().setStealImmunity(id, 280)
        if (prev !== 'arc') trySkillMoveBeatPressers(id, 'feint')
      } else if (stickPhase === 'cut' && prev !== 'cut') {
        useGameStore.getState().setStealImmunity(id, 720)
        trySkillMoveBeatPressers(id, 'cut')
      }
      aiStickPhasePrev.current = stickPhase
    } else {
      aiStickPhasePrev.current = null
    }

    wasStopFeint.current = dribbleOut.stopFeintActive

    // player_finta_01 desabilitada — corte 180 segue só na lógica de drible/loco

    if (dribbleOut.sprintBlocked) sprint = false

    if (ctrl?.isSpinning()) {
      // Tempo próprio — não depende do mixer (que só atualiza no fim do frame)
      spinElapsed.current += simDelta
      const t = THREE.MathUtils.clamp(
        spinElapsed.current / Math.max(spinDuration.current, 0.01),
        0,
        1,
      )
      // Pico CEDO (durante o giro), não no final
      let forwardPhase: number
      if (t < 0.58) {
        forwardPhase = t / 0.28
      } else if (t < 0.72) {
        forwardPhase = 1
      } else {
        forwardPhase = THREE.MathUtils.lerp(1, 0.35, (t - 0.72) / 0.28)
      }
      const pushDist = (0.08 + 1.22 * forwardPhase) * WORLD_SCALE
      dribbleBallOffset.current.x = spinBallDir.current.x * pushDist
      dribbleBallOffset.current.z = spinBallDir.current.z * pushDist
      dribbleTouchSeverity.current = 0
      const holderLive = registryEntry.current
      if (holderLive) {
        holderLive.dribbleSpinning = true
        holderLive.dribbleBallOffset = {
          x: dribbleBallOffset.current.x,
          z: dribbleBallOffset.current.z,
        }
      }
    } else {
      spinElapsed.current = 0
      dribbleBallOffset.current.x = dribbleOut.ballOffsetX
      dribbleBallOffset.current.z = dribbleOut.ballOffsetZ
      dribbleTouchSeverity.current = dribbleOut.touchSeverity
    }

    // Lean / pitch do tronco — segue a finta/corte com atraso de peso
    {
      const leanT = 1 - Math.exp(-(dribbleOut.stopFeintActive || dribbleOut.touchSeverity > 0.12 ? 14 : 9) * simDelta)
      bodyLean.current += (dribbleOut.bodyLean - bodyLean.current) * leanT
      bodyPitch.current += (dribbleOut.bodyPitch - bodyPitch.current) * leanT
      if (Math.abs(bodyLean.current) < 0.002) bodyLean.current = 0
      if (Math.abs(bodyPitch.current) < 0.002) bodyPitch.current = 0
    }

    if (isGoalkeeper && gkCtrl) {
      const gkState = getGkRuntime(id)
      const ball = ballRef.current

      if (
        gkState?.mode === 'distribute' &&
        tryGoalkeeperRelease(id) &&
        !gkDistribTriggered.current
      ) {
        gkDistribTriggered.current = true
        const intoField = getAttackSign(team, fieldBounds!)
        const ctx = getCarrierContext(id, role, fieldBounds!, ballRef.current)
        const mate = ctx ? findBestPassTarget(ctx) : null
        const mateDist = mate
          ? distance2D(position.current, mate.position)
          : 999
        const useFootKick = !mate || mateDist > 15

        const releaseDistribution = () => {
          let dx = 0
          let dz = intoField
          if (mate) {
            const n = normalize2D(
              mate.position.x - position.current.x,
              mate.position.z - position.current.z,
            )
            dx = n.x
            dz = n.z
          }
          const power = useFootKick ? 9.5 : 7.5
          const loft = useFootKick ? 0.42 : 0.32
          releaseBallFromFeet(dx * power, useFootKick ? 0.35 : 0.25, dz * power, id, {
            loft,
            releaseKind: 'pass',
          })
          finishGkDistribution(id)
          gkDistribTriggered.current = false
        }

        if (useFootKick) {
          gkCtrl.playFootKick(releaseDistribution)
        } else {
          gkCtrl.playHandPass(releaseDistribution)
        }
      } else if (gkState?.mode === 'hold' || hasBallNow) {
        const gkAnim = gkCtrl.getDisplayAnim()
        const needsHoldBlend =
          shouldGkBlendToHold(id) &&
          !gkCtrl.isSaving() &&
          gkAnim !== 'gk_idle_ball' &&
          gkAnim !== 'gk_catch'
        if (needsHoldBlend) {
          gkCtrl.blendToHoldBall()
        } else if (!gkCtrl.isSaving() && animFree) {
          const moveSpeed = Math.hypot(moveVel.current.x, moveVel.current.z)
          if (gkState?.mode === 'hold' && moveSpeed > 0.25) {
            gkCtrl.playLocomotion(moveSpeed > GK_SPEED * 0.85)
          } else {
            gkCtrl.forceIdleWithBall()
          }
        }
      } else if (
        gkState?.mode === 'save' &&
        gkState.saveKind === 'foot' &&
        !lastGkFootSave.current &&
        animFree
      ) {
        lastGkFootSave.current = true
        gkCtrl.playFootSave(undefined, () => {
          lastGkFootSave.current = false
          notifyGkSaveFinished(id)
        })
      } else if (
        gkState?.saveAnim &&
        (gkState.saveAnim !== lastGkSaveAnim.current || !gkCtrl.isSaving())
      ) {
        lastGkSaveAnim.current = gkState.saveAnim
        gkCtrl.playSave(gkState.saveAnim, () => {
          lastGkSaveAnim.current = null
          notifyGkSaveFinished(id)
        })
      } else if (gkState?.mode === 'idle' && animFree && !gkCtrl.isSaving()) {
        // Sem corrida “de linha” parado — idle de goleiro
        const moveSpeed = Math.hypot(moveVel.current.x, moveVel.current.z)
        if (moveSpeed > 0.35) {
          gkCtrl.playLocomotion(moveSpeed > GK_SPEED * 0.9)
        } else {
          gkCtrl.forceIdle()
        }
      }

      const faceTarget =
        gkState?.faceAngle ??
        clampGkFacing(team, fieldBounds!, position.current, ball)
      if (!gkCtrl.isSaving() && !gkCtrl.isBodyLocked()) {
        rotation.current = rotateTowardAngle(
          rotation.current,
          faceTarget,
          GK_TURN_SPEED,
          simDelta,
        )
      }
    }

    const gkRt = getGkRuntime(id)
    const ballLow = ballRef.current.y < GK_FEET_CLAIM_MAX_HEIGHT + 0.55
    const interceptDist = gkRt?.interceptTarget
      ? distance2D(position.current, {
          x: gkRt.interceptTarget.x,
          y: 0,
          z: gkRt.interceptTarget.z,
        })
      : 0
    const duelSpeedMul =
      shotAimActive || shotChargeWindUp
        ? 1
        : getPhysicalDuelSpeedMul(id)
    const duelDecelMul =
      shotAimActive || shotChargeWindUp
        ? 1
        : getPhysicalDuelDecelMul(id)
    const inPhysicalDuel =
      shotAimActive || shotChargeWindUp ? false : isInPhysicalDuel(id)
    const staminaSpeedMul = getStaminaSpeedMul(id)
    const attrMuls = getPlayerAttrMultipliers(id)

    // Sem fôlego: corta sprint (urgência = interceptação / bola solta perto)
    const sprintUrgent =
      passInterceptPressing ||
      needsAutoReceiveRun ||
      autoFirstTimeRun ||
      anticipatedShotRun ||
      (markerPressing && distToHolderEarly < 0.85)
    if (sprint && !isGoalkeeper && !canPlayerSprint(id, sprintUrgent)) {
      sprint = false
    }

    const speed = isGoalkeeper
      ? gkRt?.mode === 'save' && gkRt.saveAnim
        ? 0
        : ballLow
          ? GK_SPEED * 0.92 * attrMuls.pace
          : interceptDist > 2.4
            ? GK_RUSH_SPEED * 1.08 * attrMuls.pace
            : GK_SPEED * 1.12 * attrMuls.pace
      : dribbleOut.stopFeintActive && intentLen > 0.02
        ? Math.max(dribbleOut.feintMoveSpeed, PLAYER_SPEED * 0.78) * attrMuls.pace
        : (sprint ? PLAYER_SPRINT_SPEED : PLAYER_SPEED) *
          dribbleOut.speedMul *
          duelSpeedMul *
          staminaSpeedMul *
          attrMuls.pace

    // Candidato a passe: peito na bola (strafe/costas ao se mover)
    const teammateHasBall =
      !isGoalkeeper &&
      currentPoss != null &&
      currentPoss.team === team &&
      currentPoss.playerId !== id
    const distBallForAttend = distance2D(position.current, ballRef.current)
    const passCandidateAttend =
      teammateHasBall &&
      phase === 'playing' &&
      !hasBallNow &&
      !receivingPass &&
      !needsAutoReceiveRun &&
      !autoFirstTimeRun &&
      !anticipatedShotRun &&
      !(markerPressing || passInterceptPressing) &&
      distBallForAttend < PASS_CANDIDATE_ATTENTION_DIST

    let moveSpeed = speed
    let candidateSprint = sprint
    if (passCandidateAttend && intentLen > 0.02 && !bodyActionLocked) {
      const bx = ballRef.current.x - position.current.x
      const bz = ballRef.current.z - position.current.z
      const bLen = Math.hypot(bx, bz)
      if (bLen > 0.2) {
        const faceX = bx / bLen
        const faceZ = bz / bLen
        const mx = dirX / intentLen
        const mz = dirZ / intentLen
        const towardBall = mx * faceX + mz * faceZ
        if (towardBall < -0.2) {
          moveSpeed *= PASS_CANDIDATE_BACKPEDAL_SPEED
          candidateSprint = false
        } else if (towardBall < 0.45) {
          moveSpeed *= PASS_CANDIDATE_SIDE_SPEED
        }
      }
    }
    sprint = candidateSprint

    // Ofegante: animação só walk — sem flip run/walk
    const animSprint = sprint && !inPhysicalDuel && !isSprintWinded(id)

    const targetVelX = intentLen > 0.02 && !bodyActionLocked ? (dirX / intentLen) * moveSpeed * moveScale : 0
    const targetVelZ = intentLen > 0.02 && !bodyActionLocked ? (dirZ / intentLen) * moveSpeed * moveScale : 0
    const accelerating = intentLen > 0.02 && !bodyActionLocked

    if (dribbleOut.stopFeintActive && intentLen > 0.02 && !bodyActionLocked) {
      // Plant: mais inércia no impulso antigo; pivot/drive mistura com o stick
      const plantHeavy = dribbleOut.feintKeepRun ? 0.38 : 0.62
      const carry = Math.max(
        preMoveSpeed * (0.78 + plantHeavy * 0.14),
        dribbleOut.feintMoveSpeed,
        PLAYER_SPEED * 0.55,
      )
      const faceYaw = dribbleOut.forcedYaw ?? rotation.current
      const fx = Math.sin(faceYaw)
      const fz = Math.cos(faceYaw)
      const oldW = plantHeavy
      const newW = 1 - oldW
      moveVel.current.x = fx * carry * oldW + dirX * carry * newW
      moveVel.current.z = fz * carry * oldW + dirZ * carry * newW
    } else if (receiveRunState.current.directVel && !userCrossReceiveControl) {
      const rs = receiveRunState.current
      if (rs.hardStop || bodyActionLocked) {
        moveVel.current.x = 0
        moveVel.current.z = 0
      } else {
        // Snap na bola — sem smoothVelocity (era o saracoteio)
        moveVel.current.x = rs.dirX * rs.targetSpeed
        moveVel.current.z = rs.dirZ * rs.targetSpeed
      }
    } else {
      const receiveApproach = receiveRunState.current
      const receiveNear =
        urgentMove && receiveApproach.approachDist < 2.4 && !receiveApproach.hardStop
      const decelMul = receiveApproach.hardStop
        ? 3.6
        : receiveNear
          ? 2.1
          : urgentMove
            ? 1.35
            : 1
      // Peso só com bola nos pés; off-ball (IA incluso) = snappy
      const weightedLoco = hasBallNow
      const nextVel = smoothVelocity2D(
        moveVel.current,
        targetVelX,
        targetVelZ,
        simDelta,
        accelerating,
        weightedLoco
          ? PLAYER_MOVE_DECEL_DRIBBLE * duelDecelMul
          : fieldLoco
            ? isUserActive
              ? PLAYER_MOVE_DECEL * decelMul * duelDecelMul
              : markerPressing || passInterceptPressing
                ? PLAYER_MOVE_DECEL_AI * 0.92
                : PLAYER_MOVE_DECEL_AI * decelMul * duelDecelMul
            : PLAYER_MOVE_DECEL_AI * duelDecelMul,
        weightedLoco
          ? isUserActive
            ? sprint
              ? PLAYER_MOVE_ACCEL_DRIBBLE * 0.95 * attrMuls.acceleration
              : PLAYER_MOVE_ACCEL_DRIBBLE * attrMuls.acceleration
            : sprint
              ? PLAYER_MOVE_ACCEL_DRIBBLE * 0.9 * attrMuls.acceleration
              : PLAYER_MOVE_ACCEL_DRIBBLE * 0.98 * attrMuls.acceleration
          : fieldLoco
            ? isUserActive
              ? urgentMove
                ? PLAYER_MOVE_ACCEL * 1.2 * attrMuls.acceleration
                : PLAYER_MOVE_ACCEL * attrMuls.acceleration
              : markerPressing
                ? PLAYER_MOVE_ACCEL_AI * 1.18 * attrMuls.acceleration
                : passInterceptPressing
                  ? PLAYER_MOVE_ACCEL_AI * 1.12 * attrMuls.acceleration
                  : PLAYER_MOVE_ACCEL_AI * (urgentMove ? 1.08 : 1) * attrMuls.acceleration
            : PLAYER_MOVE_ACCEL_AI * attrMuls.acceleration,
        weightedLoco,
      )
      moveVel.current.x = nextVel.x
      moveVel.current.z = nextVel.z
      if (receiveApproach.hardStop) {
        const stopBlend = 1 - Math.exp(-8.5 * simDelta)
        moveVel.current.x *= 1 - stopBlend
        moveVel.current.z *= 1 - stopBlend
        if (Math.hypot(moveVel.current.x, moveVel.current.z) < 0.12) {
          moveVel.current.x = 0
          moveVel.current.z = 0
        }
      }
    }

    if (userCrossReceiveControl && intentLen <= 0.02 && !bodyActionLocked) {
      const stopBlend = 1 - Math.exp(-14 * simDelta)
      moveVel.current.x *= 1 - stopBlend
      moveVel.current.z *= 1 - stopBlend
      if (Math.hypot(moveVel.current.x, moveVel.current.z) < 0.08) {
        moveVel.current.x = 0
        moveVel.current.z = 0
      }
    }

    // Planta só em jockey lento (marcação). Em corrida pra bola: NÃO plantar — isso vira skate de lado.
    if (
      phase === 'playing' &&
      !hasBallNow &&
      !isGoalkeeper &&
      !bodyActionLocked &&
      !isPlayerSliding(id) &&
      !needsAutoReceiveRun &&
      !receivingPass
    ) {
      const distBallPlant = distance2D(position.current, ballRef.current)
      const speedNow = Math.hypot(moveVel.current.x, moveVel.current.z)
      if (distBallPlant < BALL_ATTENTION_DIST && speedNow < PLAYER_SPEED * 0.55) {
        const faceYaw = getBallFocusFacing(
          position.current,
          ballRef.current,
          rotation.current,
          0.18,
        )
        const yawErr = Math.abs(shortestAngleDelta(rotation.current, faceYaw))
        if (yawErr > 0.7) {
          const planted = plantVelocityForYawError(moveVel.current, yawErr * 0.65, simDelta)
          moveVel.current.x = planted.x
          moveVel.current.z = planted.z
        }
      }
    }

    let moveX = moveVel.current.x * simDelta
    let moveZ = moveVel.current.z * simDelta
    const knock = consumeBodyChargeKnock(id)
    if (knock) {
      moveVel.current.x += knock.x
      moveVel.current.z += knock.z
      moveX += knock.x * simDelta
      moveZ += knock.z * simDelta
    }
    const actualSpeed = Math.hypot(moveVel.current.x, moveVel.current.z)
    const projectedMove = actualSpeed * simDelta

    if (isGoalkeeper && gkCtrl && animFree && !gkCtrl.isSaving()) {
      const gkStateNow = getGkRuntime(id)
      // Nunca loco de linha durante save — era o “desliza como idiota”
      if (gkStateNow?.mode === 'idle') {
        if (actualSpeed > 0.16) {
          gkCtrl.playLocomotion(actualSpeed > GK_SPEED * 0.68)
        } else {
          gkCtrl.forceIdle()
        }
      }
    }

    const isMarking =
      (!userManualOnly && pressAsMarker) ||
      manMarkingActive ||
      (opponentHasBall &&
        !hasBallNow &&
        !isPassParticipant &&
        (isTeamMarker(id, team, currentPoss, ballRef.current) ||
          (isCoverPresser(id, team) && preMoveSpeed < 1.85)))

    const receiveWaiting =
      receivingPass &&
      !userCrossReceiveControl &&
      !userManualOnly &&
      receiveRunState.current.hardStop &&
      passIntent?.passType === 'pass'

    const holdingPosition =
      intentLen < 0.04 &&
      preMoveSpeed < 0.15 &&
      (!receivingPass || receiveWaiting) &&
      !hasBallNow

    const chasingBallToSteal = markerPressing || passInterceptPressing

    const ball = ballRef.current
    const distToBallNow = distance2D(position.current, ball)

    // Corrida pura pra bola: peito no movimento (receive / first-time)
    const chaseRun =
      !passCandidateAttend &&
      (needsAutoReceiveRun ||
        receivingPass ||
        autoFirstTimeRun ||
        anticipatedShotRun)

    // Perto da bola sem posse: peito na bola só em jockey/marcação (não Be a Pro forçado)
    const faceBallOffBall =
      !hasBallNow &&
      phase === 'playing' &&
      !isGoalkeeper &&
      !ctrl?.isStriking() &&
      !isPlayerSliding(id) &&
      !chaseRun &&
      !animSprint &&
      distToBallNow < BALL_ATTENTION_DIST * 1.4

    // Jockey: peito na bola + strafe — marcação OU candidato a receber
    const jockeyBall =
      faceBallOffBall &&
      (passCandidateAttend ||
        isMarking ||
        (!userManualOnly && pressAsMarker) ||
        manMarkingActive ||
        chasingBallToSteal ||
        (actualSpeed < PLAYER_SPEED * 0.55 && intentLen < 0.55))

    // Sem bola: loco relativo ao peito (frente/lado/trás)
    const useStrafeLoco =
      !hasBallNow &&
      !isGoalkeeper &&
      !receiveWaiting &&
      (intentLen > 0.02 ||
        locoMoving.current ||
        actualSpeed > RUN_STOP_THRESHOLD ||
        projectedMove > RUN_STOP_THRESHOLD)

    if (
      !isGoalkeeper &&
      !bodyActionLocked &&
      !shielding
    ) {
      if (strikeWarpYaw.current != null) {
        tickStrikeWarp(simDelta)
      }

      let targetYaw = rotation.current
      if (dribbleOut.forcedYaw != null) {
        targetYaw = dribbleOut.forcedYaw
      } else if (strikeWarpYaw.current != null) {
        targetYaw = rotation.current
      } else if (aiPendingShot.current) {
        targetYaw = Math.atan2(aiPendingShot.current.x, aiPendingShot.current.z)
      } else if (
        hasCrossVolleyIntent(id) &&
        passIntent?.passType === 'cross' &&
        storeState.pendingUserShot
      ) {
        targetYaw = Math.atan2(
          storeState.pendingUserShot.dirX,
          storeState.pendingUserShot.dirZ,
        )
      } else if (aiPassLook.current && hasBallNow && !isUserActive) {
        targetYaw = Math.atan2(aiPassLook.current.x, aiPassLook.current.z)
      } else if (hasBallNow && !isUserActive && aiHoldUpLook.current) {
        targetYaw = Math.atan2(aiHoldUpLook.current.x, aiHoldUpLook.current.z)
      } else if (jockeyBall || passCandidateAttend) {
        targetYaw = getBallFocusFacing(position.current, ball, rotation.current, 0.18)
      } else if (ctrl?.locksFacing()) {
        targetYaw = getBallFocusFacing(position.current, ball, rotation.current)
      } else if (
        (receivingPass || needsAutoReceiveRun) &&
        intentLen > 0.02
      ) {
        // Passe a caminho: peito na corrida (sem girar pra “frente da formação”)
        targetYaw = Math.atan2(dirX, dirZ)
      } else if (holdingPosition) {
        targetYaw = passCandidateAttend
          ? getBallFocusFacing(position.current, ball, rotation.current, 0.18)
          : rotation.current
      } else if ((shotAimActive || shotChargeWindUp) && hasBallNow) {
        // Wind-up: peito na corrida travada — mira é só a seta
        if (shotChargeWindUp && shotRunLockRef.current) {
          targetYaw = Math.atan2(shotRunLockRef.current.x, shotRunLockRef.current.z)
        } else {
          const moveLen = Math.hypot(moveVel.current.x, moveVel.current.z)
          const runLen = Math.hypot(dirX, dirZ)
          if (moveLen > 0.08) {
            targetYaw = Math.atan2(moveVel.current.x, moveVel.current.z)
          } else if (runLen > 0.02) {
            targetYaw = Math.atan2(dirX, dirZ)
          } else if (storeState.strikeAim) {
            targetYaw = Math.atan2(
              storeState.strikeAim.dirX,
              storeState.strikeAim.dirZ,
            )
          }
        }
      } else if (shotLockActive) {
        const turnLen = Math.hypot(dirX, dirZ)
        if (turnLen > 0.001) {
          targetYaw = Math.atan2(dirX, dirZ)
        }
      } else if (
        intentLen > 0.02 &&
        (locoMoving.current || actualSpeed > RUN_STOP_THRESHOLD || projectedMove > RUN_STOP_THRESHOLD)
      ) {
        targetYaw = facingFromMovement(
          moveVel.current.x,
          moveVel.current.z,
          dirX,
          dirZ,
          rotation.current,
          hasBallNow,
        )
      }

      const baseTurn = dribbleOut.forcedYaw != null
        ? PLAYER_TURN_SPEED_CONTROLLED * dribbleOut.turnRateMul
        : jockeyBall || passCandidateAttend
          ? PLAYER_TURN_SPEED_BALL_FOCUS * (passCandidateAttend ? 1.35 : 1.15)
        : receivingPass || needsAutoReceiveRun
          ? PLAYER_TURN_SPEED_CONTROLLED * 2.1
        : shotAimActive || shotChargeWindUp
          ? PLAYER_TURN_SPEED_CONTROLLED * 1.05
        : shotLockActive
          ? PLAYER_TURN_SPEED_CONTROLLED * 0.55
          : !hasBallNow
            ? PLAYER_TURN_SPEED_CONTROLLED * 1.25
          : fieldLoco
            ? PLAYER_TURN_SPEED_CONTROLLED *
              (sprint ? 0.72 : 1.05) *
              (0.85 + dribbleOut.turnRateMul * 0.28)
            : PLAYER_TURN_SPEED_AI
      const attrTurn = isGoalkeeper ? baseTurn : baseTurn * attrMuls.agility
      if (strikeWarpYaw.current != null) {
        // tickStrikeWarp já ajustou o corpo para o chute/passe
      } else if (dribbleOut.forcedYaw != null) {
        rotation.current = applyPlayerFacing(
          rotation.current,
          dribbleOut.forcedYaw,
          attrTurn,
          actualSpeed,
          speed,
          true,
          simDelta,
          true,
        )
      } else if (receivingPass || needsAutoReceiveRun) {
        rotation.current = rotateTowardAngle(
          rotation.current,
          targetYaw,
          PLAYER_TURN_SPEED_CONTROLLED * 2.1,
          simDelta,
        )
      } else if (jockeyBall || passCandidateAttend) {
        rotation.current = rotateTowardAngle(
          rotation.current,
          targetYaw,
          PLAYER_TURN_SPEED_BALL_FOCUS * (passCandidateAttend ? 1.35 : 1.15),
          simDelta,
        )
      } else if (fieldLoco && hasBallNow) {
        rotation.current = applyPlayerFacing(
          rotation.current,
          targetYaw,
          attrTurn,
          actualSpeed,
          speed,
          true,
          simDelta,
          true,
        )
      } else if (
        fieldLoco &&
        isUserActive &&
        !hasBallNow &&
        intentLen > 0.02
      ) {
        rotation.current = applyPlayerFacing(
          rotation.current,
          Math.atan2(dirX, dirZ),
          attrTurn,
          actualSpeed,
          speed,
          true,
          simDelta,
          false,
        )
      } else {
        rotation.current = applyPlayerFacing(
          rotation.current,
          targetYaw,
          attrTurn,
          actualSpeed,
          speed,
          isUserActive,
          simDelta,
          hasBallNow,
        )
      }
    }

    if (bodyActionLocked) {
      moveX = 0
      moveZ = 0
      moveVel.current.x = 0
      moveVel.current.z = 0
    } else if (ctrl?.isStriking()) {
      const strikeMul = ctrl.getStrikeMoveMultiplier()
      moveX *= strikeMul
      moveZ *= strikeMul
      moveVel.current.x *= strikeMul
      moveVel.current.z *= strikeMul
    } else if (ctrl?.isSpinning()) {
      const spinMul = ctrl.getSpinMoveMultiplier()
      moveX *= spinMul
      moveZ *= spinMul
      moveVel.current.x *= spinMul
      moveVel.current.z *= spinMul
    }

    const prevX = position.current.x
    const prevZ = position.current.z
    let nx = position.current.x + moveX
    let nz = position.current.z + moveZ
    nx = THREE.MathUtils.clamp(nx, fieldBounds.minX + PLAYER_RADIUS, fieldBounds.maxX - PLAYER_RADIUS)
    nz = THREE.MathUtils.clamp(nz, fieldBounds.minZ + PLAYER_RADIUS, fieldBounds.maxZ - PLAYER_RADIUS)

    if (isGoalkeeper) {
      const maxDepth =
        gkRt?.allowStep && gkRt.mode === 'save' ? gkRt.stepDepth : GK_MAX_STEP_FROM_LINE
      const clamped = clampGkPosition({ x: nx, y: 0, z: nz }, team, fieldBounds, maxDepth)
      nx = clamped.x
      nz = clamped.z
    }

    // Colisão física corpo↔corpo (IA e humano, com ou sem bola)
    // Corte 180 / finta: sem colisão — senão trava a virada
    const skippingBodyCollision =
      bodyActionLocked ||
      (ctrl?.isFinting() ?? false) ||
      dribbleOut.stopFeintActive
    if (phase === 'playing' && !ballFrozen && !skippingBodyCollision) {
      const bodyHit = resolvePlayerBodyCollisions(
        id,
        { x: nx, z: nz },
        moveVel.current,
        simDelta,
      )
      nx = bodyHit.x
      nz = bodyHit.z
      moveVel.current.x = bodyHit.vx
      moveVel.current.z = bodyHit.vz
      if (bodyHit.contested) {
        registerBodyContactDuel(
          id,
          bodyHit.opponentId,
          bodyHit.contactImpulse,
          bodyHit.contested,
        )
      }
      nx = THREE.MathUtils.clamp(nx, fieldBounds.minX + PLAYER_RADIUS, fieldBounds.maxX - PLAYER_RADIUS)
      nz = THREE.MathUtils.clamp(nz, fieldBounds.minZ + PLAYER_RADIUS, fieldBounds.maxZ - PLAYER_RADIUS)
      if (isGoalkeeper) {
        const maxDepth =
          gkRt?.allowStep && gkRt.mode === 'save' ? gkRt.stepDepth : GK_MAX_STEP_FROM_LINE
        const clamped = clampGkPosition({ x: nx, y: 0, z: nz }, team, fieldBounds, maxDepth)
        nx = clamped.x
        nz = clamped.z
      }
    }

    const moved = Math.hypot(nx - prevX, nz - prevZ)

    position.current.set(nx, 0, nz)
    bodyRef.current.setNextKinematicTranslation({ x: nx, y: getPlayerBodyY(), z: nz })
    if (modelRootRef.current) {
      modelRootRef.current.rotation.y = rotation.current
      // Inclinação de tronco — vender peso da finta (estilo FIFA/PES)
      const leanAmp = 0.42
      const pitchAmp = 0.28
      modelRootRef.current.rotation.z = THREE.MathUtils.lerp(
        modelRootRef.current.rotation.z,
        -bodyLean.current * leanAmp,
        1 - Math.exp(-16 * simDelta),
      )
      modelRootRef.current.rotation.x = THREE.MathUtils.lerp(
        modelRootRef.current.rotation.x,
        bodyPitch.current * pitchAmp,
        1 - Math.exp(-14 * simDelta),
      )
    }

    if (canUpdateLocoAnim) {
      if (shielding) {
        locoMoving.current = false
        wasRunLoco.current = false
        ctrl?.forceIdle()
        velocity.current.set(0, 0, 0)
        moveVel.current.x = 0
        moveVel.current.z = 0
      } else if (ctrl?.isRunStopping()) {
        locoMoving.current = false
        wasRunLoco.current = false
        velocity.current.set(0, 0, 0)
        moveVel.current.x = 0
        moveVel.current.z = 0
      } else {
        if (receiveWaiting || holdingPosition) {
          locoMoving.current = false
          wasRunLoco.current = false
        } else {
          const wantsRun =
            !bodyActionLocked &&
            (moved > RUN_START_THRESHOLD ||
              actualSpeed > RUN_STOP_THRESHOLD * 2 ||
              (intentLen > 0.04 && projectedMove > RUN_STOP_THRESHOLD * 1.2))
          if (wantsRun) {
            locoMoving.current = true
          } else if (dribbleOut.stopFeintActive && intentLen > 0.02) {
            locoMoving.current = true
          } else if (
            intentLen < 0.015 &&
            moved < RUN_STOP_THRESHOLD &&
            actualSpeed < 0.12
          ) {
            locoMoving.current = false
          }
        }

        if (locoMoving.current) {
          wasRunLoco.current = true
          ctrl?.exitFieldIdle()
          if (ctrl?.isFinting() || ctrl?.isImbalancing() || ctrl?.isSpinning()) {
            // root-motion / spin — não sobrescreve a clip
          } else if (dribbleOut.touchAnim) {
            ctrl?.playDribbleTouch(dribbleOut.touchAnim, dribbleOut.touchDuration)
          } else if (dribbleOut.locomotionOverride && hasBallNow) {
            const override = dribbleOut.locomotionOverride
            const local =
              override === 'player_backward'
                ? { localForward: -1, localRight: 0 }
                : override === 'player_left'
                  ? { localForward: 0.15, localRight: -1 }
                  : { localForward: 0.15, localRight: 1 }
            ctrl?.setCarrierLocomotion({
              moving: true,
              sprint: false,
              localForward: local.localForward,
              localRight: local.localRight,
            })
          } else if (hasBallNow) {
            const local = worldToLocalMovement(dirX, dirZ, rotation.current)
            const carrierSprint =
              animSprint ||
              (dribbleOut.stopFeintActive &&
                dribbleOut.feintKeepRun &&
                !inPhysicalDuel)
            ctrl?.setCarrierLocomotion({
              moving: true,
              sprint: carrierSprint,
              localForward: local.localForward,
              localRight: local.localRight,
            })
          } else if (useStrafeLoco) {
            const moveLen = Math.hypot(moveVel.current.x, moveVel.current.z)
            const local = worldToLocalMovement(
              moveLen > 0.08 ? moveVel.current.x : dirX,
              moveLen > 0.08 ? moveVel.current.z : dirZ,
              rotation.current,
            )
            // Lado/costas: sem sprint — só run pra frente
            const canSprintAnim =
              animSprint && local.localForward > 0.35 && Math.abs(local.localRight) < local.localForward
            ctrl?.setStrafeLocomotion({
              moving: true,
              sprint: canSprintAnim,
              localForward: local.localForward,
              localRight: local.localRight,
            })
          } else {
            // Fallback raro (GK etc.)
            ctrl?.setDirectLocomotion({ moving: true, sprint: animSprint })
          }
          velocity.current.set(moveVel.current.x, 0, moveVel.current.z)
        } else if (receiveWaiting || holdingPosition) {
          wasRunLoco.current = false
          ctrl?.enterFieldIdle()
          velocity.current.set(0, 0, 0)
        } else {
          // Parou por completo → run_stop antes do idle
          ctrl?.exitFieldIdle()
          const canPlayStop =
            wasRunLoco.current &&
            ctrl &&
            !ctrl.isLocked() &&
            !ctrl.isShoulderCharging() &&
            !ctrl.isFinting() &&
            !ctrl.isImbalancing() &&
            !ctrl.isStriking()
          if (canPlayStop) {
            ctrl.playRunStop()
          } else if (!ctrl?.isShoulderCharging() && !ctrl?.isRunStopping()) {
            ctrl?.setDirectLocomotion({ moving: false, sprint: false })
          }
          wasRunLoco.current = false
          velocity.current.set(0, 0, 0)
        }
      }
    } else if (bodyActionLocked) {
      velocity.current.set(0, 0, 0)
      moveVel.current.x = 0
      moveVel.current.z = 0
    }

    syncRegistry(
      { x: nx, z: nz },
      {
        velocity: { x: velocity.current.x, y: 0, z: velocity.current.z },
        isSprinting: animSprint && locoMoving.current && !shielding,
        dribbleBallOffset: hasBallNow
          ? { x: dribbleBallOffset.current.x, z: dribbleBallOffset.current.z }
          : undefined,
        dribbleTouchSeverity: hasBallNow ? dribbleTouchSeverity.current : undefined,
        dribbleSpinning: hasBallNow && (ctrl?.isSpinning() ?? false),
      },
    )

    if (phase === 'playing' && !ballFrozen && !isGoalkeeper) {
      // Sprint de stamina: user = botão. IA = só pressão/caça/com bola.
      // (IA sprintava só pra chegar no posto tático e a barra nunca subia)
      const staminaSprint = isUserActive
        ? !!(animSprint && locoMoving.current && !shielding)
        : !!(
            animSprint &&
            locoMoving.current &&
            !shielding &&
            (markerPressing ||
              passInterceptPressing ||
              hasBallNow ||
              receivingPass ||
              autoFirstTimeRun ||
              anticipatedShotRun ||
              crossVolleyChase ||
              shouldAutoChaseLooseBall(id, team))
          )
      tickPlayerStamina(id, simDelta, {
        sprinting: staminaSprint,
        pressing: !!(markerPressing || passInterceptPressing),
        shoulderCharging: ctrl?.isShoulderCharging() ?? false,
        inDuel: inPhysicalDuel,
        hasBall: hasBallNow,
        moving: locoMoving.current || Math.hypot(moveVel.current.x, moveVel.current.z) > 0.2,
        sliding: isPlayerSliding(id),
      })
    }
    } finally {
      finishAnimation()
    }
  })

  function isHoldingBall(): boolean {
    return useGameStore.getState().ballPossession?.playerId === id
  }

  function getAIMove(delta: number): {
    dirX: number
    dirZ: number
    sprint: boolean
    urgency: number
    direct: boolean
  } {
    const store = useGameStore.getState()
    const poss = store.ballPossession
    const lastTouch = store.lastTouchTeam
    const ball = ballRef.current
    const ballVel = ballRef.velocity
    const bounds = fieldBounds!
    const predicted = predictBallPosition(ball, ballVel)

    if (store.phase === 'goal-kick' && store.ballFrozen && store.setPieceTeam) {
      if (isGoalkeeper && id === store.setPieceKickerId) {
        return { dirX: 0, dirZ: 0, sprint: false, urgency: 0, direct: false }
      }
      const pushTarget = getGoalKickPushTarget(
        team,
        formation,
        bounds,
        store.setPieceTeam,
      )
      tacticalTarget.current = smoothToward(tacticalTarget.current, pushTarget, delta, 2.2)
      return { ...moveToward(tacticalTarget.current, true, -1), direct: false }
    }

    if (
      (store.phase === 'throw-in' || store.phase === 'corner' || store.phase === 'penalty') &&
      store.ballFrozen &&
      store.setPieceTeam &&
      store.setPiecePosition
    ) {
      if (id === store.setPieceKickerId) {
        return { dirX: 0, dirZ: 0, sprint: false, urgency: 0, direct: false }
      }
      const setupTarget =
        store.phase === 'penalty'
          ? getSetPiecePlayerSpot(
              id,
              team,
              formation,
              bounds,
              store.phase,
              store.setPieceTeam,
              store.setPiecePosition,
              store.setPieceKickerId,
              store.setPieceAimAngle,
            )
          : store.phase === 'throw-in'
          ? getThrowInSetupTarget(
              team,
              formation,
              bounds,
              store.setPieceTeam,
              store.setPiecePosition,
              id,
              store.setPieceKickerId,
              store.setPieceAimAngle,
            )
          : getCornerSetupTarget(
              team,
              formation,
              bounds,
              store.setPieceTeam,
              store.setPiecePosition,
              id,
              store.setPieceKickerId,
              store.setPieceAimAngle,
            )
      tacticalTarget.current = smoothToward(tacticalTarget.current, setupTarget, delta, 2.2)
      return { ...moveToward(tacticalTarget.current, true, -1), direct: false }
    }

    const phase = getTeamPhase(team, poss, lastTouch)

    if (isGoalkeeper) {
      return { ...getGoalkeeperMove(poss, predicted, delta), direct: true }
    }

    if (isHoldingBall()) {
      if (aiPendingShot.current) {
        return { dirX: 0, dirZ: 0, sprint: false, urgency: 0, direct: true }
      }

      const pendingPass = aiPendingPass.current
      if (pendingPass) {
        const now = performance.now()
        const ctx = getCarrierContext(id, role, bounds, ball)
        if (now < pendingPass.carryUntil && ctx) {
          const intent = getCarrierMoveIntent(ctx, phase)
          const call = useGameStore.getState().ballCall
          const prepCaller =
            call && call.callerId === pendingPass.targetId
              ? playerRegistry.get(call.callerId)
              : null
          const prep =
            prepCaller && prepCaller.team === team
              ? getBallCallPrepMoveDir(ctx, prepCaller)
              : null
          const dirX = prep ? prep.x * 0.55 + intent.dirX * 0.45 : intent.dirX
          const dirZ = prep ? prep.z * 0.55 + intent.dirZ * 0.45 : intent.dirZ
          const dLen = Math.hypot(dirX, dirZ) || 1
          aiHoldUpLook.current = intent.lookDir
          return {
            dirX: dirX / dLen,
            dirZ: dirZ / dLen,
            sprint: intent.sprint || !!prep,
            urgency: intent.sprint || prep ? 1.05 : intent.holdUp ? 0.88 : 0.92,
            direct: false,
          }
        }

        if (aiPassLook.current) {
          aiHoldUpLook.current = aiPassLook.current
        }
        // Fase de mira: quase planta — só ajusta peito pro alvo
        if (ctx) {
          const look = aiPassLook.current
          if (look && Math.hypot(look.x, look.z) > 0.08) {
            const dLen = Math.hypot(look.x, look.z) || 1
            return {
              dirX: look.x / dLen,
              dirZ: look.z / dLen,
              sprint: false,
              urgency: 0.35,
              direct: true,
            }
          }
          return { dirX: 0, dirZ: 0, sprint: false, urgency: 0, direct: true }
        }
         return { dirX: 0, dirZ: 0, sprint: false, urgency: 0, direct: true }
      }

      // Pedido de bola ativo: prepara ângulo / foge da marcação antes de passar
      const ballCallPrep = useGameStore.getState().ballCall
      if (
        ballCallPrep &&
        performance.now() < ballCallPrep.until &&
        ballCallPrep.callerId !== id
      ) {
        const ctx = getCarrierContext(id, role, bounds, ball)
        const caller = playerRegistry.get(ballCallPrep.callerId)
        if (ctx && caller && caller.team === team) {
          const delivery = evaluateBallCallDelivery(ctx, caller)
          if (!delivery.ready) {
            const prep = getBallCallPrepMoveDir(ctx, caller)
            const intent = getCarrierMoveIntent(ctx, phase)
            if (prep) {
              aiHoldUpLook.current = {
                x: caller.position.x - position.current.x,
                z: caller.position.z - position.current.z,
              }
              return {
                dirX: prep.x,
                dirZ: prep.z,
                sprint: delivery.underPressure,
                urgency: delivery.heavyPressure ? 1.08 : 1.0,
                direct: false,
              }
            }
            aiHoldUpLook.current = intent.lookDir
            return {
              dirX: intent.dirX,
              dirZ: intent.dirZ,
              sprint: intent.sprint,
              urgency: intent.sprint ? 1.02 : 0.94,
              direct: false,
            }
          }
        }
      }

      const ctx = getCarrierContext(id, role, bounds, ball)
      if (
        ctx &&
        !(
          !isGoalkeeper &&
          team === getUserTeam() &&
          useGameStore.getState().activePlayerId === id
        )
      ) {
        const intent = getCarrierMoveIntent(ctx, phase)
        aiHoldUpLook.current = intent.lookDir
        return {
          dirX: intent.dirX,
          dirZ: intent.dirZ,
          sprint: intent.sprint,
          urgency: intent.sprint ? 1.02 : intent.holdUp ? 0.88 : 0.96,
          direct: false,
        }
      }

      aiHoldUpLook.current = null

      // Fallback raro: ainda suaviza como drible de stick
      if (ctx) {
        const intent = getCarrierMoveIntent(ctx, phase)
        return {
          dirX: intent.dirX,
          dirZ: intent.dirZ,
          sprint: intent.sprint,
          urgency: intent.sprint ? 1.0 : 0.94,
          direct: false,
        }
      }
      const raw = getCarrierTarget(team, formation, bounds, ball)
      tacticalTarget.current = smoothToward(tacticalTarget.current, raw, delta, 2.6)
      const sprint = phase === 'attack'
      return { ...moveToward(tacticalTarget.current, sprint, 1), direct: false }
    }

    const passIntent = store.passIntent
    const chasesBall =
      passIntent &&
      !poss &&
      (passIntent.passType !== 'cross'
        ? passIntent.receiverId === id ||
          shouldChaseOwnPassBall(id, team, passIntent, ball)
        : passIntent.receiverId === id ||
          id === getReceiveInterceptorId(team, passIntent) ||
          hasCrossVolleyIntent(id) ||
          shouldChaseOwnPassBall(id, team, passIntent, ball))
    if (chasesBall && passIntent) {
      const distBall = distance2D(position.current, ball)
      // Receptor: corre pro ponto de queda / intercepto — não todos na bola viva
      const isReceiver = passIntent.receiverId === id
      let tx = ball.x
      let tz = ball.z
      if (isReceiver || passIntent.passType === 'through') {
        const intercept = getPassInterceptTarget(
          position.current,
          ball,
          ballVel,
          passIntent,
        )
        if (distBall > 2.4 && intercept) {
          tx = intercept.x
          tz = intercept.z
        } else if (distBall > 3.2) {
          tx = passIntent.targetX * 0.65 + ball.x * 0.35
          tz = passIntent.targetZ * 0.65 + ball.z * 0.35
        }
      }
      const bx = tx - position.current.x
      const bz = tz - position.current.z
      const bd = Math.hypot(bx, bz) || 1
      return {
        dirX: bx / bd,
        dirZ: bz / bd,
        sprint: true,
        direct: true,
        urgency: isReceiver ? 1.35 : 1.15,
      }
    }

    if (isOpponentPassInFlight(team) && passIntent && isPassInterceptor(id, team)) {
      const intercept = getPassInterceptTarget(
        position.current,
        ball,
        ballVel,
        passIntent,
      )
      const distBall = distance2D(position.current, ball)
      const target =
        distBall < 2.6
          ? { x: ball.x, z: ball.z }
          : intercept ?? { x: predicted.x, z: predicted.z }
      tacticalTarget.current = { x: target.x, z: target.z }
      const dist = distance2D(position.current, {
        x: target.x,
        y: 0,
        z: target.z,
      })
      return {
        ...moveToward(target, true, dist, 0.015),
        direct: true,
        urgency: 1.48,
      }
    }

    const ballSpeed = Math.hypot(ballVel.x, ballVel.z)
    const passInFlight = passIntent != null
    // Só bola solta de verdade — durante passe a decisão já está travada acima
    if (!poss && !passInFlight) {
      const distLive = distance2D(position.current, ball)
      const chaseBall = ballSpeed < 1.15 || distLive < 2.6 ? ball : predicted
      const chaserId = resolveLooseBallChaser(team, chaseBall)
      const assists =
        chaserId !== id && shouldAssistLooseBallChase(id, team, chaseBall)
      if (chaserId === id || assists) {
        const dx = chaseBall.x - position.current.x
        const dz = chaseBall.z - position.current.z
        const d = Math.hypot(dx, dz) || 1
        // Perto: vai reto na bola (smooth/overshoot faz órbita e “olha” sem dominar)
        if (distLive < 1.65 || (chaserId === id && distLive < 2.2)) {
          const liveDx = ball.x - position.current.x
          const liveDz = ball.z - position.current.z
          const liveD = Math.hypot(liveDx, liveDz) || 1
          tacticalTarget.current = { x: ball.x, z: ball.z }
          return {
            dirX: liveDx / liveD,
            dirZ: liveDz / liveD,
            sprint: true,
            direct: true,
            urgency: assists ? 1.28 : 1.48,
          }
        }
        const overshoot = distLive < 1.2 ? 0.08 : 0.22
        const chaseTarget = {
          x: chaseBall.x + (dx / d) * overshoot,
          y: 0,
          z: chaseBall.z + (dz / d) * overshoot,
        }
        const chaseSmooth = ballSpeed < 0.45 ? 18 : ballSpeed < 1.2 ? 14 : 9
        tacticalTarget.current = smoothToward(
          tacticalTarget.current,
          chaseTarget,
          delta,
          chaseSmooth,
        )
        const dist = distance2D(position.current, chaseTarget)
        const arriveDist = 0.02
        return {
          ...moveToward(tacticalTarget.current, true, dist, arriveDist),
          direct: true,
          urgency: assists ? 1.12 : 1.28,
        }
      }
    }

    const opponentHasBall = poss !== null && poss.team !== team
    const gkProtected = isGkBallProtected(poss)
    const ownPassInFlight = isOwnPassInFlight(team)
    const opponentPassInFlight = isOpponentPassInFlight(team)
    const defendingShape =
      !ownPassInFlight &&
      (phase === 'defense' || opponentHasBall || opponentPassInFlight)

    const passShapeAnchor =
      passIntent != null
        ? {
            x: passIntent.targetX * 0.55 + ball.x * 0.45,
            z: passIntent.targetZ * 0.55 + ball.z * 0.45,
          }
        : { x: ball.x, z: ball.z }

    ballAnchor.current = smoothToward(
      ballAnchor.current,
      ownPassInFlight && passIntent
        ? { x: passIntent.targetX, z: passIntent.targetZ }
        : passShapeAnchor,
      delta,
      ownPassInFlight ? 3.2 : defendingShape ? 1.55 : 1.85,
    )
    const shapeBall: Vec3 = {
      x: ballAnchor.current.x,
      y: ball.y,
      z: ballAnchor.current.z,
    }
    const ballForShape =
      ownPassInFlight && passIntent
        ? { x: passIntent.targetX, y: ball.y, z: passIntent.targetZ }
        : opponentPassInFlight && passIntent
          ? {
              x: passIntent.targetX * 0.48 + ball.x * 0.52,
              y: ball.y,
              z: passIntent.targetZ * 0.48 + ball.z * 0.52,
            }
          : defendingShape
            ? shapeBall
            : predicted

    const isMarker = isTeamMarker(id, team, poss, predicted)
    const markPoint = getMarkingPoint(poss, poss ? ball : predicted)
    let tacticalDirect = false
    let manMarking = false

    let rawTarget = getDynamicPosition(
      team,
      formation,
      bounds,
      ballForShape,
      poss,
      lastTouch,
    )

    if (
      passIntent &&
      ownPassInFlight &&
      !chasesBall &&
      !opponentHasBall
    ) {
      rawTarget = getPassFlightSupportPosition(team, formation, bounds, passIntent, id)
      tacticalDirect = true
    } else if (
      !poss &&
      !passInFlight &&
      lastTouch === team &&
      phase === 'attack'
    ) {
      rawTarget = getLooseBallAttackPosition(
        team,
        formation,
        bounds,
        predicted,
        passIntent,
      )
    } else if (poss?.team === team && poss.playerId !== id) {
      const carrier = playerRegistry.get(poss.playerId)
      if (carrier) {
        rawTarget = getSupportPosition(
          team,
          formation,
          bounds,
          predicted,
          carrier.position,
          id,
        )
      }
    } else if (gkProtected && poss) {
      const gk = playerRegistry.get(poss.playerId)
      if (gk) {
        const clear = getGkHoldClearTarget(position.current, gk.position)
        rawTarget = { x: clear.x, z: clear.z }
        tacticalDirect = true
      } else {
        rawTarget = getDefensiveShapePosition(team, formation, bounds, ballForShape)
      }
    } else if (isMarker && opponentHasBall && poss) {
      rawTarget = { x: markPoint.x, z: markPoint.z }
      tacticalDirect = true
    } else if (isMarker && !poss && passIntent && opponentPassInFlight) {
      const intercept = getPassInterceptTarget(
        position.current,
        ball,
        ballVel,
        passIntent,
      )
      const distBall = distance2D(position.current, ball)
      if (distBall < 2.6) {
        rawTarget = { x: ball.x, z: ball.z }
      } else if (intercept) {
        rawTarget = { x: intercept.x, z: intercept.z }
      } else {
        rawTarget = { x: ball.x, z: ball.z }
      }
      tacticalDirect = true
    } else if (
      isPassInterceptor(id, team) &&
      opponentPassInFlight &&
      passIntent
    ) {
      const intercept = getPassInterceptTarget(
        position.current,
        ball,
        ballVel,
        passIntent,
      )
      const distBall = distance2D(position.current, ball)
      if (distBall < 2.6) {
        rawTarget = { x: ball.x, z: ball.z }
      } else if (intercept) {
        rawTarget = { x: intercept.x, z: intercept.z }
      } else {
        rawTarget = { x: ball.x, z: ball.z }
      }
      tacticalDirect = true
    } else if (
      isCoverPresser(id, team) &&
      opponentHasBall &&
      poss
    ) {
      const carrier = playerRegistry.get(poss.playerId)
      const shape = getDefensiveShapePosition(team, formation, bounds, ballForShape)
      if (carrier) {
        rawTarget = getCoverPressTarget(team, formation, bounds, carrier, shape)
      } else {
        rawTarget = shape
      }
    } else if (opponentHasBall && poss && getManMarkOpponentId(team, id)) {
      // Marcação individual: cola no adversário atribuído, goal-side. Mistura
      // levemente com o bloco pra não perder totalmente a forma defensiva.
      const manTarget = getManMarkTarget(id, team, bounds, ball)
      if (manTarget) {
        const shape = getDefensiveShapePosition(team, formation, bounds, ballForShape)
        const wideSlot = Math.abs(formation.x) >= 0.55
        rawTarget = getBlendedTarget(
          { x: shape.x, z: shape.z },
          { x: manTarget.x, y: 0, z: manTarget.z },
          // Laterais: mais forma, menos cola no atacante central
          scaleMarkBlend(wideSlot ? 0.55 : 0.78, team),
        )
        manMarking = true
      } else {
        rawTarget = getDefensiveShapePosition(team, formation, bounds, ballForShape)
      }
    } else if (opponentHasBall && poss) {
      rawTarget = getDefensiveShapePosition(team, formation, bounds, ballForShape)
      if (isPassLaneBlocker(id, team)) {
        const carrier = playerRegistry.get(poss.playerId)
        if (carrier) {
          const lane = getPassLaneBlockTarget(team, bounds, carrier, predicted)
          if (lane) {
            const laneDist = distance2D(position.current, carrier.position)
            const laneW = THREE.MathUtils.clamp(0.62 - laneDist * 0.018, 0.34, 0.62)
            rawTarget = getBlendedTarget(rawTarget, { x: lane.x, y: 0, z: lane.z }, laneW)
            tacticalDirect = true
          }
        }
      }
    } else if (phase === 'defense' && !isMarker && !ownPassInFlight) {
      rawTarget = getDefensiveShapePosition(team, formation, bounds, ballForShape)
    }

    if (!tacticalDirect && !manMarking) {
      rawTarget = applyPlayerSlotBias(id, formation, bounds, team, rawTarget)
    }

    const distToRaw = distance2D(position.current, {
      x: rawTarget.x,
      y: 0,
      z: rawTarget.z,
    })

    const makingDepthRun = role === 'fwd' && isForwardMakingRun(id, team)
    const markerChaseBall =
      isMarker && (opponentHasBall || opponentPassInFlight)
    const passInterceptChase =
      isPassInterceptor(id, team) && opponentPassInFlight
    const urgentChase = markerChaseBall || passInterceptChase

    const formationArrive = getRoleArriveDist(
      role,
      defendingShape,
      isMarker && opponentHasBall,
    )
    const canHoldFormation =
      !urgentChase &&
      !tacticalDirect &&
      !manMarking &&
      !makingDepthRun

    // Não trava no posto se tem companheiro colado (vira encavalamento)
    let crowdedByMate = false
    for (const other of playerRegistry.values()) {
      if (other.id === id || other.team !== team || other.role === 'gk') continue
      if (distance2D(position.current, other.position) < 1.15) {
        crowdedByMate = true
        break
      }
    }

    if (canHoldFormation && !crowdedByMate) {
      if (formationHold.current) {
        if (distToRaw < formationArrive * 1.35) {
          tacticalTarget.current = { x: position.current.x, z: position.current.z }
          return { dirX: 0, dirZ: 0, sprint: false, urgency: 0, direct: false }
        }
        formationHold.current = false
      } else if (distToRaw < formationArrive) {
        formationHold.current = true
        tacticalTarget.current = { x: position.current.x, z: position.current.z }
        return { dirX: 0, dirZ: 0, sprint: false, urgency: 0, direct: false }
      }
    } else {
      formationHold.current = false
      if (crowdedByMate && canHoldFormation) {
        // Empurra alvo pra longe do mate mais próximo
        let bestAway = { x: rawTarget.x, z: rawTarget.z }
        let bestD = Infinity
        for (const other of playerRegistry.values()) {
          if (other.id === id || other.team !== team || other.role === 'gk') continue
          const d = distance2D(position.current, other.position)
          if (d >= 1.15 || d >= bestD) continue
          bestD = d
          const away = normalize2D(
            position.current.x - other.position.x,
            position.current.z - other.position.z,
          )
          bestAway = {
            x: rawTarget.x + away.x * 1.8,
            z: rawTarget.z + away.z * 1.4,
          }
        }
        rawTarget = bestAway
      }
    }

    const targetSmooth =
      isMarker && (opponentHasBall || opponentPassInFlight)
        ? 4.8
        : manMarking
          ? 4.2
          : isCoverPresser(id, team) && (opponentHasBall || !!passIntent)
            ? 4.0
            : isPassInterceptor(id, team) && opponentPassInFlight
              ? 4.5
            : defendingShape
              ? 3.1
              : 3.2

    const tacticalSmooth =
      urgentChase
        ? 8.5
        : tacticalDirect || manMarking
          ? isMarker && opponentHasBall
            ? 5.6
            : manMarking
              ? 4.8
              : 5.2
          : targetSmooth

    tacticalTarget.current = smoothToward(
      tacticalTarget.current,
      rawTarget,
      delta,
      tacticalSmooth,
    )

    const distTarget = distance2D(position.current, {
      x: tacticalTarget.current.x,
      y: 0,
      z: tacticalTarget.current.z,
    })
    const sprint =
      urgentChase ||
      tacticalDirect ||
      makingDepthRun ||
      (isMarker && opponentHasBall && getMarkerPursuitIntensity(
        team,
        position.current,
        poss ? playerRegistry.get(poss.playerId) ?? null : null,
      ) > 0.28) ||
      (isMarker && opponentPassInFlight) ||
      (isPassInterceptor(id, team) && opponentPassInFlight) ||
      (isPassLaneBlocker(id, team) && opponentHasBall) ||
      (phase === 'attack' && (role === 'fwd' || role === 'mid') && distTarget > formationArrive * 0.95) ||
      (phase === 'attack' && role === 'fwd' && distTarget > formationArrive * 0.65) ||
      (manMarking && distTarget > 1.1) ||
      distTarget > 2.2

    const sprintUrgent =
      urgentChase ||
      (isPassInterceptor(id, team) && opponentPassInFlight) ||
      (isMarker && opponentPassInFlight)
    const sprintAllowed = canPlayerSprint(id, sprintUrgent)

    const arriveDist = passInterceptChase
      ? 0.12
      : markerChaseBall
      ? 0.14
      : tacticalDirect
      ? isPassInterceptor(id, team) && opponentPassInFlight
        ? 0.18
        : 0.28
      : manMarking
        ? 0.32
        : formationArrive

    const move = moveToward(
      tacticalTarget.current,
      sprint && sprintAllowed,
      distTarget,
      arriveDist,
    )
    const urgencyBoost =
      (isPassInterceptor(id, team) && opponentPassInFlight) ||
      (isMarker && opponentHasBall &&
        getMarkerPursuitIntensity(
          team,
          position.current,
          poss ? playerRegistry.get(poss.playerId) ?? null : null,
        ) > 0.26)
        ? 1.12
        : manMarking
          ? 1.08
          : 1

    return {
      ...move,
      urgency: passInterceptChase
        ? 1.32
        : markerChaseBall
          ? 1.22
          : move.urgency * urgencyBoost,
      direct: tacticalDirect || manMarking || urgentChase,
    }
  }

  function moveToward(
    target: { x: number; z: number },
    sprint: boolean,
    dist: number,
    arriveDist = 0.12,
  ): { dirX: number; dirZ: number; sprint: boolean; urgency: number } {
    const none = { dirX: 0, dirZ: 0, sprint: false, urgency: 0 }
    const d = dist >= 0 ? dist : distance2D(position.current, { x: target.x, y: 0, z: target.z })
    // Chegou no posto → para (antes: arrive*0.12 ⇒ órbita)
    if (d <= arriveDist) return none

    const softOuter = arriveDist * 2.35
    const n = normalize2D(target.x - position.current.x, target.z - position.current.z)
    let urgency = 1
    if (d < softOuter && !sprint) {
      urgency = THREE.MathUtils.clamp(
        (d - arriveDist) / Math.max(softOuter - arriveDist, 0.08),
        0,
        1,
      )
      if (urgency < 0.14) return none
      urgency = 0.35 + urgency * 0.65
    }
    return { dirX: n.x, dirZ: n.z, sprint: sprint && urgency > 0.55, urgency }
  }

  function getGoalkeeperMove(
    poss: ReturnType<typeof useGameStore.getState>['ballPossession'],
    _predicted: Vec3,
    delta: number,
  ) {
    const bounds = fieldBounds!
    const gkState = getGkRuntime(id)
    const ball = ballRef.current
    const ballLow = ball.y < GK_FEET_CLAIM_MAX_HEIGHT + 0.55

    if (isGkBodyLocked(id)) {
      return { dirX: 0, dirZ: 0, sprint: false, urgency: 0 }
    }

    if (poss?.playerId === id) {
      if (gkState?.mode === 'hold' && !gkState.distributing) {
        const shufflePos = computeGkCoverPosition(team, bounds, ball, GK_MAX_STEP_FROM_LINE * 0.55)
        const shuffle = { x: shufflePos.x, y: 0, z: shufflePos.z }
        gkTarget.current = smoothToward(gkTarget.current, shuffle, delta, 2.8)
        const d = distance2D(position.current, {
          x: gkTarget.current.x,
          y: 0,
          z: gkTarget.current.z,
        })
        return moveToward(gkTarget.current, false, d, 0.035)
      }
      return { dirX: 0, dirZ: 0, sprint: false, urgency: 0 }
    }

    const intercept = getGkPositionTarget(id, team, bounds, ball, ballRef.velocity)
    if (intercept) {
      const interceptVec = { x: intercept.x, y: 0, z: intercept.z }
      // Ameaça alta: acompanha rápido; bola baixa: shuffle controlado (sem “deslizar”)
      const urgent =
        gkState?.mode === 'save' ||
        (gkState?.interceptTarget != null && !ballLow)
      const smoothRate = ballLow ? 6.8 : urgent ? 11.5 : 8.8
      gkTarget.current = smoothToward(gkTarget.current, interceptVec, delta, smoothRate)

      const d = distance2D(position.current, {
        x: gkTarget.current.x,
        y: 0,
        z: gkTarget.current.z,
      })
      if (d < 0.06) {
        return { dirX: 0, dirZ: 0, sprint: false, urgency: 0 }
      }

      // Rush só em mergulho / interceptação aérea — nunca em bola rasteira sem animação
      const diving =
        !!gkState?.saveAnim &&
        (gkState.saveAnim.includes('diving') || gkState.saveAnim.includes('body_save'))
      const rush = !ballLow && diving && d > 0.85
      return moveToward(gkTarget.current, rush, d, 0.055)
    }

    const rawPos = computeGkCoverPosition(team, bounds, ball)
    const raw = { x: rawPos.x, y: 0, z: rawPos.z }
    gkTarget.current = smoothToward(gkTarget.current, raw, delta, 5.2)
    return moveToward(gkTarget.current, false, -1, 0.03)
  }

  function mySnapshot(): PlayerRef {
    const controlled =
      !isGoalkeeper &&
      team === getUserTeam() &&
      useGameStore.getState().activePlayerId === id
    return {
      id,
      team,
      role,
      position: { x: position.current.x, y: getPlayerBodyY(), z: position.current.z },
      rotation: rotation.current,
      velocity: { x: 0, y: 0, z: 0 },
      isControlled: controlled,
      anim: (isGoalkeeper
        ? (gkAnimCtrl.current?.getDisplayAnim() ?? 'gk_idle')
        : (animCtrl.current?.getDisplayAnim() ?? 'player_idle')) as PlayerAnim,
      animTime: isGoalkeeper
        ? (gkAnimCtrl.current?.getAnimTime() ?? 0)
        : (animCtrl.current?.getAnimTime() ?? 0),
    }
  }

  function facingDotToDir(dir: { x: number; z: number }): number {
    const fx = Math.sin(rotation.current)
    const fz = Math.cos(rotation.current)
    return fx * dir.x + fz * dir.z
  }

  function computeAICrossAim(
    target: PlayerRef,
    power: number,
  ): { x: number; z: number } {
    const dist = distance2D(position.current, target.position)
    const speedEst = crossSpeedFromPower(crossSpeedForDistance(dist), power)
    const lead = getCrossReceiveLead(target, position.current, speedEst, fieldBounds!, team)
    return normalize2D(lead.x - position.current.x, lead.z - position.current.z)
  }

  function computeAIPassAim(
    target: PlayerRef,
    style: { power: number; quickPass: boolean; through: boolean },
  ): { x: number; z: number } {
    const dist = distance2D(position.current, target.position)
    // Mesma potência do chute — senão mira com 0.55 e chuta com outra
    const power =
      style.quickPass && !style.through
        ? quickPassPowerForDistance(dist)
        : style.power
    const baseSpeed = style.through
      ? throughPassSpeedForDistance(dist)
      : passSpeedForDistance(dist)
    const speed = style.through
      ? throughSpeedFromPower(baseSpeed, power)
      : passSpeedFromPower(baseSpeed, power, style.quickPass)
    const lead = style.through
      ? getThroughPassLead(target, position.current, speed, fieldBounds!, team)
      : getPassLeadPosition(target, position.current, speed, fieldBounds!)
    return normalize2D(lead.x - position.current.x, lead.z - position.current.z)
  }

  function tickCarrierBrain(delta: number) {
    const store = useGameStore.getState()
    if (animCtrl.current?.isStriking()) return

    if (!isHoldingBall()) {
      aiPendingShot.current = null
      aiPendingPass.current = null
      aiPassLook.current = null
      return
    }

    // Pedido de bola: só agenda passe quando a entrega está limpa o bastante
    if (team === getUserTeam() && fieldBounds) {
      const ballCall = store.ballCall
      if (
        ballCall &&
        performance.now() < ballCall.until &&
        ballCall.callerId !== id &&
        !aiPendingShot.current
      ) {
        const alreadyToCaller =
          aiPendingPass.current?.targetId === ballCall.callerId
        if (!alreadyToCaller) {
          const caller = playerRegistry.get(ballCall.callerId)
          const ctxEarly = getCarrierContext(id, role, fieldBounds, ballRef.current)
          if (caller && caller.team === team && caller.role !== 'gk' && ctxEarly) {
            const delivery = evaluateBallCallDelivery(ctxEarly, caller)
            if (delivery.ready) {
              const fwd =
                (caller.position.z - position.current.z) *
                getAttackSign(team, fieldBounds)
              const style = getAIPassParams(ctxEarly, caller, {
                underPressure: delivery.underPressure,
                recycle: fwd < -0.8,
              })
              const now = performance.now()
              // Tempo pra abrir o corpo / sair da marcação antes de soltar
              const carryMs = delivery.heavyPressure
                ? 220 + Math.random() * 160
                : delivery.underPressure
                  ? 420 + Math.random() * 280
                  : 580 + Math.random() * 420
              const lookMs = delivery.heavyPressure
                ? 180 + Math.random() * 120
                : 280 + Math.random() * 200
              aiPendingPass.current = {
                targetId: caller.id,
                style: {
                  ...style,
                  quickPass:
                    delivery.heavyPressure ||
                    (distance2D(position.current, caller.position) < 14 &&
                      !style.through),
                  through: style.through && fwd > 4 && delivery.blockers === 0,
                },
                carryUntil: now + carryMs,
                releaseAfter: now + carryMs + lookMs,
              }
              aiPassLook.current = null
              // Não limpa o balão aqui — some quando o passe sai ou o pedido expira
              aiThinkTimer.current = 0.04
            }
          }
        }
      }
    }

    const pendingPass = aiPendingPass.current
    if (pendingPass) {
      const target = playerRegistry.get(pendingPass.targetId)
      if (!target) {
        aiPendingPass.current = null
        aiPassLook.current = null
        return
      }

      const now = performance.now()
      const aim = pendingPass.style.cross
        ? computeAICrossAim(target, pendingPass.style.power)
        : computeAIPassAim(target, pendingPass.style)

      if (now < pendingPass.carryUntil) {
        aiPassLook.current = null
        aiThinkTimer.current = 0.08
        return
      }

      aiPassLook.current = aim
      const targetYaw = Math.atan2(aim.x, aim.z)
      if (facingDotToDir(aim) < AI_PASS_FACE_DOT) {
        rotation.current = rotateTowardAngle(
          rotation.current,
          targetYaw,
          PLAYER_TURN_SPEED_AI * 1.15,
          delta,
        )
        if (modelRootRef.current) {
          modelRootRef.current.rotation.y = rotation.current
        }
        aiThinkTimer.current = 0.05
        return
      }

      if (now < pendingPass.releaseAfter) {
        aiThinkTimer.current = 0.05
        return
      }

      // Antes de soltar: reavalia pedido de bola (marcação pode ter fechado)
      const liveCall = store.ballCall
      if (
        liveCall &&
        liveCall.callerId === pendingPass.targetId &&
        fieldBounds
      ) {
        const ctxLive = getCarrierContext(id, role, fieldBounds, ballRef.current)
        if (ctxLive) {
          const again = evaluateBallCallDelivery(ctxLive, target)
          if (!again.ready && !again.heavyPressure) {
            // Adia — continua preparando
            aiPendingPass.current = {
              ...pendingPass,
              carryUntil: now + 280 + Math.random() * 220,
              releaseAfter: now + 520 + Math.random() * 280,
            }
            aiPassLook.current = null
            aiThinkTimer.current = 0.08
            return
          }
        }
      }

      // Linha suja no release: só cancela se estiver BEM fechada (2+ bloqueios)
      if (fieldBounds && !pendingPass.style.cross) {
        const ctxLane = getCarrierContext(id, role, fieldBounds, ballRef.current)
        if (ctxLane) {
          const near = getNearestOpponent(ctxLane.carrier, ctxLane.opponents)
          const press = near?.dist ?? 99
          const tired = getPlayerStamina(id) <= 0.32 || isSprintWinded(id)
          // Marcador no receptor não deve cancelar — já ignorado nos endpoints
          const maxBlock = press < 2.1 || tired ? 2 : 1
          if (!isPassLaneClearEnough(ctxLane, target, maxBlock)) {
            // Em vez de cancelar sempre: tenta outro alvo aberto
            const alt = findBestPassTarget(ctxLane)
            if (
              alt &&
              alt.id !== target.id &&
              isPassLaneClearEnough(ctxLane, alt, maxBlock)
            ) {
              pendingPass.targetId = alt.id
              aiPassLook.current = null
              aiThinkTimer.current = 0.05
              return
            }
            aiPendingPass.current = null
            aiPassLook.current = null
            aiThinkTimer.current = 0.06
            return
          }
          if (
            pendingPass.style.through &&
            !isPassLaneClearEnough(ctxLane, target, 0)
          ) {
            pendingPass.style.through = false
            pendingPass.style.quickPass = true
          }
        }
      }

      aiPendingPass.current = null
      aiPassLook.current = null
      rotation.current = targetYaw
      if (modelRootRef.current) {
        modelRootRef.current.rotation.y = rotation.current
      }
      if (pendingPass.style.cross) {
        performCrossTo(target, pendingPass.style.power, aim)
      } else {
        performPassTo(target, {
          power: pendingPass.style.power,
          quickPass: pendingPass.style.quickPass,
          through: pendingPass.style.through,
          aimDir: aim,
        })
      }
      if (store.ballCall?.callerId === pendingPass.targetId) {
        store.clearBallCall()
      }
      aiThinkTimer.current =
        AI_THINK_MIN_S * 1.1 + Math.random() * (AI_THINK_MAX_S - AI_THINK_MIN_S) * 0.95
      return
    }

    const pendingShot = aiPendingShot.current
    if (pendingShot) {
      const targetYaw = Math.atan2(pendingShot.x, pendingShot.z)
      if (facingDotToDir(pendingShot) < AI_SHOOT_FACE_DOT) {
        rotation.current = rotateTowardAngle(
          rotation.current,
          targetYaw,
          PLAYER_TURN_SPEED_AI * 2.4,
          delta,
        )
        if (modelRootRef.current) {
          modelRootRef.current.rotation.y = rotation.current
        }
        aiThinkTimer.current = 0.06
        return
      }

      aiPendingShot.current = null
      rotation.current = targetYaw
      if (modelRootRef.current) {
        modelRootRef.current.rotation.y = rotation.current
      }
      performAIShot(pendingShot)
      aiThinkTimer.current =
        AI_THINK_MIN_S * 0.7 + Math.random() * (AI_THINK_MAX_S - AI_THINK_MIN_S) * 0.75
      return
    }

    const ctx = getCarrierContext(id, role, fieldBounds!, ballRef.current)
    if (!ctx) return

    const goalZ = getGoalZ(team, fieldBounds!)
    const sign = getAttackSign(team, fieldBounds!)
    const goalDist = (goalZ - position.current.z) * sign

    aiThinkTimer.current -= delta
    if (aiThinkTimer.current > 0) return

    const holdMs = performance.now() - store.possessionSince
    const decision = decideCarrierAction(ctx, holdMs)
    const nearest = getNearestOpponent(ctx.carrier, ctx.opponents)
    const underPressure = (nearest?.dist ?? 10) < 3.25
    const nearGoal = goalDist < 14
    const thinkMin = underPressure
      ? AI_THINK_MIN_S * 0.78
      : nearGoal
        ? AI_THINK_MIN_S * 0.82
        : AI_THINK_MIN_S
    const thinkMax = underPressure
      ? AI_THINK_MAX_S * 0.82
      : nearGoal
        ? AI_THINK_MAX_S * 0.88
        : AI_THINK_MAX_S

    if (decision.action === 'shoot') {
      const shootDir = decision.shootDir
      if (facingDotToDir(shootDir) < AI_SHOOT_FACE_DOT) {
        aiPendingShot.current = shootDir
        aiThinkTimer.current = 0.06
        return
      }

      aiThinkTimer.current = thinkMin + Math.random() * (thinkMax - thinkMin)
      const targetYaw = Math.atan2(shootDir.x, shootDir.z)
      rotation.current = targetYaw
      if (modelRootRef.current) {
        modelRootRef.current.rotation.y = rotation.current
      }
      performAIShot(shootDir)
      return
    }

    if (decision.action === 'cross') {
      const target = decision.crossTarget
      if (target) {
        const crossParams = getAICrossParams(ctx, target, decision.crossKind)
        const now = performance.now()
        const carryMs = underPressure
          ? 260 + Math.random() * 180
          : 400 + Math.random() * 320
        const lookMs = underPressure
          ? 200 + Math.random() * 160
          : 320 + Math.random() * 260
        aiPendingPass.current = {
          targetId: target.id,
          style: {
            power: crossParams.power,
            quickPass: false,
            through: false,
            cross: true,
          },
          carryUntil: now + carryMs,
          releaseAfter: now + carryMs + lookMs,
        }
        aiThinkTimer.current = 0.08
      } else {
        aiThinkTimer.current = thinkMin + Math.random() * (thinkMax - thinkMin)
      }
      return
    }

    if (decision.action === 'pass') {
      const target = decision.passTarget ?? findBestPassTarget(ctx)
      if (target) {
        const fwd =
          (target.position.z - position.current.z) * getAttackSign(team, fieldBounds!)
        const tired =
          getPlayerStamina(id) <= 0.32 || isSprintWinded(id)
        const style = getAIPassParams(ctx, target, {
          underPressure,
          recycle: fwd < -0.5,
          tired,
        })
        const now = performance.now()
        const carryMs = tired
          ? 160 + Math.random() * 140
          : underPressure
            ? 220 + Math.random() * 160
            : 360 + Math.random() * 260
        const lookMs = tired
          ? 120 + Math.random() * 100
          : underPressure
            ? 160 + Math.random() * 140
            : 260 + Math.random() * 200
        aiPendingPass.current = {
          targetId: target.id,
          style,
          carryUntil: now + carryMs,
          releaseAfter: now + carryMs + lookMs,
        }
        aiThinkTimer.current = 0.08
      } else {
        aiThinkTimer.current = thinkMin + Math.random() * (thinkMax - thinkMin)
      }
      return
    }

    aiThinkTimer.current = isCarrierSurrounded(ctx)
      ? 0.12 + Math.random() * 0.18
      : underPressure
      ? AI_DRIBBLE_THINK_MIN_S * 0.72 + Math.random() * 0.55
      : AI_DRIBBLE_THINK_MIN_S +
        Math.random() * (AI_DRIBBLE_THINK_MAX_S - AI_DRIBBLE_THINK_MIN_S)
  }

  function performAIShot(dir: { x: number; z: number }) {
    const goalDist =
      fieldBounds != null
        ? Math.abs(getGoalZ(team, fieldBounds) - position.current.z)
        : undefined
    const power = getAIShotPower(goalDist)
    const shotAttr = getPlayerAttrMultipliers(id)
    const speed =
      shotSpeedFromPower(power, goalDist) * 1.06 * shotAttr.shotPower * (0.94 + shotAttr.finishing * 0.06)
    const loft = shotLoftFromPower(power, goalDist)
    const noisyDir = applyAttrAimNoise(dir.x, dir.z, id, 'shot')
    const targetYaw = Math.atan2(noisyDir.x, noisyDir.z)
    playStrikeRelease(
      pickShotStrikeAnim(power),
      () => {
        releaseBallFromFeet(noisyDir.x * speed, 0, noisyDir.z * speed, id, {
          loft,
          releaseKind: 'shot',
        })
      },
      targetYaw,
    )
  }

  function getStrikeDirection(): { x: number; z: number } {
    const c = controls?.current
    if (!c) {
      return {
        x: Math.sin(rotation.current),
        z: Math.cos(rotation.current),
      }
    }
    return computeStrikeDirection(c, rotation.current)
  }

  function tickStrikeWarp(delta: number) {
    const yaw = strikeWarpYaw.current
    if (yaw == null) return
    if (!animCtrl.current?.isStriking()) {
      strikeWarpYaw.current = null
      return
    }
    rotation.current = rotateTowardAngle(
      rotation.current,
      yaw,
      STRIKE_WARP_TURN_SPEED,
      delta,
    )
    if (modelRootRef.current) {
      modelRootRef.current.rotation.y = rotation.current
    }
    const fx = Math.sin(rotation.current)
    const fz = Math.cos(rotation.current)
    if (fx * Math.sin(yaw) + fz * Math.cos(yaw) > 0.96) {
      strikeWarpYaw.current = null
    }
  }

  function playStrikeRelease(
    anim:
      | 'player_pass'
      | 'player_pass_short'
      | 'player_pass_long'
      | 'player_shoot'
      | 'player_kick'
      | 'player_kick_high'
      | 'player_kick_medium'
      | 'player_kick_low',
    onContact: () => void,
    targetYaw?: number,
    /** Só force true em casos especiais (ex.: saída de bola). Chute NUNCA é instantâneo. */
    instantContact = false,
    firstTime = false,
  ) {
    if (targetYaw != null) strikeWarpYaw.current = targetYaw
    const aimX =
      targetYaw != null ? Math.sin(targetYaw) : Math.sin(rotation.current)
    const aimZ =
      targetYaw != null ? Math.cos(targetYaw) : Math.cos(rotation.current)
    const mirror = shouldMirrorRightFootedStrike(
      rotation.current,
      aimX,
      aimZ,
    )
    const isShot =
      anim === 'player_shoot' ||
      anim === 'player_kick' ||
      anim === 'player_kick_high' ||
      anim === 'player_kick_medium' ||
      anim === 'player_kick_low'
    animCtrl.current?.playStrike(anim, {
      onContact,
      instantContact: isShot ? false : instantContact,
      mirror,
      firstTime: isShot && firstTime,
    })
  }

  function performKickoffPass() {
    if (!fieldBounds) return
    // Domínio real — sem isso o passe de saída sai do centro / bugado
    if (!isHoldingBall()) {
      useGameStore.getState().setPossession(id, team)
    }
    const me = mySnapshot()
    setBallPosition(getBallAtFeet(me))
    syncDribblePossession(id, useGameStore.getState().possessionSince)

    const store = useGameStore.getState()
    const mate = findKickoffPassTarget(team, id, position.current, fieldBounds)

    // Drag do gramado (~0.55/s) + damping: teto normal de passe (~PASS_SPEED_MAX)
    // morre antes dos ~12 m até o meio. Saída precisa de impulso próprio.
    let dx: number
    let dz: number
    let dist: number
    if (mate) {
      dist = Math.max(distance2D(me.position, mate.position), 8)
      const provisional = Math.min(BALL_MAX_SPEED * 0.88, PASS_SPEED_MAX * 1.55)
      const lead = getPassLeadPosition(mate, me.position, provisional, fieldBounds)
      const n = normalize2D(lead.x - me.position.x, lead.z - me.position.z)
      dx = n.x
      dz = n.z
      const ballZ = ballRef.current?.z ?? me.position.z
      store.setPassIntent({
        receiverId: mate.id,
        targetX: lead.x,
        targetZ: lead.z,
        startedAt: performance.now(),
        passingTeam: team,
        passType: 'pass',
        ballZAtPass: ballZ,
        runnerIds: buildPassRunnerIds(
          me.id,
          team,
          mate.id,
          { x: lead.x, z: lead.z },
          'pass',
        ),
        soloReceive: shouldSoloReceivePass(mate.id) || undefined,
      })
    } else {
      const yaw = getKickoffFacingRotation(team, fieldBounds)
      dx = Math.sin(yaw)
      dz = Math.cos(yaw)
      dist = 11
      setOpenSpacePassIntent(me, team, dx, dz, dist, 'pass')
    }

    const speed = Math.min(
      BALL_MAX_SPEED * 0.9,
      Math.max(
        passSpeedForDistance(dist) * 1.6,
        dist * 1.2 + 3.2,
        PASS_SPEED_MAX * 1.5,
      ),
    )

    rotation.current = Math.atan2(dx, dz)
    if (modelRootRef.current) {
      modelRootRef.current.rotation.y = rotation.current
    }

    // Contato imediato — não depende do timer da anim (e não passa pelo teto fraco)
    const fire = () => {
      releaseBallFromFeet(dx * speed, 0, dz * speed, id, {
        loft: 0.035,
        releaseKind: 'pass',
      })
      useGameStore.getState().blockPasserClaim(id, 1400)
    }
    if (animCtrl.current) {
      playStrikeRelease(
        pickPassStrikeAnim({
          moveSpeed: Math.hypot(moveVel.current.x, moveVel.current.z),
          sprinting: !!controls?.current?.sprint,
          dist,
          walkSpeed: PLAYER_SPEED,
        }),
        fire,
        rotation.current,
        true,
      )
    } else {
      fire()
    }
  }

  function performPass(
    power = 0.55,
    aimDir?: { x: number; z: number },
  ) {
    if (!isHoldingBall() || !fieldBounds) return
    const strikeDir = aimDir ?? getStrikeDirection()
    const me = mySnapshot()
    const teammates = [...playerRegistry.values()].filter(
      (p) => p.team === team && p.id !== id && p.role !== 'gk',
    )
    const ballZ = ballRef.current?.z ?? me.position.z
    const mate =
      findAssistedPassTarget(me, teammates, strikeDir, {
        onsideOnly: { team, bounds: fieldBounds, ballZ },
      }) ?? findNearestTeammate(me, teammates)
    performPassTo(mate, { power, aimDir: strikeDir })
  }

  function performThroughPass(
    power = 0.62,
    aimDir?: { x: number; z: number },
  ) {
    if (!isHoldingBall() || !fieldBounds) return
    const strikeDir = aimDir ?? getStrikeDirection()
    const me = mySnapshot()
    const teammates = [...playerRegistry.values()].filter(
      (p) => p.team === team && p.id !== id && p.role !== 'gk',
    )
    const ballZ = ballRef.current?.z ?? me.position.z
    const mate =
      findThroughPassTarget(me, teammates, fieldBounds, team, ballZ) ??
      findAssistedPassTarget(me, teammates, strikeDir, {
        onsideOnly: { team, bounds: fieldBounds, ballZ },
      }) ??
      findPassTargetInFacingDirection(me, teammates, {
        facingDir: strikeDir,
        minDist: 4,
        maxDist: 32,
        minDot: 0.35,
        maxLateralRatio: 0.65,
      })
    performPassTo(mate, { through: true, power, aimDir: strikeDir })
  }

  function performCross(
    power = 0.68,
    aimDir?: { x: number; z: number },
  ) {
    if (!isHoldingBall() || !fieldBounds) return
    const strikeDir = aimDir ?? getStrikeDirection()
    const me = mySnapshot()
    const teammates = [...playerRegistry.values()].filter(
      (p) => p.team === team && p.id !== id && p.role !== 'gk',
    )
    const ballZ = ballRef.current?.z ?? me.position.z
    // Só amarra em companheiro se estiver no cone da mira — senão cruza livre
    const mate = findCrossTargetAlongAim(
      me,
      teammates,
      strikeDir,
      fieldBounds,
      team,
      ballZ,
      { minDot: 0.62, maxDist: 34 },
    )
    performCrossTo(mate, power, strikeDir)
  }

  function performCrossTo(
    mate: PlayerRef | null,
    power = 0.68,
    aimDir?: { x: number; z: number },
  ) {
    if (!fieldBounds || !isHoldingBall()) return
    if (animCtrl.current?.isStriking()) return

    const store = useGameStore.getState()
    const me = mySnapshot()
    const strikeDir = aimDir ?? getStrikeDirection()

    // Mira do stick manda — não redireciona a bola pro companheiro
    let dx = strikeDir.x
    let dz = strikeDir.z
    const range = 9 + power * 12
    let speed = crossSpeedFromPower(crossSpeedForDistance(range), power)
    let loft = crossLoftFromPower(power, crossLoftForDistance(range))
    let targetX = me.position.x + dx * range
    let targetZ = me.position.z + dz * range

    if (mate) {
      const dist = distance2D(me.position, mate.position)
      const speedEst = crossSpeedFromPower(crossSpeedForDistance(dist), power)
      const lead = getCrossReceiveLead(mate, me.position, speedEst, fieldBounds, team)
      const leadDist = distance2D(me.position, { x: lead.x, y: 0, z: lead.z })
      // Força/arco pela distância do alvo — sem empilhar max()
      speed = crossSpeedFromPower(crossSpeedForDistance(Math.max(leadDist, range * 0.75)), power)
      loft = crossLoftFromPower(power, crossLoftForDistance(Math.max(leadDist, range * 0.75)))
      targetX = me.position.x + dx * Math.max(leadDist, range * 0.85)
      targetZ = me.position.z + dz * Math.max(leadDist, range * 0.85)

      const ballZ = ballRef.current?.z ?? me.position.z
      const offsideFlag =
        store.phase === 'playing'
          ? getOffsideFlagAtPass(team, mate, fieldBounds, ballZ)
          : null

      store.setPassIntent({
        receiverId: mate.id,
        targetX,
        targetZ,
        startedAt: performance.now(),
        passingTeam: team,
        passType: 'cross',
        offsideFlag: offsideFlag ?? undefined,
        ballZAtPass: ballZ,
        runnerIds: buildPassRunnerIds(me.id, team, mate.id, { x: targetX, z: targetZ }, 'cross'),
      })
    } else {
      setOpenSpacePassIntent(me, team, dx, dz, range, 'cross')
    }

    playStrikeRelease(
      pickPassStrikeAnim({
        moveSpeed: Math.hypot(moveVel.current.x, moveVel.current.z),
        sprinting: !!controls?.current?.sprint,
        cross: true,
        walkSpeed: PLAYER_SPEED,
      }),
      () => {
        releaseBallFromFeet(dx * speed, 0, dz * speed, id, {
          loft,
          releaseKind: 'cross',
        })
      },
      Math.atan2(dx, dz),
    )
  }

  function performPassTo(
    mate: PlayerRef | null,
    opts?: {
      kickoff?: boolean
      through?: boolean
      power?: number
      quickPass?: boolean
      aimDir?: { x: number; z: number }
    },
  ) {
    if (!fieldBounds) return
    if (!opts?.kickoff && !isHoldingBall()) return
    if (!opts?.kickoff && animCtrl.current?.isStriking()) return

    const store = useGameStore.getState()
    const me = mySnapshot()
    const quickSimplePass =
      opts?.quickPass ??
      (!opts?.through && Math.abs((opts?.power ?? -1) - QUICK_PASS_POWER) < 0.02)
    let power = opts?.power ?? (opts?.through ? 0.62 : 0.55)
    const strikeDir = opts?.kickoff
      ? { x: Math.sin(rotation.current), z: Math.cos(rotation.current) }
      : opts?.aimDir ?? getStrikeDirection()

    let dx = strikeDir.x
    let dz = strikeDir.z
    let baseSpeed = opts?.through
      ? throughPassSpeedForDistance(12)
      : passSpeedForDistance(8)
    let speed = opts?.through
      ? throughSpeedFromPower(baseSpeed, power)
      : passSpeedFromPower(baseSpeed, power, quickSimplePass)

    if (mate) {
      const dist = distance2D(me.position, mate.position)
      if (quickSimplePass && !opts?.through) {
        power = quickPassPowerForDistance(dist)
      }
      baseSpeed = opts?.through
        ? throughPassSpeedForDistance(dist)
        : passSpeedForDistance(dist)
      speed = opts?.through
        ? throughSpeedFromPower(baseSpeed, power)
        : passSpeedFromPower(baseSpeed, power, quickSimplePass)
      const lead = opts?.through
        ? getThroughPassLead(mate, me.position, speed, fieldBounds, team)
        : getPassLeadPosition(mate, me.position, speed, fieldBounds)
      const n = normalize2D(lead.x - me.position.x, lead.z - me.position.z)
      dx = n.x
      dz = n.z

      const ballZ = ballRef.current?.z ?? me.position.z
      const offsideFlag =
        mate && store.phase === 'playing' && !opts?.kickoff
          ? getOffsideFlagAtPass(team, mate, fieldBounds, ballZ)
          : null

      store.setPassIntent({
        receiverId: mate.id,
        targetX: lead.x,
        targetZ: lead.z,
        startedAt: performance.now(),
        passingTeam: team,
        passType: opts?.through ? 'through' : 'pass',
        offsideFlag: offsideFlag ?? undefined,
        ballZAtPass: ballZ,
        runnerIds: buildPassRunnerIds(
          me.id,
          team,
          mate.id,
          { x: lead.x, z: lead.z },
          opts?.through ? 'through' : 'pass',
        ),
        soloReceive: shouldSoloReceivePass(mate.id) || undefined,
      })
    } else if (opts?.through) {
      const fallback = throughPassFallbackDir(me, fieldBounds, team)
      dx = fallback.x
      dz = fallback.z
      baseSpeed = throughPassSpeedForDistance(fallback.dist)
      speed = throughSpeedFromPower(baseSpeed, power)
      setOpenSpacePassIntent(me, team, dx, dz, fallback.dist, 'through')
    } else {
      setOpenSpacePassIntent(me, team, dx, dz, 8, 'pass')
    }

    const passLoft = opts?.kickoff ? 0 : passLoftFromPower(power, !!opts?.through)
    const releaseKind = opts?.through ? 'through' : 'pass'
    const passAttr = getPlayerAttrMultipliers(id)
    speed *= passAttr.passing
    const noisyPass = opts?.kickoff
      ? { x: dx, z: dz }
      : applyAttrAimNoise(dx, dz, id, 'pass')
    const passDist = mate
      ? distance2D(me.position, mate.position)
      : opts?.through
        ? 16
        : 8
    const passClip = pickPassStrikeAnim({
      moveSpeed: Math.hypot(moveVel.current.x, moveVel.current.z),
      sprinting: !!controls?.current?.sprint,
      dist: passDist,
      through: !!opts?.through,
      walkSpeed: PLAYER_SPEED,
    })
    playStrikeRelease(
      passClip,
      () => {
        releaseBallFromFeet(noisyPass.x * speed, 0, noisyPass.z * speed, id, {
          loft: passLoft,
          releaseKind,
        })
      },
      Math.atan2(noisyPass.x, noisyPass.z),
    )
  }

  function slideActiveMs(): number {
    const ctrl = animCtrl.current
    const durSec = ctrl?.playbackDurationSec('player_tackle') ?? SLIDE_DURATION_MS / 1000
    return durSec * 0.62 * 1000
  }

  function performStandingSteal() {
    if (isHoldingBall() || isGoalkeeper) return
    tryStandingStealOrBodyCharge(id)
  }

  function performSlideTackle() {
    if (!fieldBounds || isGoalkeeper || !canPlayerPlay(id)) return
    const fx = Math.sin(rotation.current)
    const fz = Math.cos(rotation.current)
    if (!startSlide(id, fx, fz, slideActiveMs())) return
    animCtrl.current?.startSlide()
  }

  function performKick(
    power = 0.75,
    aimDir?: { x: number; z: number },
    firstTime = false,
  ) {
    const store = useGameStore.getState()

    if (
      phase === 'kickoff' &&
      team === store.kickoffTeam &&
      !isGoalkeeper &&
      team === getUserTeam() &&
      store.activePlayerId === id &&
      store.ballFrozen
    ) {
      startKickoff()
      return
    }

    if (
      isActiveSetPiecePhase(phase) &&
      id === store.setPieceKickerId &&
      store.setPieceTeam === team
    ) {
      return
    }

    if (!isHoldingBall()) return

    const strikeDir = aimDir ?? getStrikeDirection()
    const goalDist =
      fieldBounds != null
        ? Math.abs(getGoalZ(team, fieldBounds) - position.current.z)
        : undefined
    const speed =
      shotSpeedFromPower(power, goalDist) *
      getPlayerAttrMultipliers(id).shotPower *
      (0.94 + getPlayerAttrMultipliers(id).finishing * 0.06)
    const loft = shotLoftFromPower(power, goalDist)
    const noisyShot = applyAttrAimNoise(strikeDir.x, strikeDir.z, id, 'shot')
    playStrikeRelease(
      pickShotStrikeAnim(power),
      () => {
        releaseBallFromFeet(noisyShot.x * speed, 0, noisyShot.z * speed, id, {
          loft,
          releaseKind: 'shot',
        })
      },
      Math.atan2(noisyShot.x, noisyShot.z),
      false,
      firstTime,
    )
  }

  return (
    <>
      <RigidBody
      ref={bodyRef}
      type="kinematicPosition"
      colliders={false}
      position={[spawn.x, getPlayerBodyY(), spawn.z]}
      userData={{ isPlayer: true, team, id }}
    >
      <primitive ref={modelRootRef} object={cloned} />
    </RigidBody>
    {isGoalkeeper ? (
      <GkHandColliders gkId={id} modelRootRef={modelRootRef} />
    ) : (
      <PlayerBoneColliders playerId={id} modelRootRef={modelRootRef} />
    )}
    </>
  )
}
