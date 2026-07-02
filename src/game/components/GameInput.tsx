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
import { useGameStore, USER_TEAM } from '../store/gameStore'
import { startKickoff } from '../systems/kickoff'
import { executeSetPieceKick, isActiveSetPiecePhase } from '../systems/setPiece'
import {
  createShotChargeState,
  updateShotCharge,
} from '../systems/shotPower'
import { getSimDelta, isUserPauseActive } from '../systems/gameTime'

type GameInputProps = {
  controls: MutableRefObject<ControlState>
  consumeKickRelease: () => boolean
}

const AIM_ROTATE_SPEED = 2.4

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
  return pos?.team === USER_TEAM && pos.playerId === store.activePlayerId
}

function canChargeSetPiece(store: ReturnType<typeof useGameStore.getState>) {
  return isActiveSetPiecePhase(store.phase) && store.ballFrozen && store.setPieceTeam === USER_TEAM
}

export function GameInput({ controls, consumeKickRelease }: GameInputProps) {
  const kickoffTimerRef = useRef(0)
  const cornerKickTimerRef = useRef(0)
  const chargeRef = useRef(createShotChargeState())

  useFrame((_, delta) => {
    const store = useGameStore.getState()
    if (store.phase === 'replay' || store.phase === 'goal-celebration' || store.phase === 'intro') return
    if (isUserPauseActive()) return

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
      if (store.kickoffTeam !== USER_TEAM) {
        kickoffTimerRef.current += simDelta
        if (kickoffTimerRef.current >= SET_PIECE_DELAY) {
          startKickoff()
          kickoffTimerRef.current = 0
        }
      }
      return
    }

    kickoffTimerRef.current = 0

    const c = controls.current
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
    const canCharge = openPlayCharge || setPieceCharge

    if (setPieceCharge) {
      if (c.left) store.rotateSetPieceAim(-AIM_ROTATE_SPEED * simDelta)
      if (c.right) store.rotateSetPieceAim(AIM_ROTATE_SPEED * simDelta)
    }

    if (canCharge) {
      if (c.kick && !charge.active) {
        charge.active = true
        charge.power = 0
        charge.direction = 1
      }

      if (charge.active) {
        updateShotCharge(charge, simDelta)
        store.setShotCharge(charge.power, true)

        if (!c.kick) {
          const power = charge.power
          charge.active = false
          store.setShotCharge(0, false)
          consumeKickRelease()

          if (openPlayCharge) {
            store.setPendingUserShot(power)
          } else if (setPieceCharge) {
            store.setPendingSetPiecePower(power)
            if (store.phase === 'corner' || store.phase === 'penalty') {
              store.setSetPieceKickPending(true)
            } else {
              executeSetPieceKick(power)
            }
          }
        }
      }
    } else if (charge.active) {
      charge.active = false
      store.setShotCharge(0, false)
    }
  })

  return null
}

export function getAiSetPieceKickDelay(phase: string): number {
  if (phase === 'goal-kick') return GOAL_KICK_AUTO_DELAY
  if (phase === 'penalty') return PENALTY_AUTO_DELAY
  return SET_PIECE_DELAY
}
