import {
  CONTACT_CLAIM_BODY,
  CONTACT_CLAIM_BODY_AI,
  CONTACT_CLAIM_FOOT,
  CONTACT_CLAIM_FOOT_AI,
  LOOSE_BALL_MAX_SPEED,
  PASS_RECEIVE_MAX_SPEED,
  POSSESSION_HEIGHT,
  STEAL_COOLDOWN_MS,
  STEAL_DISTANCE,
  WORLD_SCALE,
} from '../constants'
import { ballRef, ballBodyRef, playerRegistry, type PlayerRef } from './entityRegistry'
import { ensureBallDynamic, syncBallFromBody } from './ballPhysics'
import { isBallShielding } from './ballShield'
import { minPlayerFootDist2D, type PlayerBonePart } from './playerSkeleton'
import { distance2D, normalize2D } from './rules'
import { getOpponent, getUserTeam, useGameStore } from '../store/gameStore'
import { shouldDelayPassClaim } from './passReceiveAnim'
import {
  clearCrossAssistCache,
  hasCrossVolleyIntent,
  isCrossVolleyShooterShielded,
  tryCrossBallContact,
} from './crossAssist'
import { tryStandingSteal } from './standingSteal'
import { isPlayerSliding, isPlayerKnockedDown } from './tackle'
import { tryCallOffsideOnReceive } from './referee'
import { crowdSfx } from './crowdSfx'
import { THROUGH_RECEIVE_MAX_SPEED_MUL } from './throughPass'

const contactCooldown = new Map<string, number>()
const CONTACT_DEBOUNCE_MS = 70

function markClaimAttempt(playerId: string): boolean {
  const now = performance.now()
  const last = contactCooldown.get(playerId) ?? 0
  if (now - last < CONTACT_DEBOUNCE_MS) return false
  contactCooldown.set(playerId, now)
  return true
}

/** Raio para ligar colisores físicos */
const PHYSICS_COLLIDER_RADIUS = 2.75 * WORLD_SCALE
const BONE_SYNC_RADIUS = 8.5 * WORLD_SCALE

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

  if (isCrossVolleyShooterShielded(playerId)) return false

  const passIntent = store.passIntent
  if (passIntent?.passType === 'cross' && player.team === passIntent.passingTeam) {
    return false
  }

  if (hasCrossVolleyIntent(playerId)) return true
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
  if (colliderActiveByPlayer.get(playerId)) return true
  if (store.ballPossession?.playerId === playerId) return true
  if (store.activePlayerId === playerId) return true
  if (hasCrossVolleyIntent(playerId)) return true

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
  return colliderActiveByPlayer.get(playerId) ?? false
}

export function needsPlayerBoneSync(playerId: string): boolean {
  return boneSyncByPlayer.get(playerId) ?? false
}

import type { RapierRigidBody } from '@react-three/rapier'

function deflectLooseBallOffFoot(player: PlayerRef, ballSpeed: number) {
  const body = ballBodyRef.current as RapierRigidBody | null
  if (!body) return

  ensureBallDynamic()
  const faceX = Math.sin(player.rotation)
  const faceZ = Math.cos(player.rotation)
  const perp = { x: -faceZ, z: faceX }
  const side = Math.random() < 0.5 ? 1 : -1
  const dir = normalize2D(
    faceX * 0.35 + perp.x * side * 0.75,
    faceZ * 0.35 + perp.z * side * 0.75,
  )
  const bump = (0.9 + Math.random() * 0.8) * WORLD_SCALE + ballSpeed * 0.08

  body.wakeUp()
  const v = body.linvel()
  body.setLinvel(
    {
      x: dir.x * bump + v.x * 0.35,
      y: Math.max(v.y, 0.08 + Math.random() * 0.12),
      z: dir.z * bump + v.z * 0.35,
    },
    true,
  )
  syncBallFromBody(body)

  const store = useGameStore.getState()
  store.setLastTouch(player.team)
  store.freezeDistanceBallClaims(280 + Math.random() * 160)
  store.blockPasserClaim(player.id, 320)
}

function receiveMaxSpeed(
  passIntent: ReturnType<typeof useGameStore.getState>['passIntent'],
): number {
  if (!passIntent) return LOOSE_BALL_MAX_SPEED
  if (passIntent.passType === 'through') {
    return PASS_RECEIVE_MAX_SPEED * THROUGH_RECEIVE_MAX_SPEED_MUL
  }
  return PASS_RECEIVE_MAX_SPEED
}

/** Regras compartilhadas de domínio no contato (colisão Rapier ou fallback). */
function tryClaimLooseBall(
  playerId: string,
  part: PlayerBonePart | 'contact',
  fromCollision: boolean,
): boolean {
  const store = useGameStore.getState()
  if (store.phase !== 'playing' || store.ballFrozen) return false
  if (store.ballPossession) return false

  const player = playerRegistry.get(playerId)
  if (!player || player.role === 'gk') return false
  if (isPlayerKnockedDown(playerId)) return false
  if (!store.canPlayerClaimBall(playerId)) return false

  const ball = ballRef.current
  const ballSpeed = Math.hypot(ballRef.velocity.x, ballRef.velocity.z)
  const passIntent = store.passIntent

  if (passIntent?.passType === 'cross') {
    const crossTeam = passIntent.passingTeam ?? store.lastTouchTeam
    if (crossTeam === player.team) return false
  }

  const maxH =
    part === 'body' || part === 'contact'
      ? POSSESSION_HEIGHT + 0.55
      : POSSESSION_HEIGHT + 0.28
  if (ball.y > maxH) return false

  const maxSp = receiveMaxSpeed(passIntent)
  if (ballSpeed > maxSp * 1.08) return false

  const userTeam = getUserTeam()
  const isActiveUser =
    player.team === userTeam && playerId === store.activePlayerId
  const isAi = !isActiveUser

  const footReach = isAi ? CONTACT_CLAIM_FOOT_AI : CONTACT_CLAIM_FOOT
  const bodyReach = isAi ? CONTACT_CLAIM_BODY_AI : CONTACT_CLAIM_BODY

  const bodyDist = distance2D(player.position, ball)
  const footDist = minPlayerFootDist2D(playerId, ball)

  if (!fromCollision) {
    const footOk = footDist != null && footDist < footReach
    const bodyOk = bodyDist < bodyReach
    if (!footOk && !bodyOk) return false
  }

  // IA domina bola um pouco mais rápida; jogador precisa reduzir mais
  const deflectAt = isAi ? maxSp * 0.98 : maxSp * 0.85
  if (ballSpeed > deflectAt) {
    if (part === 'foot' || part === 'leg' || part === 'contact') {
      if (!markClaimAttempt(playerId)) return false
      deflectLooseBallOffFoot(player, ballSpeed)
    }
    return false
  }

  if (passIntent) {
    const passerTeam = passIntent.passingTeam ?? store.lastTouchTeam
    const isOpponentPass = passerTeam != null && passerTeam !== player.team
    if (passIntent.passType === 'cross' && !isOpponentPass) return false
    if (!isOpponentPass) {
      const receiverIds = [
        passIntent.receiverId,
        ...(passIntent.runnerIds ?? []),
      ]
      if (!receiverIds.includes(playerId)) return false
      // Delay de animação só no jogador controlado
      if (
        isActiveUser &&
        shouldDelayPassClaim(player.anim, footDist ?? bodyDist, ballSpeed)
      ) {
        return false
      }
    }

    if (
      passIntent.offsideFlag &&
      tryCallOffsideOnReceive(passIntent.offsideFlag, playerId)
    ) {
      return false
    }
    clearCrossAssistCache()
  }

  if (!markClaimAttempt(playerId)) return false

  const prevTouch = store.lastTouchTeam
  store.setPossession(playerId, player.team)
  if (
    !passIntent &&
    prevTouch &&
    prevTouch !== player.team &&
    player.team === userTeam &&
    prevTouch === getOpponent(userTeam)
  ) {
    crowdSfx.notifyHomeSteal()
  }
  return true
}

/**
 * Fallback por frame: domínio se a bola está colada no pé/corpo.
 * Cobre falhas de onCollisionEnter do Rapier com corpos cinemáticos.
 */
export function tickContactBallClaims(): void {
  const store = useGameStore.getState()
  if (store.phase !== 'playing' || store.ballFrozen) return
  if (store.ballPossession) return
  if (!store.canDistanceClaimBall()) return

  const ball = ballRef.current
  if (ball.y > POSSESSION_HEIGHT + 0.55) return

  const userTeam = getUserTeam()
  const activeId = store.activePlayerId

  let bestId: string | null = null
  let bestDist = Infinity

  for (const player of playerRegistry.values()) {
    if (player.role === 'gk') continue
    if (store.sentOffPlayers.includes(player.id)) continue
    if (isPlayerKnockedDown(player.id)) continue

    const isAi = !(player.team === userTeam && player.id === activeId)
    const footReach = isAi ? CONTACT_CLAIM_FOOT_AI : CONTACT_CLAIM_FOOT
    const bodyReach = isAi ? CONTACT_CLAIM_BODY_AI : CONTACT_CLAIM_BODY

    const bodyDist = distance2D(player.position, ball)
    if (bodyDist > bodyReach + 0.4) continue

    const footDist = minPlayerFootDist2D(player.id, ball)
    const d =
      footDist != null
        ? Math.min(footDist, bodyDist)
        : bodyDist
    const inContact =
      (footDist != null && footDist < footReach) || bodyDist < bodyReach
    if (!inContact) continue

    if (d < bestDist) {
      bestDist = d
      bestId = player.id
    }
  }

  if (!bestId) return
  const best = playerRegistry.get(bestId)
  const isAiBest = !(best?.team === userTeam && bestId === activeId)
  const footReach = isAiBest ? CONTACT_CLAIM_FOOT_AI : CONTACT_CLAIM_FOOT
  const part: PlayerBonePart | 'contact' =
    (minPlayerFootDist2D(bestId, ball) ?? Infinity) < footReach
      ? 'foot'
      : 'body'
  tryClaimLooseBall(bestId, part, false)
}

/** Colisão física bola ↔ ossos do jogador de linha */
export function handlePlayerBallCollision(playerId: string, part: PlayerBonePart) {
  const store = useGameStore.getState()
  if (store.phase !== 'playing' || store.ballFrozen) return

  const player = playerRegistry.get(playerId)
  if (!player || player.role === 'gk') return
  if (isPlayerKnockedDown(playerId)) return

  const poss = store.ballPossession
  const ball = ballRef.current
  const passIntent = store.passIntent

  if (!poss && passIntent?.passType === 'cross') {
    const crossTeam = passIntent.passingTeam ?? store.lastTouchTeam
    if (crossTeam === player.team) {
      if (hasCrossVolleyIntent(playerId)) {
        tryCrossBallContact(playerId, player.position, ball, ballRef.velocity)
      }
      return
    }
  }

  if (!poss) {
    tryClaimLooseBall(playerId, part, true)
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
  if (footDist == null || footDist > STEAL_DISTANCE + 0.18) return

  if (!markClaimAttempt(playerId)) return
  tryStandingSteal(playerId)
}

/** Legado — preferir arePlayerPhysicsCollidersActiveCached após refreshPhysicsColliderCache */
export function arePlayerPhysicsCollidersActive(playerId: string): boolean {
  const store = useGameStore.getState()
  return computeColliderActive(playerId, store)
}
