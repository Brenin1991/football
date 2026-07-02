import * as THREE from 'three'
import type { FieldBounds, GoalZone, Vec3 } from '../types'
import { PLAYER_HEIGHT } from '../constants'

const HIDDEN_NODES = new Set(['field_area', 'gol_01', 'gol_02', 'ball_spawn'])

/** Escala do gramado em relação ao modelo base field.glb */
export const FIELD_SCALE = 1.5

const BASE_HALF_X = 6.5
const BASE_HALF_Z = 9.5

/** Fallback se field_area não existir no GLB */
export const PITCH_LIMITS = {
  minX: -BASE_HALF_X * FIELD_SCALE,
  maxX: BASE_HALF_X * FIELD_SCALE,
  minZ: -BASE_HALF_Z * FIELD_SCALE,
  maxZ: BASE_HALF_Z * FIELD_SCALE,
  groundY: 0.06,
}

let pitchGroundY = PITCH_LIMITS.groundY

export function setPitchGroundY(y: number) {
  pitchGroundY = y
}

function getFieldAreaBox(scene: THREE.Object3D): THREE.Box3 | null {
  const fieldArea = scene.getObjectByName('field_area')
  if (!fieldArea) return null
  return new THREE.Box3().setFromObject(fieldArea)
}

export function hideDebugNodes(scene: THREE.Object3D) {
  scene.traverse((child) => {
    if (HIDDEN_NODES.has(child.name)) {
      child.visible = false
    }
  })
}

export function getPitchColliderFromBounds(bounds: FieldBounds) {
  const halfY = 0.06
  const halfX = (bounds.maxX - bounds.minX) / 2
  const halfZ = (bounds.maxZ - bounds.minZ) / 2
  const centerX = (bounds.minX + bounds.maxX) / 2
  const centerZ = (bounds.minZ + bounds.maxZ) / 2
  return {
    halfExtents: [halfX, halfY, halfZ] as [number, number, number],
    position: [centerX, bounds.center.y - halfY, centerZ] as [number, number, number],
  }
}

/** @deprecated Use getPitchColliderFromBounds após extractFieldData */
export function getPitchCollider() {
  const halfY = 0.06
  return {
    halfExtents: [BASE_HALF_X * FIELD_SCALE, halfY, BASE_HALF_Z * FIELD_SCALE] as [
      number,
      number,
      number,
    ],
    position: [0, PITCH_LIMITS.groundY - halfY, 0] as [number, number, number],
  }
}

export function extractFieldData(scene: THREE.Object3D): {
  bounds: FieldBounds
  goals: GoalZone[]
  spawn: Vec3
  collider: ReturnType<typeof getPitchColliderFromBounds>
} {
  scene.updateMatrixWorld(true)

  const ballSpawn = scene.getObjectByName('ball_spawn')
  const golA = scene.getObjectByName('gol_01')
  const golB = scene.getObjectByName('gol_02')
  const fieldBox = getFieldAreaBox(scene)

  const spawnPos = new THREE.Vector3(0, PITCH_LIMITS.groundY, 0)
  if (ballSpawn) {
    ballSpawn.getWorldPosition(spawnPos)
  }

  const pitchMinX = fieldBox?.min.x ?? PITCH_LIMITS.minX
  const pitchMaxX = fieldBox?.max.x ?? PITCH_LIMITS.maxX
  const pitchMinZ = fieldBox?.min.z ?? PITCH_LIMITS.minZ
  const pitchMaxZ = fieldBox?.max.z ?? PITCH_LIMITS.maxZ
  const groundY = fieldBox?.max.y ?? spawnPos.y ?? PITCH_LIMITS.groundY

  setPitchGroundY(groundY)

  const boxes: { node: THREE.Object3D; box: THREE.Box3; z: number }[] = []
  if (golA) {
    const box = new THREE.Box3().setFromObject(golA)
    boxes.push({ node: golA, box, z: (box.min.z + box.max.z) / 2 })
  }
  if (golB) {
    const box = new THREE.Box3().setFromObject(golB)
    boxes.push({ node: golB, box, z: (box.min.z + box.max.z) / 2 })
  }

  // Regra fixa de futebol: CASA ataca +Z, VISITANTE ataca -Z (independente do nome do nó)
  boxes.sort((a, b) => a.z - b.z)
  const awayGoal = boxes[0]
  const homeGoal = boxes[boxes.length - 1]

  const awayScoringGoalZ = awayGoal?.z ?? pitchMinZ
  const homeScoringGoalZ = homeGoal?.z ?? pitchMaxZ

  const goals: GoalZone[] = []

  if (awayGoal) {
    const g = awayGoal.box
    goals.push({
      team: 'away',
      minX: g.min.x,
      maxX: g.max.x,
      minY: g.min.y,
      maxY: g.max.y + 1.5,
      minZ: g.min.z - 0.5,
      maxZ: g.max.z + 0.3,
    })
  }

  if (homeGoal && homeGoal !== awayGoal) {
    const g = homeGoal.box
    goals.push({
      team: 'home',
      minX: g.min.x,
      maxX: g.max.x,
      minY: g.min.y,
      maxY: g.max.y + 1.5,
      minZ: g.min.z - 0.3,
      maxZ: g.max.z + 0.5,
    })
  }

  const center: Vec3 = {
    x: fieldBox ? (pitchMinX + pitchMaxX) / 2 : spawnPos.x,
    y: groundY,
    z: fieldBox ? (pitchMinZ + pitchMaxZ) / 2 : spawnPos.z,
  }

  const bounds: FieldBounds = {
    minX: pitchMinX,
    maxX: pitchMaxX,
    minZ: pitchMinZ,
    maxZ: pitchMaxZ,
    center,
    homeScoringGoalZ,
    awayScoringGoalZ,
    goalWidth: 7.32 * FIELD_SCALE,
    goalHeight: 2.44,
    corners: [
      { x: pitchMinX, y: groundY, z: pitchMinZ },
      { x: pitchMaxX, y: groundY, z: pitchMinZ },
      { x: pitchMaxX, y: groundY, z: pitchMaxZ },
      { x: pitchMinX, y: groundY, z: pitchMaxZ },
    ],
  }

  return {
    bounds,
    goals,
    spawn: { x: spawnPos.x, y: groundY, z: spawnPos.z },
    collider: getPitchColliderFromBounds(bounds),
  }
}

export function ballRestY(radius = 0.11) {
  return pitchGroundY + radius
}

export function getPitchGroundY(): number {
  return pitchGroundY
}

/** Centro vertical do capsule do jogador — pés no gramado */
export function getPlayerBodyY(): number {
  return pitchGroundY + PLAYER_HEIGHT / 2
}
