import type { BallPossession, PassIntent } from '../store/gameStore'
import type { TeamId } from '../types'

export function possessionChanged(
  prev: BallPossession | null | undefined,
  next: BallPossession | null | undefined,
): boolean {
  return prev?.playerId !== next?.playerId
}

export function passIntentReceivedBy(
  intent: PassIntent,
  playerId: string,
): boolean {
  return (
    playerId === intent.receiverId ||
    intent.runnerIds?.includes(playerId) === true
  )
}

export function isFailedPassClaim(
  intent: PassIntent | null | undefined,
  prevPoss: BallPossession | null | undefined,
  nextPoss: BallPossession | null | undefined,
): intent is PassIntent {
  if (!intent || !nextPoss) return false
  if (!possessionChanged(prevPoss, nextPoss)) return false
  // Posse ainda no passador — roubo de pé, não passe errado
  if (prevPoss && prevPoss.team !== nextPoss.team) return false
  return !passIntentReceivedBy(intent, nextPoss.playerId)
}

export function isBallRecoveredFromOpponent(
  prev: {
    ballPossession: BallPossession | null
    lastTouchTeam: TeamId | null
  },
  nextPoss: BallPossession | null | undefined,
): boolean {
  const prevPoss = prev.ballPossession
  if (!nextPoss || !possessionChanged(prevPoss, nextPoss)) return false

  if (prevPoss && prevPoss.team !== nextPoss.team) return true

  if (
    !prevPoss &&
    prev.lastTouchTeam &&
    prev.lastTouchTeam !== nextPoss.team
  ) {
    return true
  }

  return false
}
