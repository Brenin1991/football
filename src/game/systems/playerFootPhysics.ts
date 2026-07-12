import {
  CLAIM_DISTANCE,
  LOOSE_BALL_MAX_SPEED,
  PASS_RECEIVE_MAX_SPEED,
  PHYSICAL_POSSESSION,
  POSSESSION_HEIGHT,
  STEAL_COOLDOWN_MS,
  STEAL_DISTANCE,
  WORLD_SCALE,
} from '../constants'
import { ballRef, playerRegistry } from './entityRegistry'
import { isBallShielding } from './ballShield'
import { minPlayerFootDist2D, type PlayerBonePart } from './playerSkeleton'
import { distance2D } from './rules'
import { useGameStore } from '../store/gameStore'
import { tryStandingSteal } from './standingSteal'
import { shouldDelayPassClaim } from './passReceiveAnim'
import { isPlayerSliding, isPlayerKnockedDown } from './tackle'

const contactCooldown = new Map<string, number>()
const CONTACT_DEBOUNCE_MS = 90

function canContact(playerId: string): boolean {
  const now = performance.now()
  const last = contactCooldown.get(playerId) ?? 0
  if (now - last < CONTACT_DEBOUNCE_MS) return false
  contactCooldown.set(playerId, now)
  return true
}

/** Raio para ligar colisores físicos — menor = menos corpos Rapier ativos */
const PHYSICS_COLLIDER_RADIUS = 3.4 * WORLD_SCALE
const BONE_SYNC_RADIUS = 11 * WORLD_SCALE

let colliderCacheFrame = -1
const colliderActiveByPlayer = new Map<string, boolean>()
const boneSyncByPlayer = new Map<string, boolean>()

function computeColliderActive(
  playerId: string,
  store: ReturnType<typeof useGameStore.getState>,
): boolean {
  if (store.phase === 'replay' || store.ballFrozen || store.phase !== 'playing') {
    return false
  }

  const player = playerRegistry.get(playerId)
  if (!player || player.role === 'gk') return false

  if (isPlayerSliding(playerId)) return true
  const poss = store.ballPossession
  if (poss?.playerId === playerId) return true

  const ball = ballRef.current
  const bodyDist = distance2D(player.position, ball)
  if (bodyDist < 2.6 * WORLD_SCALE) return true

  if (poss && poss.team !== player.team) {
    const holder = playerRegistry.get(poss.playerId)
    if (holder && distance2D(player.position, holder.position) < 2.1 * WORLD_SCALE) {
      return true
    }
  }

  return bodyDist < PHYSICS_COLLIDER_RADIUS
}

function computeBoneSync(
  playerId: string,
  store: ReturnType<typeof useGameStore.getState>,
): boolean {
  if (!PHYSICAL_POSSESSION) return true
  if (colliderActiveByPlayer.get(playerId)) return true
  if (store.ballPossession?.playerId === playerId) return true
  if (store.activePlayerId === playerId) return true

  const player = playerRegistry.get(playerId)
  if (!player) return false
  return distance2D(player.position, ballRef.current) < BONE_SYNC_RADIUS
}

/** Uma vez por frame — evita recalcular distância por osso/jogador */
export function refreshPhysicsColliderCache(frame: number) {
  if (frame === colliderCacheFrame) return
  colliderCacheFrame = frame

  colliderActiveByPlayer.clear()
  boneSyncByPlayer.clear()

  const store = useGameStore.getState()
  for (const player of playerRegistry.values()) {
    if (player.role === 'gk') continue
    const active = computeColliderActive(player.id, store)
    colliderActiveByPlayer.set(player.id, active)
    boneSyncByPlayer.set(player.id, computeBoneSync(player.id, store))
  }
}

export function arePlayerPhysicsCollidersActiveCached(playerId: string): boolean {
  if (!PHYSICAL_POSSESSION) return arePlayerPhysicsCollidersActive(playerId)
  return colliderActiveByPlayer.get(playerId) ?? false
}

export function needsPlayerBoneSync(playerId: string): boolean {
  if (!PHYSICAL_POSSESSION) return true
  return boneSyncByPlayer.get(playerId) ?? false
}

/** Colisão física bola ↔ ossos do jogador de linha */
export function handlePlayerBallCollision(playerId: string, part: PlayerBonePart) {
  const store = useGameStore.getState()
  if (store.phase !== 'playing' || store.ballFrozen) return

  const player = playerRegistry.get(playerId)
  if (!player || player.role === 'gk') return
  if (isPlayerKnockedDown(playerId)) return
  if (!canContact(playerId)) return

  const poss = store.ballPossession
  const ball = ballRef.current
  const ballSpeed = Math.hypot(ballRef.velocity.x, ballRef.velocity.z)

  if (ball.y > POSSESSION_HEIGHT + 0.28 && part !== 'body') return

  if (!poss) {
    if (part === 'body') return
    if (!store.canPlayerClaimBall(playerId)) return

    const passIntent = store.passIntent
    const receiveMax = passIntent
      ? PASS_RECEIVE_MAX_SPEED
      : LOOSE_BALL_MAX_SPEED
    if (ballSpeed > receiveMax * 1.08) return

    const footDist = minPlayerFootDist2D(playerId, ball)
    const reach = part === 'foot' ? STEAL_DISTANCE + 0.08 : CLAIM_DISTANCE
    if (footDist == null || footDist > reach) return

    if (passIntent) {
      const receiverIds = [
        passIntent.receiverId,
        ...(passIntent.runnerIds ?? []),
      ]
      if (!receiverIds.includes(playerId)) return
      const holder = playerRegistry.get(playerId)
      if (
        holder &&
        shouldDelayPassClaim(holder.anim, footDist, ballSpeed)
      ) {
        return
      }
    }

    store.setPossession(playerId, player.team)
    return
  }

  if (poss.playerId === playerId) return

  if (poss.team === player.team) return

  if (part !== 'foot' && part !== 'leg') return
  if (isPlayerSliding(playerId)) return
  if (performance.now() - store.possessionSince < STEAL_COOLDOWN_MS) return
  if (store.isStealImmune(poss.playerId)) return
  if (isBallShielding(poss.playerId)) return

  const footDist = minPlayerFootDist2D(playerId, ball)
  if (footDist == null || footDist > STEAL_DISTANCE + 0.1) return

  tryStandingSteal(playerId)
}

/** Legado — preferir arePlayerPhysicsCollidersActiveCached após refreshPhysicsColliderCache */
export function arePlayerPhysicsCollidersActive(playerId: string): boolean {
  const store = useGameStore.getState()
  return computeColliderActive(playerId, store)
}
