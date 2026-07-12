import * as THREE from 'three'
import type { RapierRigidBody } from '@react-three/rapier'
import { PLAYER_RADIUS } from '../constants'
import type { FieldBounds, Vec3 } from '../types'
import { getPlayerBodyY } from './fieldData'

const HIP_NAMES = ['mixamorig5:Hips', 'mixamorig5Hips', 'Hips']
const FOOT_LEFT = ['mixamorig5:LeftFoot', 'mixamorig5LeftFoot']
const FOOT_RIGHT = ['mixamorig5:RightFoot', 'mixamorig5RightFoot']
const LEG_LEFT = ['mixamorig5:LeftLeg', 'mixamorig5LeftLeg']
const LEG_RIGHT = ['mixamorig5:RightLeg', 'mixamorig5RightLeg']
/** Tronco — no máximo 2 ossos (evita dezenas de colisores por jogador) */
const CORE_BODY = [
  'mixamorig5:Hips',
  'mixamorig5Hips',
  'mixamorig5:Spine2',
  'mixamorig5Spine2',
]

const _hipsWorld = new THREE.Vector3()

function findBone(root: THREE.Object3D, names: string[]): THREE.Object3D | null {
  for (const name of names) {
    const bone = root.getObjectByName(name)
    if (bone) return bone
  }
  return null
}

export type PlayerBonePart = 'foot' | 'leg' | 'body'

export type PlayerBoneRef = {
  bone: THREE.Object3D
  part: PlayerBonePart
}

type PlayerBoneEntry = {
  hips: THREE.Object3D
  hipsRestLocal: THREE.Vector3
  leftFoot: THREE.Object3D
  rightFoot: THREE.Object3D
  leftFootWorld: THREE.Vector3
  rightFootWorld: THREE.Vector3
  refs: PlayerBoneRef[]
}

const playerBones = new Map<string, PlayerBoneEntry>()

/** Ossos de contato — pés, pernas e tronco mínimo (performance) */
export function getPlayerContactBones(modelRoot: THREE.Object3D): PlayerBoneRef[] {
  const refs: PlayerBoneRef[] = []
  const seen = new Set<string>()

  const push = (bone: THREE.Object3D | null, part: PlayerBonePart) => {
    if (!bone || seen.has(bone.uuid)) return
    seen.add(bone.uuid)
    refs.push({ bone, part })
  }

  push(findBone(modelRoot, FOOT_LEFT), 'foot')
  push(findBone(modelRoot, FOOT_RIGHT), 'foot')
  push(findBone(modelRoot, LEG_LEFT), 'leg')
  push(findBone(modelRoot, LEG_RIGHT), 'leg')

  for (const name of CORE_BODY) {
    const bone = modelRoot.getObjectByName(name)
    if (bone) push(bone, 'body')
  }

  return refs
}

export function registerPlayerBones(playerId: string, modelRoot: THREE.Object3D): boolean {
  const hips = findBone(modelRoot, HIP_NAMES)
  const leftFoot = findBone(modelRoot, FOOT_LEFT)
  const rightFoot = findBone(modelRoot, FOOT_RIGHT)
  if (!hips || !leftFoot || !rightFoot) return false

  const refs = getPlayerContactBones(modelRoot)
  if (refs.length === 0) return false

  playerBones.set(playerId, {
    hips,
    hipsRestLocal: hips.position.clone(),
    leftFoot,
    rightFoot,
    leftFootWorld: new THREE.Vector3(),
    rightFootWorld: new THREE.Vector3(),
    refs,
  })
  return true
}

export function unregisterPlayerBones(playerId: string) {
  playerBones.delete(playerId)
}

export function getPlayerBoneRefs(playerId: string): PlayerBoneRef[] {
  return playerBones.get(playerId)?.refs ?? []
}

function pinHipsHorizontal(entry: PlayerBoneEntry) {
  entry.hips.position.x = entry.hipsRestLocal.x
  entry.hips.position.z = entry.hipsRestLocal.z
}

/** Cancela root motion horizontal do clip sem mover o corpo — uso em idle/corrida. */
export function pinPlayerHips(playerId: string) {
  const entry = playerBones.get(playerId)
  if (!entry) return
  pinHipsHorizontal(entry)
}

/** Uma única captura: corpo vai para o quadril na world e o esqueleto volta ao repouso. */
export function snapshotPlayerSkeletonToBody(
  playerId: string,
  position: THREE.Vector3,
  body: RapierRigidBody,
  bounds: FieldBounds,
): boolean {
  const entry = playerBones.get(playerId)
  if (!entry) return false

  entry.hips.updateMatrixWorld(true)
  entry.hips.getWorldPosition(_hipsWorld)

  const prevX = position.x
  const prevZ = position.z
  const nx = THREE.MathUtils.clamp(
    _hipsWorld.x,
    bounds.minX + PLAYER_RADIUS,
    bounds.maxX - PLAYER_RADIUS,
  )
  const nz = THREE.MathUtils.clamp(
    _hipsWorld.z,
    bounds.minZ + PLAYER_RADIUS,
    bounds.maxZ - PLAYER_RADIUS,
  )

  position.set(nx, 0, nz)
  body.setNextKinematicTranslation({ x: nx, y: getPlayerBodyY(), z: nz })
  pinHipsHorizontal(entry)

  return Math.abs(nx - prevX) > 1e-5 || Math.abs(nz - prevZ) > 1e-5
}

/** Atualiza posições world — chamar após mixer.update (só jogadores perto da ação) */
export function updatePlayerBonePositions(playerId: string, root?: THREE.Object3D) {
  const entry = playerBones.get(playerId)
  if (!entry) return
  if (root) root.updateMatrixWorld(true)
  entry.leftFoot.getWorldPosition(entry.leftFootWorld)
  entry.rightFoot.getWorldPosition(entry.rightFootWorld)
}

export function getPlayerFootWorld(playerId: string, side: 'left' | 'right'): Vec3 | null {
  const entry = playerBones.get(playerId)
  if (!entry) return null
  const w = side === 'left' ? entry.leftFootWorld : entry.rightFootWorld
  return { x: w.x, y: w.y, z: w.z }
}

/** Pontos dos pés para carrinho / contato — usa ossos reais da animação */
export function getPlayerSlideFootPoints(playerId: string): Vec3[] {
  const entry = playerBones.get(playerId)
  if (!entry) return []
  return [
    { x: entry.leftFootWorld.x, y: entry.leftFootWorld.y, z: entry.leftFootWorld.z },
    { x: entry.rightFootWorld.x, y: entry.rightFootWorld.y, z: entry.rightFootWorld.z },
  ]
}

export function minPlayerFootDist2D(playerId: string, target: Vec3): number | null {
  const feet = getPlayerSlideFootPoints(playerId)
  if (feet.length === 0) return null
  let best = Infinity
  for (const foot of feet) {
    const d = Math.hypot(foot.x - target.x, foot.z - target.z)
    if (d < best) best = d
  }
  return best
}
