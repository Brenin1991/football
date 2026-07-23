import {
  CONTACT_CLAIM_BODY,
  CONTACT_CLAIM_BODY_AI,
  CONTACT_CLAIM_FOOT,
  CONTACT_CLAIM_FOOT_AI,
  LOOSE_BALL_MAX_SPEED,
  PASS_RECEIVE_MAX_SPEED,
  POSSESSION_HEIGHT,
  WORLD_SCALE,
} from '../constants'
import { ballRef, ballBodyRef, playerRegistry, type PlayerRef } from './entityRegistry'
import { ensureBallDynamic, softenBallBodyHit, syncBallFromBody } from './ballPhysics'
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
import { hasBodyDuelClaimPriority } from './dynamicFormation'
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

  // Passe do próprio time: só quem pode dominar colide —
  // senão a IA “apoio” chuta a bola sem poder dominar.
  if (passIntent && passIntent.passType !== 'cross') {
    const passerTeam = passIntent.passingTeam ?? store.lastTouchTeam
    if (passerTeam === player.team) {
      const isActiveUser =
        player.team === getUserTeam() && playerId === store.activePlayerId
      const designated = passIntent.soloReceive
        ? playerId === passIntent.receiverId
        : [
            passIntent.receiverId,
            ...(passIntent.runnerIds ?? []),
          ].includes(playerId)
      if (!designated && !isActiveUser) return false
    }
  }

  if (hasCrossVolleyIntent(playerId)) return true
  if (isPlayerSliding(playerId)) return true

  const poss = store.ballPossession
  // Dono da bola: NÃO colide fisicamente (drible é cinemático) — senão o osso chuta a bola sozinho
  if (poss?.playerId === playerId) return false

  // Acabou de tocar / bloqueado de claim — não dar segundo chute físico
  if (!store.canPlayerClaimBall(playerId)) return false

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
  const bump = (0.45 + Math.random() * 0.35) * WORLD_SCALE + ballSpeed * 0.04

  body.wakeUp()
  const v = body.linvel()
  body.setLinvel(
    {
      x: dir.x * bump + v.x * 0.28,
      y: Math.max(Math.min(v.y * 0.4, 0.55), 0.04),
      z: dir.z * bump + v.z * 0.28,
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

  const userTeam = getUserTeam()
  const isActiveUser =
    player.team === userTeam && playerId === store.activePlayerId
  const isAi = !isActiveUser

  // Passe do próprio time: ANTES do deflect — quem não é receptor não toca na bola
  // (era o bug: IA ia no passe pedido, não podia dominar e só chutava/desviava)
  let ownPassDesignated = false
  if (passIntent) {
    const passerTeam = passIntent.passingTeam ?? store.lastTouchTeam
    const isOpponentPass = passerTeam != null && passerTeam !== player.team
    if (!isOpponentPass && passIntent.passType !== 'cross') {
      const receiverIds = passIntent.soloReceive
        ? [passIntent.receiverId]
        : [passIntent.receiverId, ...(passIntent.runnerIds ?? [])]
      ownPassDesignated = receiverIds.includes(playerId)
      const nearBallUser =
        isActiveUser &&
        (distance2D(player.position, ball) < CONTACT_CLAIM_BODY * 1.35 ||
          (minPlayerFootDist2D(playerId, ball) ?? 99) < CONTACT_CLAIM_FOOT * 1.25)
      if (!ownPassDesignated && !nearBallUser) return false
    }
  }

  const maxSp =
    receiveMaxSpeed(passIntent) *
    (ownPassDesignated || isActiveUser ? 1.12 : 1)
  if (ballSpeed > maxSp * 1.08) return false

  const duelPriority =
    hasBodyDuelClaimPriority(playerId) || ownPassDesignated || isActiveUser

  const footReach =
    (isAi ? CONTACT_CLAIM_FOOT_AI : CONTACT_CLAIM_FOOT) *
    (duelPriority ? 1.4 : 1) *
    (ownPassDesignated ? 1.12 : 1)
  const bodyReach =
    (isAi ? CONTACT_CLAIM_BODY_AI : CONTACT_CLAIM_BODY) *
    (duelPriority ? 1.32 : 1) *
    (ownPassDesignated ? 1.1 : 1)

  const bodyDist = distance2D(player.position, ball)
  const footDist = minPlayerFootDist2D(playerId, ball)

  if (!fromCollision) {
    const footOk = footDist != null && footDist < footReach
    const bodyOk = bodyDist < bodyReach
    if (!footOk && !bodyOk) return false
  }

  // Domínio: receptor do passe tolera bola um pouco mais rápida
  const deflectAt =
    ownPassDesignated || isActiveUser
      ? maxSp * 1.06
      : isAi
        ? maxSp * 0.99
        : maxSp * 0.96
  if (ballSpeed > deflectAt) {
    // No passe próprio, não deflecta — espera a bola cair no domínio
    if (passIntent) {
      const passerTeam = passIntent.passingTeam ?? store.lastTouchTeam
      if (passerTeam === player.team) return false
    }
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
  const passIntent = store.passIntent
  const passerTeam = passIntent?.passingTeam ?? store.lastTouchTeam
  const ownPassIds =
    passIntent &&
    passIntent.passType !== 'cross' &&
    passerTeam
      ? new Set(
          (passIntent.soloReceive
            ? [passIntent.receiverId]
            : [passIntent.receiverId, ...(passIntent.runnerIds ?? [])]
          ).filter(Boolean) as string[],
        )
      : null

  let bestId: string | null = null
  let bestScore = Infinity

  for (const player of playerRegistry.values()) {
    if (player.role === 'gk') continue
    if (store.sentOffPlayers.includes(player.id)) continue
    if (isPlayerKnockedDown(player.id)) continue

    const isActiveUser =
      player.team === userTeam && player.id === activeId
    // No passe próprio, só receptor/runners/user — evita IA apoio “ganhar” o tick e falhar o domínio
    if (ownPassIds && player.team === passerTeam) {
      if (!ownPassIds.has(player.id) && !isActiveUser) continue
    }

    const isAi = !isActiveUser
    const designated =
      !!ownPassIds &&
      player.team === passerTeam &&
      ownPassIds.has(player.id)
    const duelPriority =
      hasBodyDuelClaimPriority(player.id) || designated || isActiveUser
    const footReach =
      (isAi ? CONTACT_CLAIM_FOOT_AI : CONTACT_CLAIM_FOOT) *
      (duelPriority ? 1.35 : 1) *
      (designated ? 1.12 : 1)
    const bodyReach =
      (isAi ? CONTACT_CLAIM_BODY_AI : CONTACT_CLAIM_BODY) *
      (duelPriority ? 1.28 : 1) *
      (designated ? 1.1 : 1)

    const bodyDist = distance2D(player.position, ball)
    if (bodyDist > bodyReach + 0.4) continue

    const footDist = minPlayerFootDist2D(player.id, ball)
    let d =
      footDist != null
        ? Math.min(footDist, bodyDist)
        : bodyDist
    if (duelPriority) d *= 0.7
    // Preferência forte ao receptor do passe
    if (designated || isActiveUser) d *= 0.55
    const inContact =
      (footDist != null && footDist < footReach) || bodyDist < bodyReach
    if (!inContact) continue

    if (d < bestScore) {
      bestScore = d
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
    const claimed = tryClaimLooseBall(playerId, part, true)
    // Corpo/perna: Rapier explode com osso cinemático — amortece se não dominou
    if (!claimed && (part === 'body' || part === 'leg')) {
      softenBallBodyHit()
    }
    return
  }

  if (poss.playerId === playerId) return
  if (poss.team === player.team) return

  // Adversário com posse: pé/perna não rouba — só jogo de corpo (A / ombro).
  return
}

/** Legado — preferir arePlayerPhysicsCollidersActiveCached após refreshPhysicsColliderCache */
export function arePlayerPhysicsCollidersActive(playerId: string): boolean {
  const store = useGameStore.getState()
  return computeColliderActive(playerId, store)
}
