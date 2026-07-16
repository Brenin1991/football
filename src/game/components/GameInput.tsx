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
import { playerRegistry } from '../systems/entityRegistry'
import { useGameStore, getUserTeam } from '../store/gameStore'
import { startKickoff } from '../systems/kickoff'
import { executeSetPieceDelivery, canSetPiecePassOrCross, isActiveSetPiecePhase } from '../systems/setPiece'
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
import { canAnticipateStrike, getAnticipatedStrikerId, getPassReceiverId, canManualSwitchPlayer, resolveCrossVolleyStrikerId } from '../systems/anticipation'
import { releaseCrossVolleyShot, isCrossVolleyArmed } from '../systems/crossAssist'
import { getMarkerChargeSpeedMul } from '../systems/markerPressure'

type GameInputProps = {
  controls: MutableRefObject<ControlState>
  consumeKickRelease: () => boolean
}

const AIM_ROTATE_SPEED = 2.4

type PassChargeKind = 'pass' | 'through' | 'cross'
type ShotContext = 'open' | 'setpiece' | null

function resetChargeState(
  charge: ReturnType<typeof createShotChargeState>,
  refs: {
    chargeMode: MutableRefObject<PowerBarMode>
    shotContext: MutableRefObject<ShotContext>
    chargeStartedAt: MutableRefObject<number>
  },
  store: ReturnType<typeof useGameStore.getState>,
) {
  charge.active = false
  charge.power = 0
  refs.chargeMode.current = null
  refs.shotContext.current = null
  refs.chargeStartedAt.current = 0
  store.setShotCharge(0, false)
}

function fireSetPieceDelivery(
  store: ReturnType<typeof useGameStore.getState>,
  kind: 'shot' | 'pass' | 'cross',
  power: number,
) {
  const finalized = finalizePower(power)
  store.setPendingSetPiecePower(finalized)
  if (kind === 'shot' && (store.phase === 'corner' || store.phase === 'penalty')) {
    store.setSetPieceKickPending(true)
    return
  }
  executeSetPieceDelivery(kind, finalized)
}

function fireShotCharge(
  store: ReturnType<typeof useGameStore.getState>,
  shotContext: ShotContext,
  power: number,
) {
  const aim = store.strikeAim
  const finalized = finalizePower(power)
  const ctx =
    shotContext ?? (canChargeOpenPlay(store) ? 'open' : null)

  if (ctx === 'open') {
    store.setPendingUserShot(finalized, aim?.dirX, aim?.dirZ)
  } else if (ctx === 'setpiece') {
    fireSetPieceDelivery(store, 'shot', finalized)
  }
}

function strikerHasBall(
  store: ReturnType<typeof useGameStore.getState>,
  strikerId: string,
): boolean {
  const poss = store.ballPossession
  return poss?.team === getUserTeam() && poss.playerId === strikerId
}

function focusAnticipatedStriker(store: ReturnType<typeof useGameStore.getState>) {
  const receiverId = getPassReceiverId(store)
  if (receiverId && receiverId !== store.activePlayerId) {
    store.setActivePlayer(receiverId)
  }
}

function canChargeOpenPlay(store: ReturnType<typeof useGameStore.getState>) {
  if (store.phase !== 'playing' || store.ballFrozen) return false
  const pos = store.ballPossession
  return pos?.team === getUserTeam() && pos.playerId === store.activePlayerId
}

function canChargeSetPiece(store: ReturnType<typeof useGameStore.getState>) {
  return isActiveSetPiecePhase(store.phase) && store.ballFrozen && store.setPieceTeam === getUserTeam()
}

function canUpdateAnticipationAim(store: ReturnType<typeof useGameStore.getState>) {
  return (
    canAnticipateStrike(store) &&
    store.shotChargeActive &&
    store.powerBarMode != null
  )
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
  const hasBall =
    possession?.team === getUserTeam() &&
    possession.playerId === store.activePlayerId
  const anticipationAim = canUpdateAnticipationAim(store)

  if (!hasBall && !anticipationAim) {
    store.setStrikeAim(null)
    return
  }

  const strikerId = hasBall
    ? store.activePlayerId
    : getAnticipatedStrikerId(store) ?? store.activePlayerId
  const player = playerRegistry.get(strikerId)
  if (!player) {
    store.setStrikeAim(null)
    return
  }

  const rawDir =
    store.powerBarMode === 'shot'
      ? computeShotAimDirection(
          controls,
          player.rotation,
          store.strikeAim?.mode === 'shot'
            ? { x: store.strikeAim.dirX, z: store.strikeAim.dirZ }
            : null,
        )
      : computeStrikeDirection(controls, player.rotation)
  const dir = { x: rawDir.x, z: rawDir.z }
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

    if (c.switchPlayer && store.phase === 'playing' && !store.ballFrozen && !store.shotChargeActive) {
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
        executeSetPieceDelivery('shot', store.takePendingSetPiecePower())
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

    const openPlayCharge = canChargeOpenPlay(store)
    const setPieceCharge = canChargeSetPiece(store)
    const anticipateStrike =
      canAnticipateStrike(store) &&
      store.phase === 'playing' &&
      !store.ballFrozen &&
      !openPlayCharge &&
      !setPieceCharge

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
      store.setShotCharge(0, false)
      store.setStrikeAim(null)
      store.setCrossOneTouchActive(false)
      return
    }

    // Antecipação: toque rápido OU mira + força (voleio no cruzamento, first-time no passe)
    if (anticipateStrike) {
      const crossInFlight = store.passIntent?.passType === 'cross'
      const strikerId = getAnticipatedStrikerId(store) ?? store.activePlayerId

      const shotHeld = !!c.kick
      const groundPassHeld = !!c.pass
      const otherPassHeld = !!(c.throughPass || c.cross)
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

      // Enquanto segura o chute, mantém o atacante certo focado
      if (shotHeld || (charge.active && chargeModeRef.current === 'shot')) {
        focusAnticipatedStriker(store)
      }

      if (shotPressed && !charge.active && !passTapHoldRef.current) {
        focusAnticipatedStriker(store)
        charge.active = true
        charge.power = 0
        chargeStartedAtRef.current = performance.now()
        chargeModeRef.current = 'shot'
        shotContextRef.current = null
        store.setShotCharge(0, true, 'shot')
        if (crossInFlight) store.setCrossOneTouchActive(true)
      }

      if (shotReleased && charge.active && chargeModeRef.current === 'shot') {
        const power = finalizePower(charge.power)
        const aim = store.strikeAim
        const wasCrossVolley =
          crossInFlight ||
          isCrossVolleyArmed(store, store.activePlayerId) ||
          store.passIntent?.passType === 'cross'
        const strikerId = wasCrossVolley
          ? resolveCrossVolleyStrikerId(store)
          : (getPassReceiverId(store) ?? store.activePlayerId)
        if (strikerId !== store.activePlayerId) {
          store.setActivePlayer(strikerId)
        }
        const dirX = aim?.dirX ?? 0
        const dirZ = aim?.dirZ ?? 1
        resetChargeState(
          charge,
          {
            chargeMode: chargeModeRef,
            shotContext: shotContextRef,
            chargeStartedAt: chargeStartedAtRef,
          },
          store,
        )
        if (wasCrossVolley) {
          releaseCrossVolleyShot(strikerId, power, dirX, dirZ)
        } else if (strikerHasBall(store, strikerId)) {
          store.setPendingUserShot(power, dirX, dirZ)
        } else {
          store.setPendingUserShot(power, dirX, dirZ, true)
        }
        store.setCrossOneTouchActive(false)
      }
      if (groundPassPressed) {
        focusAnticipatedStriker(store)
        passTapHoldRef.current = true
        passTapStartedRef.current = performance.now()
        passInAimModeRef.current = false
      }

      if (passTapHoldRef.current && groundPassHeld && !passInAimModeRef.current) {
        const tapElapsed = performance.now() - passTapStartedRef.current
        if (tapElapsed >= QUICK_PASS_TAP_MS) {
          passInAimModeRef.current = true
          charge.active = true
          charge.power = 0
          chargeModeRef.current = 'pass'
          chargeStartedAtRef.current = performance.now()
          store.setShotCharge(0, true, 'pass')
        }
      }

      if (passTapHoldRef.current && groundPassReleased) {
        const aim = store.strikeAim
        if (passInAimModeRef.current && charge.active) {
          const power = finalizePower(charge.power)
          resetChargeState(
            charge,
            {
              chargeMode: chargeModeRef,
              shotContext: shotContextRef,
              chargeStartedAt: chargeStartedAtRef,
            },
            store,
          )
          store.setPendingUserPass('pass', power, true, aim?.dirX, aim?.dirZ)
        } else {
          store.setPendingUserPass('pass', QUICK_PASS_POWER, true, aim?.dirX, aim?.dirZ)
        }
        passTapHoldRef.current = false
        passInAimModeRef.current = false
      }

      if (
        otherPassPressed &&
        otherPassButton === 'through' &&
        !charge.active &&
        !passTapHoldRef.current
      ) {
        focusAnticipatedStriker(store)
        charge.active = true
        charge.power = 0
        chargeStartedAtRef.current = performance.now()
        chargeModeRef.current = 'through'
        store.setShotCharge(0, true, 'through')
      }

      if (charge.active) {
        const mode = chargeModeRef.current
        const duration = getPowerChargeDuration(mode)
        const elapsedMs = performance.now() - chargeStartedAtRef.current
        const aim = store.strikeAim
        const chargeMul =
          mode === 'shot' ? 1 : getMarkerChargeSpeedMul(strikerId, mode)

        if (mode === 'shot') {
          if (shotHeld) {
            updatePowerFill(
              charge,
              simDelta,
              getPowerFillSpeed('shot') * chargeMul,
            )
          }
          store.setShotCharge(charge.power, true, 'shot')
        } else if (mode === 'pass') {
          if (groundPassHeld) {
            updatePowerFill(charge, simDelta, getPowerFillSpeed('pass') * chargeMul)
          }
          store.setShotCharge(charge.power, true, 'pass')
        } else if (mode === 'through') {
          if (otherPassHeld) {
            updatePowerFill(charge, simDelta, getPowerFillSpeed(mode) * chargeMul)
          }
          store.setShotCharge(charge.power, true, mode)

          if (elapsedMs >= duration * 1000 || charge.power >= 1) {
            const power = finalizePower(charge.power)
            resetChargeState(
              charge,
              {
                chargeMode: chargeModeRef,
                shotContext: shotContextRef,
                chargeStartedAt: chargeStartedAtRef,
              },
              store,
            )
            store.setPendingUserPass('through', power, true, aim?.dirX, aim?.dirZ)
          }
        }
      }

      prevShotHeldRef.current = shotHeld
      prevGroundPassHeldRef.current = groundPassHeld
      prevOtherPassHeldRef.current = otherPassHeld
      updateStrikeAim(store, c)
      return
    }

    const strikeChargeReady = openPlayCharge || setPieceCharge
    const setPiecePassCross =
      setPieceCharge && canSetPiecePassOrCross(store.phase)
    const passChargeReady = openPlayCharge || setPiecePassCross

    const shotHeld = c.kick && strikeChargeReady
    const groundPassHeld = passChargeReady && c.pass
    const otherPassHeld =
      passChargeReady &&
      (openPlayCharge ? !!(c.throughPass || c.cross) : !!c.cross)
    const otherPassButton: PassChargeKind | null = c.cross
      ? 'cross'
      : c.throughPass && openPlayCharge
        ? 'through'
        : null

    const shotPressed = shotHeld && !prevShotHeldRef.current
    const shotReleased = !shotHeld && prevShotHeldRef.current
    consumeKickRelease()
    const groundPassPressed = groundPassHeld && !prevGroundPassHeldRef.current
    const groundPassReleased = !groundPassHeld && prevGroundPassHeldRef.current
    const otherPassPressed = otherPassHeld && !prevOtherPassHeldRef.current
    const actionHeld = shotHeld || otherPassHeld || (passInAimModeRef.current && groundPassHeld)

    const resolveShotContext = (): ShotContext => {
      if (openPlayCharge) return 'open'
      if (setPieceCharge) return 'setpiece'
      return null
    }

    if (otherPassPressed && !charge.active && !passTapHoldRef.current) {
      charge.active = true
      charge.power = 0
      chargeStartedAtRef.current = performance.now()
      shotContextRef.current = resolveShotContext()
      chargeModeRef.current = otherPassButton
    }

    if (shotPressed && strikeChargeReady && !charge.active && !passTapHoldRef.current) {
      charge.active = true
      charge.power = 0
      chargeStartedAtRef.current = performance.now()
      shotContextRef.current = resolveShotContext()
      chargeModeRef.current = 'shot'
      store.setShotCharge(0, true, 'shot')
    }

    if (groundPassPressed) {
      passTapHoldRef.current = true
      passTapStartedRef.current = performance.now()
      passInAimModeRef.current = false
      shotContextRef.current = resolveShotContext()
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
      const aim = store.strikeAim
      const setCtx = shotContextRef.current === 'setpiece'

      if (passInAimModeRef.current && charge.active) {
        const power = finalizePower(charge.power)
        charge.active = false
        chargeModeRef.current = null
        shotContextRef.current = null
        chargeStartedAtRef.current = 0
        store.setShotCharge(0, false)
        if (setCtx && canSetPiecePassOrCross(store.phase)) {
          fireSetPieceDelivery(store, 'pass', power)
        } else {
          store.setPendingUserPass('pass', power, false, aim?.dirX, aim?.dirZ)
        }
      } else if (!passInAimModeRef.current && openPlayCharge) {
        store.setPendingUserPass('pass', QUICK_PASS_POWER, false, aim?.dirX, aim?.dirZ)
      } else if (!passInAimModeRef.current && setPiecePassCross) {
        fireSetPieceDelivery(store, 'pass', QUICK_PASS_POWER)
      }
      passTapHoldRef.current = false
      passInAimModeRef.current = false
    }

    if (shotReleased && charge.active && chargeModeRef.current === 'shot') {
      const power = finalizePower(charge.power)
      const aim = store.strikeAim
      const shotContext = shotContextRef.current
      const strikerId = resolveCrossVolleyStrikerId(store)
      if (strikerId !== store.activePlayerId) {
        store.setActivePlayer(strikerId)
      }
      const wasCrossVolley =
        store.passIntent?.passType === 'cross' ||
        isCrossVolleyArmed(store, strikerId)
      const dirX = aim?.dirX ?? 0
      const dirZ = aim?.dirZ ?? 1
      resetChargeState(
        charge,
        {
          chargeMode: chargeModeRef,
          shotContext: shotContextRef,
          chargeStartedAt: chargeStartedAtRef,
        },
        store,
      )
      if (wasCrossVolley) {
        releaseCrossVolleyShot(strikerId, power, dirX, dirZ)
      } else if (canChargeOpenPlay(store)) {
        store.setPendingUserShot(power, dirX, dirZ)
      } else {
        fireShotCharge(store, shotContext, power)
      }
      store.setCrossOneTouchActive(false)
    }

    if (charge.active) {
      const mode = chargeModeRef.current
      const duration = getPowerChargeDuration(mode)
      const elapsedMs = performance.now() - chargeStartedAtRef.current
      const aim = store.strikeAim
      const carrierId = store.ballPossession?.playerId ?? store.activePlayerId
      const chargeMul =
        mode === 'shot' ? 1 : getMarkerChargeSpeedMul(carrierId, mode)

      if (mode === 'pass') {
        if (groundPassHeld) {
          updatePowerFill(charge, simDelta, getPowerFillSpeed(mode) * chargeMul)
        }
        store.setShotCharge(charge.power, true, 'pass')
      } else if (mode === 'shot') {
        if (shotHeld) {
          updatePowerFill(charge, simDelta, getPowerFillSpeed('shot') * chargeMul)
        }
        store.setShotCharge(charge.power, true, 'shot')
      } else {
        if (actionHeld) {
          updatePowerFill(charge, simDelta, getPowerFillSpeed(mode) * chargeMul)
        }

        store.setShotCharge(charge.power, true, mode)

        if (elapsedMs >= duration * 1000 || charge.power >= 1) {
          const power = finalizePower(charge.power)
          resetChargeState(
            charge,
            {
              chargeMode: chargeModeRef,
              shotContext: shotContextRef,
              chargeStartedAt: chargeStartedAtRef,
            },
            store,
          )

          if (mode === 'through' || mode === 'cross') {
            if (shotContextRef.current === 'setpiece' && canSetPiecePassOrCross(store.phase)) {
              fireSetPieceDelivery(store, mode === 'cross' ? 'cross' : 'pass', power)
            } else {
              store.setPendingUserPass(mode, power, false, aim?.dirX, aim?.dirZ)
            }
          }
        }
      }
    }

    prevShotHeldRef.current = shotHeld
    prevGroundPassHeldRef.current = groundPassHeld
    prevOtherPassHeldRef.current = otherPassHeld

    updateStrikeAim(store, c)
  })

  return null
}

export function getAiSetPieceKickDelay(phase: string): number {
  if (phase === 'goal-kick') return GOAL_KICK_AUTO_DELAY
  if (phase === 'penalty') return PENALTY_AUTO_DELAY
  return SET_PIECE_DELAY
}
