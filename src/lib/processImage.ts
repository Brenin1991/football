import type { EntityImageType } from '../db/entityImages'
import { IMAGE_MAX_DIMENSION } from '../db/entityImages'

const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp'])
const MAX_FILE_BYTES = 4 * 1024 * 1024

export type ProcessedImage = {
  mimeType: string
  data: Uint8Array
}

function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Não foi possível ler a imagem.'))
    }
    img.src = url
  })
}

function resizeToCanvas(img: HTMLImageElement, maxDim: number): HTMLCanvasElement {
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height))
  const w = Math.max(1, Math.round(img.width * scale))
  const h = Math.max(1, Math.round(img.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas indisponível.')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, 0, 0, w, h)
  return canvas
}

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Falha ao exportar imagem.'))),
      mimeType,
      mimeType === 'image/jpeg' ? 0.9 : undefined,
    )
  })
}

export async function processImageUpload(
  file: File,
  entityType: EntityImageType,
): Promise<ProcessedImage> {
  if (!ALLOWED_MIME.has(file.type)) {
    throw new Error('Use PNG, JPEG ou WebP.')
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new Error('Imagem muito grande (máx. 4 MB).')
  }

  const img = await loadImageFromFile(file)
  const canvas = resizeToCanvas(img, IMAGE_MAX_DIMENSION[entityType])
  const preferWebp = file.type === 'image/webp' || file.type === 'image/png'
  const mimeType = preferWebp ? 'image/webp' : 'image/jpeg'
  const blob = await canvasToBlob(canvas, mimeType)
  const buffer = await blob.arrayBuffer()
  return { mimeType, data: new Uint8Array(buffer) }
}
