import * as THREE from 'three'
import { AAA_CLASSIC } from './aaaSettings'

type StandardLike = THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial

function isStandardLike(src: THREE.Material): src is StandardLike {
  return (
    src instanceof THREE.MeshStandardMaterial ||
    src instanceof THREE.MeshPhysicalMaterial
  )
}

function tuneTextureForAaa(texture: THREE.Texture) {
  texture.anisotropy = 8
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = true
  texture.needsUpdate = true
}

function tuneMaterialMaps(mat: THREE.MeshStandardMaterial) {
  for (const tex of [
    mat.map,
    mat.normalMap,
    mat.aoMap,
    mat.roughnessMap,
    mat.metalnessMap,
    mat.emissiveMap,
    mat.alphaMap,
  ]) {
    if (tex) tuneTextureForAaa(tex)
  }
}

export type AaaStandardOptions = Partial<THREE.MeshStandardMaterialParameters> & {
  /** Remove mapas de gloss/metal do GLB — evita tecido espelhado */
  matte?: boolean
}

/** Material PBR padrão — sem snap, sem afim, shading suave */
export function toAaaStandard(
  src: THREE.Material,
  opts: AaaStandardOptions = {},
): THREE.MeshStandardMaterial {
  const { matte, ...materialOpts } = opts
  const mat = new THREE.MeshStandardMaterial()

  if (isStandardLike(src)) {
    mat.name = src.name
    mat.color.copy(src.color)
    mat.emissive.copy(src.emissive)
    mat.emissiveIntensity = src.emissiveIntensity
    mat.roughness = src.roughness
    mat.metalness = src.metalness
    mat.opacity = src.opacity
    mat.transparent = src.transparent
    mat.alphaTest = src.alphaTest
    mat.side = src.side
    mat.map = src.map
    mat.normalMap = src.normalMap
    mat.aoMap = src.aoMap
    mat.emissiveMap = src.emissiveMap
    mat.alphaMap = src.alphaMap
    if (!matte) {
      mat.roughnessMap = src.roughnessMap
      mat.metalnessMap = src.metalnessMap
    }
    if (src.aoMap) mat.aoMapIntensity = src.aoMapIntensity
    if (src.normalMap) mat.normalScale.copy(src.normalScale)
  }

  Object.assign(mat, materialOpts)

  if (matte || materialOpts.roughnessMap === null) {
    mat.roughnessMap = null
    mat.metalnessMap = null
  }

  mat.flatShading = false
  mat.envMapIntensity = materialOpts.envMapIntensity ?? AAA_CLASSIC.material.envMapIntensity
  tuneMaterialMaps(mat)
  return mat
}

export function applyAaaMaterialToMesh(
  mesh: THREE.Mesh,
  overrides: AaaStandardOptions = {},
) {
  const sources = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
  const upgraded = sources.map((src) => {
    if (!(src instanceof THREE.Material)) return src
    return toAaaStandard(src, overrides)
  })
  mesh.material = upgraded.length === 1 ? upgraded[0] : upgraded
}

export function applyAaaMeshShadows(
  root: THREE.Object3D,
  opts: { cast?: boolean; receive?: boolean } = {},
) {
  const cast = opts.cast ?? true
  const receive = opts.receive ?? true

  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (!mesh.isMesh) return
    mesh.castShadow = cast
    mesh.receiveShadow = receive
    if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) {
      mesh.frustumCulled = false
    }
  })
}
