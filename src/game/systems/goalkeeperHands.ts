import * as THREE from 'three'
import type { RapierRigidBody } from '@react-three/rapier'
import { BALL_RADIUS, GK_HAND_RADIUS } from '../constants'
import type { Vec3 } from '../types'
import { getPlayerBodyY } from './fieldData'

const LEFT_BONE_NAMES = ['mixamorig5:LeftHand', 'mixamorig5LeftHand']
const RIGHT_BONE_NAMES = ['mixamorig5:RightHand', 'mixamorig5RightHand']
const HIP_NAMES = ['mixamorig5:Hips', 'mixamorig5Hips', 'Hips']

const _hipsWorld = new THREE.Vector3()

const GK_BODY_BONE_NAMES = [
  ['mixamorig5:Hips', 'mixamorig5Hips'],
  ['mixamorig5:Spine', 'mixamorig5Spine'],
  ['mixamorig5:Spine1', 'mixamorig5Spine1'],
  ['mixamorig5:Spine2', 'mixamorig5Spine2'],
  ['mixamorig5:Neck', 'mixamorig5Neck'],
  ['mixamorig5:Head', 'mixamorig5Head'],
  ['mixamorig5:LeftShoulder', 'mixamorig5LeftShoulder'],
  ['mixamorig5:RightShoulder', 'mixamorig5RightShoulder'],
  ['mixamorig5:LeftArm', 'mixamorig5LeftArm'],
  ['mixamorig5:RightArm', 'mixamorig5RightArm'],
  ['mixamorig5:LeftForeArm', 'mixamorig5LeftForeArm'],
  ['mixamorig5:RightForeArm', 'mixamorig5RightForeArm'],
  ['mixamorig5:LeftUpLeg', 'mixamorig5LeftUpLeg'],
  ['mixamorig5:RightUpLeg', 'mixamorig5RightUpLeg'],
  ['mixamorig5:LeftLeg', 'mixamorig5LeftLeg'],
  ['mixamorig5:RightLeg', 'mixamorig5RightLeg'],
  ['mixamorig5:LeftFoot', 'mixamorig5LeftFoot'],
  ['mixamorig5:RightFoot', 'mixamorig5RightFoot'],
] as const

function findHandBone(modelRoot: THREE.Object3D, names: string[]) {
  for (const name of names) {
    const bone = modelRoot.getObjectByName(name)
    if (bone) return bone
  }
  return null
}

type HandSide = 'left' | 'right'

type GkHandEntry = {
  hips: THREE.Object3D
  hipsRestLocal: THREE.Vector3
  left: THREE.Object3D
  right: THREE.Object3D
  leftWorld: THREE.Vector3
  rightWorld: THREE.Vector3
}

const gkHands = new Map<string, GkHandEntry>()
const _v = new THREE.Vector3()

export function getGkHandBones(modelRoot: THREE.Object3D): {
  left: THREE.Object3D | null
  right: THREE.Object3D | null
} {
  return {
    left: findHandBone(modelRoot, LEFT_BONE_NAMES),
    right: findHandBone(modelRoot, RIGHT_BONE_NAMES),
  }
}

const GK_BONE_SKIP = /finger|index|middle|ring|pinky|thumb|toebase|end|twist/i

function isGkPhysicsBone(bone: THREE.Bone): boolean {
  const n = bone.name.replace(/:/g, '')
  if (!/mixamorig/i.test(n)) return false
  if (GK_BONE_SKIP.test(n)) return false
  if (/lefthand|righthand/i.test(n)) return false
  return true
}

/** Todos os ossos relevantes do esqueleto — colisor por segmento do corpo */
export function getGkSkeletonBones(modelRoot: THREE.Object3D): THREE.Object3D[] {
  const bones: THREE.Object3D[] = []
  modelRoot.traverse((obj) => {
    if (obj instanceof THREE.Bone && isGkPhysicsBone(obj)) {
      bones.push(obj)
    }
  })
  return bones
}

export function getGkBodyBones(modelRoot: THREE.Object3D): THREE.Object3D[] {
  const fromSkeleton = getGkSkeletonBones(modelRoot)
  if (fromSkeleton.length > 0) return fromSkeleton

  const bones: THREE.Object3D[] = []
  for (const names of GK_BODY_BONE_NAMES) {
    const bone = findHandBone(modelRoot, [...names])
    if (bone) bones.push(bone)
  }
  return bones
}

export function registerGkHands(gkId: string, modelRoot: THREE.Object3D) {
  const { left, right } = getGkHandBones(modelRoot)
  const hips = findHandBone(modelRoot, HIP_NAMES)
  if (!left || !right || !hips) return false
  gkHands.set(gkId, {
    hips,
    hipsRestLocal: hips.position.clone(),
    left,
    right,
    leftWorld: new THREE.Vector3(),
    rightWorld: new THREE.Vector3(),
  })
  return true
}

export function unregisterGkHands(gkId: string) {
  gkHands.delete(gkId)
}

function pinGkHipsHorizontal(entry: GkHandEntry) {
  entry.hips.position.x = entry.hipsRestLocal.x
  entry.hips.position.z = entry.hipsRestLocal.z
}

/** Cancela root motion horizontal do clip sem mover o corpo. */
export function pinGkHips(gkId: string) {
  const entry = gkHands.get(gkId)
  if (!entry) return
  pinGkHipsHorizontal(entry)
}

/** Uma única captura: corpo vai para worldX/worldZ e o esqueleto volta ao repouso. */
export function snapshotGkSkeletonToBody(
  gkId: string,
  position: THREE.Vector3,
  body: RapierRigidBody,
  worldX: number,
  worldZ: number,
): boolean {
  const entry = gkHands.get(gkId)
  if (!entry) return false

  const prevX = position.x
  const prevZ = position.z

  position.set(worldX, 0, worldZ)
  body.setNextKinematicTranslation({ x: worldX, y: getPlayerBodyY(), z: worldZ })
  pinGkHipsHorizontal(entry)

  return Math.abs(worldX - prevX) > 1e-5 || Math.abs(worldZ - prevZ) > 1e-5
}

export function getGkHipsWorldXZ(gkId: string): { x: number; z: number } | null {
  const entry = gkHands.get(gkId)
  if (!entry) return null
  entry.hips.updateMatrixWorld(true)
  entry.hips.getWorldPosition(_hipsWorld)
  return { x: _hipsWorld.x, z: _hipsWorld.z }
}

/** Atualiza posições world após mixer — chamar no fim do useFrame do goleiro */
export function updateGkHandPositions(gkId: string, root?: THREE.Object3D) {
  const entry = gkHands.get(gkId)
  if (!entry) return
  if (root) root.updateMatrixWorld(true)
  entry.left.updateMatrixWorld(true)
  entry.right.updateMatrixWorld(true)
  entry.left.getWorldPosition(entry.leftWorld)
  entry.right.getWorldPosition(entry.rightWorld)
}

export function getGkHandWorld(gkId: string, side: HandSide): Vec3 | null {
  const entry = gkHands.get(gkId)
  if (!entry) return null
  const w = side === 'left' ? entry.leftWorld : entry.rightWorld
  return { x: w.x, y: w.y, z: w.z }
}

/** Ponto entre as mãos onde a bola fica ao segurar / no contato da defesa. */
export function getGkCatchAnchor(
  gkId: string,
  side: HandSide | 'feet' | null = null,
): Vec3 | null {
  const entry = gkHands.get(gkId)
  if (!entry) return null

  if (side === 'left') {
    const w = entry.leftWorld
    return { x: w.x, y: w.y + 0.04, z: w.z + 0.03 }
  }
  if (side === 'right') {
    const w = entry.rightWorld
    return { x: w.x, y: w.y + 0.04, z: w.z + 0.03 }
  }

  const lx = entry.leftWorld.x
  const ly = entry.leftWorld.y
  const lz = entry.leftWorld.z
  const rx = entry.rightWorld.x
  const ry = entry.rightWorld.y
  const rz = entry.rightWorld.z
  return {
    x: (lx + rx) * 0.5,
    y: (ly + ry) * 0.5 + 0.05,
    z: (lz + rz) * 0.5 + 0.04,
  }
}

export function getGkFeetAnchor(gkPos: Vec3, rotation: number): Vec3 {
  const fx = Math.sin(rotation)
  const fz = Math.cos(rotation)
  return {
    x: gkPos.x + fx * 0.32,
    y: 0.1,
    z: gkPos.z + fz * 0.32,
  }
}

export function testGkFootContact(
  gkPos: Vec3,
  rotation: number,
  ball: Vec3,
): boolean {
  if (ball.y > 0.55) return false
  const foot = getGkFeetAnchor(gkPos, rotation)
  const dx = ball.x - foot.x
  const dz = ball.z - foot.z
  return Math.hypot(dx, dz) <= 0.72 + BALL_RADIUS
}

const contactRadius = GK_HAND_RADIUS + BALL_RADIUS

export function testGkHandContact(gkId: string, ball: Vec3): HandSide | null {
  const entry = gkHands.get(gkId)
  if (!entry) return null

  const distL = Math.hypot(
    ball.x - entry.leftWorld.x,
    ball.y - entry.leftWorld.y,
    ball.z - entry.leftWorld.z,
  )
  if (distL <= contactRadius) return 'left'

  const distR = Math.hypot(
    ball.x - entry.rightWorld.x,
    ball.y - entry.rightWorld.y,
    ball.z - entry.rightWorld.z,
  )
  if (distR <= contactRadius) return 'right'

  return null
}

/** Distância mínima bola → qualquer mão (debug / fallback leve) */
export function minGkHandDist(gkId: string, ball: Vec3): number {
  const entry = gkHands.get(gkId)
  if (!entry) return Infinity
  _v.set(ball.x, ball.y, ball.z)
  return Math.min(entry.leftWorld.distanceTo(_v), entry.rightWorld.distanceTo(_v))
}
