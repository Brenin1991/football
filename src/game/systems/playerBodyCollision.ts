import {
  PLAYER_BODY_RADIUS,
  PLAYER_BODY_SEPARATION_STIFFNESS,
  WORLD_SCALE,
} from '../constants'
import { playerRegistry, type PlayerRef } from './entityRegistry'
import { applyPhysicalContactBrake } from './playerPhysicalDuel'
import { getPlayerAttrMultipliers } from './playerAttributes'
import { distance2D, normalize2D } from './rules'
import { isPlayerKnockedDown, isPlayerSliding } from './tackle'

/**
 * Colisão simples jogador↔jogador: só separa penetração e corta velocidade
 * que entra no outro. Sem mola/soft/halo — evita tremor.
 */

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v))
}

export function playerBodyMass(role: PlayerRef['role'], playerId?: string): number {
  let mass = 1.18
  if (role === 'def') mass = 1.28
  else if (role === 'mid') mass = 1.02
  else if (role === 'fwd') mass = 0.86
  if (playerId) mass *= getPlayerAttrMultipliers(playerId).strength
  return mass
}

function bodyRadius(role: PlayerRef['role']): number {
  if (role === 'gk') return PLAYER_BODY_RADIUS * 1.06
  if (role === 'def') return PLAYER_BODY_RADIUS * 1.02
  return PLAYER_BODY_RADIUS
}

type BodySolveResult = {
  x: number
  z: number
  vx: number
  vz: number
  contested: boolean
  opponentId: string | null
  contactImpulse: number
}

/**
 * Separa corpos sobrepostos e remove componente de velocidade que empurra
 * para dentro do outro. Sem bounce, sem spring, sem soft push.
 */
export function resolvePlayerBodyCollisions(
  selfId: string,
  proposed: { x: number; z: number },
  vel: { x: number; z: number },
  _simDelta: number,
): BodySolveResult {
  const self = playerRegistry.get(selfId)
  if (!self) {
    return {
      x: proposed.x,
      z: proposed.z,
      vx: vel.x,
      vz: vel.z,
      contested: false,
      opponentId: null,
      contactImpulse: 0,
    }
  }

  if (isPlayerKnockedDown(selfId) || isPlayerSliding(selfId)) {
    return {
      x: proposed.x,
      z: proposed.z,
      vx: vel.x,
      vz: vel.z,
      contested: false,
      opponentId: null,
      contactImpulse: 0,
    }
  }

  // Giro 180 / finta — atravessa pra completar a virada
  if (
    self.anim === 'player_finta_180' ||
    self.anim === 'player_finta_01'
  ) {
    return {
      x: proposed.x,
      z: proposed.z,
      vx: vel.x,
      vz: vel.z,
      contested: false,
      opponentId: null,
      contactImpulse: 0,
    }
  }

  const massSelf = playerBodyMass(self.role, selfId)
  const rSelf = bodyRadius(self.role)
  let nx = proposed.x
  let nz = proposed.z
  let vx = vel.x
  let vz = vel.z

  let bestOpponent: string | null = null
  let bestDepth = 0
  let contested = false

  for (const other of playerRegistry.values()) {
    if (other.id === selfId) continue
    if (isPlayerKnockedDown(other.id)) continue
    // Não bloqueia quem está no giro 180 / finta
    if (
      other.anim === 'player_finta_180' ||
      other.anim === 'player_finta_01'
    ) {
      continue
    }

    const dx = nx - other.position.x
    const dz = nz - other.position.z
    let dist = Math.hypot(dx, dz)
    const hardSum = rSelf + bodyRadius(other.role)
    const sameTeam = other.team === self.team
    // Folga mínima — só resolve se realmente enfiou
    const slop = 0.012 * WORLD_SCALE
    const softPad = sameTeam ? 0.38 * WORLD_SCALE : 0

    if (dist >= hardSum + softPad - slop) continue

    let nxDir: number
    let nzDir: number
    if (dist < 1e-4) {
      const a = (selfId.charCodeAt(0) + other.id.charCodeAt(0)) * 0.17
      nxDir = Math.sin(a)
      nzDir = Math.cos(a)
      dist = 1e-4
    } else {
      nxDir = dx / dist
      nzDir = dz / dist
    }

    const massOther = playerBodyMass(other.role, other.id)
    const selfShare = massOther / (massSelf + massOther)

    // Soft: companheiros se afastam antes de colar
    if (sameTeam && dist >= hardSum - slop) {
      const softPen = hardSum + softPad - dist
      const soft = softPen * 0.28 * selfShare
      nx += nxDir * soft
      nz += nzDir * soft
      const intoSoft = vx * nxDir + vz * nzDir
      if (intoSoft < 0) {
        vx -= nxDir * intoSoft * 0.55
        vz -= nzDir * intoSoft * 0.55
      }
      continue
    }

    const pen = hardSum - dist
    // Separação só de posição (Gauss-Seidel no self)
    const sep =
      pen *
      PLAYER_BODY_SEPARATION_STIFFNESS *
      (sameTeam ? 0.95 : 1) *
      selfShare
    nx += nxDir * sep
    nz += nzDir * sep

    // Corta velocidade entrando no outro (slide tangente) — sem bounce
    const into = vx * nxDir + vz * nzDir
    if (into < 0) {
      const cut = sameTeam ? into * 1.15 : into
      vx -= nxDir * cut
      vz -= nzDir * cut
    }

    if (!sameTeam && pen > bestDepth) {
      bestDepth = pen
      bestOpponent = other.id
      contested = pen > 0.08 * WORLD_SCALE && into < -0.7 * WORLD_SCALE
    }
  }

  self.position.x = nx
  self.position.z = nz
  self.velocity.x = vx
  self.velocity.z = vz

  return {
    x: nx,
    z: nz,
    vx,
    vz,
    contested,
    opponentId: bestOpponent,
    contactImpulse: bestDepth / Math.max(0.05 * WORLD_SCALE, 1e-4),
  }
}

const lastDuelRegisterAt = new Map<string, number>()

export function registerBodyContactDuel(
  selfId: string,
  opponentId: string | null,
  contactImpulse: number,
  contested: boolean,
) {
  if (!opponentId || !contested || contactImpulse < 1.35) return
  const self = playerRegistry.get(selfId)
  const other = playerRegistry.get(opponentId)
  if (!self || !other || self.team === other.team) return

  const pairKey =
    selfId < opponentId ? `${selfId}|${opponentId}` : `${opponentId}|${selfId}`
  const now = performance.now()
  const last = lastDuelRegisterAt.get(pairKey) ?? 0
  if (now - last < 180) return
  lastDuelRegisterAt.set(pairKey, now)

  const intensity = clamp(0.28 + contactImpulse * 0.12, 0.3, 0.55)
  const duration = 90 + Math.round(intensity * 70)
  const floor = 0.88

  // Só freia o lado mais leve — evita os dois se arrebentarem no ombro
  const massSelf = playerBodyMass(self.role, selfId)
  const massOther = playerBodyMass(other.role, opponentId)
  if (massSelf <= massOther) {
    applyPhysicalContactBrake(selfId, intensity * 0.55, duration, opponentId, floor)
  } else {
    applyPhysicalContactBrake(
      opponentId,
      intensity * 0.55,
      duration + 15,
      selfId,
      floor,
    )
  }
}

export function nearestBodyContactDist(selfId: string): number {
  const self = playerRegistry.get(selfId)
  if (!self) return Infinity
  let best = Infinity
  for (const other of playerRegistry.values()) {
    if (other.id === selfId || other.team === self.team) continue
    const d = distance2D(self.position, other.position)
    if (d < best) best = d
  }
  return best
}

export function isBodyToBodyNear(aId: string, bId: string, mul = 1.15): boolean {
  const a = playerRegistry.get(aId)
  const b = playerRegistry.get(bId)
  if (!a || !b) return false
  const sum = (bodyRadius(a.role) + bodyRadius(b.role)) * mul
  return distance2D(a.position, b.position) <= sum
}

export function bodySeparationDir(
  selfId: string,
  otherId: string,
): { x: number; z: number } | null {
  const self = playerRegistry.get(selfId)
  const other = playerRegistry.get(otherId)
  if (!self || !other) return null
  return normalize2D(
    self.position.x - other.position.x,
    self.position.z - other.position.z,
  )
}

export function clearPlayerBodyCollision(playerId: string) {
  for (const key of [...lastDuelRegisterAt.keys()]) {
    if (key.includes(playerId)) lastDuelRegisterAt.delete(key)
  }
}
