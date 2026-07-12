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
  LOOSE_BALL_MAX_SPEED,
  GK_TURN_SPEED,
  SHOT_SPEED,
  WORLD_SCALE,
} from '../constants'
import { passSpeedForDistance, releaseBallFromFeet } from './TeamController'
import { computeStrikeDirection } from '../systems/strikeAim'
import { usePlayerAssets } from '../context/PlayerAssetsContext'
import { useGameStore, getUserTeam } from '../store/gameStore'
import { applyPlayerMaterials } from '../graphics/graphicsMaterials'
import { getTeamDbId, getPlayerAppearance, getTeamMatchKit } from '../matchRuntime'
import { attachTeamShirtTexture, detachTeamShirtTexture } from '../psx/shirtTextureApply'
import { parsePlayerIndex } from '../data/playerRoster'
import type { FormationSlot, PlayerAnim, PlayerRole, TeamId, Vec3 } from '../types'
import { canAnticipateStrike, hasBufferedStrikeIntent, isAutoFirstTimeStriker, shouldAutoRunForFirstTime, shouldBlockManualUserControl } from '../systems/anticipation'

/** Não roubar em pé quando o jogador está antecipando passe/chute (first-time). */
function shouldSkipPassStealForAnticipation(
  store: ReturnType<typeof useGameStore.getState>,
  playerId: string,
  isActive: boolean,
) {
  if (!isActive) return false
  if (hasBufferedStrikeIntent(store, playerId)) return true
  if (store.shotChargeActive && canAnticipateStrike(store)) return true

  const userTeam = getUserTeam()
  const poss = store.ballPossession
  if (poss?.team === userTeam && poss.playerId === playerId) return false
  if (poss && poss.team !== userTeam) return false
  const incoming = store.passIntent?.receiverId === playerId
  const loose = !poss
  return incoming || loose
}

import {
  ballRef,
  playerRegistry,
  registerPlayer,
  unregisterPlayer,
  type PlayerRef,
} from '../systems/entityRegistry'
import { findAssistedPassTarget, findNearestTeammate, findPassTargetInFacingDirection, getPassInterceptTarget, getPassReceiveTarget } from '../systems/possession'
import {
  applyPlayerFacing,
  facingFromMovement,
  getBallFocusFacing,
  worldToLocalMovement,
  PLAYER_BALL_FOCUS_TURN,
  PLAYER_DIR_SMOOTH_AI,
  PLAYER_DIR_SMOOTH_AI_DIRECT,
  PLAYER_DIR_SMOOTH_CONTROLLED,
  smoothDirection2D,
  smoothVelocity2D,
} from '../systems/playerLocomotion'
import { distance2D, normalize2D, rotateTowardAngle } from '../systems/rules'
import {
  decideCarrierAction,
  findBestPassTarget,
  getCarrierContext,
  getDribbleTarget,
  getPassLaneBlockTarget,
  getPassLeadPosition,
} from '../systems/aiBrain'
import { cameraState } from '../systems/cameraState'
import { getKickoffPlayerId, getKickoffAimRotation, getKickoffFacingRotation, findKickoffPassTarget, startKickoff } from '../systems/kickoff'
import {
  applyTacticalFloat,
  applyPlayerSlotBias,
  getBlendedTarget,
  getCarrierTarget,
  getCoverPressTarget,
  getDefensiveShapePosition,
  getDynamicPosition,
  getLooseBallAttackPosition,
  getManMarkOpponentId,
  getManMarkTarget,
  getMarkingPoint,
  getPassFlightSupportPosition,
  getPressBallWeight,
  getRoleArriveDist,
  resolveLooseBallChaser,
  getSupportPosition,
  getTackleTarget,
  getTeamPhase,
  isCoverPresser,
  isPassLaneBlocker,
  isPassInterceptor,
  isForwardMakingRun,
  isTeamMarker,
  predictBallPosition,
  smoothToward,
} from '../systems/dynamicFormation'
import { getPlayerBodyY } from '../systems/fieldData'
import { getAttackSign, getAttackingGoalZ as getGoalZ, getFieldFacingRotation, getFormationSpawn, isInPenaltyArea } from '../systems/teamField'
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
  QUICK_PASS_POWER,
  shotLoftFromPower,
  shotSpeedFromPower,
  throughSpeedFromPower,
} from '../systems/shotPower'
import {
  findThroughPassTarget,
  getThroughPassLead,
  throughPassFallbackDir,
  throughPassSpeedForDistance,
} from '../systems/throughPass'
import {
  CROSS_LOFT,
  crossSpeedForDistance,
  findCrossTarget,
  getCrossReceiveLead,
  shouldVolleyCross,
} from '../systems/cross'
import {
  canStartSlide,
  cleanupPhysicalStates,
  clearPlayerPhysicalState,
  getSlideDirection,
  isPlayerKnockedDown,
  isPlayerSliding,
  processSlideContacts,
  startSlide,
} from '../systems/tackle'
import { SLIDE_DURATION_MS, SLIDE_AI_MAX_DIST, SLIDE_AI_MIN_DIST, SLIDE_AI_MIN_INTERVAL_MS, SLIDE_AI_ROLL_CHANCE, SLIDE_AI_SECOND_CHANCE_MUL, STANDING_STEAL_AI_CHANCE, STANDING_STEAL_AI_INTERVAL_MS, STANDING_STEAL_AI_MAX_DIST, STRIKE_WARP_TURN_SPEED } from '../constants'
import { alignPlayerModelToCapsule } from '../systems/animationClips'
import { PlayerAnimController } from '../systems/playerAnimController'
import { normalizePlayerAnim } from '../systems/playerClipRegistry'
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
import { tryStandingSteal } from '../systems/standingSteal'
import {
  clearPlayerDribbleControl,
  updatePlayerDribbleControl,
  type DribbleControlOutput,
} from '../systems/playerDribbleControl'
import {
  clearPlayerSkillMoves,
  updatePlayerSkillSpin,
} from '../systems/playerSkillMoves'
import { impulseDribbleFeint } from '../systems/ballDribble'
import { GkHandColliders } from './GkHandColliders'
import { PlayerBoneColliders } from './PlayerBoneColliders'
import { needsPlayerBoneSync } from '../systems/playerFootPhysics'
import { shouldTriggerReceiveAnim } from '../systems/passReceiveAnim'
import {
  registerPlayerBones,
  unregisterPlayerBones,
  updatePlayerBonePositions,
  snapshotPlayerSkeletonToBody,
  pinPlayerHips,
} from '../systems/playerSkeleton'


const AI_THINK_MIN_S = 0.58
const AI_THINK_MAX_S = 1.25
const AI_DRIBBLE_THINK_MIN_S = 0.85
const AI_DRIBBLE_THINK_MAX_S = 1.65

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
  const receiver = findNearestTeammate(me, teammates)
  if (!receiver) {
    store.setPassIntent(null)
    return
  }

  store.setPassIntent({
    receiverId: receiver.id,
    targetX: me.position.x + dx * passDist,
    targetZ: me.position.z + dz * passDist,
    startedAt: performance.now(),
    passType,
    ballZAtPass: ballRef.current?.z ?? me.position.z,
  })
}

function resolveReceiveTouchAnim(
  receiverPos: { x: number; z: number },
  ball: { x: number; z: number },
  ballVel: { x: number; z: number },
  facing: number,
): 'player_left' | 'player_right' | 'player_backward' | null {
  const approachX = Math.hypot(ballVel.x, ballVel.z) > 0.16
    ? ballVel.x
    : ball.x - receiverPos.x
  const approachZ = Math.hypot(ballVel.x, ballVel.z) > 0.16
    ? ballVel.z
    : ball.z - receiverPos.z
  const len = Math.hypot(approachX, approachZ)
  if (len < 0.001) return null

  const dirX = approachX / len
  const dirZ = approachZ / len
  const sin = Math.sin(facing)
  const cos = Math.cos(facing)
  const localF = dirX * sin + dirZ * cos
  const localR = dirX * cos - dirZ * sin

  if (localF < -0.35 && Math.abs(localF) > Math.abs(localR) * 0.85) {
    return 'player_backward'
  }

  if (Math.abs(localR) > 0.42 && Math.abs(localR) > Math.abs(localF) * 0.75) {
    return localR < 0 ? 'player_left' : 'player_right'
  }

  return null
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
  const { scene, animations } = usePlayerAssets()
  const modelRootRef = useRef<THREE.Group>(null)
  const bodyRef = useRef<RapierRigidBody>(null)

  const slotIndex = parsePlayerIndex(id)

  const cloned = useMemo(() => {
    const model = SkeletonUtils.clone(scene) as THREE.Group
    applyPlayerMaterials(model, getPlayerAppearance(team, slotIndex, role), false)
    alignPlayerModelToCapsule(model)
    return model
  }, [scene, team, role, slotIndex])

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

  const { actions, mixer, animToClip } = usePlayerMixer(animations, modelRootRef)
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
  const aiDirectMove = useRef(false)
  const aiThinkTimer = useRef(0)
  const aiSlideTimer = useRef(0)
  const aiStealTimer = useRef(0)
  const knockdownActive = useRef(false)
  const snapshotSkeletonRef = useRef<(() => void) | null>(null)
  const gkSnapshotSkeletonRef = useRef<(() => void) | null>(null)
  const lastReplayAnim = useRef<PlayerAnim | null>(null)
  const receiveAnimActive = useRef(false)
  const lastPossessionSince = useRef(0)
  const dribbleBallOffset = useRef({ x: 0, z: 0 })
  const dribbleCtrl = useRef<DribbleControlOutput | null>(null)
  const wasStopFeint = useRef(false)
  /** Yaw alvo durante animação de passe/chute — warp de corpo estilo FIFA */
  const strikeWarpYaw = useRef<number | null>(null)

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
      unregisterPlayer(id)
    }
  }, [id])

  useLayoutEffect(() => {
    if (role === 'gk') {
      if (!mixer || !modelRootRef.current || !actions.gk_idle) return
      const ctrl = new GoalkeeperAnimController(actions, mixer)
      ctrl.init()
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
    ctrl.bindHoldBallIdle(actions.gk_idle_ball)
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
        gkAnimCtrl.current = boot
      }
    } else {
      animCtrl.current?.dispose()
      if (mixer && actions.player_idle) {
        const boot = new PlayerAnimController(actions, mixer)
        boot.init()
        boot.bindHoldBallIdle(actions.gk_idle_ball)
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
    const c = fieldBounds.center
    position.current.set(c.x, 0, c.z)
    tacticalTarget.current = { x: c.x, z: c.z }
    rotation.current = getKickoffFacingRotation(kickoffTeam, fieldBounds)
    bodyRef.current?.setTranslation({ x: c.x, y: getPlayerBodyY(), z: c.z }, true)
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

    registerPlayer({
      id,
      team,
      role,
      position: { x: pos.x, y: getPlayerBodyY(), z: pos.z },
      rotation: opts?.rotation ?? rotation.current,
      velocity: opts?.velocity ?? { x: 0, y: 0, z: 0 },
      isControlled:
        opts?.isControlled ??
        (!isGoalkeeper &&
          team === getUserTeam() &&
          useGameStore.getState().activePlayerId === id),
      isSprinting: opts?.isSprinting,
      dribbleBallOffset: opts?.dribbleBallOffset,
      anim: opts?.anim ?? displayAnim,
      animTime: opts?.animTime ?? displayTime,
    })
  }

  useEffect(() => {
    if (!setPieceShootAnim || setPieceShootAnim.kickerId !== id) return
    if (isGoalkeeper) {
      gkAnimCtrl.current?.playFootKick()
    } else {
      animCtrl.current?.playStrike('player_shoot')
    }
    if (useGameStore.getState().setPieceShootAnim?.kickerId === id) {
      useGameStore.setState({ setPieceShootAnim: null })
    }
  }, [setPieceShootAnim?.at, id, isGoalkeeper])

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
    performKickoffPass()
    if (useGameStore.getState().kickoffStrikeAnim?.kickerId === id) {
      useGameStore.setState({ kickoffStrikeAnim: null })
    }
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
          ctrl?.setStrafeLocomotion({
            moving: actor.moving,
            sprint: actor.moving,
            localForward: actor.moving ? 1 : 0,
            localRight: 0,
          })
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
      const ball = ballRef.current
      const bodyY = getPlayerBodyY()

      if (celebTeam && team === celebTeam && !isGoalkeeper) {
        const dx = ball.x - position.current.x
        const dz = ball.z - position.current.z
        const dist = Math.hypot(dx, dz)
        if (dist > 0.55) {
          const step = Math.min(dist, 2.4 * simDelta)
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
          ctrl?.playStrike('player_shoot')
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
      position.current.set(center.x, 0, center.z)
      rotation.current = getKickoffAimRotation(
        team,
        fieldBounds,
        id,
        position.current,
      )
      bodyRef.current.setNextKinematicTranslation({
        x: center.x,
        y: getPlayerBodyY(),
        z: center.z,
      })
      if (modelRootRef.current) {
        modelRootRef.current.rotation.y = rotation.current
      }
      if (animFree) ctrl?.forceIdle()

      const isKickerActive =
        team === getUserTeam() ? isUserActive : team === storeState.kickoffTeam
      if (
        isKickerActive &&
        consumeAction?.('kick') &&
        animFree
      ) {
        startKickoff()
      }

      syncRegistry(center)
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
        animFree &&
        canMove &&
        phase === 'playing' &&
        !hasBallNow &&
        !isGoalkeeper
      ) {
        performStandingSteal()
      }
      if (
        isUserActive &&
        team === getUserTeam() &&
        storeState.passIntent?.passType === 'cross' &&
        storeState.passIntent.receiverId === id &&
        !hasBallNow &&
        storeState.crossOneTouchActive &&
        canStrike &&
        phase === 'playing' &&
        controls.current.kick &&
        shouldVolleyCross(position.current, ballRef.current, ballRef.velocity)
      ) {
        performOneTouchCrossShot()
      }
      if (
        (isUserActive ||
          (storeState.pendingUserShot?.buffered &&
            storeState.pendingUserShot.playerId === id)) &&
        hasBallNow &&
        phase === 'playing'
      ) {
        const hasBufferedPass =
          storeState.pendingUserPass?.buffered &&
          storeState.pendingUserPass.playerId === id
        const hasBufferedShot =
          storeState.pendingUserShot?.buffered &&
          storeState.pendingUserShot.playerId === id
        if (canStrike || hasBufferedPass || hasBufferedShot) {
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
            })
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
      if (isUserActive && consumeAction?.('kick') && animFree) {
        if (phase === 'kickoff' && storeState.ballFrozen) {
          performKick()
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
    const canAiSlidePress =
      canMove &&
      !ballFrozen &&
      !isGoalkeeper &&
      !hasBallNow &&
      !isUserActive &&
      !(passIntentEarly != null &&
        (passIntentEarly.receiverId === id || passIntentEarly.runnerIds?.includes(id))) &&
      opponentHasBallEarly &&
      holderEarly?.role !== 'gk' &&
      (role === 'def' || role === 'mid' || role === 'fwd') &&
      animFree &&
      phase === 'playing' &&
      distToHolderEarly < SLIDE_AI_MAX_DIST + 0.55 &&
      (isPrimaryMarkerEarly || distToHolderEarly < 1.38)

    if (canAiSlidePress) {
      aiSlideTimer.current -= simDelta * 1000
      if (aiSlideTimer.current <= 0 && canStartSlide(id)) {
        aiSlideTimer.current =
          SLIDE_AI_MIN_INTERVAL_MS + Math.random() * SLIDE_AI_MIN_INTERVAL_MS * 0.65

        if (holderEarly) {
          const d = distToHolderEarly
          const roleMul =
            role === 'def' ? 1 : role === 'mid' ? 0.82 : 0.42
          let rollChance = SLIDE_AI_ROLL_CHANCE * roleMul
          if (!isPrimaryMarkerEarly) rollChance *= SLIDE_AI_SECOND_CHANCE_MUL
          if (
            d < SLIDE_AI_MAX_DIST &&
            d > SLIDE_AI_MIN_DIST &&
            Math.random() < rollChance
          ) {
            const n = normalize2D(
              holderEarly.position.x - position.current.x,
              holderEarly.position.z - position.current.z,
            )
            rotation.current = Math.atan2(n.x, n.z)
            if (startSlide(id, n.x, n.z, slideActiveMs())) {
              ctrl?.startSlide()
            }
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
      !(passIntentEarly != null &&
        (passIntentEarly.receiverId === id || passIntentEarly.runnerIds?.includes(id))) &&
      opponentHasBallEarly &&
      holderEarly?.role !== 'gk' &&
      (role === 'def' || role === 'mid' || role === 'fwd') &&
      animFree &&
      phase === 'playing' &&
      distToHolderEarly < STANDING_STEAL_AI_MAX_DIST &&
      (isPrimaryMarkerEarly || distToHolderEarly < 0.95)

    if (canAiStandingSteal) {
      aiStealTimer.current -= simDelta * 1000
      if (aiStealTimer.current <= 0) {
        aiStealTimer.current =
          STANDING_STEAL_AI_INTERVAL_MS +
          Math.random() * STANDING_STEAL_AI_INTERVAL_MS * 0.5
        const roleMul = role === 'def' ? 1 : role === 'mid' ? 0.85 : 0.4
        // Quanto mais colado no portador, mais decidido é o bote — perto de
        // verdade sendo o marcador vira quase certeza; de longe, improvável.
        const proximity = THREE.MathUtils.clamp(
          1 - distToHolderEarly / STANDING_STEAL_AI_MAX_DIST,
          0,
          1,
        )
        let rollChance = STANDING_STEAL_AI_CHANCE * roleMul * (0.5 + proximity)
        if (!isPrimaryMarkerEarly) rollChance *= 0.6
        if (Math.random() < rollChance) {
          tryStandingSteal(id)
        }
      }
    }

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
          AI_THINK_MIN_S * (0.55 + Math.random() * 0.65)
      }
    }

    if (
      storePoss?.playerId === id &&
      canMove &&
      animFree &&
      phase === 'playing' &&
      (isGoalkeeper || !isUserActive)
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
    const currentPoss = storeState.ballPossession
    const isPassReceiver =
      passIntent != null &&
      (passIntent.receiverId === id || passIntent.runnerIds?.includes(id) === true)
    const opponentHasBall = currentPoss !== null && currentPoss.team !== team
    const pressAsMarker =
      canMove &&
      !ballFrozen &&
      !isGoalkeeper &&
      !hasBallNow &&
      !isPassReceiver &&
      isTeamMarker(id, team, currentPoss, ballRef.current) &&
      opponentHasBall &&
      currentPoss !== null

    const receivingPass =
      isPassReceiver &&
      !hasBallNow &&
      canMove &&
      !currentPoss

    const autoFirstTimeRun =
      shouldAutoRunForFirstTime(storeState, id) &&
      !hasBallNow &&
      canMove &&
      !currentPoss

    const autoFirstTimeWithBall =
      isAutoFirstTimeStriker(storeState, id) &&
      hasBallNow &&
      hasBufferedStrikeIntent(storeState, id) &&
      canMove &&
      phase === 'playing'

    const needsAutoReceiveRun =
      (receivingPass || autoFirstTimeRun) && passIntent

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

    const shotAimActive =
      isUserActive &&
      team === getUserTeam() &&
      !isGoalkeeper &&
      hasBallNow &&
      canMove &&
      !bodyActionLocked &&
      phase === 'playing' &&
      !!controls?.current &&
      storeState.shotChargeActive &&
      storeState.powerBarMode === 'shot'

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

    if (needsAutoReceiveRun) {
      const target = getPassReceiveTarget(
        position.current,
        ballRef.current,
        ballRef.velocity,
        passIntent,
      )
      const distToReceive = distance2D(position.current, { x: target.x, y: 0, z: target.z })
      const ball = ballRef.current
      const inReceiveAnim =
        receiveAnimActive.current ||
        ctrl?.isReceiving() === true ||
        ctrl?.isHeading() === true

      const recvAnim = shouldTriggerReceiveAnim(
        passIntent,
        id,
        position.current,
        ball,
        ballRef.velocity,
        inReceiveAnim,
        {
          crossOneTouch: storeState.crossOneTouchActive,
          userReceiver: team === getUserTeam(),
        },
      )

      const run = moveToward(
        target,
        !inReceiveAnim && distToReceive > (recvAnim.kind === 'player_header' ? 3.0 : 2.2),
        distToReceive,
        autoFirstTimeRun ? 0.08 : 0.06,
      )
      dirX = run.dirX
      dirZ = run.dirZ
      sprint = !inReceiveAnim && distToReceive > (autoFirstTimeRun ? 2.0 : 2.6)
      moveScale = inReceiveAnim ? 0.42 : autoFirstTimeRun ? 1.08 : 1
      aiDirectMove.current = true

      if (animFree && ctrl && recvAnim.trigger && recvAnim.kind === 'player_header') {
        receiveAnimActive.current = true
        ctrl.playHeader({
          onFinished: () => {
            receiveAnimActive.current = false
          },
        })
      } else if (animFree && ctrl && recvAnim.trigger && recvAnim.kind === 'player_receive') {
        receiveAnimActive.current = true
        ctrl.playReceive(() => {
          receiveAnimActive.current = false
        })
        const touchAnim = resolveReceiveTouchAnim(
          position.current,
          ballRef.current,
          ballRef.velocity,
          rotation.current,
        )
        if (touchAnim) {
          ctrl.playDribbleTouch(touchAnim, 0.28)
        }
      }
    } else if (autoFirstTimeWithBall) {
      const pending = storeState.pendingUserShot
      const aim = storeState.strikeAim
      let faceX = pending?.dirX ?? aim?.dirX ?? Math.sin(rotation.current)
      let faceZ = pending?.dirZ ?? aim?.dirZ ?? Math.cos(rotation.current)
      const faceLen = Math.hypot(faceX, faceZ)
      if (faceLen > 0.01) {
        faceX /= faceLen
        faceZ /= faceLen
        rotation.current = Math.atan2(faceX, faceZ)
        if (modelRootRef.current) {
          modelRootRef.current.rotation.y = rotation.current
        }
      }
      dirX = 0
      dirZ = 0
      sprint = false
      moveScale = 0.28
      aiDirectMove.current = true
    } else if (pressAsMarker) {
      const ai = getAIMove(simDelta)
      dirX = ai.dirX
      dirZ = ai.dirZ
      sprint = ai.sprint
      moveScale = ai.urgency
      aiDirectMove.current = ai.direct
    } else if (shotAimActive) {
      const coastLen = Math.hypot(inputDir.current.x, inputDir.current.z)
      if (coastLen > 0.06) {
        dirX = inputDir.current.x / coastLen
        dirZ = inputDir.current.z / coastLen
      }
      sprint = !!controls?.current?.sprint
      moveScale = 1
      aiDirectMove.current = false
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
      !shouldBlockManualUserControl(storeState, id)
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
      dirX = ai.dirX
      dirZ = ai.dirZ
      sprint = ai.sprint
      moveScale = ai.urgency
      aiDirectMove.current = ai.direct
    } else {
      aiDirectMove.current = false
    }

    if (passAimActive) {
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

    const manualControlBlocked = shouldBlockManualUserControl(storeState, id)
    const autoFirstTimeLocked = needsAutoReceiveRun || autoFirstTimeWithBall

    const playerControlled =
      isUserActive &&
      controls?.current &&
      canMove &&
      !bodyActionLocked &&
      !shotLockActive &&
      !autoFirstTimeLocked &&
      !manualControlBlocked

    const rawDirLen = Math.hypot(dirX, dirZ)
    const rawDirX = rawDirLen > 0.02 ? dirX : 0
    const rawDirZ = rawDirLen > 0.02 ? dirZ : 0
    const dirSmooth = playerControlled
      ? PLAYER_DIR_SMOOTH_CONTROLLED
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
      dirX = 0
      dirZ = 0
    }

    const intentLen = Math.hypot(dirX, dirZ)
    const preMoveSpeed = Math.hypot(moveVel.current.x, moveVel.current.z)
    const dribbleEnabled =
      hasBallNow &&
      !isGoalkeeper &&
      !!playerControlled &&
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
    })
    dribbleCtrl.current = dribbleOut

    if (
      dribbleEnabled &&
      isUserActive &&
      controls?.current &&
      !storeState.shotChargeActive &&
      ctrl &&
      !ctrl.isLocked()
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
        impulseDribbleFeint(0.12 * WORLD_SCALE, 0.08 * WORLD_SCALE)
      }
    }

    if (dribbleOut.stopFeintActive && !wasStopFeint.current) {
      impulseDribbleFeint(dribbleOut.ballOffsetX * 0.65, dribbleOut.ballOffsetZ * 0.65)
    }
    wasStopFeint.current = dribbleOut.stopFeintActive

    if (dribbleOut.sprintBlocked) sprint = false

    dribbleBallOffset.current.x = dribbleOut.ballOffsetX
    dribbleBallOffset.current.z = dribbleOut.ballOffsetZ

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
        gkCtrl.forceIdle()
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
    const speed = isGoalkeeper
      ? gkRt?.mode === 'save' && gkRt.saveAnim
        ? 0
        : ballLow
          ? GK_SPEED * 0.92
          : interceptDist > 2.4
            ? GK_RUSH_SPEED * 1.08
            : GK_SPEED * 1.12
      : dribbleOut.stopFeintActive && intentLen > 0.02
        ? Math.max(dribbleOut.feintMoveSpeed, PLAYER_SPEED * 0.78)
        : (sprint ? PLAYER_SPRINT_SPEED : PLAYER_SPEED)
    const targetVelX = intentLen > 0.02 && !bodyActionLocked ? (dirX / intentLen) * speed * moveScale : 0
    const targetVelZ = intentLen > 0.02 && !bodyActionLocked ? (dirZ / intentLen) * speed * moveScale : 0
    const accelerating = intentLen > 0.02 && !bodyActionLocked

    if (dribbleOut.stopFeintActive && intentLen > 0.02 && !bodyActionLocked) {
      const carry = Math.max(
        preMoveSpeed * 0.92,
        dribbleOut.feintMoveSpeed,
        PLAYER_SPEED * 0.78,
      )
      const faceYaw = dribbleOut.forcedYaw ?? rotation.current
      const fx = Math.sin(faceYaw)
      const fz = Math.cos(faceYaw)
      moveVel.current.x = fx * carry * 0.45 + dirX * carry * 0.55
      moveVel.current.z = fz * carry * 0.45 + dirZ * carry * 0.55
    } else {
      const nextVel = smoothVelocity2D(moveVel.current, targetVelX, targetVelZ, simDelta, accelerating)
      moveVel.current.x = nextVel.x
      moveVel.current.z = nextVel.z
    }

    let moveX = moveVel.current.x * simDelta
    let moveZ = moveVel.current.z * simDelta
    const actualSpeed = Math.hypot(moveVel.current.x, moveVel.current.z)
    const projectedMove = actualSpeed * simDelta

    if (isGoalkeeper && gkCtrl && animFree && !gkCtrl.isSaving()) {
      const gkStateNow = getGkRuntime(id)
      if (gkStateNow?.mode === 'idle' || gkStateNow?.mode === 'save') {
        if (actualSpeed > 0.16) {
          gkCtrl.playLocomotion(actualSpeed > GK_SPEED * 0.68)
        } else {
          gkCtrl.forceIdle()
        }
      }
    }

    const isMarking =
      pressAsMarker ||
      (opponentHasBall &&
        !hasBallNow &&
        !isPassReceiver &&
        (isTeamMarker(id, team, currentPoss, ballRef.current) ||
          (isCoverPresser(id, team) && preMoveSpeed < 1.85)))

    const holdingPosition =
      intentLen < 0.04 &&
      preMoveSpeed < 0.15 &&
      !receivingPass &&
      !hasBallNow

    const ballFocusMode =
      phase === 'playing' &&
      !hasBallNow &&
      !ctrl?.isStriking() &&
      !isPlayerSliding(id) &&
      (isMarking || holdingPosition || ctrl?.locksFacing() === true || receivingPass)

    const useStrafeLoco = isMarking && !isUserActive && ballFocusMode

    if (
      !isGoalkeeper &&
      !bodyActionLocked &&
      !shielding
    ) {
      if (strikeWarpYaw.current != null) {
        tickStrikeWarp(simDelta)
      }

      const ball = ballRef.current
      const faceBall = ballFocusMode

      let targetYaw = rotation.current
      if (dribbleOut.forcedYaw != null) {
        targetYaw = dribbleOut.forcedYaw
      } else if (ctrl?.locksFacing()) {
        targetYaw = getBallFocusFacing(position.current, ball, rotation.current)
      } else if (
        receivingPass &&
        distance2D(position.current, ball) < 5.5
      ) {
        targetYaw = getBallFocusFacing(position.current, ball, rotation.current)
      } else if (faceBall) {
        targetYaw = getBallFocusFacing(position.current, ball, rotation.current)
      } else if (shotAimActive) {
        const turnLen = Math.hypot(dirX, dirZ)
        if (turnLen > 0.02) {
          targetYaw = Math.atan2(dirX, dirZ)
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
        )
      }

      const baseTurn = dribbleOut.snapFacing
        ? PLAYER_TURN_SPEED_CONTROLLED * 12
        : dribbleOut.forcedYaw != null
        ? PLAYER_TURN_SPEED_CONTROLLED * dribbleOut.turnRateMul
        : faceBall
        ? PLAYER_BALL_FOCUS_TURN
        : shotAimActive
          ? PLAYER_TURN_SPEED_CONTROLLED * 0.55
        : shotLockActive
          ? PLAYER_TURN_SPEED_CONTROLLED * 0.4
          : playerControlled
            ? PLAYER_TURN_SPEED_CONTROLLED
            : moveScale < 0.6
              ? PLAYER_TURN_SPEED_AI * 0.82
              : PLAYER_TURN_SPEED_AI
      if (dribbleOut.snapFacing && dribbleOut.forcedYaw != null) {
        rotation.current = dribbleOut.forcedYaw
      } else {
        rotation.current = applyPlayerFacing(
          rotation.current,
          targetYaw,
          baseTurn,
          actualSpeed,
          speed,
          !!playerControlled,
          simDelta,
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

    const moved = Math.hypot(nx - prevX, nz - prevZ)

    position.current.set(nx, 0, nz)
    bodyRef.current.setNextKinematicTranslation({ x: nx, y: getPlayerBodyY(), z: nz })
    if (modelRootRef.current) modelRootRef.current.rotation.y = rotation.current

    if (canUpdateLocoAnim) {
      if (shielding) {
        locoMoving.current = false
        ctrl?.forceIdle()
        velocity.current.set(0, 0, 0)
        moveVel.current.x = 0
        moveVel.current.z = 0
      } else {
      const wantsRun =
        !bodyActionLocked &&
        (moved > RUN_START_THRESHOLD ||
          actualSpeed > RUN_STOP_THRESHOLD * 2 ||
          (intentLen > 0.04 && projectedMove > RUN_STOP_THRESHOLD * 1.2))
      if (wantsRun) {
        locoMoving.current = true
      } else if (
        dribbleOut.stopFeintActive &&
        intentLen > 0.02
      ) {
        locoMoving.current = true
      } else if (intentLen < 0.015 && moved < RUN_STOP_THRESHOLD && actualSpeed < 0.12) {
        locoMoving.current = false
      }

      if (locoMoving.current) {
        if (dribbleOut.touchAnim && !dribbleOut.stopFeintActive) {
          ctrl?.playDribbleTouch(dribbleOut.touchAnim, dribbleOut.touchDuration)
        } else if (hasBallNow) {
          const local = worldToLocalMovement(dirX, dirZ, rotation.current)
          const carrierSprint = sprint || (dribbleOut.stopFeintActive && dribbleOut.feintKeepRun)
          ctrl?.setCarrierLocomotion({
            moving: true,
            sprint: carrierSprint,
            localForward: local.localForward,
            localRight: local.localRight,
          })
        } else if (useStrafeLoco) {
          const local = worldToLocalMovement(dirX, dirZ, rotation.current)
          ctrl?.setStrafeLocomotion({
            moving: true,
            sprint,
            localForward: local.localForward,
            localRight: local.localRight,
          })
        } else {
          ctrl?.setDirectLocomotion({ moving: true, sprint })
        }
        velocity.current.set(moveVel.current.x, 0, moveVel.current.z)
      } else if (ballFocusMode && holdingPosition) {
        ctrl?.forceIdle()
        velocity.current.set(0, 0, 0)
      } else {
        ctrl?.setDirectLocomotion({ moving: false, sprint: false })
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
        isSprinting: sprint && locoMoving.current && !shielding,
        dribbleBallOffset: hasBallNow
          ? { x: dribbleBallOffset.current.x, z: dribbleBallOffset.current.z }
          : undefined,
      },
    )
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
      const ctx = getCarrierContext(id, role, bounds, ball)
      if (
        ctx &&
        !(
          !isGoalkeeper &&
          team === getUserTeam() &&
          useGameStore.getState().activePlayerId === id
        )
      ) {
        const lookahead = role === 'fwd' ? 3.6 : role === 'mid' ? 2.8 : 2.1
        const dribble = getDribbleTarget(ctx, lookahead)
        tacticalTarget.current = smoothToward(tacticalTarget.current, dribble, delta, 2.2)
        // Facing do drible é resolvido no bloco principal de facing (segue a
        // velocidade suavizada). Escrever aqui era descartado depois e ainda
        // brigava com aquele valor, causando tremor de rotação no portador IA.
        const sprint = phase === 'attack' && (role === 'fwd' || role === 'mid')
        return { ...moveToward(tacticalTarget.current, sprint, -1), direct: true }
      }

      const raw = getCarrierTarget(team, formation, bounds, ball)
      tacticalTarget.current = smoothToward(tacticalTarget.current, raw, delta, 2.2)
      const sprint = phase === 'attack' && (role === 'fwd' || role === 'mid')
      return { ...moveToward(tacticalTarget.current, sprint, 1), direct: true }
    }

    const passIntent = store.passIntent
    const isReceiver =
      passIntent &&
      (passIntent.receiverId === id || passIntent.runnerIds?.includes(id))
    if (isReceiver && !poss) {
      const target = getPassReceiveTarget(
        position.current,
        ball,
        ballVel,
        passIntent,
      )
      const dist = distance2D(position.current, { x: target.x, y: 0, z: target.z })
      return { ...moveToward(target, true, dist, 0.06), direct: true }
    }

    const opponentPassInFlight =
      passIntent && !poss && lastTouch != null && lastTouch !== team
    if (opponentPassInFlight && isPassInterceptor(id, team)) {
      const intercept = getPassInterceptTarget(
        position.current,
        ball,
        ballVel,
        passIntent,
      )
      if (intercept) {
        tacticalTarget.current = smoothToward(
          tacticalTarget.current,
          intercept,
          delta,
          4.5,
        )
        const dist = distance2D(position.current, {
          x: tacticalTarget.current.x,
          y: 0,
          z: tacticalTarget.current.z,
        })
        return {
          ...moveToward(tacticalTarget.current, true, dist, 0.04),
          direct: true,
        }
      }
    }

    const ballSpeed = Math.hypot(ballVel.x, ballVel.z)
    if (!poss && !passIntent && ballSpeed <= LOOSE_BALL_MAX_SPEED) {
      const chaserId = resolveLooseBallChaser(team, predicted)
      if (chaserId === id) {
        const chaseTarget = { x: predicted.x, y: 0, z: predicted.z }
        tacticalTarget.current = smoothToward(tacticalTarget.current, chaseTarget, delta, 3.4)
        const dist = distance2D(position.current, chaseTarget)
        return { ...moveToward(tacticalTarget.current, true, dist, 0.08), direct: true }
      }
    }

    const opponentHasBall = poss !== null && poss.team !== team
    const gkProtected = isGkBallProtected(poss)
    const defendingShape =
      phase === 'defense' || opponentHasBall || (!poss && lastTouch != null && lastTouch !== team)

    ballAnchor.current = smoothToward(
      ballAnchor.current,
      { x: ball.x, z: ball.z },
      delta,
      defendingShape ? 1.75 : 2.1,
    )
    const shapeBall: Vec3 = {
      x: ballAnchor.current.x,
      y: ball.y,
      z: ballAnchor.current.z,
    }
    const ballForShape = defendingShape ? shapeBall : predicted

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
      lastTouch === team &&
      !isReceiver &&
      !opponentHasBall
    ) {
      rawTarget = getPassFlightSupportPosition(team, formation, bounds, passIntent)
    } else if (!poss && !passIntent && lastTouch === team && phase === 'attack') {
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
      rawTarget = getTackleTarget(poss, team, bounds, predicted)
      tacticalDirect = true
    } else if (isMarker && !poss && passIntent && lastTouch !== team) {
      const intercept = getPassInterceptTarget(
        position.current,
        ball,
        ballVel,
        passIntent,
      )
      if (intercept) {
        rawTarget = { x: intercept.x, z: intercept.z }
        tacticalDirect = true
      } else {
        const distBall = distance2D(position.current, markPoint)
        const pressW = getPressBallWeight(true, phase, distBall)
        rawTarget = getBlendedTarget(rawTarget, markPoint, pressW)
        tacticalDirect = true
      }
    } else if (
      isCoverPresser(id, team) &&
      opponentHasBall &&
      poss
    ) {
      const carrier = playerRegistry.get(poss.playerId)
      const shape = getDefensiveShapePosition(team, formation, bounds, ballForShape)
      if (carrier) {
        rawTarget = getCoverPressTarget(team, formation, bounds, carrier.position, shape)
      } else {
        rawTarget = shape
      }
    } else if (opponentHasBall && poss && getManMarkOpponentId(team, id)) {
      // Marcação individual: cola no adversário atribuído, goal-side. Mistura
      // levemente com o bloco pra não perder totalmente a forma defensiva.
      const manTarget = getManMarkTarget(id, team, bounds, ball)
      if (manTarget) {
        const shape = getDefensiveShapePosition(team, formation, bounds, ballForShape)
        rawTarget = getBlendedTarget(
          { x: shape.x, z: shape.z },
          { x: manTarget.x, y: 0, z: manTarget.z },
          0.82,
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
            const laneW = THREE.MathUtils.clamp(0.62 - laneDist * 0.02, 0.38, 0.62)
            rawTarget = getBlendedTarget(rawTarget, { x: lane.x, y: 0, z: lane.z }, laneW)
            tacticalDirect = true
          }
        }
      }
    } else if (phase === 'defense' && !isMarker) {
      rawTarget = getDefensiveShapePosition(team, formation, bounds, ballForShape)
    }

    const distToRaw = distance2D(position.current, {
      x: rawTarget.x,
      y: 0,
      z: rawTarget.z,
    })
    if (!tacticalDirect && !manMarking) {
      rawTarget = applyPlayerSlotBias(id, formation, bounds, team, rawTarget)
      if (
        defendingShape &&
        !isMarker &&
        !isCoverPresser(id, team) &&
        distToRaw < 0.55
      ) {
        rawTarget = applyTacticalFloat(id, rawTarget, distToRaw)
      }
    }

    const makingDepthRun = role === 'fwd' && isForwardMakingRun(id, team)
    const targetSmooth =
      isMarker && opponentHasBall
        ? 2.6
        : manMarking
          ? 2.4
          : isCoverPresser(id, team) && opponentHasBall
            ? 2.15
            : defendingShape
              ? 1.85
              : 2.2

    tacticalTarget.current = smoothToward(
      tacticalTarget.current,
      rawTarget,
      delta,
      targetSmooth,
    )

    const distTarget = distance2D(position.current, {
      x: tacticalTarget.current.x,
      y: 0,
      z: tacticalTarget.current.z,
    })
    const sprint =
      tacticalDirect ||
      makingDepthRun ||
      (isMarker && opponentHasBall) ||
      (isMarker && !poss && !!passIntent) ||
      (isPassInterceptor(id, team) && !poss && !!passIntent) ||
      (phase === 'attack' && (role === 'fwd' || role === 'mid')) ||
      (manMarking && distTarget > 1.4) ||
      distTarget > 2.5

    const arriveDist = tacticalDirect
      ? 0.08
      : manMarking
        ? 0.16
        : getRoleArriveDist(
            role,
            defendingShape,
            isMarker && opponentHasBall,
          )

    return {
      ...moveToward(tacticalTarget.current, sprint, distTarget, arriveDist),
      direct: tacticalDirect || manMarking,
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
    const softOuter = arriveDist * 2.4
    if (d < arriveDist * 0.22) return none

    const n = normalize2D(target.x - position.current.x, target.z - position.current.z)
    let urgency = 1
    if (arriveDist >= 0.14) {
      urgency = THREE.MathUtils.clamp(
        (d - arriveDist * 0.22) / Math.max(softOuter - arriveDist * 0.22, 0.08),
        0.3,
        1,
      )
    }
    return { dirX: n.x, dirZ: n.z, sprint: sprint && urgency > 0.5, urgency }
  }

  function getGoalkeeperMove(
    poss: ReturnType<typeof useGameStore.getState>['ballPossession'],
    predicted: Vec3,
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
      const smoothRate = ballLow ? 5.2 : 8.4
      gkTarget.current = smoothToward(gkTarget.current, interceptVec, delta, smoothRate)

      const d = distance2D(position.current, {
        x: gkTarget.current.x,
        y: 0,
        z: gkTarget.current.z,
      })
      if (d < 0.06) {
        return { dirX: 0, dirZ: 0, sprint: false, urgency: 0 }
      }

      const inBox = isInPenaltyArea(ball, team, bounds)
      const rush =
        !ballLow &&
        (inBox || d > 1.35 || (gkState?.mode === 'save' && !gkState.saveAnim))
      return moveToward(gkTarget.current, rush, d, 0.06)
    }

    const rawPos = computeGkCoverPosition(team, bounds, ball)
    const raw = { x: rawPos.x, y: 0, z: rawPos.z }
    gkTarget.current = smoothToward(gkTarget.current, raw, delta, 4.5)
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

  function tickCarrierBrain(delta: number) {
    const store = useGameStore.getState()
    const ctx = getCarrierContext(id, role, fieldBounds!, ballRef.current)
    if (!ctx) return

    const goalZ = getGoalZ(team, fieldBounds!)
    const sign = getAttackSign(team, fieldBounds!)
    const goalDist = (goalZ - position.current.z) * sign

    if (goalDist < 10) {
      aiThinkTimer.current = 0
    } else {
      aiThinkTimer.current -= delta
      if (aiThinkTimer.current > 0) return
    }

    const holdMs = performance.now() - store.possessionSince
    const decision = decideCarrierAction(ctx, holdMs)

    if (decision.action === 'shoot') {
      aiThinkTimer.current =
        AI_THINK_MIN_S + Math.random() * (AI_THINK_MAX_S - AI_THINK_MIN_S)
      rotation.current = Math.atan2(decision.shootDir.x, decision.shootDir.z)
      performAIShot(decision.shootDir)
      return
    }

    if (decision.action === 'pass') {
      aiThinkTimer.current =
        AI_THINK_MIN_S + Math.random() * (AI_THINK_MAX_S - AI_THINK_MIN_S)
      const target =
        decision.passTarget ?? findBestPassTarget(ctx)
      if (target) {
        const n = normalize2D(
          target.position.x - position.current.x,
          target.position.z - position.current.z,
        )
        rotation.current = Math.atan2(n.x, n.z)
        performPassTo(target, { power: 0.42 + Math.random() * 0.45 })
      }
      return
    }

    aiThinkTimer.current =
      AI_DRIBBLE_THINK_MIN_S +
      Math.random() * (AI_DRIBBLE_THINK_MAX_S - AI_DRIBBLE_THINK_MIN_S)
  }

  function performAIShot(dir: { x: number; z: number }) {
    const power =
      team !== getUserTeam()
        ? 0.72 + Math.random() * 0.26
        : 0.42 + Math.random() * 0.48
    const speed = shotSpeedFromPower(power)
    const loft = shotLoftFromPower(power)
    playStrikeRelease('player_shoot', () => {
      releaseBallFromFeet(dir.x * speed, 0, dir.z * speed, id, {
        loft,
        releaseKind: 'shot',
      })
    })
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
    anim: 'player_pass' | 'player_shoot' | 'player_kick',
    onContact: () => void,
    targetYaw?: number,
  ) {
    if (targetYaw != null) strikeWarpYaw.current = targetYaw
    animCtrl.current?.playStrike(anim, { onContact })
  }

  function performKickoffPass() {
    if (!fieldBounds) return
    const mate = findKickoffPassTarget(team, id, position.current, fieldBounds)
    rotation.current = mate
      ? Math.atan2(
          mate.position.x - position.current.x,
          mate.position.z - position.current.z,
        )
      : getKickoffFacingRotation(team, fieldBounds)
    if (modelRootRef.current) {
      modelRootRef.current.rotation.y = rotation.current
    }
    performPassTo(mate, { kickoff: true })
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
    const mate =
      findCrossTarget(me, teammates, fieldBounds, team, ballZ) ??
      findAssistedPassTarget(me, teammates, strikeDir, {
        onsideOnly: { team, bounds: fieldBounds, ballZ },
      }) ??
      findPassTargetInFacingDirection(me, teammates, {
        facingDir: strikeDir,
        minDist: 4,
        maxDist: 28,
        minDot: 0.35,
        maxLateralRatio: 0.75,
      })
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

    let dx = strikeDir.x
    let dz = strikeDir.z
    let speed = crossSpeedFromPower(crossSpeedForDistance(14), power)
    let targetX = me.position.x + dx * 12
    let targetZ = me.position.z + dz * 12
    let loft = crossLoftFromPower(power, CROSS_LOFT)

    if (mate) {
      const lead = getCrossReceiveLead(mate, fieldBounds, team)
      const dist = distance2D(me.position, mate.position)
      speed = crossSpeedFromPower(crossSpeedForDistance(dist), power)
      const n = normalize2D(lead.x - me.position.x, lead.z - me.position.z)
      dx = n.x
      dz = n.z
      targetX = lead.x
      targetZ = lead.z

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
        passType: 'cross',
        offsideFlag: offsideFlag ?? undefined,
        ballZAtPass: ballZ,
      })
    } else {
      setOpenSpacePassIntent(me, team, dx, dz, 12, 'cross')
    }

    playStrikeRelease(
      'player_pass',
      () => {
        releaseBallFromFeet(dx * speed, 0, dz * speed, id, {
          loft,
          releaseKind: 'cross',
        })
      },
      Math.atan2(dx, dz),
    )
  }

  function performOneTouchCrossShot() {
    if (!fieldBounds || animCtrl.current?.isLocked()) return
    const store = useGameStore.getState()
    const goalZ = getGoalZ(team, fieldBounds)
    const n = normalize2D(0 - position.current.x, goalZ - position.current.z)
    rotation.current = Math.atan2(n.x, n.z)
    if (modelRootRef.current) {
      modelRootRef.current.rotation.y = rotation.current
    }

    const speed = SHOT_SPEED * 1.02
    const loft = 0.32

    store.setPassIntent(null)
    store.setCrossOneTouchActive(false)
    animCtrl.current?.playHeader({
      onContact: () => {
        releaseBallFromFeet(n.x * speed, 0, n.z * speed, id, {
          loft,
          releaseKind: 'shot',
        })
      },
    })
  }

  function performPassTo(
    mate: PlayerRef | null,
    opts?: {
      kickoff?: boolean
      through?: boolean
      power?: number
      aimDir?: { x: number; z: number }
    },
  ) {
    if (!fieldBounds) return
    if (!opts?.kickoff && !isHoldingBall()) return
    if (!opts?.kickoff && animCtrl.current?.isStriking()) return

    const store = useGameStore.getState()
    const me = mySnapshot()
    const power = opts?.power ?? (opts?.through ? 0.62 : 0.55)
    const quickSimplePass =
      !opts?.through && Math.abs(power - QUICK_PASS_POWER) < 0.02
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
        passType: opts?.through ? 'through' : 'pass',
        offsideFlag: offsideFlag ?? undefined,
        ballZAtPass: ballZ,
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

    const passLoft = passLoftFromPower(power, !!opts?.through)
    const releaseKind = opts?.through ? 'through' : 'pass'
    playStrikeRelease(
      'player_pass',
      () => {
        releaseBallFromFeet(dx * speed, 0, dz * speed, id, {
          loft: passLoft,
          releaseKind,
        })
      },
      Math.atan2(dx, dz),
    )
  }

  function slideActiveMs(): number {
    const ctrl = animCtrl.current
    const durSec = ctrl?.playbackDurationSec('player_tackle') ?? SLIDE_DURATION_MS / 1000
    return durSec * 0.62 * 1000
  }

  function performStandingSteal() {
    if (isHoldingBall() || isGoalkeeper) return
    tryStandingSteal(id)
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
    const speed = shotSpeedFromPower(power)
    const loft = shotLoftFromPower(power)
    playStrikeRelease(
      'player_shoot',
      () => {
        releaseBallFromFeet(strikeDir.x * speed, 0, strikeDir.z * speed, id, {
          loft,
          releaseKind: 'shot',
        })
      },
      Math.atan2(strikeDir.x, strikeDir.z),
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
