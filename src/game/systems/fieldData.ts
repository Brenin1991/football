import * as THREE from 'three'
import type { FieldBounds, GoalZone, Vec3 } from '../types'
import { BALL_RADIUS, GOAL_FRAME_FRICTION, GOAL_FRAME_RESTITUTION, PLAYER_HEIGHT } from '../constants'

/** Escala do gramado em relação ao modelo base field.glb */
export const FIELD_SCALE = 1.5

export type GoalFrameCollider = {
  position: [number, number, number]
  halfExtents: [number, number, number]
  friction: number
  restitution: number
  part: 'post' | 'crossbar'
}

const GOAL_POST_RADIUS = 0.055
const GOAL_CROSSBAR_RADIUS = 0.052
/** Espessura dos colisores de trave/travessão ao longo do eixo Z (na linha) */
const GOAL_FRAME_DEPTH_HALF = 0.5
/** Travessão um pouco mais grossa que a trave — CCD sem volume gigante */
const GOAL_CROSSBAR_DEPTH_HALF = 0.5

type GoalAnchor = {
  centerX: number
  goalLineZ: number
}

/** Medidas da boca do gol — lidas do cubo gol_XX do Blender (já em world space). */
type GoalMouth = {
  anchor: GoalAnchor
  minX: number
  maxX: number
  height: number
  netDepth: number
}

function goalMouthFromBox(
  team: 'home' | 'away',
  box: THREE.Box3,
  groundY: number,
): GoalMouth {
  const minX = box.min.x
  const maxX = box.max.x
  return {
    anchor: {
      centerX: (minX + maxX) / 2,
      goalLineZ: team === 'home' ? box.min.z : box.max.z,
    },
    minX,
    maxX,
    height: Math.max(box.max.y - groundY, box.max.y - box.min.y, 0.4),
    netDepth: Math.max(box.max.z - box.min.z, 0.12),
  }
}

/** Traves + travessão — encaixam no cubo de referência do Blender */
function buildGoalFrameColliders(
  mouth: GoalMouth,
  groundY: number,
): GoalFrameCollider[] {
  const { anchor, minX, maxX, height } = mouth
  const { centerX, goalLineZ } = anchor
  const postHalfH = height / 2
  const postMidY = groundY + postHalfH
  const leftX = minX + GOAL_POST_RADIUS
  const rightX = maxX - GOAL_POST_RADIUS
  const barY = groundY + height - GOAL_CROSSBAR_RADIUS
  const barHalfW = Math.max((maxX - minX) / 2 - GOAL_POST_RADIUS * 1.4, 0.2)

  const metal = {
    friction: GOAL_FRAME_FRICTION,
    restitution: GOAL_FRAME_RESTITUTION,
  }

  return [
    {
      part: 'post',
      position: [leftX, postMidY, goalLineZ],
      halfExtents: [GOAL_POST_RADIUS, postHalfH, GOAL_FRAME_DEPTH_HALF],
      ...metal,
    },
    {
      part: 'post',
      position: [rightX, postMidY, goalLineZ],
      halfExtents: [GOAL_POST_RADIUS, postHalfH, GOAL_FRAME_DEPTH_HALF],
      ...metal,
    },
    {
      part: 'crossbar',
      position: [centerX, barY, goalLineZ],
      halfExtents: [barHalfW, GOAL_CROSSBAR_RADIUS, GOAL_CROSSBAR_DEPTH_HALF],
      ...metal,
    },
  ]
}

function buildGoalZone(team: 'home' | 'away', mouth: GoalMouth, groundY: number): GoalZone {
  const inset = BALL_RADIUS * 0.9
  const { anchor, minX, maxX, height, netDepth } = mouth
  const { centerX, goalLineZ } = anchor
  const halfMouth = (maxX - minX) / 2 - inset

  if (team === 'home') {
    return {
      team,
      minX: centerX - halfMouth,
      maxX: centerX + halfMouth,
      minY: groundY,
      maxY: groundY + height + inset,
      minZ: goalLineZ,
      maxZ: goalLineZ + netDepth,
    }
  }

  return {
    team,
    minX: centerX - halfMouth,
    maxX: centerX + halfMouth,
    minY: groundY,
    maxY: groundY + height + inset,
    minZ: goalLineZ - netDepth,
    maxZ: goalLineZ,
  }
}


const HIDDEN_NODES = new Set(['gol_01', 'gol_02', 'ball_spawn', 'NurbsCircle'])

/** Remove helpers de mapa que não devem existir em runtime (spawn/círculo). */
export function stripFieldHelperNodes(scene: THREE.Object3D) {
  const toRemove: THREE.Object3D[] = []
  scene.traverse((child) => {
    if (child.name === 'ball_spawn' || child.name === 'NurbsCircle') {
      toRemove.push(child)
    }
  })
  for (const node of toRemove) {
    node.removeFromParent()
  }
}

const BASE_HALF_X = 6.5
const BASE_HALF_Z = 9.5

/** Volume ortográfico fallback — cobre estádio + margem (luz em ângulo precisa de folga) */
export const SHADOW_CAMERA = {
  halfX: BASE_HALF_X * FIELD_SCALE * 4.8,
  halfZ: BASE_HALF_Z * FIELD_SCALE * 4.8,
  near: 1,
  far: 420,
}

/** Raiz do GLB do estádio — preferência pelo nó nomeado; fallback = field_area. */
function getStadiumRoot(scene: THREE.Object3D): THREE.Object3D | null {
  return scene.getObjectByName('field_stadium') ?? scene.getObjectByName('field_area') ?? null
}

/**
 * Ajusta a shadow camera do sol para cobrir o estádio inteiro (arquibancadas + cobertura).
 * Usa o AABB do GLB do campo no espaço da câmera de sombra.
 */
export function fitDirectionalLightShadowToField(
  light: THREE.DirectionalLight,
  scene: THREE.Object3D,
  pad = 1.2,
): void {
  if (!light.shadow) return

  const cam = light.shadow.camera as THREE.OrthographicCamera
  const stadiumRoot = getStadiumRoot(scene)
  const box = stadiumRoot
    ? new THREE.Box3().setFromObject(stadiumRoot)
    : new THREE.Box3(
        new THREE.Vector3(PITCH_LIMITS.minX * 2.2, PITCH_LIMITS.groundY, PITCH_LIMITS.minZ * 2.2),
        new THREE.Vector3(PITCH_LIMITS.maxX * 2.2, PITCH_LIMITS.groundY + 28, PITCH_LIMITS.maxZ * 2.2),
      )

  // Garante volume mínimo pro gramado / jogadores mesmo se o AABB vier raso
  box.min.y = Math.min(box.min.y, PITCH_LIMITS.groundY - 0.5)
  box.max.y = Math.max(box.max.y, PITCH_LIMITS.groundY + 28)

  const center = box.getCenter(new THREE.Vector3())
  light.target.position.copy(center)
  if (!light.target.parent) {
    scene.add(light.target)
  }
  light.target.updateMatrixWorld(true)
  light.updateMatrixWorld(true)

  // A shadow camera do DirectionalLight é quem aponta pro alvo (não a luz em si)
  cam.position.copy(light.position)
  cam.lookAt(light.target.position)
  cam.updateMatrixWorld(true)

  const corners = [
    new THREE.Vector3(box.min.x, box.min.y, box.min.z),
    new THREE.Vector3(box.min.x, box.min.y, box.max.z),
    new THREE.Vector3(box.min.x, box.max.y, box.min.z),
    new THREE.Vector3(box.min.x, box.max.y, box.max.z),
    new THREE.Vector3(box.max.x, box.min.y, box.min.z),
    new THREE.Vector3(box.max.x, box.min.y, box.max.z),
    new THREE.Vector3(box.max.x, box.max.y, box.min.z),
    new THREE.Vector3(box.max.x, box.max.y, box.max.z),
  ]

  const inv = cam.matrixWorld.clone().invert()
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity

  for (const c of corners) {
    c.applyMatrix4(inv)
    minX = Math.min(minX, c.x)
    maxX = Math.max(maxX, c.x)
    minY = Math.min(minY, c.y)
    maxY = Math.max(maxY, c.y)
    minZ = Math.min(minZ, c.z)
    maxZ = Math.max(maxZ, c.z)
  }

  const halfW = Math.max(4, (maxX - minX) * 0.5 * pad)
  const halfH = Math.max(4, (maxY - minY) * 0.5 * pad)
  const cx = (minX + maxX) * 0.5
  const cy = (minY + maxY) * 0.5

  cam.left = cx - halfW
  cam.right = cx + halfW
  cam.top = cy + halfH
  cam.bottom = cy - halfH
  // near/far: pontos no espaço da câmera (Three olha -Z)
  cam.near = Math.max(0.5, -maxZ - 24)
  cam.far = Math.max(cam.near + 80, -minZ + 48)
  cam.updateProjectionMatrix()
  light.shadow.needsUpdate = true
}

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

const DEBUG_WIREFRAME = new THREE.MeshBasicMaterial({
  color: 0x22d3ee,
  wireframe: true,
  transparent: true,
  opacity: 0.72,
  depthTest: false,
})

/** Mostra nós de referência do GLB (gols, spawn) em wireframe */
export function showDebugNodes(scene: THREE.Object3D) {
  scene.traverse((child) => {
    if (!HIDDEN_NODES.has(child.name)) return
    child.visible = true
    if (child instanceof THREE.Mesh) {
      child.material = DEBUG_WIREFRAME
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
  goalColliders: GoalFrameCollider[]
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

  const awayScoringGoalZ = awayGoal?.box.max.z ?? pitchMinZ
  const homeScoringGoalZ = homeGoal?.box.min.z ?? pitchMaxZ

  const goals: GoalZone[] = []
  const goalColliders: GoalFrameCollider[] = []

  if (awayGoal) {
    const mouth = goalMouthFromBox('away', awayGoal.box, groundY)
    goals.push(buildGoalZone('away', mouth, groundY))
    goalColliders.push(...buildGoalFrameColliders(mouth, groundY))
  }

  if (homeGoal && homeGoal !== awayGoal) {
    const mouth = goalMouthFromBox('home', homeGoal.box, groundY)
    goals.push(buildGoalZone('home', mouth, groundY))
    goalColliders.push(...buildGoalFrameColliders(mouth, groundY))
  }

  const refGoalBox = homeGoal?.box ?? awayGoal?.box
  const goalWidth = refGoalBox ? refGoalBox.max.x - refGoalBox.min.x : 7.32 * FIELD_SCALE
  const goalHeight = refGoalBox
    ? Math.max(refGoalBox.max.y - groundY, refGoalBox.max.y - refGoalBox.min.y)
    : 2.44 * FIELD_SCALE

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
    goalWidth,
    goalHeight,
    corners: [
      { x: pitchMinX, y: groundY, z: pitchMinZ },
      { x: pitchMaxX, y: groundY, z: pitchMinZ },
      { x: pitchMaxX, y: groundY, z: pitchMaxZ },
      { x: pitchMinX, y: groundY, z: pitchMaxZ },
    ],
    ballSpawn: { x: spawnPos.x, y: groundY, z: spawnPos.z },
  }

  return {
    bounds,
    goals,
    goalColliders,
    spawn: { x: spawnPos.x, y: groundY, z: spawnPos.z },
    collider: getPitchColliderFromBounds(bounds),
  }
}

export function ballRestY(radius = 0.11) {
  return pitchGroundY + radius
}

/** Centro da saída de bola — usa ball_spawn do mapa quando existir */
export function getBallSpawnPosition(bounds: FieldBounds): Vec3 {
  const p = bounds.ballSpawn ?? bounds.center
  return { x: p.x, y: ballRestY(), z: p.z }
}

export function getPitchGroundY(): number {
  return pitchGroundY
}

/** Centro vertical do capsule do jogador — pés no gramado */
export function getPlayerBodyY(): number {
  return pitchGroundY + PLAYER_HEIGHT / 2
}
