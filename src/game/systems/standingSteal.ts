import {
  BODY_CHARGE_AI_COOLDOWN_MS,
  BODY_CHARGE_AI_VS_PLAYER_MS,
  BODY_CHARGE_COOLDOWN_MS,
  BODY_CHARGE_MAX_DIST,
  WORLD_SCALE,
} from '../constants'
import { getUserTeam, useGameStore } from '../store/gameStore'
import { ballRef, playerRegistry, type PlayerRef } from './entityRegistry'
import { isCoverPresser, isTeamMarker, markBodyDuelClaimPriority } from './dynamicFormation'
import { distance2D, normalize2D } from './rules'
import { isBallShielding } from './ballShield'
import { getDribbleStealProtect } from './possession'
import { getAiDribbleStickProtect } from './aiBrain'
import {
  applyPhysicalContactBrake,
  releaseBallFromBodyImbalance,
} from './playerPhysicalDuel'
import { requestContactAnim } from './playerContactAnims'
import {
  canAiAttemptStandingSteal,
  isStaminaExhausted,
  payStealAttemptStamina,
} from './playerStamina'
import { playerBodyMass, isBodyToBodyNear } from './playerBodyCollision'
import { isPlayerKnockedDown, isPlayerSliding } from './tackle'
import { getMatchDifficulty } from './difficulty'

const bodyChargeCooldownUntil = new Map<string, number>()
/** Empurrão aplicado no próximo frame do Player (moveVel). */
const pendingKnockVel = new Map<string, { x: number; z: number }>()
/** Cooldown pra não spamar “perdido” no mesmo marcador. */
const skillBeatCooldownUntil = new Map<string, number>()

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v))
}

function isActiveUserPlayer(playerId: string): boolean {
  const store = useGameStore.getState()
  const p = playerRegistry.get(playerId)
  return !!p && p.team === getUserTeam() && playerId === store.activePlayerId
}

/** Cooldown do ombro da IA: 1s no player, 6s vs IA. */
function aiBodyChargeCooldownMs(victimId: string): number {
  return isActiveUserPlayer(victimId)
    ? BODY_CHARGE_AI_VS_PLAYER_MS
    : BODY_CHARGE_AI_COOLDOWN_MS
}

function addPendingKnock(playerId: string, ix: number, iz: number) {
  const prev = pendingKnockVel.get(playerId)
  if (prev) {
    prev.x += ix
    prev.z += iz
  } else {
    pendingKnockVel.set(playerId, { x: ix, z: iz })
  }
}

export function consumeBodyChargeKnock(
  playerId: string,
): { x: number; z: number } | null {
  const p = pendingKnockVel.get(playerId)
  if (!p) return null
  pendingKnockVel.delete(playerId)
  return p
}

export type SkillBeatKind = 'spin' | 'finta180' | 'cut' | 'feint'

/**
 * 180 / spin / corte / finta: marcadores colados às vezes ficam perdidos
 * (desequilíbrio + freio) — nem sempre.
 */
export function trySkillMoveBeatPressers(
  holderId: string,
  kind: SkillBeatKind,
): void {
  const holder = playerRegistry.get(holderId)
  if (!holder || holder.role === 'gk') return

  const store = useGameStore.getState()
  if (store.phase !== 'playing' || store.ballFrozen) return
  if (store.ballPossession?.playerId !== holderId) return

  const now = performance.now()
  const baseChance =
    kind === 'finta180'
      ? 0.62
      : kind === 'spin'
        ? 0.54
        : kind === 'cut'
          ? 0.48
          : 0.4
  const maxDist = BODY_CHARGE_MAX_DIST
  const faceX = Math.sin(holder.rotation)
  const faceZ = Math.cos(holder.rotation)
  const diff = getMatchDifficulty()
  const resist =
    diff === 'expert' ? 0.78 : diff === 'hard' ? 0.86 : diff === 'medium' ? 0.94 : 1

  for (const other of playerRegistry.values()) {
    if (other.id === holderId) continue
    if (other.team === holder.team) continue
    if (other.role === 'gk') continue
    if (isPlayerKnockedDown(other.id) || isPlayerSliding(other.id)) continue
    // Só se os corpos estiverem encostados
    if (!isBodyToBodyNear(holderId, other.id, 1.12)) continue

    const dist = distance2D(holder.position, other.position)
    const cd = skillBeatCooldownUntil.get(other.id) ?? 0
    if (now < cd) continue

    const pressing =
      isCoverPresser(other.id, other.team) ||
      isTeamMarker(other.id, other.team, store.ballPossession, ballRef.current)
    let chance = baseChance * (pressing ? 1.2 : 0.85)
    if (dist < maxDist * 0.85) chance += 0.14
    // Portador (player ou IA) com skill: mesma chance de desequilibrar o marcador
    chance += 0.1
    // Marcador IA resiste um pouco conforme dificuldade
    if (other.team !== getUserTeam()) chance *= resist
    chance = clamp(chance, 0.18, 0.88)

    if (Math.random() > chance) continue

    skillBeatCooldownUntil.set(other.id, now + 780 + Math.random() * 420)

    // Empurra pro lado / atrás do novo peito do portador — “perdeu o tempo”
    const away = normalize2D(
      other.position.x - holder.position.x,
      other.position.z - holder.position.z,
    )
    const side = Math.random() < 0.5 ? 1 : -1
    const knockDir = normalize2D(
      away.x * 0.55 - faceZ * side * 0.7 - faceX * 0.15,
      away.z * 0.55 + faceX * side * 0.7 - faceZ * 0.15,
    )
    const push =
      (0.55 + (1 - dist / Math.max(maxDist, 1e-3)) * 0.85) * WORLD_SCALE *
      (kind === 'finta180' || kind === 'spin' ? 1.15 : 0.9)

    addPendingKnock(other.id, knockDir.x * push, knockDir.z * push)
    other.velocity.x += knockDir.x * push * 0.85
    other.velocity.z += knockDir.z * push * 0.85

    applyPhysicalContactBrake(
      other.id,
      0.78 + (kind === 'finta180' ? 0.12 : 0),
      kind === 'finta180' || kind === 'spin' ? 520 + Math.random() * 220 : 380 + Math.random() * 160,
      holderId,
      0.42,
    )
    requestContactAnim(other.id, 'imbalance')
  }
}

/**
 * Roubo = só jogo de corpo no portador.
 * Desequilibrou → bola livre. Sem transferência mágica de posse.
 */
export function tryStandingSteal(stealerId: string): boolean {
  return tryBodyChargeOnHolder(stealerId)
}

/**
 * Ombro no portador da bola (player no A ou IA).
 * Knock solta a bola no campo — depois disputa normal.
 */
export function tryBodyChargeOnHolder(chargerId: string): boolean {
  const store = useGameStore.getState()
  if (store.phase !== 'playing' || store.ballFrozen) return false

  const possession = store.ballPossession
  if (!possession || possession.playerId === chargerId) return false

  const charger = playerRegistry.get(chargerId)
  const holder = playerRegistry.get(possession.playerId)
  if (!charger || !holder) return false
  if (charger.role === 'gk' || holder.role === 'gk') return false
  if (charger.team === holder.team) return false
  if (isPlayerKnockedDown(chargerId) || isPlayerSliding(chargerId)) return false
  if (isPlayerKnockedDown(holder.id) || isPlayerSliding(holder.id)) return false
  if (store.isStealImmune(possession.playerId)) return false
  if (isBallShielding(possession.playerId)) return false
  // Finta / meia-lua / corte: igual player — ombro não pega no meio da skill
  const protect = Math.max(
    getDribbleStealProtect(holder),
    getAiDribbleStickProtect(holder.id),
  )
  if (protect > 0.62) return false
  if (!isBodyToBodyNear(chargerId, holder.id, 1.18)) return false

  const isUserActive =
    charger.team === getUserTeam() && chargerId === store.activePlayerId
  if (!isUserActive && !canAiAttemptStandingSteal(chargerId)) return false
  if (isUserActive && isStaminaExhausted(chargerId)) return false

  const now = performance.now()
  const cd = bodyChargeCooldownUntil.get(chargerId) ?? 0
  if (now < cd) return false

  // IA: só marcador / perto; player no A pode sempre se colado
  if (!isUserActive) {
    const isMarker = isTeamMarker(
      chargerId,
      charger.team,
      possession,
      ballRef.current,
    )
    const isCloseSupport =
      isCoverPresser(chargerId, charger.team) ||
      distance2D(charger.position, holder.position) < 1.15
    if (!isMarker && !isCloseSupport) return false
  }

  payStealAttemptStamina(chargerId)
  const holderIsUser = isActiveUserPlayer(holder.id)
  bodyChargeCooldownUntil.set(
    chargerId,
    now +
      (isUserActive
        ? BODY_CHARGE_COOLDOWN_MS * 0.5
        : aiBodyChargeCooldownMs(holder.id)),
  )

  return applyBodyChargeHit(charger, holder, {
    isUserCharger: isUserActive,
    marginBoost: isUserActive ? 0.35 : holderIsUser ? 0.08 : 0.18,
    knockChanceCap: isUserActive ? 0.94 : holderIsUser ? 0.82 : 0.9,
    victimBrakeBoost: false,
    softVsUser: !isUserActive && holderIsUser,
    releaseBallOnKnock: true,
  })
}

/** @deprecated use tryBodyChargeOnHolder — mantido pra IA antiga */
export function tryAiBodyChargeOnHolder(chargerId: string): boolean {
  return tryBodyChargeOnHolder(chargerId)
}

/** Mantém ombro em loop enquanto o roubador pressiona colado no portador. */
export function refreshShoulderChargePress(stealerId: string, holderId: string) {
  const stealer = playerRegistry.get(stealerId)
  const holder = playerRegistry.get(holderId)
  if (!stealer || !holder) return
  if (!isBodyToBodyNear(stealerId, holderId, 1.18)) return
  requestContactAnim(stealerId, 'shoulder_charge', 280)
}

/**
 * Alvo de jogo de corpo sem bola — adversário no ombro / ao lado, colado.
 * Ignora quem está com a bola (isso é roubo em pé).
 * Após passe: permite ombro lateral no marcador que vinha roubar.
 */
export function findOffBallBodyChargeTarget(chargerId: string): PlayerRef | null {
  const charger = playerRegistry.get(chargerId)
  if (!charger || charger.role === 'gk') return null

  const store = useGameStore.getState()
  const ballHolderId = store.ballPossession?.playerId ?? null
  const justPassed =
    store.passBlockPlayerId === chargerId &&
    performance.now() < (store.passBlockUntil ?? 0)
  const faceX = Math.sin(charger.rotation)
  const faceZ = Math.cos(charger.rotation)
  const speed = Math.hypot(charger.velocity.x, charger.velocity.z)
  const moveX = speed > 0.25 ? charger.velocity.x / speed : faceX
  const moveZ = speed > 0.25 ? charger.velocity.z / speed : faceZ
  // Pós-passe: ombro lateral conta (marcador costuma estar ao lado)
  const minAlign = justPassed ? -0.35 : -0.08

  let best: PlayerRef | null = null
  let bestScore = -Infinity

  for (const other of playerRegistry.values()) {
    if (other.id === chargerId) continue
    if (other.team === charger.team) continue
    if (other.role === 'gk') continue
    if (other.id === ballHolderId) continue
    if (isPlayerKnockedDown(other.id) || isPlayerSliding(other.id)) continue
    // Só corpo no corpo
    if (!isBodyToBodyNear(chargerId, other.id, 1.1)) continue

    const dist = distance2D(charger.position, other.position)

    const toX = other.position.x - charger.position.x
    const toZ = other.position.z - charger.position.z
    const toLen = Math.hypot(toX, toZ) || 1e-4
    const align = (toX / toLen) * moveX + (toZ / toLen) * moveZ
    // Frente / ombro / lado — não atrás
    if (align < minAlign) continue

    const pressing =
      isCoverPresser(other.id, other.team) ||
      isTeamMarker(other.id, other.team, store.ballPossession, ballRef.current)
    const isActiveUser =
      other.team === getUserTeam() && other.id === store.activePlayerId
    const score =
      align * 1.15 -
      dist * 1.05 +
      (speed > 1.2 ? 0.2 : 0) +
      (pressing ? 0.55 : 0) +
      (justPassed ? 0.35 : 0) +
      (isActiveUser ? 0.9 : 0)
    if (score > bestScore) {
      bestScore = score
      best = other
    }
  }
  return best
}

/**
 * Ombro em jogador sem bola → vítima desequilibra e leva freio/empurrão.
 * Botão A ou sprint colado (mesmo input do roubo).
 */
export function tryOffBallBodyCharge(
  chargerId: string,
  preferredTargetId?: string,
): boolean {
  const store = useGameStore.getState()
  if (store.phase !== 'playing' || store.ballFrozen) return false

  const charger = playerRegistry.get(chargerId)
  if (!charger || charger.role === 'gk') return false
  if (store.ballPossession?.playerId === chargerId) return false
  if (isPlayerKnockedDown(chargerId) || isPlayerSliding(chargerId)) return false

  const isUserActive =
    charger.team === getUserTeam() && chargerId === store.activePlayerId
  if (isUserActive && isStaminaExhausted(chargerId)) return false
  if (!isUserActive && !canAiAttemptStandingSteal(chargerId)) return false

  const now = performance.now()
  const cd = bodyChargeCooldownUntil.get(chargerId) ?? 0
  if (now < cd) return false

  let victim =
    preferredTargetId != null
      ? playerRegistry.get(preferredTargetId) ?? null
      : null
  if (victim) {
    if (
      victim.team === charger.team ||
      victim.role === 'gk' ||
      victim.id === store.ballPossession?.playerId ||
      isPlayerKnockedDown(victim.id) ||
      isPlayerSliding(victim.id) ||
      !isBodyToBodyNear(chargerId, victim.id, 1.1)
    ) {
      victim = null
    }
  }
  if (!victim) victim = findOffBallBodyChargeTarget(chargerId)
  if (!victim) return false
  if (!isBodyToBodyNear(chargerId, victim.id, 1.1)) return false

  payStealAttemptStamina(chargerId)
  bodyChargeCooldownUntil.set(
    chargerId,
    now +
      (isUserActive
        ? BODY_CHARGE_COOLDOWN_MS * 0.55
        : aiBodyChargeCooldownMs(victim.id)),
  )

  const justPassedBoost =
    store.passBlockPlayerId === chargerId &&
    performance.now() < (store.passBlockUntil ?? 0)
  return applyBodyChargeHit(charger, victim, {
    isUserCharger: isUserActive,
    marginBoost: justPassedBoost ? 0.32 : 0,
    knockChanceCap: justPassedBoost ? 0.96 : 0.92,
    victimBrakeBoost: justPassedBoost,
  })
}

/** A: ombro no portador se colado; senão ombro em adversário sem bola. */
export function tryStandingStealOrBodyCharge(playerId: string): boolean {
  const store = useGameStore.getState()
  const poss = store.ballPossession
  if (poss && poss.playerId !== playerId) {
    return tryBodyChargeOnHolder(playerId)
  }
  return tryOffBallBodyCharge(playerId)
}

function applyBodyChargeHit(
  charger: PlayerRef,
  victim: PlayerRef,
  opts: {
    isUserCharger: boolean
    marginBoost: number
    knockChanceCap: number
    victimBrakeBoost: boolean
    softVsUser?: boolean
    releaseBallOnKnock?: boolean
  },
): boolean {
  const store = useGameStore.getState()
  const dist = distance2D(charger.position, victim.position)
  const closeness = clamp(1 - dist / Math.max(BODY_CHARGE_MAX_DIST, 1e-3), 0, 1)
  const chargerSp = Math.hypot(charger.velocity.x, charger.velocity.z)
  const victimSp = Math.hypot(victim.velocity.x, victim.velocity.z)
  const massCh = playerBodyMass(charger.role, charger.id)
  const massVi = playerBodyMass(victim.role, victim.id)

  const toV = normalize2D(
    victim.position.x - charger.position.x,
    victim.position.z - charger.position.z,
  )
  const faceDot =
    Math.sin(charger.rotation) * toV.x + Math.cos(charger.rotation) * toV.z
  let margin =
    (chargerSp - victimSp * 0.55) * 0.35 +
    (massCh - massVi) * 0.42 +
    faceDot * 0.38 +
    closeness * 0.35 +
    opts.marginBoost
  if (opts.isUserCharger) margin += 0.28
  if (charger.role === 'def') margin += 0.12

  const knockChance = clamp(0.38 + margin * 0.5, 0.28, opts.knockChanceCap)
  const knocks = Math.random() < knockChance
  const soft = opts.softVsUser === true
  // Se a vítima TEM a bola e caiu: sempre solta — sem magnetismo
  const victimHasBall = store.ballPossession?.playerId === victim.id
  const releaseBall = knocks && (opts.releaseBallOnKnock === true || victimHasBall)

  requestContactAnim(charger.id, 'shoulder_charge', knocks ? 380 : 260)

  const push =
    (0.85 + closeness * 1.1 + chargerSp * 0.18) *
    WORLD_SCALE *
    (knocks ? (soft ? 0.7 : 0.72) : soft ? 0.35 : 0.42)
  const pushShare = massCh / (massCh + massVi)
  addPendingKnock(victim.id, toV.x * push * pushShare, toV.z * push * pushShare)
  addPendingKnock(charger.id, -toV.x * push * 0.18, -toV.z * push * 0.18)
  victim.velocity.x += toV.x * push * pushShare
  victim.velocity.z += toV.z * push * pushShare
  charger.velocity.x *= releaseBall ? 0.92 : 0.82
  charger.velocity.z *= releaseBall ? 0.92 : 0.82

  applyPhysicalContactBrake(
    charger.id,
    releaseBall ? 0.35 : 0.45 + closeness * 0.2,
    releaseBall ? 90 : knocks ? 140 : 180,
    victim.id,
    releaseBall ? 0.9 : knocks ? 0.86 : 0.8,
  )
  applyPhysicalContactBrake(
    victim.id,
    0.5 + closeness * 0.2 + (opts.victimBrakeBoost ? 0.1 : 0),
    knocks
      ? opts.victimBrakeBoost
        ? 420
        : soft
          ? 280
          : 320
      : opts.victimBrakeBoost
        ? 300
        : soft
          ? 200
          : 220,
    charger.id,
    knocks ? (soft ? 0.72 : 0.72) : soft ? 0.8 : opts.victimBrakeBoost ? 0.72 : 0.78,
  )

  if (knocks) {
    requestContactAnim(victim.id, 'imbalance')
    requestContactAnim(charger.id, 'end_shoulder_charge')

    if (victimHasBall) {
      releaseBallFromBodyImbalance(victim, charger)
      markBodyDuelClaimPriority(charger.id, 900)
    }
    return true
  }

  requestContactAnim(charger.id, 'end_shoulder_charge')
  return true
}

export function clearBodyChargeCooldown(playerId: string) {
  bodyChargeCooldownUntil.delete(playerId)
  pendingKnockVel.delete(playerId)
  skillBeatCooldownUntil.delete(playerId)
}
