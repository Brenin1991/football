import { STEAL_COOLDOWN_MS } from '../constants'
import { USER_TEAM, useGameStore } from '../store/gameStore'
import { ballRef, playerRegistry } from './entityRegistry'
import { isTeamMarker } from './dynamicFormation'
import { canStealFromHolder, getBallAtFeet } from './possession'
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
  if (!store.canPlayerClaimBall(stealerId)) return false
  if (performance.now() - store.possessionSince < STEAL_COOLDOWN_MS) return false
  if (store.isStealImmune(possession.playerId)) return false
  if (isBallShielding(possession.playerId)) return false

  const isUserActive =
    stealer.team === USER_TEAM && stealerId === store.activePlayerId
  if (
    !isUserActive &&
    !isTeamMarker(stealerId, stealer.team, possession, ballRef.current)
  ) {
    return false
  }

  const foot = getBallAtFeet(holder)
  if (!canStealFromHolder(stealer, holder, foot)) return false

  store.setPossession(stealerId, stealer.team)
  if (stealer.team === USER_TEAM && possession.team === 'away') {
    crowdSfx.notifyHomeSteal()
  }
  if (stealer.team === USER_TEAM && stealer.role !== 'gk') {
    store.setActivePlayer(stealerId)
  }
  return true
}
