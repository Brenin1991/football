import { STEAL_COOLDOWN_MS } from '../constants'
import { getOpponent, getUserTeam, useGameStore } from '../store/gameStore'
import { ballRef, playerRegistry } from './entityRegistry'
import { isCoverPresser, isTeamMarker } from './dynamicFormation'
import { distance2D } from './rules'
import { canStealFromHolder, getHeldBallPoint } from './possession'
import { isBallShielding } from './ballShield'
import { crowdSfx } from './crowdSfx'
import { resolveStandingStealContest } from './playerPhysicalDuel'
import { clearDribbleState } from './ballDribble'
import { ensureBallDynamic } from './ballPhysics'
import { requestContactAnim } from './playerContactAnims'

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
  const isMarker = isTeamMarker(
    stealerId,
    stealer.team,
    possession,
    ballRef.current,
  )
  const isCloseSupport =
    !isUserActive &&
    (isCoverPresser(stealerId, stealer.team) ||
      distance2D(stealer.position, holder.position) < 1.15)
  // Marcador principal, segundo pressionador ou alguém colado no corpo
  if (!isUserActive && !isMarker && !isCloseSupport) {
    return false
  }

  const held = getHeldBallPoint(holder, possession.playerId)
  if (!canStealFromHolder(stealer, holder, held)) return false

  // Ombro no contato — loop enquanto a disputa resolve
  requestContactAnim(stealerId, 'shoulder_charge', 420)

  const outcome = resolveStandingStealContest(stealerId, holder.id, held)
  if (outcome === 'stolen') {
    store.setPossession(stealerId, stealer.team)
    requestContactAnim(holder.id, 'imbalance_stolen')
    requestContactAnim(stealerId, 'end_shoulder_charge')
    if (stealer.team === getUserTeam() && possession.team === getOpponent(getUserTeam())) {
      crowdSfx.notifyHomeSteal()
    }
    return true
  }

  // Choque sem roubo limpo — portador para, desequilibra e perde a bola
  if (store.ballPossession?.playerId === holder.id) {
    store.clearPossession()
  } else {
    clearDribbleState()
  }
  ensureBallDynamic()
  requestContactAnim(holder.id, 'imbalance')
  requestContactAnim(stealerId, 'end_shoulder_charge')
  return false
}

/** Mantém ombro em loop enquanto o roubador pressiona colado no portador. */
export function refreshShoulderChargePress(stealerId: string, holderId: string) {
  const stealer = playerRegistry.get(stealerId)
  const holder = playerRegistry.get(holderId)
  if (!stealer || !holder) return
  if (distance2D(stealer.position, holder.position) > 1.35) return
  requestContactAnim(stealerId, 'shoulder_charge', 280)
}
