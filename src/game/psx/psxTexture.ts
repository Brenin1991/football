import * as THREE from 'three'
import { PSX_CLASSIC } from './psxSettings'

const downscaledCache = new WeakMap<THREE.Texture, THREE.Texture>()

function getImageDimensions(image: CanvasImageSource): { w: number; h: number } {
  if (image instanceof HTMLVideoElement) {
    return { w: image.videoWidth, h: image.videoHeight }
  }
  if (image instanceof HTMLImageElement || image instanceof HTMLCanvasElement) {
    return { w: image.width, h: image.height }
  }
  if (image instanceof ImageBitmap) {
    return { w: image.width, h: image.height }
  }
  const sized = image as { width?: number; height?: number }
  return { w: sized.width ?? 0, h: sized.height ?? 0 }
}

/** Reduz textura para 64×64 / 128×128 com filtro nearest (pixelado PSX) */
export function downscalePsxTexture(
  texture: THREE.Texture,
  maxSize: number = PSX_CLASSIC.material.texture.maxSize,
): THREE.Texture {
  const img = texture.image as CanvasImageSource | undefined
  if (!img) return texture

  const { w, h } = getImageDimensions(img)
  if (!w || !h) return texture

  const cached = downscaledCache.get(texture)
  if (cached) return cached

  const scale = Math.min(1, maxSize / Math.max(w, h))
  const tw = Math.max(1, Math.round(w * scale))
  const th = Math.max(1, Math.round(h * scale))

  const canvas = document.createElement('canvas')
  canvas.width = tw
  canvas.height = th
  const ctx = canvas.getContext('2d')
  if (!ctx) return texture

  ctx.imageSmoothingEnabled = false
  ctx.drawImage(img, 0, 0, tw, th)

  const low = new THREE.CanvasTexture(canvas)
  low.name = texture.name ? `${texture.name}_psx${maxSize}` : `psx${maxSize}`
  low.wrapS = texture.wrapS
  low.wrapT = texture.wrapT
  low.colorSpace = texture.colorSpace
  low.flipY = texture.flipY
  low.minFilter = THREE.NearestFilter
  low.magFilter = THREE.NearestFilter
  low.generateMipmaps = false
  low.needsUpdate = true

  downscaledCache.set(texture, low)
  return low
}

export function applyPsxTextureSettings(
  texture: THREE.Texture | null | undefined,
): THREE.Texture | null {
  if (!texture) return null
  const { maxSize } = PSX_CLASSIC.material.texture
  const out = downscalePsxTexture(texture, maxSize)
  out.minFilter = THREE.NearestFilter
  out.magFilter = THREE.NearestFilter
  out.generateMipmaps = false
  return out
}

export function applyPsxTexturesToMaterial(mat: THREE.MeshStandardMaterial) {
  if (mat.map) mat.map = applyPsxTextureSettings(mat.map)
  if (mat.emissiveMap) mat.emissiveMap = applyPsxTextureSettings(mat.emissiveMap)
  if (mat.alphaMap) mat.alphaMap = applyPsxTextureSettings(mat.alphaMap)
  if (mat.aoMap) mat.aoMap = applyPsxTextureSettings(mat.aoMap)
  if (mat.normalMap) mat.normalMap = applyPsxTextureSettings(mat.normalMap)
}
