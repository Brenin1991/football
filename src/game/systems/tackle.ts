import {
  SLIDE_COOLDOWN_MS,
  SLIDE_CONTACT_DIST,
  SLIDE_HEAVY_BODY_DIST,
  SLIDE_DURATION_MS,
  SLIDE_REACH,
  SLIDE_AI_INTERCEPT_CHANCE_DEF,
  SLIDE_AI_INTERCEPT_CHANCE_FWD,
  SLIDE_AI_INTERCEPT_CHANCE_MID,
  SLIDE_AI_DUEL_CHANCE_DEF,
  SLIDE_AI_DUEL_CHANCE_FWD,
  SLIDE_AI_DUEL_CHANCE_MID,
  SLIDE_AI_GOAL_BOX_CHANCE_DEF,
  SLIDE_AI_GOAL_DANGER_CHANCE_DEF,
  SLIDE_AI_GOAL_BOX_MAX_DIST,
  SLIDE_AI_GOAL_DANGER_MAX_DIST,
  SLIDE_AI_ROLL_CHANCE_DEF,
  SLIDE_AI_ROLL_CHANCE_FWD,
  SLIDE_AI_ROLL_CHANCE_MID,
  SLIDE_AI_SECOND_CHANCE_MUL,
  PHYSICAL_DUEL_SLIDE_MIN_MS,
  WORLD_SCALE,
} from '../constants'
import { useGameStore } from '../store/gameStore'
import type { FieldBounds } from '../types'
import { getPlayerAttrMultipliers } from './playerAttributes'
import type { PlayerRole, TeamId } from '../types'
import { playerRegistry, type PlayerRef } from './entityRegistry'
import { getHeldBallPoint, STEAL_COOLDOWN_MS } from './possession'
import { isBallShielding } from './ballShield'
import { reportSlideFoul, canPlayerPlay } from './referee'
import { distance2D, normalize2D } from './rules'
import { minPlayerFootDist2D } from './playerSkeleton'
import { clearPlayerDuelState, applySlideContactBrake, releaseBallFromSlideTackle } from './playerPhysicalDuel'
import { clearPlayerBodyCollision } from './playerBodyCollision'
import { paySlideStamina } from './playerStamina'
import { getAttackSign, getDefensiveGoalZ, isInPenaltyArea } from './teamField'

export type DefenderGoalThreat = 'box' | 'danger'

export const HEAVY_TACKLE_DIST = SLIDE_HEAVY_BODY_DIST
export const KNOCKDOWN_DURATION_MS = 1900

/** Perigo na própria área / perto do gol que o zagueiro deve cortar com carrinho. */
export function getDefenderGoalThreat(
  defendingTeam: TeamId,
  bounds: FieldBounds,
  ball: { x: number; z: number },
  holder: PlayerRef,
): DefenderGoalThreat | null {
  if (
    isInPenaltyArea({ x: ball.x, y: 0, z: ball.z }, defendingTeam, bounds) ||
    isInPenaltyArea(holder.position, defendingTeam, bounds)
  ) {
    return 'box'
  }

  const goalZ = getDefensiveGoalZ(defendingTeam, bounds)
  const ballDist = Math.abs(ball.z - goalZ)
  const holderDist = Math.abs(holder.position.z - goalZ)
  const dangerDist = 18 * WORLD_SCALE
  if (ballDist < dangerDist || holderDist < dangerDist) {
    return 'danger'
  }
  return null
}

/** Perto do gol o zagueiro não hesita — critério bem mais solto que no meio-campo. */
export function canEmergencySlideNearGoal(
  slider: PlayerRef,
  holder: PlayerRef,
  bounds: FieldBounds,
  threat: DefenderGoalThreat,
): boolean {
  if (slider.role !== 'def') return false

  const dist = distance2D(slider.position, holder.position)
  const maxDist =
    threat === 'box' ? SLIDE_AI_GOAL_BOX_MAX_DIST : SLIDE_AI_GOAL_DANGER_MAX_DIST
  if (dist > maxDist || dist < 0.2) return false

  const toHolder = normalize2D(
    holder.position.x - slider.position.x,
    holder.position.z - slider.position.z,
  )
  const faceX = Math.sin(slider.rotation)
  const faceZ = Math.cos(slider.rotation)
  const facing = toHolder.x * faceX + toHolder.z * faceZ
  if (facing < 0.1) return false

  if (threat === 'box') return true

  const attackSign = getAttackSign(holder.team, bounds)
  const goalSide =
    (holder.position.z - slider.position.z) * attackSign > 0.04 * WORLD_SCALE
  return goalSide || dist < 1.05 * WORLD_SCALE
}

export function getAISlideChanceNearGoal(threat: DefenderGoalThreat): number {
  return threat === 'box'
    ? SLIDE_AI_GOAL_BOX_CHANCE_DEF
    : SLIDE_AI_GOAL_DANGER_CHANCE_DEF
}

interface SlideState {
  startedAt: number
  until: number
  dirX: number
  dirZ: number
  resolvedHolder: boolean
}

interface KnockdownState {
  until: number
}

const slides = new Map<string, SlideState>()
const knockdowns = new Map<string, KnockdownState>()
const slideCooldownUntil = new Map<string, number>()

export function clearPlayerPhysicalState(playerId: string) {
  slides.delete(playerId)
  knockdowns.delete(playerId)
  slideCooldownUntil.delete(playerId)
  clearPlayerDuelState(playerId)
  clearPlayerBodyCollision(playerId)
}

export function isPlayerKnockedDown(playerId: string): boolean {
  const k = knockdowns.get(playerId)
  return k != null && performance.now() < k.until
}

export function isPlayerSliding(playerId: string): boolean {
  const s = slides.get(playerId)
  return s != null && performance.now() < s.until
}

export function getSlideDirection(playerId: string): { x: number; z: number } | null {
  const s = slides.get(playerId)
  if (!s || performance.now() >= s.until) return null
  return { x: s.dirX, z: s.dirZ }
}

export function canStartSlide(playerId: string): boolean {
  if (!canPlayerPlay(playerId)) return false
  const player = playerRegistry.get(playerId)
  if (player?.role === 'gk') return false
  if (isPlayerKnockedDown(playerId) || isPlayerSliding(playerId)) return false
  return performance.now() >= (slideCooldownUntil.get(playerId) ?? 0)
}

/** Carrinho no portador — zagueiro pela frente; demais funções com critério mais rígido. */
export function canSlideOnHolder(
  slider: PlayerRef,
  holder: PlayerRef,
  bounds: FieldBounds,
): boolean {
  const holderSpeed = Math.hypot(holder.velocity?.x ?? 0, holder.velocity?.z ?? 0)
  const faceX =
    holderSpeed > 0.25 ? holder.velocity!.x / holderSpeed : Math.sin(holder.rotation)
  const faceZ =
    holderSpeed > 0.25 ? holder.velocity!.z / holderSpeed : Math.cos(holder.rotation)

  const toSliderX = slider.position.x - holder.position.x
  const toSliderZ = slider.position.z - holder.position.z
  const toSliderLen = Math.hypot(toSliderX, toSliderZ)
  if (toSliderLen < 0.01) return false

  // Ângulo lateral ok, mas não de qualquer lado — evita carrinho em massa
  const frontMin = slider.role === 'def' ? -0.28 : slider.role === 'mid' ? -0.14 : 0.02
  const holderSeesFront =
    (toSliderX * faceX + toSliderZ * faceZ) / toSliderLen > frontMin

  const attackSign = getAttackSign(holder.team, bounds)
  const goalSideMin =
    slider.role === 'def' ? 0.12 : slider.role === 'mid' ? 0.06 : 0.04
  const goalSide =
    (holder.position.z - slider.position.z) * attackSign > goalSideMin * WORLD_SCALE

  const toHolderX = -toSliderX
  const toHolderZ = -toSliderZ
  const sliderFaceX = Math.sin(slider.rotation)
  const sliderFaceZ = Math.cos(slider.rotation)
  const facingMin =
    slider.role === 'def' ? 0.32 : slider.role === 'mid' ? 0.4 : 0.5
  const facingHolder =
    (toHolderX * sliderFaceX + toHolderZ * sliderFaceZ) / toSliderLen > facingMin

  if (slider.role === 'def') {
    return facingHolder && holderSeesFront && goalSide
  }
  if (slider.role === 'mid') {
    return (
      facingHolder &&
      holderSeesFront &&
      (goalSide || toSliderLen < 1.2 * WORLD_SCALE)
    )
  }
  return (
    holderSeesFront &&
    facingHolder &&
    goalSide &&
    toSliderLen < 1.1 * WORLD_SCALE
  )
}

/** @deprecated use canSlideOnHolder */
export function canSlideFromFront(
  slider: PlayerRef,
  holder: PlayerRef,
  bounds: FieldBounds,
): boolean {
  return canSlideOnHolder(slider, holder, bounds)
}

/** Carrinho para cortar passe em voo — perto da bola e do ponto de corte. */
export function canSlideOnPassIntercept(
  slider: PlayerRef,
  ball: { x: number; z: number },
  velocity: { x: number; y: number; z: number },
  passIntent: { targetX: number; targetZ: number },
  interceptPoint: { x: number; z: number },
): boolean {
  const distBall = Math.hypot(slider.position.x - ball.x, slider.position.z - ball.z)
  const distCut = Math.hypot(
    slider.position.x - interceptPoint.x,
    slider.position.z - interceptPoint.z,
  )
  const maxBall =
    slider.role === 'def' ? 1.95 : slider.role === 'mid' ? 1.68 : 1.35
  const maxCut =
    slider.role === 'def' ? 1.4 : slider.role === 'mid' ? 1.2 : 0.95
  if (distBall > maxBall || distCut > maxCut) return false

  const ballSpeed = Math.hypot(velocity.x, velocity.z)
  if (ballSpeed < 0.95) return false

  const toBallX = ball.x - slider.position.x
  const toBallZ = ball.z - slider.position.z
  const toBallLen = Math.hypot(toBallX, toBallZ)
  if (toBallLen < 0.05) return true

  const faceX = Math.sin(slider.rotation)
  const faceZ = Math.cos(slider.rotation)
  const facingBall =
    (toBallX * faceX + toBallZ * faceZ) / toBallLen >
    (slider.role === 'fwd' ? 0.48 : 0.34)

  const toTargetX = passIntent.targetX - ball.x
  const toTargetZ = passIntent.targetZ - ball.z
  const passLen = Math.hypot(toTargetX, toTargetZ)
  if (passLen < 1.2) return false
  const velDot =
    (velocity.x * toTargetX + velocity.z * toTargetZ) / (ballSpeed * passLen)

  return facingBall && velDot > 0.22
}

export function getAISlideChanceOnHolder(
  role: PlayerRole,
  isPrimaryMarker: boolean,
  playerId?: string,
): number {
  const base =
    role === 'def'
      ? SLIDE_AI_ROLL_CHANCE_DEF
      : role === 'mid'
        ? SLIDE_AI_ROLL_CHANCE_MID
        : SLIDE_AI_ROLL_CHANCE_FWD
  const chance = isPrimaryMarker ? base : base * SLIDE_AI_SECOND_CHANCE_MUL
  if (!playerId) return chance
  return Math.min(0.95, chance * getPlayerAttrMultipliers(playerId).tackling)
}

export function getAISlideChanceOnIntercept(role: PlayerRole, playerId?: string): number {
  const base =
    role === 'def'
      ? SLIDE_AI_INTERCEPT_CHANCE_DEF
      : role === 'mid'
        ? SLIDE_AI_INTERCEPT_CHANCE_MID
        : SLIDE_AI_INTERCEPT_CHANCE_FWD
  if (!playerId) return base
  return Math.min(0.95, base * getPlayerAttrMultipliers(playerId).tackling)
}

/** Carrinho após disputa de corpo prolongada com o portador. */
export function canSlideInPhysicalDuel(
  slider: PlayerRef,
  holder: PlayerRef,
  duelDurationMs: number,
): boolean {
  if (duelDurationMs < PHYSICAL_DUEL_SLIDE_MIN_MS) return false

  const dist = distance2D(slider.position, holder.position)
  const maxDist =
    slider.role === 'def' ? 1.42 : slider.role === 'mid' ? 1.28 : 1.1
  if (dist > maxDist || dist < 0.26) return false

  const toHolder = normalize2D(
    holder.position.x - slider.position.x,
    holder.position.z - slider.position.z,
  )
  const faceX = Math.sin(slider.rotation)
  const faceZ = Math.cos(slider.rotation)
  const facingMin =
    slider.role === 'def' ? 0.2 : slider.role === 'mid' ? 0.3 : 0.4
  if (toHolder.x * faceX + toHolder.z * faceZ < facingMin) return false

  const holderSpeed = Math.hypot(holder.velocity?.x ?? 0, holder.velocity?.z ?? 0)
  const hx =
    holderSpeed > 0.2 ? holder.velocity!.x / holderSpeed : Math.sin(holder.rotation)
  const hz =
    holderSpeed > 0.2 ? holder.velocity!.z / holderSpeed : Math.cos(holder.rotation)
  const toSliderX = slider.position.x - holder.position.x
  const toSliderZ = slider.position.z - holder.position.z
  const toSliderLen = Math.hypot(toSliderX, toSliderZ)
  if (toSliderLen > 0.01) {
    const behindHolder = (toSliderX * hx + toSliderZ * hz) / toSliderLen
    if (behindHolder > 0.55) return false
  }

  return true
}

export function getAISlideChanceOnDuel(role: PlayerRole): number {
  if (role === 'def') return SLIDE_AI_DUEL_CHANCE_DEF
  if (role === 'mid') return SLIDE_AI_DUEL_CHANCE_MID
  return SLIDE_AI_DUEL_CHANCE_FWD
}

export function startSlide(
  playerId: string,
  dirX: number,
  dirZ: number,
  durationMs = SLIDE_DURATION_MS,
): boolean {
  const player = playerRegistry.get(playerId)
  if (player?.role === 'gk') return false
  if (!canStartSlide(playerId)) return false
  const len = Math.hypot(dirX, dirZ)
  const nx = len > 0.001 ? dirX / len : 0
  const nz = len > 0.001 ? dirZ / len : 1
  const now = performance.now()
  slides.set(playerId, {
    startedAt: now,
    until: now + durationMs,
    dirX: nx,
    dirZ: nz,
    resolvedHolder: false,
  })
  slideCooldownUntil.set(playerId, now + durationMs + SLIDE_COOLDOWN_MS)
  paySlideStamina(playerId)
  return true
}

export function startKnockdown(playerId: string, durationMs = KNOCKDOWN_DURATION_MS) {
  const store = useGameStore.getState()
  if (store.ballPossession?.playerId === playerId) {
    store.clearPossession()
  }
  knockdowns.set(playerId, { until: performance.now() + durationMs })
  slides.delete(playerId)
}

function slideProgress(slide: SlideState): number {
  const elapsed = performance.now() - slide.startedAt
  const total = slide.until - slide.startedAt
  if (total <= 0) return 1
  return Math.min(1, elapsed / total)
}

export function getSlideProgress(playerId: string): number {
  const s = slides.get(playerId)
  if (!s) return 1
  return slideProgress(s)
}

export function getSlideRemainingMs(playerId: string): number {
  const s = slides.get(playerId)
  if (!s) return 0
  return Math.max(0, s.until - performance.now())
}

/** Alcance dos pés — pico no meio da animação in-place */
function getSlideFeetPoint(slider: PlayerRef, slide: SlideState): { x: number; z: number } {
  const t = slideProgress(slide)
  const reach = SLIDE_REACH * Math.sin(t * Math.PI)
  return {
    x: slider.position.x + slide.dirX * reach,
    z: slider.position.z + slide.dirZ * reach,
  }
}

function contactDistanceDuringSlide(
  slider: PlayerRef,
  slide: SlideState,
  target: { x: number; z: number },
): number {
  const footDist = minPlayerFootDist2D(slider.id, { x: target.x, y: 0, z: target.z })
  const toBody = distance2D(slider.position, { x: target.x, y: 0, z: target.z })
  if (footDist != null) {
    return Math.min(toBody, footDist)
  }

  const feet = getSlideFeetPoint(slider, slide)
  const toFeet = distance2D({ x: feet.x, y: 0, z: feet.z }, { x: target.x, y: 0, z: target.z })
  return Math.min(toBody, toFeet)
}

function isVictimInSlideCone(
  slider: PlayerRef,
  slide: SlideState,
  target: { x: number; z: number },
): boolean {
  const toTarget = normalize2D(
    target.x - slider.position.x,
    target.z - slider.position.z,
  )
  const slideDot = toTarget.x * slide.dirX + toTarget.z * slide.dirZ
  return slideDot > 0.12
}

function canSlideReachTarget(
  slider: PlayerRef,
  slide: SlideState,
  target: { x: number; z: number },
): boolean {
  if (!isVictimInSlideCone(slider, slide, target)) return false
  return contactDistanceDuringSlide(slider, slide, target) < SLIDE_CONTACT_DIST
}

function measureSlideContactQuality(
  slider: PlayerRef,
  slide: SlideState,
  victim: PlayerRef,
  heldPoint?: { x: number; z: number },
): {
  hitsBody: boolean
  hitsBall: boolean
  heavyBody: boolean
  bodyDist: number
} {
  const bodyDist = contactDistanceDuringSlide(slider, slide, victim.position)
  const hitsBody =
    isVictimInSlideCone(slider, slide, victim.position) &&
    bodyDist < SLIDE_CONTACT_DIST
  const heavyBody = hitsBody && bodyDist < HEAVY_TACKLE_DIST

  let hitsBall = false
  if (heldPoint) {
    hitsBall = canSlideReachTarget(slider, slide, heldPoint)
  }

  return { hitsBody, hitsBall, heavyBody, bodyDist }
}

/** Carrinho — solta a bola; física decide quem domina depois. */
function dislodgeBallOnSlide(
  sliderId: string,
  holderId: string,
  slide: SlideState,
) {
  const slider = playerRegistry.get(sliderId)
  const holder = playerRegistry.get(holderId)
  if (!slider || !holder) return

  const roll = Math.random()
  const kind =
    roll < 0.34
      ? 'ricochet'
      : roll < 0.62
        ? 'loose'
        : roll < 0.82
          ? 'scrape'
          : 'tackle'
  const held = getHeldBallPoint(holder, holderId)
  releaseBallFromSlideTackle(slider, holder, kind, 0.88, held, {
    x: slide.dirX,
    z: slide.dirZ,
  })
}

export function processSlideContacts(sliderId: string) {
  const slide = slides.get(sliderId)
  if (!slide) return

  const now = performance.now()
  if (now >= slide.until) {
    slides.delete(sliderId)
    return
  }

  const slider = playerRegistry.get(sliderId)
  if (!slider || slider.role === 'gk') return

  const store = useGameStore.getState()
  if (store.phase !== 'playing') return
  if (now - store.possessionSince < STEAL_COOLDOWN_MS) return

  const possession = store.ballPossession
  const t = slideProgress(slide)
  if (t < 0.05 || t > 0.95) return

  if (possession && !slide.resolvedHolder) {
    const holder = playerRegistry.get(possession.playerId)
    if (holder && holder.team !== slider.team) {
      if (holder.role === 'gk') return
      const held = getHeldBallPoint(holder, possession.playerId)
      const quality = measureSlideContactQuality(slider, slide, holder, held)

      if (quality.hitsBody || quality.hitsBall) {
        slide.resolvedHolder = true
        if (isBallShielding(holder.id)) return
        applySlideContactBrake(slider.id, holder.id, quality.heavyBody)
        const slideDir = { x: slide.dirX, z: slide.dirZ }
        if (reportSlideFoul(sliderId, holder.id, slideDir, true, quality)) {
          startKnockdown(holder.id)
          return
        }
        // Lance limpo / interceptação: derruba só se pegou feio no corpo
        if (quality.heavyBody) startKnockdown(holder.id)
        dislodgeBallOnSlide(slider.id, holder.id, slide)
        return
      }
    }
  }

  for (const victim of playerRegistry.values()) {
    if (victim.team === slider.team || victim.id === sliderId) continue
    if (isPlayerKnockedDown(victim.id)) continue
    if (possession?.playerId === victim.id) continue

    const quality = measureSlideContactQuality(slider, slide, victim)
    if (!quality.hitsBody) continue

    // Raspão / perto sem bater feio — continua o lance, sem queda nem falta
    if (!quality.heavyBody) continue

    applySlideContactBrake(sliderId, victim.id, true)
    const slideDir = { x: slide.dirX, z: slide.dirZ }
    const victimHasBall = possession?.playerId === victim.id
    if (reportSlideFoul(sliderId, victim.id, slideDir, victimHasBall, quality)) {
      startKnockdown(victim.id)
      continue
    }
    startKnockdown(victim.id)
  }
}

export function cleanupPhysicalStates() {
  const now = performance.now()
  for (const [id, s] of slides) {
    if (now >= s.until) slides.delete(id)
  }
  for (const [id, k] of knockdowns) {
    if (now >= k.until) knockdowns.delete(id)
  }
}
