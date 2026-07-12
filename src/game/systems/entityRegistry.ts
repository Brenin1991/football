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
  dribbleTouchSeverity?: number
  anim: PlayerAnim
  animTime: number
  dribbleBallOffset?: { x: number; z: number }
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

export const ballBodyRef: { current: unknown } = { current: null }

export function setBallVelocity(vx: number, vy: number, vz: number) {
  const body = ballBodyRef.current as {
    setLinvel: (v: { x: number; y: number; z: number }, wake: boolean) => void
    setBodyType: (type: number, wake: boolean) => void
    wakeUp: () => void
  } | null
  if (body) {
    body.wakeUp()
    body.setBodyType(0, true)
    body.setLinvel({ x: vx, y: vy, z: vz }, true)
  }
  ballRef.velocity = { x: vx, y: vy, z: vz }
}

export function setBallPosition(pos: Vec3, resetVelocity = true) {
  ballRef.current = { ...pos }
  ballRef.velocity = { x: 0, y: 0, z: 0 }
  const body = ballBodyRef.current as {
    setTranslation: (t: Vec3, wake: boolean) => void
    setLinvel: (v: Vec3, wake: boolean) => void
    setAngvel: (v: Vec3, wake: boolean) => void
  } | null
  if (body) {
    body.setTranslation(pos, true)
    if (resetVelocity) {
      body.setLinvel({ x: 0, y: 0, z: 0 }, true)
      body.setAngvel({ x: 0, y: 0, z: 0 }, true)
    }
  }
}
