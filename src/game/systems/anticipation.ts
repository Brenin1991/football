import { getUserTeam, useGameStore } from '../store/gameStore'
import { ballRef, playerRegistry } from './entityRegistry'
import { resolveCrossInterceptor } from './crossAssist'

/** Jogador do time do usuário que vai atacar o cruzamento */
export function getCrossAttackerId(
  store: ReturnType<typeof useGameStore.getState>,
): string | null {
  const pi = store.passIntent
  if (!pi || pi.passType !== 'cross' || pi.passingTeam !== getUserTeam()) return null
  const id = resolveCrossInterceptor(
    getUserTeam(),
    pi,
    ballRef.current,
    ballRef.velocity,
  )
  const player = playerRegistry.get(id)
  if (!player || player.team !== getUserTeam()) return null
  return id
}

/** Receptor do passe em andamento (time do usuário). */
export function getPassReceiverId(
  store: ReturnType<typeof useGameStore.getState>,
): string | null {
  const pi = store.passIntent
  if (!pi || pi.passingTeam !== getUserTeam()) return null

  if (pi.passType === 'cross') {
    if (
      store.shotChargeActive ||
      store.crossOneTouchActive ||
      store.pendingUserShot?.buffered ||
      store.pendingUserPass?.buffered
    ) {
      return getCrossAttackerId(store) ?? store.activePlayerId
    }
    return getCrossAttackerId(store)
  }

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

  const pi = store.passIntent
  if (pi && pi.passingTeam === userTeam) return true

  const receiverId = getPassReceiverId(store)
  if (receiverId) return receiverId === active || !poss

  return !poss
}

/** Carregando chute/passe antecipado sem ter a bola ainda. */
export function isAnticipatingShotCharge(
  store: ReturnType<typeof useGameStore.getState>,
  playerId?: string,
): boolean {
  if (!store.shotChargeActive || !store.powerBarMode) return false
  const id = playerId ?? store.activePlayerId
  if (store.activePlayerId !== id) return false
  if (!canAnticipateStrike(store)) return false
  const poss = store.ballPossession
  return !(poss?.team === getUserTeam() && poss.playerId === id)
}

/** Jogador que vai executar o first-time (receptor do passe ou ativo em bola solta). */
export function getAnticipatedStrikerId(
  store: ReturnType<typeof useGameStore.getState>,
): string | null {
  const pi = store.passIntent
  if (
    pi?.passType === 'cross' &&
    pi.passingTeam === getUserTeam() &&
    (store.shotChargeActive ||
      store.crossOneTouchActive ||
      store.pendingUserShot?.buffered ||
      store.pendingUserPass?.buffered)
  ) {
    return getCrossAttackerId(store) ?? store.activePlayerId
  }

  const receiverId = getPassReceiverId(store)
  if (receiverId) return receiverId
  if (canAnticipateStrike(store)) return store.activePlayerId
  return null
}

/** Quem deve finalizar o voleio no cruzamento (interceptador, não o active errado). */
export function resolveCrossVolleyStrikerId(
  store: ReturnType<typeof useGameStore.getState>,
): string {
  if (store.passIntent?.passType === 'cross') {
    return getCrossAttackerId(store) ?? store.activePlayerId
  }
  return getAnticipatedStrikerId(store) ?? store.activePlayerId
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

/** Jogador com chute/passe first-time enfileirado antes de receber. */
export function isAutoFirstTimeStriker(
  store: ReturnType<typeof useGameStore.getState>,
  playerId: string,
): boolean {
  return hasBufferedStrikeIntent(store, playerId)
}

/** Corrida automática para receber e finalizar first-time (sem stick). */
export function shouldAutoRunForFirstTime(
  store: ReturnType<typeof useGameStore.getState>,
  playerId: string,
): boolean {
  const pi = store.passIntent
  if (!pi || pi.passingTeam !== getUserTeam()) return false

  const player = playerRegistry.get(playerId)
  if (!player || player.team !== getUserTeam()) return false

  if (!isAutoFirstTimeStriker(store, playerId) && !isAnticipatingShotCharge(store, playerId)) {
    return false
  }

  if (pi.passType === 'cross') {
    const attackerId = getCrossAttackerId(store)
    return attackerId === playerId || store.activePlayerId === playerId
  }

  return pi.receiverId === playerId || store.activePlayerId === playerId
}

/** Jogador em modo chute com a bola (0,5s): automático, só mira. */
export function isPlayerInShotChargeMode(
  store: ReturnType<typeof useGameStore.getState>,
  playerId: string,
): boolean {
  if (!store.shotChargeActive || store.powerBarMode !== 'shot') return false
  if (store.activePlayerId !== playerId) return false

  const poss = store.ballPossession
  return poss?.team === getUserTeam() && poss.playerId === playerId
}

/** Corrida automática enquanto segura o chute: vai na bola (passe ou bola solta). */
export function shouldAutoRunForAnticipatedShot(
  store: ReturnType<typeof useGameStore.getState>,
  playerId: string,
): boolean {
  if (!hasBufferedStrikeIntent(store, playerId) && !isAnticipatingShotCharge(store, playerId)) {
    return false
  }

  const poss = store.ballPossession
  if (poss?.playerId === playerId) return false
  // Adversário com a bola — não persegue carregando chute
  if (poss && poss.team !== getUserTeam()) return false
  // Colega com a bola — não puxa sozinho
  if (poss && poss.team === getUserTeam()) return false

  const player = playerRegistry.get(playerId)
  if (!player || player.team !== getUserTeam()) return false

  const strikerId = getAnticipatedStrikerId(store) ?? store.activePlayerId
  if (playerId !== strikerId && playerId !== store.activePlayerId) return false

  const pi = store.passIntent
  if (pi?.passingTeam === getUserTeam()) {
    if (pi.passType === 'cross') {
      const attackerId = getCrossAttackerId(store)
      return attackerId === playerId || store.activePlayerId === playerId
    }
    return pi.receiverId === playerId || store.activePlayerId === playerId
  }

  // Bola solta (rebote, desarme, etc.)
  return canAnticipateStrike(store)
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
