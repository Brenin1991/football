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
  updatePowerFill,
  type PowerBarMode,
} from '../systems/shotPower'
import { getSimDelta, isUserPauseActive } from '../systems/gameTime'
import { computeStrikeDirection } from '../systems/strikeAim'

type GameInputProps = {
  controls: MutableRefObject<ControlState>
  consumeKickRelease: () => boolean
}

const AIM_ROTATE_SPEED = 2.4

type PassChargeKind = 'pass' | 'through' | 'cross'

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

function activePassButton(c: ControlState): PassChargeKind | null {
  if (c.cross) return 'cross'
  if (c.throughPass) return 'through'
  if (c.pass) return 'pass'
  return null
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
  if (
    possession?.team !== getUserTeam() ||
    possession.playerId !== store.activePlayerId
  ) {
    store.setStrikeAim(null)
    return
  }

  const player = playerRegistry.get(store.activePlayerId)
  if (!player) {
    store.setStrikeAim(null)
    return
  }

  const dir = computeStrikeDirection(controls, player.rotation)
  store.setStrikeAim({
    originX: player.position.x,
    originZ: player.position.z,
    dirX: dir.x,
    dirZ: dir.z,
    angle: Math.atan2(dir.x, dir.z),
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
  const shotContextRef = useRef<'open' | 'setpiece' | null>(null)

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
    const passButton = openPlayCharge ? activePassButton(c) : null

    if (setPieceCharge) {
      if (c.left) store.rotateSetPieceAim(-AIM_ROTATE_SPEED * simDelta)
      if (c.right) store.rotateSetPieceAim(AIM_ROTATE_SPEED * simDelta)
    }

    const shotHeld = c.kick && (openPlayCharge || setPieceCharge)
    const passHeld = passButton != null
    const actionHeld = shotHeld || passHeld

    if (actionHeld) {
      if (!charge.active) {
        charge.active = true
        charge.power = 0
        if (shotHeld) {
          chargeModeRef.current = 'shot'
          shotContextRef.current = openPlayCharge ? 'open' : 'setpiece'
        } else if (passButton) {
          chargeModeRef.current = passButton
          shotContextRef.current = null
        }
      }

      updatePowerFill(charge, simDelta)
      store.setShotCharge(charge.power, true, chargeModeRef.current)
    } else if (charge.active) {
      const power = finalizePower(charge.power)
      const mode = chargeModeRef.current
      const shotContext = shotContextRef.current
      charge.active = false
      chargeModeRef.current = null
      shotContextRef.current = null
      store.setShotCharge(0, false)

      if (mode === 'shot') {
        consumeKickRelease()
        if (shotContext === 'open') {
          store.setPendingUserShot(power)
        } else if (shotContext === 'setpiece') {
          store.setPendingSetPiecePower(power)
          if (store.phase === 'corner' || store.phase === 'penalty') {
            store.setSetPieceKickPending(true)
          } else {
            executeSetPieceKick(power)
          }
        }
      } else if (mode === 'pass' || mode === 'through' || mode === 'cross') {
        store.setPendingUserPass(mode, power)
      }
    }
  })

  return null
}

export function getAiSetPieceKickDelay(phase: string): number {
  if (phase === 'goal-kick') return GOAL_KICK_AUTO_DELAY
  if (phase === 'penalty') return PENALTY_AUTO_DELAY
  return SET_PIECE_DELAY
}
