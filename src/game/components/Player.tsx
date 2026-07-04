import { CapsuleCollider, RigidBody, type RapierRigidBody } from '@react-three/rapier'
import { useFrame } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef, type MutableRefObject } from 'react'
import * as THREE from 'three'
import { SkeletonUtils } from 'three-stdlib'
import {
  GK_SPEED,
  GK_MAX_STEP_FROM_LINE,
  GK_RUSH_SPEED,
  PLAYER_HEIGHT,
  PLAYER_RADIUS,
  PLAYER_SPEED,
  PLAYER_SPRINT_SPEED,
  PLAYER_TURN_SPEED_AI,
  PLAYER_TURN_SPEED_CONTROLLED,
  LOOSE_BALL_MAX_SPEED,
  GK_TURN_SPEED,
  SHOT_SPEED,
  getHomeOutfieldIds,
} from '../constants'
import { passSpeedForDistance, releaseBallFromFeet } from './TeamController'
import { computeStrikeDirection } from '../systems/strikeAim'
import { PlayerSelectionLabel } from './PlayerSelectionLabel'
import { usePlayerAssets } from '../context/PlayerAssetsContext'
import { useGameStore, getUserTeam } from '../store/gameStore'
import { applyPlayerMaterials } from '../graphics/graphicsMaterials'
import { getTeamDbId, getPlayerAppearance, getTeamMatchKit } from '../matchRuntime'
import { attachTeamShirtTexture, detachTeamShirtTexture } from '../psx/shirtTextureApply'
import { parsePlayerIndex } from '../data/playerRoster'
import type { FormationSlot, PlayerAnim, PlayerRole, TeamId, Vec3 } from '../types'
import {
  ballRef,
  playerRegistry,
  registerPlayer,
  unregisterPlayer,
  type PlayerRef,
} from '../systems/entityRegistry'
import { findNearestTeammate, findPassTargetInFacingDirection, getPassInterceptTarget, getPassReceiveTarget } from '../systems/possession'
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
  getDribbleDirection,
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
  getDynamicGKPosition,
  getDynamicPosition,
  getLooseBallAttackPosition,
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
import { getAttackSign, getAttackingGoalZ as getGoalZ, getDefensiveGoalZ, getFieldFacingRotation, getFormationSpawn } from '../systems/teamField'
import {
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
import { SLIDE_DURATION_MS, SLIDE_AI_MAX_DIST, SLIDE_AI_MIN_DIST, SLIDE_AI_MIN_INTERVAL_MS, SLIDE_AI_ROLL_CHANCE, SLIDE_AI_SECOND_CHANCE_MUL, STANDING_STEAL_AI_CHANCE, STANDING_STEAL_AI_INTERVAL_MS, STANDING_STEAL_AI_MAX_DIST } from '../constants'
import { alignPlayerModelToCapsule } from '../systems/animationClips'
import { PlayerAnimController } from '../systems/playerAnimController'
import { normalizePlayerAnim } from '../systems/playerClipRegistry'
import { GoalkeeperAnimController } from '../systems/goalkeeperAnimController'
import { registerGkHands, unregisterGkHands, updateGkHandPositions } from '../systems/goalkeeperHands'
import { usePlayerMixer } from '../systems/usePlayerMixer'
import { canPlayerPlay, getOffsideFlagAtPass, getSentOffSpot } from '../systems/referee'
import { getSimDelta } from '../systems/gameTime'
import {
  clampGkFacing,
  clampGkPosition,
  finishGkDistribution,
  getGkMoveTarget,
  getGkPositionTarget,
  getGkRuntime,
  isGkBodyLocked,
  notifyGkSaveFinished,
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
import { impulseDribbleFeint } from '../systems/ballDribble'
import { shouldTriggerReceiveAnim } from '../systems/passReceiveAnim'

const HOME_OUTFIELD = getHomeOutfieldIds()
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

  if (team === getUserTeam()) {
    store.setActivePlayer(receiver.id)
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
  const modelFootY = useRef(-PLAYER_HEIGHT / 2)

  const slotIndex = parsePlayerIndex(id)

  const cloned = useMemo(() => {
    const model = SkeletonUtils.clone(scene) as THREE.Group
    applyPlayerMaterials(model, getPlayerAppearance(team, slotIndex, role), false)
    alignPlayerModelToCapsule(model)
    modelFootY.current = model.position.y
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

  const { actions, mixer } = usePlayerMixer(animations, modelRootRef)
  const animCtrl = useRef<PlayerAnimController | null>(null)
  const gkAnimCtrl = useRef<GoalkeeperAnimController | null>(null)
  const lastGkSaveAnim = useRef<string | null>(null)
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
  const lastReplayAnim = useRef<PlayerAnim | null>(null)
  const receiveAnimActive = useRef(false)
  const lastPossessionSince = useRef(0)
  const dribbleBallOffset = useRef({ x: 0, z: 0 })
  const dribbleCtrl = useRef<DribbleControlOutput | null>(null)
  const wasStopFeint = useRef(false)

  const activePlayerId = useGameStore((s) => s.activePlayerId)
  const phase = useGameStore((s) => s.phase)
  const ballFrozen = useGameStore((s) => s.ballFrozen)
  const ballPossession = useGameStore((s) => s.ballPossession)
  const fieldBounds = useGameStore((s) => s.fieldBounds)
  const setPieceKickerId = useGameStore((s) => s.setPieceKickerId)
  const setPieceShootAnim = useGameStore((s) => s.setPieceShootAnim)
  const kickoffStrikeAnim = useGameStore((s) => s.kickoffStrikeAnim)
  const setPiecePosition = useGameStore((s) => s.setPiecePosition)
  const setPieceAimAngle = useGameStore((s) => s.setPieceAimAngle)
  const kickoffTeam = useGameStore((s) => s.kickoffTeam)
  const kickoffResetVersion = useGameStore((s) => s.kickoffResetVersion)
  const half = useGameStore((s) => s.half)

  const isGoalkeeper = role === 'gk'
  const isActive = !isGoalkeeper && team === getUserTeam() && id === activePlayerId
  const hasBall = ballPossession?.playerId === id

  useEffect(() => {
    if (hasBall && !isActive) {
      aiThinkTimer.current =
        AI_THINK_MIN_S * (0.55 + Math.random() * 0.65)
    }
    if (!hasBall) clearPlayerDribbleControl(id)
  }, [hasBall, ballPossession?.playerId, isActive, id])

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
    animCtrl.current = ctrl
    return () => {
      ctrl.dispose()
      animCtrl.current = null
    }
  }, [actions, mixer, cloned, role, id])

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
      isSprinting?: boolean
      dribbleBallOffset?: { x: number; z: number }
    },
  ) => {
    const ctrl = animCtrl.current
    registerPlayer({
      id,
      team,
      role,
      position: { x: pos.x, y: getPlayerBodyY(), z: pos.z },
      rotation: opts?.rotation ?? rotation.current,
      velocity: opts?.velocity ?? { x: 0, y: 0, z: 0 },
      isControlled: opts?.isControlled ?? isActive,
      isSprinting: opts?.isSprinting,
      dribbleBallOffset: opts?.dribbleBallOffset,
      anim: opts?.anim ?? ctrl?.getDisplayAnim() ?? 'player_idle',
    })
  }

  useEffect(() => {
    if (!setPieceShootAnim || setPieceShootAnim.kickerId !== id) return
    animCtrl.current?.playStrike('player_shoot')
    if (useGameStore.getState().setPieceShootAnim?.kickerId === id) {
      useGameStore.setState({ setPieceShootAnim: null })
    }
  }, [setPieceShootAnim?.at, id])

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
        gkAnimCtrl.current = boot
        registerGkHands(id, cloned)
      }
    } else if (!ctrl && modelRootRef.current && actions.player_idle && mixer) {
      const boot = new PlayerAnimController(actions, mixer)
      boot.init()
      animCtrl.current = boot
    }

    const animFree = isGoalkeeper ? !gkCtrl?.isLocked() : !ctrl?.isLocked()

    const finishAnimation = () => {
      if (isGoalkeeper) {
        gkCtrl?.update(simDelta)
      } else {
        ctrl?.update(simDelta)
      }
      mixer?.update(simDelta)
      if (modelRootRef.current) {
        modelRootRef.current.position.y = modelFootY.current
        modelRootRef.current.rotation.y = rotation.current
      }
      if (isGoalkeeper) {
        updateGkHandPositions(id, modelRootRef.current ?? undefined)
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
        const replayAnim = normalizePlayerAnim(snap.anim ?? 'player_run')
        if (replayAnim !== lastReplayAnim.current) {
          ctrl?.playReplay(replayAnim)
          lastReplayAnim.current = replayAnim
        }
        syncRegistry({ x: snap.x, z: snap.z }, { rotation: snap.rotation, anim: replayAnim })
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
      if (animFree) ctrl?.forceIdle()
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
        team === getUserTeam() ? isActive : team === storeState.kickoffTeam
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
      if (isActive && consumeAction?.('switchPlayer')) cycleTeammate()
      if (
        isActive &&
        consumePassPress?.() &&
        animFree &&
        canMove &&
        phase === 'playing' &&
        !hasBall &&
        !isGoalkeeper
      ) {
        performStandingSteal()
      }
      if (
        isActive &&
        team === getUserTeam() &&
        storeState.passIntent?.passType === 'cross' &&
        storeState.passIntent.receiverId === id &&
        !hasBall &&
        storeState.crossOneTouchActive &&
        canStrike &&
        phase === 'playing' &&
        controls.current.kick &&
        shouldVolleyCross(position.current, ballRef.current, ballRef.velocity)
      ) {
        performOneTouchCrossShot()
      }
      if (isActive && hasBall && canStrike && phase === 'playing') {
        const pendingPass = useGameStore.getState().consumePendingUserPass(id)
        if (pendingPass) {
          if (pendingPass.type === 'pass') performPass(pendingPass.power)
          else if (pendingPass.type === 'through') performThroughPass(pendingPass.power)
          else performCross(pendingPass.power)
        }
        const pendingShot = useGameStore.getState().consumePendingUserShot(id)
        if (pendingShot !== null) performKick(pendingShot)
      }
      if (
        isActive &&
        consumeAction?.('slide') &&
        animFree &&
        !hasBall &&
        phase === 'playing' &&
        !isGoalkeeper &&
        canMove &&
        canStartSlide(id)
      ) {
        performSlideTackle()
      }
      if (isActive && consumeAction?.('kick') && animFree) {
        if (phase === 'kickoff' && storeState.ballFrozen) {
          performKick()
        } else if (
          !hasBall &&
          phase === 'playing' &&
          !isGoalkeeper &&
          canMove &&
          canStartSlide(id)
        ) {
          performSlideTackle()
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
      !hasBall &&
      !isActive &&
      !(passIntentEarly != null &&
        (passIntentEarly.receiverId === id || passIntentEarly.runnerIds?.includes(id))) &&
      opponentHasBallEarly &&
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
      !hasBall &&
      !isActive &&
      !(passIntentEarly != null &&
        (passIntentEarly.receiverId === id || passIntentEarly.runnerIds?.includes(id))) &&
      opponentHasBallEarly &&
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
        const roleMul = role === 'def' ? 1 : role === 'mid' ? 0.78 : 0.35
        let rollChance = STANDING_STEAL_AI_CHANCE * roleMul
        if (!isPrimaryMarkerEarly) rollChance *= 0.55
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

        // Animação in-place — corpo fixo; alcance do tackle via getSlideFeetPoint
        bodyRef.current.setNextKinematicTranslation({
          x: position.current.x,
          y: getPlayerBodyY(),
          z: position.current.z,
        })
        if (modelRootRef.current) modelRootRef.current.rotation.y = rotation.current
        velocity.current.set(0, 0, 0)
        processSlideContacts(id)
        syncRegistry(position.current, {
          velocity: { x: 0, y: 0, z: 0 },
        })
      }
      return
    }

    const storePoss = storeState.ballPossession
    const isLiveActive =
      team === getUserTeam() && !isGoalkeeper && storeState.activePlayerId === id
    if (
      storePoss?.playerId === id &&
      storeState.possessionSince !== lastPossessionSince.current
    ) {
      lastPossessionSince.current = storeState.possessionSince
      if (!isLiveActive && team !== getUserTeam()) {
        aiThinkTimer.current =
          AI_THINK_MIN_S * (0.55 + Math.random() * 0.65)
      }
    }

    if (
      storePoss?.playerId === id &&
      canMove &&
      animFree &&
      phase === 'playing' &&
      (isGoalkeeper || !isLiveActive)
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
      !hasBall &&
      !isPassReceiver &&
      isTeamMarker(id, team, currentPoss, ballRef.current) &&
      opponentHasBall &&
      currentPoss !== null

    const receivingPass =
      isPassReceiver &&
      !hasBall &&
      canMove &&
      !currentPoss

    const shotLockActive =
      isActive &&
      team === getUserTeam() &&
      !isGoalkeeper &&
      hasBall &&
      canMove &&
      !bodyActionLocked &&
      phase === 'playing' &&
      !!controls?.current &&
      storeState.shotChargeActive &&
      (storeState.powerBarMode === 'shot' ||
        storeState.powerBarMode === 'pass' ||
        storeState.powerBarMode === 'through' ||
        storeState.powerBarMode === 'cross')

    if (receivingPass && passIntent) {
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
          userReceiver: isActive && team === getUserTeam(),
        },
      )

      const run = moveToward(
        target,
        !inReceiveAnim && distToReceive > (recvAnim.kind === 'player_header' ? 3.0 : 2.2),
        distToReceive,
        0.06,
      )
      dirX = run.dirX
      dirZ = run.dirZ
      sprint = !inReceiveAnim && distToReceive > 2.6
      moveScale = inReceiveAnim ? 0.42 : 1
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
    } else if (pressAsMarker) {
      const ai = getAIMove(simDelta)
      dirX = ai.dirX
      dirZ = ai.dirZ
      sprint = ai.sprint
      moveScale = ai.urgency
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

      const turnBlend = Math.hypot(turnDirX, turnDirZ) > 0.001 ? 0.12 : 0
      dirX = lockedDirX * (1 - turnBlend) + turnDirX * turnBlend
      dirZ = lockedDirZ * (1 - turnBlend) + turnDirZ * turnBlend
      sprint = !!controls?.current?.sprint
      moveScale = 1
      aiDirectMove.current = true
    } else if (isActive && controls?.current && canMove && !bodyActionLocked) {
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

    const shielding =
      hasBall &&
      isActive &&
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

    const playerControlled =
      isActive && controls?.current && canMove && !bodyActionLocked && !shotLockActive

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
      hasBall &&
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
        gkCtrl.playHandPass(() => {
          const intoField = getAttackSign(team, fieldBounds!)
          const ctx = getCarrierContext(id, role, fieldBounds!, ballRef.current)
          const mate = ctx ? findBestPassTarget(ctx) : null
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
          releaseBallFromFeet(dx * 7.5, 0.25, dz * 7.5, id, {
            loft: 0.32,
            releaseKind: 'pass',
          })
          finishGkDistribution(id)
          gkDistribTriggered.current = false
        })
      } else if (gkState?.mode === 'hold' || hasBall) {
        if (animFree) gkCtrl.forceIdleWithBall()
      } else if (
        gkState?.saveAnim &&
        (gkState.saveAnim !== lastGkSaveAnim.current || !gkCtrl.isSaving()) &&
        animFree
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
      rotation.current = rotateTowardAngle(
        rotation.current,
        faceTarget,
        GK_TURN_SPEED,
        simDelta,
      )
    }

    const gkRt = getGkRuntime(id)
    const interceptDist = gkRt?.interceptTarget
      ? distance2D(position.current, {
          x: gkRt.interceptTarget.x,
          y: 0,
          z: gkRt.interceptTarget.z,
        })
      : 0
    const speed = isGoalkeeper
      ? gkRt?.mode === 'save' && gkRt.allowStep
        ? GK_RUSH_SPEED * 0.85
        : interceptDist > 0.45
          ? GK_RUSH_SPEED
          : GK_SPEED
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

    const isMarking =
      pressAsMarker ||
      (opponentHasBall &&
        !hasBall &&
        !isPassReceiver &&
        (isTeamMarker(id, team, currentPoss, ballRef.current) ||
          (isCoverPresser(id, team) && preMoveSpeed < 1.85)))

    const holdingPosition =
      intentLen < 0.04 &&
      preMoveSpeed < 0.15 &&
      !receivingPass &&
      !hasBall

    const ballFocusMode =
      phase === 'playing' &&
      !hasBall &&
      !ctrl?.isStriking() &&
      !isPlayerSliding(id) &&
      (isMarking || holdingPosition || ctrl?.locksFacing() === true || receivingPass)

    const useStrafeLoco = isMarking && !isActive && ballFocusMode

    if (
      !isGoalkeeper &&
      !bodyActionLocked &&
      !shielding
    ) {
      const ball = ballRef.current
      const faceBall = ballFocusMode

      let targetYaw = rotation.current
      if (dribbleOut.forcedYaw != null) {
        targetYaw = dribbleOut.forcedYaw
      } else if (ctrl?.locksFacing()) {
        targetYaw = getBallFocusFacing(position.current, ball)
      } else if (
        receivingPass &&
        distance2D(position.current, ball) < 5.5
      ) {
        targetYaw = getBallFocusFacing(position.current, ball)
      } else if (faceBall) {
        targetYaw = getBallFocusFacing(position.current, ball)
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
        } else if (hasBall) {
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
        dribbleBallOffset: hasBall
          ? { x: dribbleBallOffset.current.x, z: dribbleBallOffset.current.z }
          : undefined,
      },
    )
    } finally {
      finishAnimation()
    }
  })

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
      return { ...getGoalkeeperMove(poss, lastTouch, predicted, delta), direct: true }
    }

    if (hasBall) {
      const ctx = getCarrierContext(id, role, bounds, ball)
      if (ctx && !isActive) {
        const lookahead = role === 'fwd' ? 3.6 : role === 'mid' ? 2.8 : 2.1
        const dribble = getDribbleTarget(ctx, lookahead)
        tacticalTarget.current = smoothToward(tacticalTarget.current, dribble, delta, 2.2)
        const d = getDribbleDirection(ctx)
        rotation.current = rotateTowardAngle(
          rotation.current,
          Math.atan2(d.x, d.z),
          PLAYER_TURN_SPEED_AI,
          delta,
        )
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
    if (!tacticalDirect) {
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
      distTarget > 2.5

    const arriveDist = tacticalDirect
      ? 0.08
      : getRoleArriveDist(
          role,
          defendingShape,
          isMarker && opponentHasBall,
        )

    return { ...moveToward(tacticalTarget.current, sprint, distTarget, arriveDist), direct: tacticalDirect }
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
    lastTouch: ReturnType<typeof useGameStore.getState>['lastTouchTeam'],
    predicted: Vec3,
    delta: number,
  ) {
    const bounds = fieldBounds!
    const gkState = getGkRuntime(id)
    const ball = ballRef.current
    const vel = ballRef.velocity

    if (gkState?.mode === 'save' && gkState.allowStep) {
      const stepTarget = getGkMoveTarget(id, team, bounds, predicted)
      if (stepTarget) {
        gkTarget.current = smoothToward(gkTarget.current, stepTarget, delta, 5.5)
        const d = distance2D(position.current, {
          x: gkTarget.current.x,
          y: 0,
          z: gkTarget.current.z,
        })
        return moveToward(gkTarget.current, true, d, 0.05)
      }
    }

    if (isGkBodyLocked(id)) {
      return { dirX: 0, dirZ: 0, sprint: false, urgency: 0 }
    }

    if (poss?.playerId === id) {
      return { dirX: 0, dirZ: 0, sprint: false, urgency: 0 }
    }

    const intercept = getGkPositionTarget(id, team, bounds, ball, vel)
    if (intercept) {
      gkTarget.current = smoothToward(gkTarget.current, intercept, delta, 4.8)
      const d = distance2D(position.current, {
        x: gkTarget.current.x,
        y: 0,
        z: gkTarget.current.z,
      })
      return moveToward(gkTarget.current, d > 0.55, d, 0.06)
    }

    const raw = getDynamicGKPosition(team, formation, bounds, predicted, poss, lastTouch)
    const goalZ = getDefensiveGoalZ(team, bounds)
    const intoField = getAttackSign(team, bounds)
    raw.z = goalZ + intoField * 0.11
    raw.x = raw.x * 0.35 + predicted.x * 0.65

    gkTarget.current = smoothToward(gkTarget.current, raw, delta, 2.8)
    return moveToward(gkTarget.current, false, -1, 0.08)
  }

  function cycleTeammate() {
    const store = useGameStore.getState()
    const idx = HOME_OUTFIELD.indexOf(store.activePlayerId)
    const next = idx >= 0 ? (idx + 1) % HOME_OUTFIELD.length : 0
    store.setActivePlayer(HOME_OUTFIELD[next])
  }

  function mySnapshot(): PlayerRef {
    return {
      id,
      team,
      role,
      position: { x: position.current.x, y: getPlayerBodyY(), z: position.current.z },
      rotation: rotation.current,
      velocity: { x: 0, y: 0, z: 0 },
      isControlled: isActive,
      anim: (isGoalkeeper
        ? (gkAnimCtrl.current?.getDisplayAnim() ?? 'gk_idle')
        : (animCtrl.current?.getDisplayAnim() ?? 'player_idle')) as PlayerAnim,
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
    const power = 0.42 + Math.random() * 0.48
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

  function applyStrikeFacing(dir: { x: number; z: number }) {
    rotation.current = Math.atan2(dir.x, dir.z)
    if (modelRootRef.current) {
      modelRootRef.current.rotation.y = rotation.current
    }
  }

  function playStrikeRelease(
    anim: 'player_pass' | 'player_shoot' | 'player_kick',
    onContact: () => void,
  ) {
    animCtrl.current?.playStrike(anim, { onContact, instantContact: true })
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

  function performPass(power = 0.55) {
    if (!hasBall || !fieldBounds) return
    const strikeDir = getStrikeDirection()
    applyStrikeFacing(strikeDir)
    const me = mySnapshot()
    const teammates = [...playerRegistry.values()].filter(
      (p) => p.team === team && p.id !== id && p.role !== 'gk',
    )
    const mate = findPassTargetInFacingDirection(me, teammates)
    performPassTo(mate, { power })
  }

  function performThroughPass(power = 0.62) {
    if (!hasBall || !fieldBounds) return
    const strikeDir = getStrikeDirection()
    applyStrikeFacing(strikeDir)
    const me = mySnapshot()
    const teammates = [...playerRegistry.values()].filter(
      (p) => p.team === team && p.id !== id && p.role !== 'gk',
    )
    const ballZ = ballRef.current?.z ?? me.position.z
    const mate =
      findThroughPassTarget(me, teammates, fieldBounds, team, ballZ) ??
      findPassTargetInFacingDirection(me, teammates, {
        minDist: 4,
        maxDist: 32,
        minDot: 0.48,
        maxLateralRatio: 0.48,
      })
    performPassTo(mate, { through: true, power })
  }

  function performCross(power = 0.68) {
    if (!hasBall || !fieldBounds) return
    const strikeDir = getStrikeDirection()
    applyStrikeFacing(strikeDir)
    const me = mySnapshot()
    const teammates = [...playerRegistry.values()].filter(
      (p) => p.team === team && p.id !== id && p.role !== 'gk',
    )
    const ballZ = ballRef.current?.z ?? me.position.z
    const mate =
      findCrossTarget(me, teammates, fieldBounds, team, ballZ) ??
      findPassTargetInFacingDirection(me, teammates, {
        minDist: 4,
        maxDist: 28,
        minDot: 0.45,
        maxLateralRatio: 0.85,
      })
    performCrossTo(mate, power)
  }

  function performCrossTo(mate: PlayerRef | null, power = 0.68) {
    if (!fieldBounds || !hasBall || animCtrl.current?.isStriking()) return

    const store = useGameStore.getState()
    const me = mySnapshot()
    const strikeDir = getStrikeDirection()

    let dx = strikeDir.x
    let dz = strikeDir.z
    let speed = crossSpeedFromPower(crossSpeedForDistance(14), power)
    let targetX = me.position.x + dx * 12
    let targetZ = me.position.z + dz * 12
    let loft = crossLoftFromPower(power, CROSS_LOFT)

    if (mate) {
      if (team === getUserTeam()) {
        store.setActivePlayer(mate.id)
      }

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

    playStrikeRelease('player_pass', () => {
      releaseBallFromFeet(dx * speed, 0, dz * speed, id, {
        loft,
        releaseKind: 'cross',
      })
    })
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
    opts?: { kickoff?: boolean; through?: boolean; power?: number },
  ) {
    if (!fieldBounds) return
    if (!opts?.kickoff && !hasBall) return
    if (!opts?.kickoff && animCtrl.current?.isStriking()) return

    const store = useGameStore.getState()
    const me = mySnapshot()
    const power = opts?.power ?? (opts?.through ? 0.62 : 0.55)
    const strikeDir = opts?.kickoff
      ? { x: Math.sin(rotation.current), z: Math.cos(rotation.current) }
      : getStrikeDirection()

    let dx = strikeDir.x
    let dz = strikeDir.z
    let baseSpeed = opts?.through
      ? throughPassSpeedForDistance(12)
      : passSpeedForDistance(8)
    let speed = opts?.through
      ? throughSpeedFromPower(baseSpeed, power)
      : passSpeedFromPower(baseSpeed, power)

    if (mate) {
      if (team === getUserTeam()) {
        store.setActivePlayer(mate.id)
      }

      const dist = distance2D(me.position, mate.position)
      baseSpeed = opts?.through
        ? throughPassSpeedForDistance(dist)
        : passSpeedForDistance(dist)
      speed = opts?.through
        ? throughSpeedFromPower(baseSpeed, power)
        : passSpeedFromPower(baseSpeed, power)
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
    playStrikeRelease('player_pass', () => {
      releaseBallFromFeet(dx * speed, 0, dz * speed, id, {
        loft: passLoft,
        releaseKind,
      })
    })
  }

  function slideActiveMs(): number {
    const ctrl = animCtrl.current
    const durSec = ctrl?.playbackDurationSec('player_tackle') ?? SLIDE_DURATION_MS / 1000
    return durSec * 0.62 * 1000
  }

  function performStandingSteal() {
    if (hasBall || isGoalkeeper) return
    tryStandingSteal(id)
  }

  function performSlideTackle() {
    if (!fieldBounds || isGoalkeeper || !canPlayerPlay(id)) return
    const fx = Math.sin(rotation.current)
    const fz = Math.cos(rotation.current)
    if (!startSlide(id, fx, fz, slideActiveMs())) return
    animCtrl.current?.startSlide()
  }

  function performKick(power = 0.75) {
    const store = useGameStore.getState()

    if (phase === 'kickoff' && team === store.kickoffTeam && isActive && store.ballFrozen) {
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

    if (!hasBall) return

    const strikeDir = getStrikeDirection()
    applyStrikeFacing(strikeDir)
    const speed = shotSpeedFromPower(power)
    const loft = shotLoftFromPower(power)
    playStrikeRelease('player_shoot', () => {
      releaseBallFromFeet(strikeDir.x * speed, 0, strikeDir.z * speed, id, {
        loft,
        releaseKind: 'shot',
      })
    })
  }

  return (
    <RigidBody
      ref={bodyRef}
      type="kinematicPosition"
      colliders={false}
      position={[spawn.x, getPlayerBodyY(), spawn.z]}
      userData={{ isPlayer: true, team, id }}
    >
      <CapsuleCollider args={[PLAYER_HEIGHT / 2 - PLAYER_RADIUS, PLAYER_RADIUS]} />
      <primitive ref={modelRootRef} object={cloned} />
      {isActive && phase !== 'replay' && (
        <PlayerSelectionLabel team={team} id={id} />
      )}
    </RigidBody>
  )
}
