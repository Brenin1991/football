import { getUserTeam, useGameStore } from '../store/gameStore'
import { playerRegistry } from './entityRegistry'

/** Receptor do passe em andamento (time do usuário). */
export function getPassReceiverId(
  store: ReturnType<typeof useGameStore.getState>,
): string | null {
  const pi = store.passIntent
  if (!pi) return null
  const receiver = playerRegistry.get(pi.receiverId)
  if (!receiver || receiver.team !== getUserTeam()) return null
  return pi.receiverId
}

/**
 * Pode pré-carregar passe/chute antes de dominar: passe a caminho, bola solta
 * (rebote, desarme) ou recepção iminente — estilo FIFA/PES.
 */
export function canAnticipateStrike(
  store: ReturnType<typeof useGameStore.getState>,
): boolean {
  const userTeam = getUserTeam()
  const active = store.activePlayerId
  const poss = store.ballPossession
  if (poss?.team === userTeam && poss.playerId === active) return false
  if (poss && poss.team !== userTeam) return false

  const receiverId = getPassReceiverId(store)
  if (receiverId) {
    return receiverId === active || !poss
  }
  return !poss
}

/** Jogador que vai executar o first-time (receptor do passe ou ativo em bola solta). */
export function getAnticipatedStrikerId(
  store: ReturnType<typeof useGameStore.getState>,
): string | null {
  const receiverId = getPassReceiverId(store)
  if (receiverId) return receiverId
  if (canAnticipateStrike(store)) return store.activePlayerId
  return null
}

export function hasBufferedStrikeIntent(
  store: ReturnType<typeof useGameStore.getState>,
  playerId: string,
): boolean {
  const pass = store.pendingUserPass
  const shot = store.pendingUserShot
  return (
    !!(pass?.buffered && pass.playerId === playerId) ||
    !!(shot?.buffered && shot.playerId === playerId)
  )
}

/** Jogador com chute/passe first-time enfileirado ou carregando antes de receber. */
export function isAutoFirstTimeStriker(
  store: ReturnType<typeof useGameStore.getState>,
  playerId: string,
): boolean {
  if (hasBufferedStrikeIntent(store, playerId)) return true

  const receiverId = getPassReceiverId(store)
  if (!receiverId || receiverId !== playerId) return false
  if (store.activePlayerId !== playerId) return false
  if (!store.shotChargeActive || store.powerBarMode !== 'shot') return false
  return canAnticipateStrike(store)
}

/** Corrida automática para receber e finalizar first-time (sem stick). */
export function shouldAutoRunForFirstTime(
  store: ReturnType<typeof useGameStore.getState>,
  playerId: string,
): boolean {
  const pi = store.passIntent
  if (!pi) return false
  if (pi.receiverId !== playerId && !pi.runnerIds?.includes(playerId)) return false

  const player = playerRegistry.get(playerId)
  if (!player || player.team !== getUserTeam()) return false

  return isAutoFirstTimeStriker(store, playerId)
}

/** Bloqueia stick/ações no jogador ativo enquanto outro do time tem a bola. */
export function shouldBlockManualUserControl(
  store: ReturnType<typeof useGameStore.getState>,
  playerId: string,
): boolean {
  const poss = store.ballPossession
  if (poss?.team === getUserTeam() && poss.playerId !== playerId) {
    return true
  }
  return false
}

export function canManualSwitchPlayer(
  store: ReturnType<typeof useGameStore.getState>,
): boolean {
  const poss = store.ballPossession
  if (poss?.team === getUserTeam()) return false
  return true
}
