import * as THREE from 'three'
import type { RapierRigidBody } from '@react-three/rapier'
import type { TeamId } from '../types'
import { PLAYER_SPEED, PLAYER_SPRINT_SPEED, STEAL_DISTANCE, WORLD_SCALE } from '../constants'
import { ballBodyRef, ballRef, playerRegistry, type PlayerRef } from './entityRegistry'
import { useGameStore, getUserTeam } from '../store/gameStore'
import { adjustStealContestMargin, getOpponentStealVsUserChanceMul, getMatchDifficulty, getUserTeammateStealChanceMul } from './difficulty'
import { clearDribbleState } from './ballDribble'
import { ensureBallDynamic, syncBallFromBody } from './ballPhysics'
import { distance2D, normalize2D } from './rules'
import { minPlayerFootDist2D } from './playerSkeleton'
import { getDribbleStealProtect } from './possession'
import { getStaminaContestMul } from './playerStamina'
import { getPlayerAttrMultipliers } from './playerAttributes'

const BRAKE_MS = 220
const BRAKE_FLOOR = 0.68
const HOLDER_BRAKE_MS = 260

export type SlideContestReleaseKind = 'loose' | 'ricochet' | 'scrape' | 'tackle'

function holderFacing(holder: PlayerRef): { x: number; z: number } {
  const speed = Math.hypot(holder.velocity?.x ?? 0, holder.velocity?.z ?? 0)
  if (speed > 0.22) {
    return { x: holder.velocity!.x / speed, z: holder.velocity!.z / speed }
  }
  return { x: Math.sin(holder.rotation), z: Math.cos(holder.rotation) }
}

/** Carrinho — solta a bola para disputa física (não usa em roubo em pé). */
export function releaseBallFromSlideTackle(
  slider: PlayerRef,
  holder: PlayerRef,
  kind: SlideContestReleaseKind,
  intensity: number,
  heldPoint?: { x: number; z: number },
  slideDir?: { x: number; z: number },
) {
  const store = useGameStore.getState()
  if (store.ballPossession?.playerId === holder.id) {
    store.clearPossession()
  } else {
    clearDribbleState()
  }
  ensureBallDynamic()

  const face = holderFacing(holder)
  const sep = normalize2D(
    slider.position.x - holder.position.x,
    slider.position.z - holder.position.z,
  )
  const perp = { x: -face.z, z: face.x }
  const side = Math.random() < 0.5 ? 1 : -1

  let dirX = sep.x
  let dirZ = sep.z
  let speed = 2.1 * WORLD_SCALE * intensity
  let lift = 0.14
  let claimFreezeMs = 520
  let lastTouch: TeamId | null = slider.team

  switch (kind) {
    case 'loose':
      dirX = sep.x * 0.48 + face.x * 0.32 + perp.x * side * 0.38
      dirZ = sep.z * 0.48 + face.z * 0.32 + perp.z * side * 0.38
      speed = (1.55 + Math.random() * 1.15) * WORLD_SCALE * intensity
      lift = 0.1 + Math.random() * 0.14
      claimFreezeMs = 540 + Math.random() * 180
      lastTouch = Math.random() < 0.45 ? slider.team : holder.team
      break
    case 'ricochet':
      dirX = face.x * 0.55 + perp.x * side * 0.82
      dirZ = face.z * 0.55 + perp.z * side * 0.82
      speed = (1.15 + Math.random() * 1.05) * WORLD_SCALE * intensity
      lift = 0.12 + Math.random() * 0.2
      claimFreezeMs = 580 + Math.random() * 220
      lastTouch = Math.random() < 0.68 ? holder.team : slider.team
      break
    case 'scrape':
      dirX = face.x * 0.7 + (Math.random() - 0.5) * 0.55
      dirZ = face.z * 0.7 + (Math.random() - 0.5) * 0.55
      speed = (0.85 + Math.random() * 0.75) * WORLD_SCALE
      lift = 0.06 + Math.random() * 0.1
      claimFreezeMs = 620 + Math.random() * 200
      lastTouch = holder.team
      break
    case 'tackle':
      if (slideDir) {
        dirX = slideDir.x * 0.78 + sep.x * 0.22
        dirZ = slideDir.z * 0.78 + sep.z * 0.22
      }
      speed = (2.6 + Math.random() * 1.6) * WORLD_SCALE * intensity
      lift = Math.random() * 0.1
      claimFreezeMs = 500 + Math.random() * 160
      lastTouch = Math.random() < 0.55 ? slider.team : holder.team
      break
  }

  const n = normalize2D(dirX, dirZ)
  const body = ballBodyRef.current as RapierRigidBody | null
  if (body && heldPoint) {
    const toHeldX = heldPoint.x - slider.position.x
    const toHeldZ = heldPoint.z - slider.position.z
    const toHeld = normalize2D(
      n.x * 0.72 + toHeldX * 0.28,
      n.z * 0.72 + toHeldZ * 0.28,
    )
    dirX = toHeld.x
    dirZ = toHeld.z
  }
  const outDir = heldPoint ? normalize2D(dirX, dirZ) : n
  if (body) {
    body.wakeUp()
    const v = body.linvel()
    body.setLinvel(
      {
        x: outDir.x * speed + v.x * 0.12,
        y: Math.max(v.y, lift),
        z: outDir.z * speed + v.z * 0.12,
      },
      true,
    )
    syncBallFromBody(body)
  }

  if (lastTouch) store.setLastTouch(lastTouch)
  store.freezeDistanceBallClaims(claimFreezeMs)
  store.blockPasserClaim(slider.id, claimFreezeMs + 80)
  store.blockPasserClaim(holder.id, claimFreezeMs + 80)
}

/**
 * Desequilíbrio / ombro no portador — bola VAI embora, livre no campo.
 * Sem magnetismo: limpa posse, joga a bola fora dos pés e congela reclaim.
 */
export function releaseBallFromBodyImbalance(
  holder: PlayerRef,
  charger?: PlayerRef | null,
) {
  const store = useGameStore.getState()
  if (store.ballPossession?.playerId === holder.id) {
    store.clearPossession()
  }
  clearDribbleState()
  ensureBallDynamic()

  const face = holderFacing(holder)
  const perp = { x: -face.z, z: face.x }
  const side = Math.random() < 0.5 ? 1 : -1

  let awayX = face.x * 0.35 + perp.x * side * 0.75
  let awayZ = face.z * 0.35 + perp.z * side * 0.75
  if (charger) {
    const fromCharger = normalize2D(
      holder.position.x - charger.position.x,
      holder.position.z - charger.position.z,
    )
    // Empurra a bola pra frente do choque (não cola no ombro do roubador)
    awayX = fromCharger.x * 0.55 + face.x * 0.2 + perp.x * side * 0.55
    awayZ = fromCharger.z * 0.55 + face.z * 0.2 + perp.z * side * 0.55
  }

  const dir = normalize2D(awayX, awayZ)
  const speed = (2.35 + Math.random() * 1.4) * WORLD_SCALE
  const lift = 0.12 + Math.random() * 0.16
  const claimFreezeMs = 720 + Math.random() * 220

  const body = ballBodyRef.current as RapierRigidBody | null
  if (body) {
    body.wakeUp()
    // Tira a bola dos pés imediatamente — senão reclaim no mesmo frame
    const t = body.translation()
    const sep = 0.55 * WORLD_SCALE
    body.setTranslation(
      {
        x: t.x + dir.x * sep,
        y: Math.max(t.y, 0.14),
        z: t.z + dir.z * sep,
      },
      true,
    )
    body.setLinvel(
      {
        x: dir.x * speed,
        y: lift,
        z: dir.z * speed,
      },
      true,
    )
    syncBallFromBody(body)
  } else {
    const cur = ballRef.current
    ballRef.current = {
      x: cur.x + dir.x * 0.55 * WORLD_SCALE,
      y: Math.max(cur.y, 0.14),
      z: cur.z + dir.z * 0.55 * WORLD_SCALE,
    }
    ballRef.velocity = { x: dir.x * speed, y: lift, z: dir.z * speed }
  }

  store.setLastTouch(charger?.team ?? holder.team)
  store.freezeDistanceBallClaims(claimFreezeMs)
  store.blockPasserClaim(holder.id, claimFreezeMs + 160)
  if (charger) {
    // Quem desequilibrou também espera um tempo — disputa limpa, não magnetiza
    store.blockPasserClaim(charger.id, Math.round(claimFreezeMs * 0.45))
  }
}

type BrakeState = {
  until: number
  floor: number
  startedAt: number
  opponentId?: string
}

const brakes = new Map<string, BrakeState>()

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v))
}

export function clearPlayerDuelState(playerId: string) {
  brakes.delete(playerId)
}

export function applyPhysicalContactBrake(
  playerId: string,
  intensity = 1,
  durationMs = BRAKE_MS,
  opponentId?: string,
  minFloor = BRAKE_FLOOR,
) {
  const now = performance.now()
  const floor = clamp(minFloor + (1 - intensity) * 0.18, minFloor, 0.88)
  const prev = brakes.get(playerId)
  const mergedFloor =
    prev && now < prev.until ? Math.min(prev.floor, floor) : floor
  const sameOpponent =
    prev != null &&
    opponentId != null &&
    prev.opponentId === opponentId &&
    now < prev.until + 120
  brakes.set(playerId, {
    until: now + durationMs,
    floor: mergedFloor,
    startedAt: sameOpponent ? prev!.startedAt : now,
    opponentId: opponentId ?? prev?.opponentId,
  })
}

export function getDuelOpponentId(playerId: string): string | null {
  const b = brakes.get(playerId)
  if (!b || performance.now() >= b.until) return null
  return b.opponentId ?? null
}

export function isInPhysicalDuel(playerId: string): boolean {
  return getDuelOpponentId(playerId) != null
}

/** Tempo contínuo na mesma disputa física com o adversário. */
export function getPhysicalDuelDurationMs(playerId: string): number {
  const b = brakes.get(playerId)
  if (!b) return 0
  const now = performance.now()
  if (now >= b.until || !b.opponentId) return 0
  return now - b.startedAt
}

export function getPhysicalDuelSpeedMul(playerId: string): number {
  const b = brakes.get(playerId)
  if (!b) return 1
  const now = performance.now()
  if (now >= b.until) {
    brakes.delete(playerId)
    return 1
  }
  const total = Math.max(b.until - b.startedAt, 1)
  const elapsed = now - b.startedAt
  const t = clamp(elapsed / total, 0, 1)
  const eased = 1 - (1 - t) * (1 - t)
  return THREE.MathUtils.lerp(b.floor, 1, eased)
}

export function getPhysicalDuelDecelMul(playerId: string): number {
  const player = playerRegistry.get(playerId)
  const mul = getPhysicalDuelSpeedMul(playerId)
  if (mul >= 0.98) return 1
  const base = clamp(1.08 + (1 - mul) * 0.55, 1.08, 1.38)
  const isActiveUser =
    player?.team === getUserTeam() &&
    playerId === useGameStore.getState().activePlayerId
  // Só o boneco controlado fica “leve”; IA aliada disputa de verdade
  if (isActiveUser) return clamp(1.01 + (1 - mul) * 0.12, 1, 1.08)
  return base
}

function roleMass(role: PlayerRef['role']): number {
  if (role === 'def') return 1.28
  if (role === 'mid') return 1.02
  if (role === 'fwd') return 0.86
  return 1.18
}

function contestPower(player: PlayerRef, other: PlayerRef, isAttacker: boolean): number {
  const speed = Math.hypot(player.velocity.x, player.velocity.z)
  const maxSp = player.isSprinting ? PLAYER_SPRINT_SPEED : PLAYER_SPEED
  const momentum = clamp(speed / Math.max(maxSp, 0.01), 0, 1.2)

  const toOther = normalize2D(
    other.position.x - player.position.x,
    other.position.z - player.position.z,
  )
  const facingX = Math.sin(player.rotation)
  const facingZ = Math.cos(player.rotation)
  const angle = toOther.x * facingX + toOther.z * facingZ

  let power = momentum * 1.35 + roleMass(player.role) * 0.52
  if (isAttacker) {
    power += clamp(angle, -0.15, 1) * 0.42
    if (speed > maxSp * 0.72) power += 0.22
  } else {
    power += clamp(-angle, -0.15, 1) * 0.32
    power += 0.2
  }
  return power * getStaminaContestMul(player.id) * getPlayerAttrMultipliers(player.id).strength
}

export type StandingStealOutcome = 'stolen' | 'held'

function standingStealChance(
  margin: number,
  holderIsUser: boolean,
  stealerIsUser: boolean,
  stealerIsUserTeammate: boolean,
): number {
  let chance = 0.18
  if (margin > 0.52) chance = 0.86
  else if (margin > 0.36) chance = 0.68
  else if (margin > 0.2) chance = 0.48
  else if (margin > 0.05) chance = 0.3
  else if (margin > -0.08) chance = 0.2
  if (holderIsUser) chance *= getOpponentStealVsUserChanceMul()
  if (stealerIsUser) {
    // Jogador precisa sentir o roubo — piso alto quando encostou
    chance = Math.min(0.94, Math.max(0.52, chance * 1.72 + 0.18))
  } else if (stealerIsUserTeammate) {
    chance = Math.min(0.88, chance * getUserTeammateStealChanceMul() + 0.06)
  }
  return chance
}

/** Disputa física em pé — roubo limpo ou portador segura a bola (sem soltar). */
export function resolveStandingStealContest(
  stealerId: string,
  holderId: string,
  _heldPoint?: { x: number; z: number },
): StandingStealOutcome {
  const stealer = playerRegistry.get(stealerId)
  const holder = playerRegistry.get(holderId)
  if (!stealer || !holder) return 'held'

  const dist = distance2D(stealer.position, holder.position)
  const intensity = clamp(1 - dist / 1.4, 0.5, 1)
  const userTeam = getUserTeam()
  const holderIsUser = holder.team === userTeam
  const stealerIsUser =
    stealer.team === userTeam &&
    stealerId === useGameStore.getState().activePlayerId
  const stealerIsUserTeammate = stealer.team === userTeam && !stealerIsUser
  const stealerBrakeMs = holderIsUser ? 120 : BRAKE_MS
  const holderBrakeMs = holderIsUser ? 90 : HOLDER_BRAKE_MS

  const atk = contestPower(stealer, holder, true)
  const def = contestPower(holder, stealer, false)
  let margin = atk - def
  // IA aliada leva o corpo um pouco mais a sério no bote
  if (stealerIsUserTeammate) margin += 0.16
  // Jogador controlado: empurrão extra na disputa
  if (stealerIsUser) margin += 0.28
  margin = adjustStealContestMargin(
    margin,
    stealer.team,
    holder.team,
    stealerIsUser,
  )
  if (_heldPoint) {
    const footDist = minPlayerFootDist2D(stealerId, {
      x: _heldPoint.x,
      y: 0,
      z: _heldPoint.z,
    })
    if (footDist != null && footDist < STEAL_DISTANCE) {
      margin += 0.22 + (1 - footDist / STEAL_DISTANCE) * 0.28
      if (stealerIsUser) margin += 0.18
    }
  }
  if (holderIsUser && stealer.team !== userTeam) {
    const diff = getMatchDifficulty()
    margin -= diff === 'expert' ? 0.18 : diff === 'hard' ? 0.22 : 0.32
  }

  // Drible / finta / 360: portador segura bem melhor a bola
  const protect = getDribbleStealProtect(holder)
  if (protect > 0.01) {
    // Jogador ainda consegue roubar se colar — protect menos brutal
    const protectMul = stealerIsUser ? 0.55 : 1
    margin -= (0.28 + protect * 0.85) * protectMul
  }

  // Desarme do roubador vs força/drible do portador (camada de atributos)
  {
    const stealMul = getPlayerAttrMultipliers(stealerId).tackling
    const holdMul =
      getPlayerAttrMultipliers(holderId).strength * 0.55 +
      getPlayerAttrMultipliers(holderId).dribbling * 0.45
    margin += (stealMul - holdMul) * 0.22
  }

  const roll = Math.random()
  let chance = standingStealChance(
    margin,
    holderIsUser,
    stealerIsUser,
    stealerIsUserTeammate,
  )
  if (protect > 0.01) {
    chance *= stealerIsUser
      ? 1 - protect * 0.55
      : 1 - protect * 0.94
  }
  // Corte 180 / spin: quase nunca sai roubo limpo (player ainda tem alguma chance)
  if (protect > 0.9) {
    chance *= stealerIsUser ? 0.35 : 0.12
  }
  const stolen = roll < chance
  const userInvolved = stealerIsUser || holderIsUser

  if (stolen) {
    const stealIntensity = stealerIsUser
      ? intensity * 0.48
      : stealerIsUserTeammate
        ? intensity * 0.62
        : intensity * 0.72
    const holdIntensity = holderIsUser ? intensity * 0.42 : intensity * 0.78
    applyPhysicalContactBrake(
      stealerId,
      stealIntensity,
      stealerIsUser ? 75 : stealerIsUserTeammate ? 110 : stealerBrakeMs,
      holderId,
      stealerIsUser ? 0.86 : stealerIsUserTeammate ? 0.78 : BRAKE_FLOOR,
    )
    applyPhysicalContactBrake(
      holderId,
      holdIntensity,
      holderIsUser ? 65 : holderBrakeMs,
      stealerId,
      holderIsUser ? 0.9 : BRAKE_FLOOR,
    )
    return 'stolen'
  }

  if (!userInvolved || stealerIsUserTeammate) {
    applyPhysicalContactBrake(
      stealerId,
      intensity * (stealerIsUserTeammate ? 0.7 : 0.82),
      stealerBrakeMs,
      holderId,
    )
    applyPhysicalContactBrake(
      holderId,
      intensity * (stealerIsUserTeammate ? 0.95 : 0.88) * (1 - protect * 0.35),
      holderBrakeMs,
      stealerId,
      BRAKE_FLOOR,
    )
  }

  const store = useGameStore.getState()
  // Falhou o roubo do player: imunidade curta no adversário (pra poder tentar de novo)
  store.setStealImmunity(
    holderId,
    stealerIsUser
      ? 160 + Math.round(protect * 120)
      : holderIsUser
        ? 1400 + Math.round(protect * 500)
        : stealerIsUserTeammate
          ? 220
          : 320 + Math.round(protect * 200),
  )
  return 'held'
}

/**
 * @deprecated Prefer `resolvePlayerBodyCollisions` — mantido só para fallback
 * se o solver de cápsula não rodar (ex.: fase especial).
 */
export function applyBodySeparationImpulse(
  moveVel: { x: number; z: number },
  selfId: string,
  simDelta: number,
): { x: number; z: number } {
  const opponentId = getDuelOpponentId(selfId)
  if (!opponentId) return moveVel

  const self = playerRegistry.get(selfId)
  const other = playerRegistry.get(opponentId)
  if (!self || !other) return moveVel

  const sep = normalize2D(
    self.position.x - other.position.x,
    self.position.z - other.position.z,
  )
  const dist = distance2D(self.position, other.position)
  if (dist > 1.55) return moveVel

  const closeness = clamp(1 - dist / 1.55, 0, 1)
  const push = 0.7 * WORLD_SCALE * simDelta * closeness
  const damp = 0.94 - closeness * 0.06

  return {
    x: moveVel.x * damp + sep.x * push,
    z: moveVel.z * damp + sep.z * push,
  }
}

export function applySlideContactBrake(sliderId: string, victimId: string, heavy = false) {
  const intensity = heavy ? 0.92 : 0.78
  applyPhysicalContactBrake(sliderId, intensity, heavy ? 340 : 280, victimId)
  applyPhysicalContactBrake(victimId, intensity * 0.96, heavy ? 400 : 340, sliderId)
}
