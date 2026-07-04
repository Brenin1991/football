import * as THREE from 'three'
import type { PassIntent } from '../store/gameStore'
import { ballRestY } from './fieldData'
import { distance2D } from './rules'
import { BALL_RADIUS } from '../constants'

export type ReceiveAnimKind = 'player_receive' | 'player_header'

const REST_Y = ballRestY(BALL_RADIUS)

function closingToReceiver(
  receiverPos: { x: number; z: number },
  ball: { x: number; z: number },
  ballVel: { x: number; z: number },
): number {
  const dist = Math.hypot(ball.x - receiverPos.x, ball.z - receiverPos.z)
  const ballSpeed = Math.hypot(ballVel.x, ballVel.z)
  if (dist < 0.05 || ballSpeed < 0.2) return 0
  const toRx = receiverPos.x - ball.x
  const toRz = receiverPos.z - ball.z
  return -(toRx * ballVel.x + toRz * ballVel.z) / (dist * ballSpeed)
}

function isAerialBall(ball: { y?: number }, ballVel: { y: number }): boolean {
  const height = (ball.y ?? REST_Y) - REST_Y
  return height > 0.38 || ballVel.y > 0.32
}

/** Escolhe animação de recepção conforme o tipo de passe */
export function pickReceiveAnim(
  passIntent: PassIntent,
  ball: { x: number; y?: number; z: number },
  ballVel: { x: number; y: number; z: number },
  opts?: { crossOneTouch?: boolean; userReceiver?: boolean },
): ReceiveAnimKind | null {
  const passType = passIntent.passType ?? 'pass'

  if (passType === 'cross') {
    if (opts?.crossOneTouch && opts.userReceiver) return null
    return isAerialBall(ball, ballVel) ? 'player_header' : 'player_receive'
  }

  if (passType === 'pass' || passType === 'through') {
    return null
  }

  return null
}

export function shouldTriggerReceiveAnim(
  passIntent: PassIntent,
  receiverId: string,
  receiverPos: { x: number; z: number },
  ball: { x: number; y?: number; z: number },
  ballVel: { x: number; y: number; z: number },
  alreadyActive: boolean,
  opts?: { crossOneTouch?: boolean; userReceiver?: boolean },
): { trigger: boolean; kind: ReceiveAnimKind | null } {
  if (alreadyActive) return { trigger: false, kind: null }

  const isTarget =
    passIntent.receiverId === receiverId ||
    passIntent.runnerIds?.includes(receiverId) === true
  if (!isTarget) return { trigger: false, kind: null }

  const kind = pickReceiveAnim(passIntent, ball, ballVel, opts)
  if (!kind) return { trigger: false, kind: null }

  const dist = distance2D(
    { x: receiverPos.x, y: 0, z: receiverPos.z },
    { x: ball.x, y: ball.y ?? REST_Y, z: ball.z },
  )
  const ballSpeed = Math.hypot(ballVel.x, ballVel.z)
  const closing = closingToReceiver(receiverPos, ball, ballVel)
  const passType = passIntent.passType ?? 'pass'
  const eta = ballSpeed > 0.45 ? dist / ballSpeed : 99

  if (kind === 'player_header') {
    if (dist < 3.6 && closing > -0.15 && ballSpeed > 0.65) {
      return { trigger: true, kind }
    }
    return { trigger: false, kind: null }
  }

  if (kind === 'player_receive' && passType === 'cross') {
    const triggerDist = THREE.MathUtils.clamp(1.85 + ballSpeed * 0.13, 2.05, 3.35)
    if (dist < triggerDist && closing > 0.08 && eta < 0.62) {
      return { trigger: true, kind: 'player_receive' }
    }
    if (dist < 1.4 && ballSpeed < PASS_RECEIVE_ANIM_MAX_BALL_SPEED) {
      return { trigger: true, kind: 'player_receive' }
    }
  }

  return { trigger: false, kind: null }
}

/** Bola ainda rápida demais — segura posse até encaixar o domínio */
export const PASS_RECEIVE_ANIM_MAX_BALL_SPEED = 7.2

export function shouldDelayPassClaim(
  receiverAnim: string | undefined,
  toBall: number,
  ballSpeed: number,
): boolean {
  if (receiverAnim !== 'player_receive' && receiverAnim !== 'player_header') {
    return false
  }
  return toBall > 0.34 && ballSpeed > 1.6
}
