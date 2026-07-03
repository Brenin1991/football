const MAX_FILE_BYTES = 8 * 1024 * 1024
const MAX_DIMENSION = 512

export type ProcessedShirtTexture = {
  mimeType: 'image/png'
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

export async function processShirtTextureUpload(file: File): Promise<ProcessedShirtTexture> {
  if (file.type !== 'image/png') {
    throw new Error('Use apenas arquivo PNG.')
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new Error('Imagem muito grande (máx. 8 MB).')
  }

  const img = await loadImageFromFile(file)
  const scale = Math.min(1, MAX_DIMENSION / Math.max(img.width, img.height))
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

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Falha ao exportar PNG.'))),
      'image/png',
    )
  })
  const buffer = await blob.arrayBuffer()
  return { mimeType: 'image/png', data: new Uint8Array(buffer) }
}
