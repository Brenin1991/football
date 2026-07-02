import { CapsuleCollider, RigidBody, type RapierRigidBody } from '@react-three/rapier'
import { useFrame } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef, type MutableRefObject } from 'react'
import * as THREE from 'three'
import { SkeletonUtils } from 'three-stdlib'
import {
  GK_SPEED,
  GK_RUSH_SPEED,
  PLAYER_HEIGHT,
  PLAYER_RADIUS,
  PLAYER_SPEED,
  PLAYER_SPRINT_SPEED,
  PLAYER_TURN_SPEED_AI,
  PLAYER_TURN_SPEED_CONTROLLED,
  LOOSE_BALL_MAX_SPEED,
  GK_TURN_SPEED,
  SHOT_LOFT,
  SHOT_SPEED,
  getHomeOutfieldIds,
} from '../constants'
import { passSpeedForDistance, releaseBallFromFeet } from './TeamController'
import { PlayerSelectionLabel } from './PlayerSelectionLabel'
import { usePlayerAssets } from '../context/PlayerAssetsContext'
import { useGameStore, USER_TEAM } from '../store/gameStore'
import { applyPlayerMaterials } from '../psx/psxMaterials'
import type { FormationSlot, PlayerAnim, PlayerRole, TeamId, Vec3 } from '../types'
import {
  ballRef,
  playerRegistry,
  registerPlayer,
  unregisterPlayer,
  type PlayerRef,
} from '../systems/entityRegistry'
import { findNearestTeammate, findPassTargetInFacingDirection, getPassInterceptTarget, getPassReceiveTarget } from '../systems/possession'
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
import { getAttackSign, getAttackingGoalZ as getGoalZ, getFieldFacingRotation, getFormationSpawn, isBallInDefensiveThird } from '../systems/teamField'
import {
  getCornerSetupTarget,
  getGoalKickPushTarget,
  getKickerStandPosition,
  getSetPiecePlayerSpot,
  getThrowInSetupTarget,
  isActiveSetPiecePhase,
} from '../systems/setPiece'
import { shotLoftFromPower, shotSpeedFromPower } from '../systems/shotPower'
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
import { usePlayerMixer } from '../systems/usePlayerMixer'
import { canPlayerPlay, getOffsideFlagAtPass, getSentOffSpot } from '../systems/referee'
import { getSimDelta } from '../systems/gameTime'
import {
  assessShotThreat,
  consumeGkPositionSnap,
  getGkRuntime,
  getThreatAwareGkPosition,
  isGkBodyLocked,
} from '../systems/goalkeeper'
import { entranceSystem } from '../systems/teamEntrance'
import { isFieldParadePhase } from '../systems/matchPhases'
import { replaySystem } from '../systems/replaySystem'
import type { ControlState } from '../hooks/useKeyboardControls'
import { clearBallShield, setBallShield } from '../systems/ballShield'
import { tryStandingSteal } from '../systems/standingSteal'

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

  if (team === USER_TEAM) {
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

export function Player({
  id,
  team,
  role,
  spawn,
  formation,
  controls,
  consumeAction,
}: PlayerProps) {
  const { scene, animations } = usePlayerAssets()
  const modelRootRef = useRef<THREE.Group>(null)
  const bodyRef = useRef<RapierRigidBody>(null)
  const modelFootY = useRef(-PLAYER_HEIGHT / 2)

  const cloned = useMemo(() => {
    const model = SkeletonUtils.clone(scene) as THREE.Group
    applyPlayerMaterials(model, team, role, false)
    alignPlayerModelToCapsule(model)
    modelFootY.current = model.position.y
    return model
  }, [scene, team, role])
  const { actions, mixer } = usePlayerMixer(animations, modelRootRef)
  const animCtrl = useRef<PlayerAnimController | null>(null)

  const velocity = useRef(new THREE.Vector3())
  const rotation = useRef(0)
  const position = useRef(new THREE.Vector3(spawn.x, 0, spawn.z))
  const tacticalTarget = useRef({ x: spawn.x, z: spawn.z })
  const gkTarget = useRef({ x: spawn.x, z: spawn.z })
  const ballAnchor = useRef({ x: spawn.x, z: spawn.z })
  const locoMoving = useRef(false)
  const aiMoveDir = useRef({ x: 0, z: 0 })
  const aiDirectMove = useRef(false)
  const aiThinkTimer = useRef(0)
  const aiSlideTimer = useRef(0)
  const aiStealTimer = useRef(0)
  const knockdownActive = useRef(false)
  const lastReplayAnim = useRef<PlayerAnim | null>(null)
  const lastPossessionSince = useRef(0)

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
  const isActive = !isGoalkeeper && team === USER_TEAM && id === activePlayerId
  const hasBall = ballPossession?.playerId === id

  useEffect(() => {
    if (hasBall && !isActive) {
      aiThinkTimer.current =
        AI_THINK_MIN_S * (0.55 + Math.random() * 0.65)
    }
  }, [hasBall, ballPossession?.playerId, isActive])

  useEffect(() => {
    if (!fieldBounds || kickoffResetVersion === 0) return
    const spot = getFormationSpawn(team, formation, fieldBounds)
    position.current.set(spot.x, 0, spot.z)
    tacticalTarget.current = { x: spot.x, z: spot.z }
    gkTarget.current = { x: spot.x, z: spot.z }
    ballAnchor.current = { x: spot.x, z: spot.z }
    rotation.current = getFieldFacingRotation(team, fieldBounds)
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
    if (!mixer || !modelRootRef.current || !actions.idle) return
    const ctrl = new PlayerAnimController(actions, mixer)
    ctrl.init()
    animCtrl.current = ctrl
    return () => {
      ctrl.dispose()
      animCtrl.current = null
    }
  }, [actions, mixer, cloned])

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
    opts?: { velocity?: Vec3; rotation?: number; isControlled?: boolean; anim?: PlayerAnim },
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
      anim: opts?.anim ?? ctrl?.getDisplayAnim() ?? 'idle',
    })
  }

  useEffect(() => {
    if (!setPieceShootAnim || setPieceShootAnim.kickerId !== id) return
    animCtrl.current?.playStrike('shoot')
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
    const ctrl = animCtrl.current

    if (!ctrl && modelRootRef.current && actions.idle && mixer) {
      const boot = new PlayerAnimController(actions, mixer)
      boot.init()
      animCtrl.current = boot
    }

    const animFree = !ctrl?.isLocked()

    const finishAnimation = () => {
      const frameCtrl = animCtrl.current
      frameCtrl?.update(simDelta)
      mixer?.update(simDelta)
      if (modelRootRef.current) {
        modelRootRef.current.position.y = modelFootY.current
        modelRootRef.current.rotation.y = rotation.current
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
          ctrl?.forceLocomotion(actor.moving ? 'run' : 'idle', actor.moving)
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
          if (animFree) ctrl?.forceLocomotion('run', true)
        } else if (animFree) {
          ctrl?.playStrike('shoot')
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
        const replayAnim = snap.anim ?? 'run'
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
        team === USER_TEAM ? isActive : team === storeState.kickoffTeam
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
      syncRegistry(position.current, {
        velocity: { x: 0, y: 0, z: 0 },
      })
      return
    }
    if (knockdownActive.current) {
      knockdownActive.current = false
      ctrl?.endKnockdown()
    }

    if (isGoalkeeper) {
      const snap = consumeGkPositionSnap(id)
      if (snap) {
        position.current.set(snap.x, 0, snap.z)
        bodyRef.current.setNextKinematicTranslation({
          x: snap.x,
          y: getPlayerBodyY(),
          z: snap.z,
        })
      }
    }

    if (ctrl?.isSliding() && !isPlayerSliding(id)) {
      ctrl.endSlide()
    }

    const canMove =
      (phase === 'playing' && !ballFrozen) || (phase === 'kickoff' && !ballFrozen)

    if (controls?.current) {
      if (isActive && consumeAction?.('switchPlayer')) cycleTeammate()
      if (
        isActive &&
        consumeAction?.('pass') &&
        animFree &&
        canMove &&
        phase === 'playing'
      ) {
        if (hasBall) performPass()
        else if (!isGoalkeeper) performStandingSteal()
      }
      if (
        isActive &&
        consumeAction?.('throughPass') &&
        animFree &&
        canMove &&
        hasBall &&
        phase === 'playing'
      ) {
        performThroughPass()
      }
      if (
        isActive &&
        hasBall &&
        animFree &&
        canMove &&
        phase === 'playing' &&
        consumeAction?.('cross')
      ) {
        performCross()
      }
      if (
        isActive &&
        team === USER_TEAM &&
        storeState.passIntent?.passType === 'cross' &&
        storeState.passIntent.receiverId === id &&
        !hasBall &&
        storeState.crossOneTouchActive &&
        animFree &&
        phase === 'playing' &&
        controls.current.kick &&
        shouldVolleyCross(position.current, ballRef.current, ballRef.velocity)
      ) {
        performOneTouchCrossShot()
      }
      if (
        isActive &&
        hasBall &&
        animFree &&
        phase === 'playing'
      ) {
        const pendingShot = useGameStore.getState().consumePendingUserShot(id)
        if (pendingShot !== null) performKick(pendingShot)
      }
      if (
        isActive &&
        (consumeAction?.('cross') || consumeAction?.('slide')) &&
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
      team === USER_TEAM && !isGoalkeeper && storeState.activePlayerId === id
    if (
      storePoss?.playerId === id &&
      storeState.possessionSince !== lastPossessionSince.current
    ) {
      lastPossessionSince.current = storeState.possessionSince
      if (!isLiveActive && team !== USER_TEAM) {
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

    const bodyActionLocked =
      (ctrl?.isBodyLocked() ?? false) || (isGoalkeeper && isGkBodyLocked(id))
    const passFacingLocked = ctrl?.locksFacing() ?? false
    const canUpdateLocoAnim =
      animFree || (ctrl?.allowsLocomotionDuringAction() ?? false)

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

    if (receivingPass && passIntent) {
      const target = getPassReceiveTarget(
        position.current,
        ballRef.current,
        ballRef.velocity,
        passIntent,
      )
      const distToReceive = distance2D(position.current, { x: target.x, y: 0, z: target.z })
      const run = moveToward(target, true, distToReceive, 0.06)
      dirX = run.dirX
      dirZ = run.dirZ
      sprint = true
      moveScale = 1
      aiDirectMove.current = true
    } else if (pressAsMarker) {
      const ai = getAIMove(simDelta)
      dirX = ai.dirX
      dirZ = ai.dirZ
      sprint = ai.sprint
      moveScale = ai.urgency
      aiDirectMove.current = ai.direct
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
        sprint = c.sprint || stickLen > 0.92
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
      isActive && controls?.current && canMove && !bodyActionLocked
    if (!playerControlled && canMove && !bodyActionLocked && !aiDirectMove.current) {
      const rawLen = Math.hypot(dirX, dirZ)
      if (rawLen > 0.025) {
        const blend = 1 - Math.exp(-10 * simDelta)
        aiMoveDir.current.x += (dirX - aiMoveDir.current.x) * blend
        aiMoveDir.current.z += (dirZ - aiMoveDir.current.z) * blend
        const smLen = Math.hypot(aiMoveDir.current.x, aiMoveDir.current.z)
        if (smLen > 0.02) {
          dirX = aiMoveDir.current.x / smLen
          dirZ = aiMoveDir.current.z / smLen
        }
      } else {
        aiMoveDir.current.x = 0
        aiMoveDir.current.z = 0
      }
    } else {
      aiMoveDir.current.x = dirX
      aiMoveDir.current.z = dirZ
    }

    if (isGoalkeeper && animFree) {
      const gkState = getGkRuntime(id)
      if (gkState?.mode === 'parry' || gkState?.mode === 'punch') {
        if (ctrl?.getAction() !== 'kick') ctrl?.playStrike('kick')
      } else if (gkState?.mode === 'catch' || gkState?.mode === 'hold') {
        ctrl?.forceIdle()
      }
      if (gkState?.faceAngle != null) {
        rotation.current = gkState.faceAngle
      }
    }

    const speed = isGoalkeeper
      ? getGkRuntime(id)?.mode === 'rush'
        ? GK_RUSH_SPEED
        : GK_SPEED
      : sprint
        ? PLAYER_SPRINT_SPEED
        : PLAYER_SPEED
    const intentLen = Math.hypot(dirX, dirZ)
    let moveX = 0
    let moveZ = 0
    const projectedMove = intentLen > 0.02 ? speed * simDelta * moveScale : 0

    if (intentLen > 0.02) {
      dirX /= intentLen
      dirZ /= intentLen
      // Gira só com deslocamento real (alinha com run) ou já em corrida — evita girar em idle/T-pose
      // e preserva pose durante chute/carrinho (bodyActionLocked).
      if (
        !passFacingLocked &&
        !bodyActionLocked &&
        !shielding &&
        (locoMoving.current || projectedMove > RUN_STOP_THRESHOLD)
      ) {
        const targetYaw = Math.atan2(dirX, dirZ)
        const turnSpeed =
          isActive && controls?.current
            ? PLAYER_TURN_SPEED_CONTROLLED
            : isGoalkeeper
              ? GK_TURN_SPEED
              : moveScale < 0.6
                ? PLAYER_TURN_SPEED_AI * 0.78
                : PLAYER_TURN_SPEED_AI
        rotation.current = rotateTowardAngle(
          rotation.current,
          targetYaw,
          turnSpeed,
          simDelta,
        )
      }
      moveX = dirX * speed * simDelta * moveScale
      moveZ = dirZ * speed * simDelta * moveScale
    }

    if (bodyActionLocked) {
      moveX = 0
      moveZ = 0
    }

    const prevX = position.current.x
    const prevZ = position.current.z
    let nx = position.current.x + moveX
    let nz = position.current.z + moveZ
    nx = THREE.MathUtils.clamp(nx, fieldBounds.minX + PLAYER_RADIUS, fieldBounds.maxX - PLAYER_RADIUS)
    nz = THREE.MathUtils.clamp(nz, fieldBounds.minZ + PLAYER_RADIUS, fieldBounds.maxZ - PLAYER_RADIUS)

    const moved = Math.hypot(nx - prevX, nz - prevZ)

    position.current.set(nx, 0, nz)
    bodyRef.current.setNextKinematicTranslation({ x: nx, y: getPlayerBodyY(), z: nz })
    if (modelRootRef.current) modelRootRef.current.rotation.y = rotation.current

    if (canUpdateLocoAnim) {
      if (shielding) {
        locoMoving.current = false
        ctrl?.forceIdle()
        velocity.current.set(0, 0, 0)
      } else {
      const wantsRun =
        !bodyActionLocked &&
        (moved > RUN_START_THRESHOLD ||
          (intentLen > 0.04 && projectedMove > RUN_STOP_THRESHOLD * 1.4))
      if (wantsRun) {
        locoMoving.current = true
      } else if (intentLen < 0.015 && moved < RUN_STOP_THRESHOLD) {
        locoMoving.current = false
      }

      if (locoMoving.current) {
        ctrl?.setLocomotion(true, sprint || moveScale > 0.55)
        velocity.current.set((nx - prevX) / Math.max(simDelta, 1e-6), 0, (nz - prevZ) / Math.max(simDelta, 1e-6))
      } else {
        ctrl?.setLocomotion(false, false)
        velocity.current.set(0, 0, 0)
      }
      }
    } else if (bodyActionLocked) {
      velocity.current.set(0, 0, 0)
    }

    syncRegistry({ x: nx, z: nz }, {
      velocity: { x: velocity.current.x, y: 0, z: velocity.current.z },
    })
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
    const store = useGameStore.getState()
    const ball = ballRef.current
    const vel = ballRef.velocity
    const gkState = getGkRuntime(id)

    if (gkState?.diveTarget && (gkState.mode === 'rush' || gkState.mode === 'parry')) {
      const d = distance2D(position.current, {
        x: gkState.diveTarget.x,
        y: 0,
        z: gkState.diveTarget.z,
      })
      return moveToward(gkState.diveTarget, true, d, 0.04)
    }

    const threat =
      store.goalZones.length > 0 && !poss
        ? assessShotThreat(ball, vel, bounds, store.goalZones)
        : null

    if (threat && threat.defendingTeam === team) {
      const intoField = getAttackSign(team, bounds)
      const rushDepth =
        threat.timeToGoal < 0.55 ? 0.7 : threat.timeToGoal < 1.1 ? 1.05 : 1.45
      const target =
        threat.timeToGoal < 1.35
          ? {
              x: threat.interceptX,
              z: threat.goalZ + intoField * rushDepth,
            }
          : getThreatAwareGkPosition(position.current, threat, bounds, team)
      gkTarget.current = smoothToward(gkTarget.current, target, delta, 3.2)
      const d = distance2D(position.current, {
        x: gkTarget.current.x,
        y: 0,
        z: gkTarget.current.z,
      })
      const rush = threat.urgency > 0.35 || threat.timeToGoal < 1.15
      return moveToward(gkTarget.current, rush, d, rush ? 0.04 : 0.1)
    }

    const ballNear = isBallInDefensiveThird(ball, team, bounds)
    const distBall = distance2D(position.current, predicted)
    const sweeper =
      !poss &&
      ballNear &&
      distBall > 0.55 &&
      distBall < 6.8 &&
      Math.hypot(vel.x, vel.z) < 7.5

    if (sweeper) {
      const n = normalize2D(predicted.x - position.current.x, predicted.z - position.current.z)
      return { dirX: n.x, dirZ: n.z, sprint: false, urgency: 0.9 }
    }

    if (poss?.playerId === id) {
      const intoField = getAttackSign(team, bounds)
      return { dirX: 0, dirZ: intoField, sprint: false, urgency: 0.65 }
    }

    const raw = getDynamicGKPosition(team, formation, bounds, predicted, poss, lastTouch)
    gkTarget.current = smoothToward(gkTarget.current, raw, delta, 1.65)
    return moveToward(gkTarget.current, false, -1)
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
      anim: animCtrl.current?.getDisplayAnim() ?? 'idle',
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
        performPassTo(target)
      }
      return
    }

    aiThinkTimer.current =
      AI_DRIBBLE_THINK_MIN_S +
      Math.random() * (AI_DRIBBLE_THINK_MAX_S - AI_DRIBBLE_THINK_MIN_S)
  }

  function performAIShot(dir: { x: number; z: number }) {
    animCtrl.current?.playStrike('shoot', {
      onContact: () => {
        releaseBallFromFeet(dir.x * SHOT_SPEED, 0, dir.z * SHOT_SPEED, id, {
          loft: SHOT_LOFT,
          releaseKind: 'shot',
        })
      },
    })
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

  function performPass() {
    if (!hasBall || !fieldBounds) return
    const me = mySnapshot()
    const teammates = [...playerRegistry.values()].filter(
      (p) => p.team === team && p.id !== id && p.role !== 'gk',
    )
    const mate = findPassTargetInFacingDirection(me, teammates)
    performPassTo(mate)
  }

  function performThroughPass() {
    if (!hasBall || !fieldBounds) return
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
    performPassTo(mate, { through: true })
  }

  function performCross() {
    if (!hasBall || !fieldBounds) return
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
    performCrossTo(mate)
  }

  function performCrossTo(mate: PlayerRef | null) {
    if (!fieldBounds || !hasBall || animCtrl.current?.isLocked()) return

    const store = useGameStore.getState()
    const me = mySnapshot()

    let dx = Math.sin(rotation.current)
    let dz = Math.cos(rotation.current)
    let speed = crossSpeedForDistance(14)
    let targetX = me.position.x + dx * 12
    let targetZ = me.position.z + dz * 12

    if (mate) {
      if (team === USER_TEAM) {
        store.setActivePlayer(mate.id)
      }

      const lead = getCrossReceiveLead(mate, fieldBounds, team)
      const dist = distance2D(me.position, mate.position)
      speed = crossSpeedForDistance(dist)
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

    animCtrl.current?.playStrike('pass', {
      onContact: () => {
        releaseBallFromFeet(dx * speed, 0, dz * speed, id, {
          loft: CROSS_LOFT,
          releaseKind: 'cross',
        })
      },
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
    animCtrl.current?.playStrike('shoot', {
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
    opts?: { kickoff?: boolean; through?: boolean },
  ) {
    if (!fieldBounds) return
    if (!opts?.kickoff && !hasBall) return
    if (!opts?.kickoff && animCtrl.current?.isLocked()) return

    const store = useGameStore.getState()
    const me = mySnapshot()

    let dx = Math.sin(rotation.current)
    let dz = Math.cos(rotation.current)
    let speed = opts?.through
      ? throughPassSpeedForDistance(12)
      : passSpeedForDistance(8)

    if (mate) {
      if (team === USER_TEAM) {
        store.setActivePlayer(mate.id)
      }

      const dist = distance2D(me.position, mate.position)
      speed = opts?.through
        ? throughPassSpeedForDistance(dist)
        : passSpeedForDistance(dist)
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
      speed = throughPassSpeedForDistance(fallback.dist)
      setOpenSpacePassIntent(me, team, dx, dz, fallback.dist, 'through')
    } else {
      setOpenSpacePassIntent(me, team, dx, dz, 8, 'pass')
    }

    const passLoft = opts?.through ? 0.05 : 0
    const releaseKind = opts?.through ? 'through' : 'pass'
    animCtrl.current?.playStrike('pass', {
      onContact: () => {
        releaseBallFromFeet(dx * speed, 0, dz * speed, id, {
          loft: passLoft,
          releaseKind,
        })
      },
    })
  }

  function slideActiveMs(): number {
    const ctrl = animCtrl.current
    const durSec = ctrl?.playbackDurationSec('carrinho') ?? SLIDE_DURATION_MS / 1000
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

    const speed = shotSpeedFromPower(power)
    const loft = shotLoftFromPower(power)
    const dx = Math.sin(rotation.current)
    const dz = Math.cos(rotation.current)
    animCtrl.current?.playStrike('shoot', {
      onContact: () => {
        releaseBallFromFeet(dx * speed, 0, dz * speed, id, {
          loft,
          releaseKind: 'shot',
        })
      },
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
