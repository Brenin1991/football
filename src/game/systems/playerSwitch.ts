import { getOutfieldIds, WORLD_SCALE } from '../constants'
import { ballRef, playerRegistry } from './entityRegistry'
import { distance2D } from './rules'
import { getPassReceiverId, canManualSwitchPlayer } from './anticipation'
import { getUserTeam, useGameStore } from '../store/gameStore'

const AUTO_SWITCH_MARGIN = 0.38 * WORLD_SCALE
const LOOSE_BALL_SYNC_MS = 220
let lastLooseBallSyncAt = 0

function sortedUserOutfieldByBallDist() {
  const store = useGameStore.getState()
  const userTeam = getUserTeam()
  const ball = ballRef.current

  return getOutfieldIds(userTeam)
    .filter((pid) => !store.sentOffPlayers.includes(pid))
    .map((pid) => {
      const p = playerRegistry.get(pid)
      if (!p) return null
      return { id: pid, dist: distance2D(p.position, ball) }
    })
    .filter((x): x is { id: string; dist: number } => x != null)
    .sort((a, b) => a.dist - b.dist)
}

/** Troca manual (LB / Tab) — mais perto da bola; se já é o mais perto, cicla pro segundo. */
export function switchUserPlayer() {
  const store = useGameStore.getState()
  if (!canManualSwitchPlayer(store)) return

  const sorted = sortedUserOutfieldByBallDist()
  if (sorted.length === 0) return

  const current = store.activePlayerId
  const idx = sorted.findIndex((c) => c.id === current)
  const next = sorted[(idx + 1) % sorted.length]
  store.setActivePlayer(next.id, true)
}

/** Bola solta: prioriza o jogador do usuário mais perto da bola (rebotes, disputas). */
export function syncActivePlayerOnLooseBall() {
  const now = performance.now()
  if (now - lastLooseBallSyncAt < LOOSE_BALL_SYNC_MS) return
  lastLooseBallSyncAt = now

  const store = useGameStore.getState()
  if (store.ballPossession) return
  if (store.phase !== 'playing' || store.ballFrozen) return
  if (performance.now() < store.manualSwitchUntil) return

  const receiverId = getPassReceiverId(store)
  if (receiverId) {
    const pending = store.pendingUserShot ?? store.pendingUserPass
    if (pending?.buffered && pending.playerId === receiverId) {
      if (store.activePlayerId !== receiverId) {
        store.setActivePlayer(receiverId)
      }
      return
    }
    if (
      store.shotChargeActive &&
      store.powerBarMode === 'shot' &&
      store.activePlayerId === receiverId
    ) {
      return
    }
  }

  const sorted = sortedUserOutfieldByBallDist()
  const closest = sorted[0]
  if (!closest) return

  const current = store.activePlayerId
  if (current === closest.id) return

  const currentP = playerRegistry.get(current)
  if (!currentP) {
    store.setActivePlayer(closest.id)
    return
  }

  const ball = ballRef.current
  const dCurrent = distance2D(currentP.position, ball)
  const dClosest = closest.dist

  if (dClosest < dCurrent - AUTO_SWITCH_MARGIN || dCurrent > 7.5 * WORLD_SCALE) {
    store.setActivePlayer(closest.id)
  }
}
