import type { RapierRigidBody } from '@react-three/rapier'
import type { PlayerAnim, PlayerRole, TeamId, Vec3 } from '../types'

export interface PlayerRef {
  id: string
  team: TeamId
  role: PlayerRole
  position: Vec3
  rotation: number
  velocity: Vec3
  isControlled: boolean
  isSprinting?: boolean
  anim: PlayerAnim
  animTime: number
  dribbleBallOffset?: { x: number; z: number }
  /** 0..1 — perda de cola da bola (finta/corte) */
  dribbleTouchSeverity?: number
  /** Roulette 360 — bola arrastada à frente a cada frame */
  dribbleSpinning?: boolean
}

export const playerRegistry: Map<string, PlayerRef> = new Map()

export function registerPlayer(ref: PlayerRef) {
  playerRegistry.set(ref.id, ref)
}

export function unregisterPlayer(id: string) {
  playerRegistry.delete(id)
}

export function getTeamPlayers(team: TeamId): PlayerRef[] {
  return [...playerRegistry.values()].filter((p) => p.team === team)
}

export function getNearestTeammate(from: PlayerRef, team: TeamId): PlayerRef | null {
  let nearest: PlayerRef | null = null
  let minDist = Infinity
  for (const p of playerRegistry.values()) {
    if (p.team !== team || p.id === from.id) continue
    const dx = p.position.x - from.position.x
    const dz = p.position.z - from.position.z
    const d = dx * dx + dz * dz
    if (d < minDist) {
      minDist = d
      nearest = p
    }
  }
  return nearest
}

export const ballRef: { current: Vec3; velocity: Vec3 } = {
  current: { x: 0, y: 0.11, z: 0 },
  velocity: { x: 0, y: 0, z: 0 },
}

export const ballBodyRef: { current: RapierRigidBody | null } = { current: null }

/**
 * Body vivo do Rapier — limpa ref morta (HMR / remount do Canvas).
 * Sem isso: "null pointer passed to rust".
 */
export function getBallBody(): RapierRigidBody | null {
  const body = ballBodyRef.current
  if (!body) return null
  try {
    // Acesso barato; body freed após unmount/HMR explode no WASM
    body.numColliders()
    return body
  } catch {
    if (ballBodyRef.current === body) ballBodyRef.current = null
    return null
  }
}

export function setBallVelocity(vx: number, vy: number, vz: number) {
  const body = getBallBody()
  if (body) {
    try {
      body.wakeUp()
      body.setBodyType(0, true)
      body.setLinvel({ x: vx, y: vy, z: vz }, true)
    } catch {
      ballBodyRef.current = null
    }
  }
  ballRef.velocity = { x: vx, y: vy, z: vz }
}

export function setBallPosition(pos: Vec3, resetVelocity = true) {
  ballRef.current = { ...pos }
  if (resetVelocity) {
    ballRef.velocity = { x: 0, y: 0, z: 0 }
  }
  const body = getBallBody()
  if (!body) return
  try {
    body.setTranslation(pos, true)
    if (resetVelocity) {
      body.setLinvel({ x: 0, y: 0, z: 0 }, true)
      body.setAngvel({ x: 0, y: 0, z: 0 }, true)
    }
  } catch {
    ballBodyRef.current = null
  }
}
