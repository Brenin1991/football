import * as THREE from 'three'
import { DEFAULT_SHIRT_UV, type ShirtUvLayout } from '../../db/shirtTexture'
import { getTeamKitShirt } from '../../db/shirtTextureQueries'
import { getDatabase } from '../../db/database'
import { isAaaGraphics } from '../../store/graphicsStore'
import { AAA_CLASSIC } from '../graphics/aaaSettings'
import { PSX_CLASSIC, type PsxTextureProfile } from './psxSettings'

/** Só cacheia o PNG original; bake (flip/UV) roda sempre na aplicação. */
const sourceTextureCache = new Map<string, THREE.Texture>()

function cacheKey(teamId: string, kitNumber: number): string {
  return `${teamId}:${kitNumber}`
}

function findShirtMesh(model: THREE.Object3D): THREE.SkinnedMesh | null {
  let shirt: THREE.SkinnedMesh | null = null
  model.traverse((obj) => {
    if ((obj as THREE.SkinnedMesh).isSkinnedMesh && obj.name.includes('Ch38_Shirt')) {
      shirt = obj as THREE.SkinnedMesh
    }
  })
  return shirt
}

function getImageSize(image: CanvasImageSource): { w: number; h: number } {
  if (image instanceof HTMLImageElement || image instanceof HTMLCanvasElement) {
    return { w: image.width, h: image.height }
  }
  if (image instanceof ImageBitmap) {
    return { w: image.width, h: image.height }
  }
  const sized = image as { width?: number; height?: number }
  return { w: sized.width ?? 1, h: sized.height ?? 1 }
}

/** Bake flip + UV em canvas — não passa pelo downscale PSX (que ignorava repeat). */
function bakeShirtMap(source: THREE.Texture, uv: ShirtUvLayout): THREE.Texture {
  const image = source.image as CanvasImageSource
  const { w, h } = getImageSize(image)

  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, w)
  canvas.height = Math.max(1, h)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas indisponível.')

  ctx.imageSmoothingEnabled = false
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  if (uv.flipHorizontal) {
    ctx.translate(w, 0)
    ctx.scale(-1, 1)
  }
  ctx.drawImage(image, 0, 0, w, h)

  const map = new THREE.CanvasTexture(canvas)
  map.colorSpace = THREE.SRGBColorSpace
  map.flipY = false
  map.wrapS = THREE.ClampToEdgeWrapping
  map.wrapT = THREE.ClampToEdgeWrapping
  map.repeat.set(uv.uvRepeatX, uv.uvRepeatY)
  map.offset.set(uv.uvOffsetX, uv.uvOffsetY)
  if (isAaaGraphics()) {
    map.minFilter = THREE.LinearMipmapLinearFilter
    map.magFilter = THREE.LinearFilter
    map.generateMipmaps = true
    map.anisotropy = 8
  } else {
    map.minFilter = THREE.NearestFilter
    map.magFilter = THREE.NearestFilter
    map.generateMipmaps = false
  }
  map.needsUpdate = true
  return map
}

function refreshShirtMaterialProgram(mat: THREE.MeshStandardMaterial): void {
  if (isAaaGraphics()) {
    mat.customProgramCacheKey = () => `aaa_shirt_${mat.map?.uuid ?? 'none'}`
    mat.needsUpdate = true
    return
  }
  const profile = (mat.userData.psxTextureProfile ?? { affine: false, wobble: 0 }) as PsxTextureProfile
  const snap = PSX_CLASSIC.material.playerVertexSnap
  const profileKey = `${profile.affine ? 1 : 0}_${profile.wobble ?? 0}`
  const mapId = mat.map?.uuid ?? 'none'
  mat.customProgramCacheKey = () => {
    const t = PSX_CLASSIC.material.texture
    return `psx_shirt_${snap}_${t.maxSize}_${profileKey}_map_${mapId}`
  }
  mat.needsUpdate = true
}

function applyMapToShirtMaterial(mat: THREE.MeshStandardMaterial, map: THREE.Texture): void {
  if (mat.map && mat.map !== map) {
    mat.map.dispose()
  }
  mat.map = map
  mat.color.set(0xffffff)
  mat.emissive.setScalar(0)
  mat.emissiveIntensity = 1
  if (!isAaaGraphics()) {
    // Afim PSX distorce UV custom — desliga na camisa texturizada.
    mat.userData.psxTextureProfile = { affine: false, wobble: 0 }
  } else {
    delete mat.userData.psxTextureProfile
    mat.roughness = AAA_CLASSIC.material.fabricRoughness
    mat.metalness = 0
    mat.roughnessMap = null
    mat.metalnessMap = null
    mat.envMapIntensity = AAA_CLASSIC.material.envMapIntensity
  }
  refreshShirtMaterialProgram(mat)
}

export function clearShirtTexture(model: THREE.Object3D): void {
  const shirt = findShirtMesh(model)
  if (!shirt) return
  const materials = Array.isArray(shirt.material) ? shirt.material : [shirt.material]
  const disposed = new Set<string>()
  for (const src of materials) {
    if (!(src instanceof THREE.MeshStandardMaterial)) continue
    const map = src.map
    if (map && !disposed.has(map.uuid)) {
      map.dispose()
      disposed.add(map.uuid)
    }
    src.map = null
    src.needsUpdate = true
  }
}

export function applyShirtTextureToModel(
  model: THREE.Object3D,
  texture: THREE.Texture,
  uv: ShirtUvLayout = DEFAULT_SHIRT_UV,
): void {
  const shirt = findShirtMesh(model)
  if (!shirt) return

  const map = bakeShirtMap(texture, uv)
  const materials = Array.isArray(shirt.material) ? shirt.material : [shirt.material]
  for (const src of materials) {
    if (!(src instanceof THREE.MeshStandardMaterial)) continue
    applyMapToShirtMaterial(src, map)
  }
}

export function loadShirtTextureFromDb(
  teamId: string,
  kitNumber: number,
): Promise<THREE.Texture | null> {
  const key = cacheKey(teamId, kitNumber)
  const cached = sourceTextureCache.get(key)
  if (cached) return Promise.resolve(cached)

  let record: ReturnType<typeof getTeamKitShirt>
  try {
    record = getTeamKitShirt(getDatabase(), teamId, kitNumber as 1 | 2)
  } catch {
    return Promise.resolve(null)
  }
  if (!record.data?.byteLength || !record.mimeType) return Promise.resolve(null)

  const blob = new Blob([record.data], { type: record.mimeType })
  const url = URL.createObjectURL(blob)

  return new Promise((resolve) => {
    new THREE.TextureLoader().load(
      url,
      (loaded) => {
        URL.revokeObjectURL(url)
        loaded.colorSpace = THREE.SRGBColorSpace
        loaded.flipY = false
        if (isAaaGraphics()) {
          loaded.minFilter = THREE.LinearMipmapLinearFilter
          loaded.magFilter = THREE.LinearFilter
          loaded.generateMipmaps = true
          loaded.anisotropy = 8
        } else {
          loaded.minFilter = THREE.NearestFilter
          loaded.magFilter = THREE.NearestFilter
          loaded.generateMipmaps = false
        }
        sourceTextureCache.set(key, loaded)
        resolve(loaded)
      },
      undefined,
      () => {
        URL.revokeObjectURL(url)
        resolve(null)
      },
    )
  })
}

export function invalidateShirtTextures(teamId?: string, kitNumber?: number): void {
  if (!teamId) {
    for (const tex of sourceTextureCache.values()) tex.dispose()
    sourceTextureCache.clear()
    return
  }
  if (kitNumber != null) {
    const tex = sourceTextureCache.get(cacheKey(teamId, kitNumber))
    if (tex) {
      tex.dispose()
      sourceTextureCache.delete(cacheKey(teamId, kitNumber))
    }
    return
  }
  for (const key of [...sourceTextureCache.keys()]) {
    if (key.startsWith(`${teamId}:`)) {
      sourceTextureCache.get(key)?.dispose()
      sourceTextureCache.delete(key)
    }
  }
}

export async function attachTeamShirtTexture(
  model: THREE.Object3D,
  teamDbId: string | null,
  kitNumber: 1 | 2,
): Promise<void> {
  clearShirtTexture(model)
  if (!teamDbId) return

  const record = getTeamKitShirt(getDatabase(), teamDbId, kitNumber)
  if (!record.data?.byteLength) return

  const texture = await loadShirtTextureFromDb(teamDbId, kitNumber)
  if (!texture) return

  applyShirtTextureToModel(model, texture, record.uv)
}

export function detachTeamShirtTexture(model: THREE.Object3D): void {
  clearShirtTexture(model)
}
