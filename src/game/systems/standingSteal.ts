import { STEAL_COOLDOWN_MS } from '../constants'
import { getOpponent, getUserTeam, useGameStore } from '../store/gameStore'
import { ballRef, playerRegistry } from './entityRegistry'
import { isTeamMarker } from './dynamicFormation'
import { canStealFromHolder, getHeldBallPoint } from './possession'
import { isBallShielding } from './ballShield'
import { crowdSfx } from './crowdSfx'

/** Disputa em pé — só com botão A (jogador) ou IA simulando o pressionamento */
export function tryStandingSteal(stealerId: string): boolean {
  const store = useGameStore.getState()
  const possession = store.ballPossession
  if (!possession || possession.playerId === stealerId) return false

  const stealer = playerRegistry.get(stealerId)
  const holder = playerRegistry.get(possession.playerId)
  if (!stealer || !holder || stealer.team === holder.team) return false
  if (holder.role === 'gk') return false
  if (!store.canPlayerClaimBall(stealerId)) return false
  if (performance.now() - store.possessionSince < STEAL_COOLDOWN_MS) return false
  if (store.isStealImmune(possession.playerId)) return false
  if (isBallShielding(possession.playerId)) return false

  const isUserActive =
    stealer.team === getUserTeam() && stealerId === store.activePlayerId
  if (
    !isUserActive &&
    !isTeamMarker(stealerId, stealer.team, possession, ballRef.current)
  ) {
    return false
  }

  const held = getHeldBallPoint(holder, possession.playerId)
  if (!canStealFromHolder(stealer, holder, held)) return false

  store.setPossession(stealerId, stealer.team)
  if (stealer.team === getUserTeam() && possession.team === getOpponent(getUserTeam())) {
    crowdSfx.notifyHomeSteal()
  }
  return true
}
