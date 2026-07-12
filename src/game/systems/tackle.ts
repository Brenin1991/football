import {
  SLIDE_COOLDOWN_MS,
  SLIDE_CONTACT_DIST,
  SLIDE_DURATION_MS,
  SLIDE_REACH,
} from '../constants'
import { useGameStore } from '../store/gameStore'
import { ballBodyRef, playerRegistry, type PlayerRef } from './entityRegistry'
import { getHeldBallPoint, STEAL_COOLDOWN_MS } from './possession'
import { isBallShielding } from './ballShield'
import { reportSlideFoul, canPlayerPlay } from './referee'
import { distance2D, normalize2D } from './rules'
import { minPlayerFootDist2D } from './playerSkeleton'
import { ensureBallDynamic, syncBallFromBody } from './ballPhysics'
import { clearDribbleState } from './ballDribble'
import type { RapierRigidBody } from '@react-three/rapier'

const SLIDE_CLAIM_BLOCK_MS = 720
const SLIDE_DISLODGE_SPEED = 4.8

export const HEAVY_TACKLE_DIST = SLIDE_CONTACT_DIST
export const KNOCKDOWN_DURATION_MS = 1900

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
  if (isPlayerKnockedDown(playerId) || isPlayerSliding(playerId)) return false
  return performance.now() >= (slideCooldownUntil.get(playerId) ?? 0)
}

export function startSlide(
  playerId: string,
  dirX: number,
  dirZ: number,
  durationMs = SLIDE_DURATION_MS,
): boolean {
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

function shouldKnockdownOnSlide(
  slider: PlayerRef,
  victim: PlayerRef,
  slide: SlideState,
): boolean {
  if (!canSlideReachTarget(slider, slide, victim.position)) return false
  const dist = contactDistanceDuringSlide(slider, slide, victim.position)
  return dist < HEAVY_TACKLE_DIST
}

/** Solta a bola sem dar posse — física/colisores decidem depois. */
function dislodgeBallOnSlide(
  sliderId: string,
  holderId: string,
  slide: SlideState,
) {
  const store = useGameStore.getState()
  const slider = playerRegistry.get(sliderId)
  if (store.ballPossession?.playerId === holderId) {
    store.clearPossession()
  } else {
    clearDribbleState()
  }
  ensureBallDynamic()
  const body = ballBodyRef.current as RapierRigidBody | null
  if (body) {
    body.wakeUp()
    const v = body.linvel()
    body.setLinvel(
      {
        x: slide.dirX * SLIDE_DISLODGE_SPEED + v.x * 0.28,
        y: v.y,
        z: slide.dirZ * SLIDE_DISLODGE_SPEED + v.z * 0.28,
      },
      true,
    )
    syncBallFromBody(body)
  }
  store.freezeDistanceBallClaims(SLIDE_CLAIM_BLOCK_MS)
  store.blockPasserClaim(sliderId, SLIDE_CLAIM_BLOCK_MS)
  store.blockPasserClaim(holderId, SLIDE_CLAIM_BLOCK_MS)
  if (slider) {
    store.setLastTouch(slider.team)
  }
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
      const hitsBody = canSlideReachTarget(slider, slide, holder.position)
      const hitsFoot = canSlideReachTarget(slider, slide, held)

      if (hitsBody || hitsFoot) {
        slide.resolvedHolder = true
        if (isBallShielding(holder.id)) return
        const slideDir = { x: slide.dirX, z: slide.dirZ }
        if (reportSlideFoul(sliderId, holder.id, slideDir, true)) {
          startKnockdown(holder.id)
          return
        }
        startKnockdown(holder.id)
        dislodgeBallOnSlide(slider.id, holder.id, slide)
        return
      }
    }
  }

  for (const victim of playerRegistry.values()) {
    if (victim.team === slider.team || victim.id === sliderId) continue
    if (isPlayerKnockedDown(victim.id)) continue
    if (possession?.playerId === victim.id) continue

    if (shouldKnockdownOnSlide(slider, victim, slide)) {
      const slideDir = { x: slide.dirX, z: slide.dirZ }
      const victimHasBall = possession?.playerId === victim.id
      if (reportSlideFoul(sliderId, victim.id, slideDir, victimHasBall)) {
        startKnockdown(victim.id)
        continue
      }
      startKnockdown(victim.id)
    }
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
