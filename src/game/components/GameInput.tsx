import { useFrame } from '@react-three/fiber'
import type { MutableRefObject } from 'react'
import { useRef } from 'react'
import {
  CORNER_KICK_CAMERA_RETURN_DELAY,
  GOAL_KICK_AUTO_DELAY,
  PENALTY_AUTO_DELAY,
  SET_PIECE_DELAY,
} from '../constants'
import type { ControlState } from '../hooks/useKeyboardControls'
import { ballRef, playerRegistry } from '../systems/entityRegistry'
import { distance2D } from '../systems/rules'
import { useGameStore, getUserTeam } from '../store/gameStore'
import { startKickoff } from '../systems/kickoff'
import { executeSetPieceKick, isActiveSetPiecePhase } from '../systems/setPiece'
import {
  createShotChargeState,
  finalizePower,
  getPowerChargeDuration,
  getPowerFillSpeed,
  QUICK_PASS_POWER,
  QUICK_PASS_TAP_MS,
  updatePowerFill,
  type PowerBarMode,
} from '../systems/shotPower'
import { getSimDelta, isUserPauseActive } from '../systems/gameTime'
import { computeShotAimDirection, computeStrikeDirection } from '../systems/strikeAim'
import { switchUserPlayer } from '../systems/playerSwitch'
import { canAnticipateStrike, getAnticipatedStrikerId, getPassReceiverId, canManualSwitchPlayer } from '../systems/anticipation'

type GameInputProps = {
  controls: MutableRefObject<ControlState>
  consumeKickRelease: () => boolean
}

const AIM_ROTATE_SPEED = 2.4

type PassChargeKind = 'pass' | 'through' | 'cross'
type ShotContext = 'open' | 'setpiece' | 'anticipate' | null

function canChargeOpenPlay(store: ReturnType<typeof useGameStore.getState>) {
  if (store.phase !== 'playing' || store.ballFrozen) return false
  if (store.crossOneTouchActive) return false
  const pi = store.passIntent
  if (
    pi?.passType === 'cross' &&
    pi.receiverId === store.activePlayerId &&
    !store.ballPossession
  ) {
    const receiver = playerRegistry.get(store.activePlayerId)
    if (receiver) {
      const dist = distance2D(receiver.position, ballRef.current)
      if (dist < 11) return false
    }
  }
  const pos = store.ballPossession
  return pos?.team === getUserTeam() && pos.playerId === store.activePlayerId
}

function canChargeSetPiece(store: ReturnType<typeof useGameStore.getState>) {
  return isActiveSetPiecePhase(store.phase) && store.ballFrozen && store.setPieceTeam === getUserTeam()
}

function updateStrikeAim(
  store: ReturnType<typeof useGameStore.getState>,
  controls: ControlState,
) {
  if (
    store.phase === 'replay' ||
    store.phase === 'goal-celebration' ||
    store.phase === 'intro' ||
    store.ballFrozen ||
    isActiveSetPiecePhase(store.phase)
  ) {
    store.setStrikeAim(null)
    return
  }

  if (!store.shotChargeActive || !store.powerBarMode) {
    store.setStrikeAim(null)
    return
  }

  const possession = store.ballPossession
  const anticipating =
    canAnticipateStrike(store) &&
    !canChargeOpenPlay(store) &&
    !canChargeSetPiece(store)

  const strikerId = anticipating
    ? (getAnticipatedStrikerId(store) ?? store.activePlayerId)
    : store.activePlayerId

  const hasBall =
    possession?.team === getUserTeam() &&
    possession.playerId === strikerId

  if (!hasBall && !anticipating) {
    store.setStrikeAim(null)
    return
  }

  const player = playerRegistry.get(strikerId)
  if (!player) {
    store.setStrikeAim(null)
    return
  }

  const dir =
    store.powerBarMode === 'shot'
      ? computeShotAimDirection(
          controls,
          player.rotation,
          store.strikeAim?.mode === 'shot'
            ? { x: store.strikeAim.dirX, z: store.strikeAim.dirZ }
            : null,
        )
      : computeStrikeDirection(controls, player.rotation)
  const facingX = Math.sin(player.rotation)
  const facingZ = Math.cos(player.rotation)
  const facingDot = Math.max(-1, Math.min(1, dir.x * facingX + dir.z * facingZ))

  store.setStrikeAim({
    originX: player.position.x,
    originZ: player.position.z,
    dirX: dir.x,
    dirZ: dir.z,
    angle: Math.atan2(dir.x, dir.z),
    facingDot,
    mode: store.powerBarMode,
    power: store.shotChargePower,
    charging: true,
  })
}

export function GameInput({ controls, consumeKickRelease }: GameInputProps) {
  const kickoffTimerRef = useRef(0)
  const cornerKickTimerRef = useRef(0)
  const chargeRef = useRef(createShotChargeState())
  const chargeModeRef = useRef<PowerBarMode>(null)
  const shotContextRef = useRef<ShotContext>(null)
  const chargeStartedAtRef = useRef(0)
  const prevShotHeldRef = useRef(false)
  const prevGroundPassHeldRef = useRef(false)
  const prevOtherPassHeldRef = useRef(false)
  const passTapHoldRef = useRef(false)
  const passTapStartedRef = useRef(0)
  const passInAimModeRef = useRef(false)
  const otherPassTapHoldRef = useRef(false)
  const otherPassTapStartedRef = useRef(0)

  useFrame((_, delta) => {
    const store = useGameStore.getState()
    const c = controls.current

    if (store.phase === 'replay' || store.phase === 'goal-celebration' || store.phase === 'intro') {
      store.setStrikeAim(null)
      return
    }
    if (isUserPauseActive()) {
      store.setStrikeAim(null)
      return
    }

    updateStrikeAim(store, c)

    if (c.switchPlayer && store.phase === 'playing' && !store.ballFrozen) {
      c.switchPlayer = false
      if (canManualSwitchPlayer(store)) {
        switchUserPlayer()
      }
    }

    const simDelta = getSimDelta(delta)
    const charge = chargeRef.current

    if (store.setPieceKickPending) {
      cornerKickTimerRef.current += simDelta
      if (cornerKickTimerRef.current >= CORNER_KICK_CAMERA_RETURN_DELAY) {
        executeSetPieceKick(store.takePendingSetPiecePower())
        store.setSetPieceKickPending(false)
        cornerKickTimerRef.current = 0
      }
      return
    }

    cornerKickTimerRef.current = 0

    if (store.phase === 'kickoff' && store.ballFrozen) {
      if (store.kickoffTeam !== getUserTeam()) {
        kickoffTimerRef.current += simDelta
        if (kickoffTimerRef.current >= SET_PIECE_DELAY) {
          startKickoff()
          kickoffTimerRef.current = 0
        }
      }
      return
    }

    kickoffTimerRef.current = 0

    const pi = store.passIntent
    const oneTouchCross = !!(
      pi?.passType === 'cross' &&
      pi.receiverId === store.activePlayerId &&
      c.kick &&
      store.phase === 'playing' &&
      !store.ballFrozen
    )
    store.setCrossOneTouchActive(oneTouchCross)

    const openPlayCharge = canChargeOpenPlay(store)
    const setPieceCharge = canChargeSetPiece(store)
    const anticipateStrike =
      canAnticipateStrike(store) &&
      store.phase === 'playing' &&
      !store.ballFrozen &&
      !openPlayCharge &&
      !setPieceCharge

    const strikeChargeReady = openPlayCharge || setPieceCharge || anticipateStrike
    const passChargeReady = openPlayCharge || anticipateStrike

    if (setPieceCharge) {
      if (c.left) store.rotateSetPieceAim(-AIM_ROTATE_SPEED * simDelta)
      if (c.right) store.rotateSetPieceAim(AIM_ROTATE_SPEED * simDelta)
    }

    if (c.cancelCharge && (charge.active || passTapHoldRef.current)) {
      charge.active = false
      charge.power = 0
      chargeModeRef.current = null
      shotContextRef.current = null
      chargeStartedAtRef.current = 0
      passTapHoldRef.current = false
      passInAimModeRef.current = false
      otherPassTapHoldRef.current = false
      store.setShotCharge(0, false)
      store.setStrikeAim(null)
      return
    }

    const shotHeld = c.kick && strikeChargeReady
    const groundPassHeld = passChargeReady && c.pass
    const otherPassHeld = passChargeReady && (c.throughPass || c.cross)
    const otherPassButton: PassChargeKind | null = c.cross
      ? 'cross'
      : c.throughPass
        ? 'through'
        : null

    const shotPressed = shotHeld && !prevShotHeldRef.current
    const shotReleased = !shotHeld && prevShotHeldRef.current
    consumeKickRelease()
    const groundPassPressed = groundPassHeld && !prevGroundPassHeldRef.current
    const groundPassReleased = !groundPassHeld && prevGroundPassHeldRef.current
    const otherPassPressed = otherPassHeld && !prevOtherPassHeldRef.current
    const otherPassReleased = !otherPassHeld && prevOtherPassHeldRef.current
    const actionHeld = shotHeld || otherPassHeld || (passInAimModeRef.current && groundPassHeld)

    const resolveShotContext = (): ShotContext => {
      if (openPlayCharge) return 'open'
      if (setPieceCharge) return 'setpiece'
      if (anticipateStrike) return 'anticipate'
      return null
    }

    if ((shotPressed || otherPassPressed) && !charge.active && !passTapHoldRef.current) {
      if (anticipateStrike) {
        const receiverId = getPassReceiverId(store)
        if (receiverId && receiverId !== store.activePlayerId) {
          store.setActivePlayer(receiverId)
        }
      }
      charge.active = true
      charge.power = 0
      chargeStartedAtRef.current = performance.now()
      shotContextRef.current = resolveShotContext()
      if (shotHeld) {
        chargeModeRef.current = 'shot'
        if (openPlayCharge || setPieceCharge || anticipateStrike) {
          store.setShotCharge(0, true, 'shot')
        }
      } else if (otherPassButton) {
        chargeModeRef.current = otherPassButton
        if (anticipateStrike) {
          otherPassTapHoldRef.current = true
          otherPassTapStartedRef.current = performance.now()
        }
      }
    } else if ((shotPressed || otherPassPressed) && charge.active) {
      const boost = chargeModeRef.current === 'shot' ? 0.18 : 0.12
      charge.power = Math.min(1, charge.power + boost)
    }

    if (groundPassPressed) {
      passTapHoldRef.current = true
      passTapStartedRef.current = performance.now()
      passInAimModeRef.current = false
      shotContextRef.current = resolveShotContext()
      if (anticipateStrike) {
        store.setPendingUserPass('pass', QUICK_PASS_POWER, true)
      }
    }

    if (passTapHoldRef.current && groundPassHeld && !passInAimModeRef.current) {
      const tapElapsed = performance.now() - passTapStartedRef.current
      if (tapElapsed >= QUICK_PASS_TAP_MS) {
        passInAimModeRef.current = true
        charge.active = true
        charge.power = 0
        chargeModeRef.current = 'pass'
        chargeStartedAtRef.current = performance.now()
        shotContextRef.current = resolveShotContext()
      }
    }

    if (passTapHoldRef.current && groundPassReleased) {
      const ctx = shotContextRef.current
      const aim = store.strikeAim
      const buffered = ctx === 'anticipate'

      if (passInAimModeRef.current && charge.active) {
        const power = finalizePower(charge.power)
        charge.active = false
        chargeModeRef.current = null
        shotContextRef.current = null
        chargeStartedAtRef.current = 0
        store.setShotCharge(0, false)
        store.setPendingUserPass('pass', power, buffered, aim?.dirX, aim?.dirZ)
      } else if (!passInAimModeRef.current && openPlayCharge) {
        store.setPendingUserPass('pass', QUICK_PASS_POWER, false, aim?.dirX, aim?.dirZ)
      } else if (!passInAimModeRef.current && buffered) {
        store.setPendingUserPass('pass', QUICK_PASS_POWER, true, aim?.dirX, aim?.dirZ)
      }
      passTapHoldRef.current = false
      passInAimModeRef.current = false
    }

    if (otherPassTapHoldRef.current && otherPassReleased && anticipateStrike) {
      const tapElapsed = performance.now() - otherPassTapStartedRef.current
      const mode = chargeModeRef.current
      if (tapElapsed < QUICK_PASS_TAP_MS && (mode === 'through' || mode === 'cross')) {
        charge.active = false
        chargeModeRef.current = null
        shotContextRef.current = null
        chargeStartedAtRef.current = 0
        store.setShotCharge(0, false)
        store.setPendingUserPass(mode, QUICK_PASS_POWER, true)
      }
      otherPassTapHoldRef.current = false
    }

    if (charge.active && chargeModeRef.current === 'shot' && shotReleased) {
      const power = finalizePower(charge.power)
      const shotContext = shotContextRef.current
      const aim = store.strikeAim
      charge.active = false
      chargeModeRef.current = null
      shotContextRef.current = null
      chargeStartedAtRef.current = 0
      store.setShotCharge(0, false)

      if (shotContext === 'open') {
        store.setPendingUserShot(power, aim?.dirX, aim?.dirZ)
      } else if (shotContext === 'anticipate') {
        store.setPendingUserShot(power, aim?.dirX, aim?.dirZ, true)
      } else if (shotContext === 'setpiece') {
        store.setPendingSetPiecePower(power)
        if (store.phase === 'corner' || store.phase === 'penalty') {
          store.setSetPieceKickPending(true)
        } else {
          executeSetPieceKick(power)
        }
      }
    }

    if (charge.active) {
      const mode = chargeModeRef.current
      const duration = getPowerChargeDuration(mode)
      const elapsedMs = performance.now() - chargeStartedAtRef.current
      const ctx = shotContextRef.current
      const buffered = ctx === 'anticipate'
      const aim = store.strikeAim

      if (mode === 'pass') {
        if (groundPassHeld) {
          updatePowerFill(charge, simDelta, getPowerFillSpeed(mode))
        }
        store.setShotCharge(charge.power, true, 'pass')
      } else if (mode === 'shot') {
        if (shotHeld) {
          updatePowerFill(charge, simDelta, getPowerFillSpeed(mode))
        }
        store.setShotCharge(charge.power, true, 'shot')
      } else {
        if (actionHeld) {
          updatePowerFill(charge, simDelta, getPowerFillSpeed(mode))
        }

        store.setShotCharge(charge.power, true, mode)

        if (elapsedMs >= duration * 1000) {
          const power = finalizePower(charge.power)
          charge.active = false
          chargeModeRef.current = null
          shotContextRef.current = null
          chargeStartedAtRef.current = 0
          store.setShotCharge(0, false)

          if (mode === 'through' || mode === 'cross') {
            store.setPendingUserPass(mode, power, buffered, aim?.dirX, aim?.dirZ)
          }
        }
      }
    }

    prevShotHeldRef.current = shotHeld
    prevGroundPassHeldRef.current = groundPassHeld
    prevOtherPassHeldRef.current = otherPassHeld
  })

  return null
}

export function getAiSetPieceKickDelay(phase: string): number {
  if (phase === 'goal-kick') return GOAL_KICK_AUTO_DELAY
  if (phase === 'penalty') return PENALTY_AUTO_DELAY
  return SET_PIECE_DELAY
}
