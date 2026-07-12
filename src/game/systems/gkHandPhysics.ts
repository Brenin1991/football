import {
  GK_CATCH_MAX_SPEED,
  GK_CLAIM_BOX_SPEED,
  GK_FEET_CLAIM_MAX_HEIGHT,
  GK_FEET_CLAIM_MAX_SPEED,
  GK_REACH_HEIGHT,
} from '../constants'
import { ballRef, playerRegistry } from './entityRegistry'
import {
  applyGkCatch,
  applyGkFeetClaim,
  getGkRuntime,
  isWeakLowBall,
  resolveGkPhysicsParry,
} from './goalkeeper'
import { isInPenaltyArea } from './teamField'
import { useGameStore } from '../store/gameStore'

export type GkContactPart = 'left' | 'right' | 'body'

function pickContactSide(
  gkId: string,
  part: GkContactPart,
): 'left' | 'right' {
  if (part !== 'body') return part
  const gk = playerRegistry.get(gkId)
  if (!gk) return 'right'
  return ballRef.current.x >= gk.position.x ? 'right' : 'left'
}

function canGkCatchBall(ballSpeed: number, rt: ReturnType<typeof getGkRuntime>) {
  if (ballSpeed > GK_CATCH_MAX_SPEED) return false
  if (!rt) return ballSpeed <= GK_CLAIM_BOX_SPEED
  if (rt.mode === 'save') return rt.saveKind === 'catch'
  return ballSpeed <= GK_CLAIM_BOX_SPEED
}

/** Colisão física Rapier: bola ↔ goleiro. Só pega se der; senão espalma/rebate. */
export function handleGkBallCollision(gkId: string, part: GkContactPart) {
  const store = useGameStore.getState()
  if (store.ballPossession) return
  if (store.phase !== 'playing' || store.ballFrozen) return

  const gk = playerRegistry.get(gkId)
  if (!gk || gk.role !== 'gk') return
  if (!store.canPlayerClaimBall(gkId)) return
  if (!store.fieldBounds) return

  const rt = getGkRuntime(gkId)
  if (rt?.handContactResolved) return

  const ball = ballRef.current
  const vel = ballRef.velocity
  const ballSpeed = Math.hypot(vel.x, vel.y, vel.z)
  const inBox = isInPenaltyArea(ball, gk.team, store.fieldBounds)

  const isHand = part === 'left' || part === 'right'

  if (isHand) {
    if (!inBox && ballSpeed > GK_FEET_CLAIM_MAX_SPEED) return

    if (canGkCatchBall(ballSpeed, rt)) {
      if (rt) rt.handContactResolved = true
      applyGkCatch(gkId, gk.team, part)
      return
    }

    if (rt) rt.handContactResolved = true
    resolveGkPhysicsParry(gkId, gk.team)
    return
  }

  // Corpo — nunca pega no ar; espalma na defesa ou em bola fraca no chão
  if (!rt || rt.mode !== 'save') {
    if (inBox && isWeakLowBall(ball, vel)) {
      if (rt) rt.handContactResolved = true
      applyGkFeetClaim(gkId, gk.team)
    }
    return
  }

  if (rt) rt.handContactResolved = true

  if (rt.saveKind === 'foot' && ball.y <= GK_FEET_CLAIM_MAX_HEIGHT) {
    if (ballSpeed < GK_FEET_CLAIM_MAX_SPEED) {
      applyGkFeetClaim(gkId, gk.team)
    } else {
      resolveGkPhysicsParry(gkId, gk.team)
    }
    return
  }

  if (rt.saveKind === 'catch' && canGkCatchBall(ballSpeed, rt) && ball.y <= GK_REACH_HEIGHT + 0.12) {
    applyGkCatch(gkId, gk.team, pickContactSide(gkId, part))
    return
  }

  resolveGkPhysicsParry(gkId, gk.team)
}
