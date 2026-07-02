import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import {
  LOOSE_BALL_MAX_SPEED,
  PASS_INTENT_TIMEOUT_MS,
  PASS_RECEIVE_MAX_SPEED,
  PASS_SPEED_MAX,
  PASS_SPEED_BASE,
  PASS_SPEED_DIST_FACTOR,
  PASS_SPEED_MIN,
} from '../constants'
import { CROSS_RECEIVE_MAX_SPEED_MUL } from '../systems/cross'
import { THROUGH_RECEIVE_MAX_SPEED_MUL } from '../systems/throughPass'
import { useGameStore, USER_TEAM } from '../store/gameStore'
import { ballRef, playerRegistry } from '../systems/entityRegistry'
import { applyBallVelocity, ensureBallDynamic, kickBall } from '../systems/ballPhysics'
import {
  CLAIM_DISTANCE,
  findClosestContestant,
  PASS_RECEIVE_DISTANCE,
} from '../systems/possession'
import { resolveLooseBallChaser } from '../systems/dynamicFormation'
import { distance2D } from '../systems/rules'
import { tryCallOffsideOnReceive } from '../systems/referee'
import { crowdSfx } from '../systems/crowdSfx'
import { narrationSfx } from '../systems/narrationSfx'
import { isFieldParadePhase } from '../systems/matchPhases'
import { replaySystem } from '../systems/replaySystem'
import { isUserPauseActive } from '../systems/gameTime'
import { sfx } from '../systems/sfx'

function claimDistanceToBall(playerId: string, ballPos: { x: number; z: number }) {
  const p = playerRegistry.get(playerId)
  if (!p) return Infinity
  return distance2D(p.position, { x: ballPos.x, y: 0, z: ballPos.z })
}

/** Posse + troca de jogador só quando a posse muda */
export function TeamController() {
  useFrame(() => {
    const store = useGameStore.getState()
    if (
      store.phase === 'goal' ||
      store.phase === 'goal-celebration' ||
      store.phase === 'replay' ||
      store.phase === 'half-time' ||
      store.phase === 'half-time-exit' ||
      store.phase === 'half-time-enter' ||
      store.phase === 'full-time' ||
      store.phase === 'full-time-exit' ||
      isFieldParadePhase(store.phase) ||
      store.ballFrozen
    ) {
      return
    }

    if (store.phase !== 'playing') return
    if (isUserPauseActive()) return

    const players = [...playerRegistry.values()]
    const possession = store.ballPossession
    const ballPos = ballRef.current

    if (possession) {
      const holder = playerRegistry.get(possession.playerId)
      if (!holder) {
        store.clearPossession()
        return
      }

      if (possession.team === USER_TEAM && holder.role !== 'gk') {
        store.setActivePlayer(possession.playerId)
      }

      return
    }

    let passIntent = store.passIntent
    if (
      passIntent &&
      performance.now() - passIntent.startedAt > PASS_INTENT_TIMEOUT_MS
    ) {
      if (!store.ballPossession) {
        narrationSfx.playPassError()
      }
      store.setPassIntent(null)
      passIntent = null
    }

    const ballSpeed = Math.hypot(ballRef.velocity.x, ballRef.velocity.z)

    if (
      store.setPieceGuardPos &&
      performance.now() < store.setPieceGuardUntil &&
      !passIntent &&
      distance2D(ballPos, store.setPieceGuardPos) < 5 &&
      ballSpeed < 5
    ) {
      return
    }

    if (passIntent) {
      const receiverIds = [
        passIntent.receiverId,
        ...(passIntent.runnerIds ?? []).filter((rid) => rid !== passIntent.receiverId),
      ]
      const receiveMaxSpeed =
        passIntent.passType === 'cross'
          ? PASS_RECEIVE_MAX_SPEED * CROSS_RECEIVE_MAX_SPEED_MUL
          : passIntent.passType === 'through'
            ? PASS_RECEIVE_MAX_SPEED * THROUGH_RECEIVE_MAX_SPEED_MUL
            : PASS_RECEIVE_MAX_SPEED

      for (const rid of receiverIds) {
        const receiver = playerRegistry.get(rid)
        if (!receiver || !store.canPlayerClaimBall(receiver.id)) continue
        const toBall = claimDistanceToBall(receiver.id, ballPos)

        if (
          passIntent.passType === 'cross' &&
          rid === passIntent.receiverId &&
          receiver.team === USER_TEAM &&
          store.crossOneTouchActive &&
          toBall < 3.4
        ) {
          continue
        }

        if (toBall < PASS_RECEIVE_DISTANCE && ballSpeed < receiveMaxSpeed) {
          if (
            passIntent.offsideFlag &&
            tryCallOffsideOnReceive(passIntent.offsideFlag, receiver.id)
          ) {
            return
          }
          store.setPossession(receiver.id, receiver.team)
          if (receiver.team === USER_TEAM && receiver.role !== 'gk') {
            store.setActivePlayer(receiver.id)
          }
          return
        }
      }
    }

    const maxClaimSpeed = passIntent
      ? passIntent.passType === 'cross'
        ? PASS_RECEIVE_MAX_SPEED * CROSS_RECEIVE_MAX_SPEED_MUL
        : passIntent.passType === 'through'
          ? PASS_RECEIVE_MAX_SPEED * THROUGH_RECEIVE_MAX_SPEED_MUL
          : PASS_RECEIVE_MAX_SPEED
      : LOOSE_BALL_MAX_SPEED
    if (ballSpeed > maxClaimSpeed) return

    const contestant = findClosestContestant(
      players,
      ballPos,
      passIntent?.receiverId,
    )
    if (contestant && store.canPlayerClaimBall(contestant.id)) {
      const toBall = claimDistanceToBall(contestant.id, ballPos)
      if (toBall >= CLAIM_DISTANCE) return

      if (
        passIntent?.offsideFlag &&
        tryCallOffsideOnReceive(passIntent.offsideFlag, contestant.id)
      ) {
        return
      }

      if (!passIntent) {
        const chaserId = resolveLooseBallChaser(contestant.team, ballPos)
        if (chaserId && chaserId !== contestant.id) return
      }

      store.setPossession(contestant.id, contestant.team)
      const recoveredFromOpponent =
        !passIntent &&
        store.lastTouchTeam &&
        store.lastTouchTeam !== contestant.team
      if (recoveredFromOpponent) {
        if (contestant.team === USER_TEAM && store.lastTouchTeam === 'away') {
          crowdSfx.notifyHomeSteal()
        }
      }
      if (contestant.team === USER_TEAM && contestant.role !== 'gk') {
        store.setActivePlayer(contestant.id)
      }
    }
  })

  return null
}

export function releaseBallFromFeet(
  vx: number,
  vy: number,
  vz: number,
  passerId?: string,
  opts?: { loft?: number; releaseKind?: 'pass' | 'through' | 'cross' | 'shot' | 'setpiece' },
) {
  const store = useGameStore.getState()
  store.clearPossession()

  if (passerId) {
    store.blockPasserClaim(passerId, 500)
    store.setLastTouch(
      playerRegistry.get(passerId)?.team ?? USER_TEAM,
    )
  }

  ensureBallDynamic()

  const speed = Math.hypot(vx, vz)
  if (speed > 0.01) {
    sfx.playKick()
    const passer = passerId ? playerRegistry.get(passerId) : null
    const loft = opts?.loft ?? (vy > 0.5 ? vy / speed : 0)
    if (passer) {
      if (passer.team === USER_TEAM && opts?.releaseKind === 'shot') {
        crowdSfx.notifyHomeShot()
      }
      if (opts?.releaseKind === 'shot') {
        replaySystem.notifyShot(passer.team)
      }
      narrationSfx.notifyBallRelease(opts?.releaseKind)
    }
    kickBall({
      dirX: vx,
      dirZ: vz,
      speed,
      loft,
    })
  } else {
    applyBallVelocity(vx, vy, vz)
  }
}

export function passSpeedForDistance(dist: number): number {
  return THREE.MathUtils.clamp(
    dist * PASS_SPEED_DIST_FACTOR + PASS_SPEED_BASE,
    PASS_SPEED_MIN,
    PASS_SPEED_MAX,
  )
}
