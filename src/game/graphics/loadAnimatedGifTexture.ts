import { parseGIF, decompressFrames, type ParsedFrame } from 'gifuct-js'
import { CanvasTexture, SRGBColorSpace, type Texture } from 'three'

export type AnimatedGifTexture = {
  texture: CanvasTexture
  /** Avança a animação; `deltaMs` em milissegundos (ex.: delta * 1000 do R3F). */
  tick: (deltaMs?: number) => void
  dispose: () => void
}

function drawPatch(
  ctx: CanvasRenderingContext2D,
  tempCanvas: HTMLCanvasElement,
  tempCtx: CanvasRenderingContext2D,
  frameImageDataRef: { current: ImageData | null },
  frame: ParsedFrame,
) {
  const dims = frame.dims

  if (
    !frameImageDataRef.current ||
    dims.width !== frameImageDataRef.current.width ||
    dims.height !== frameImageDataRef.current.height
  ) {
    tempCanvas.width = dims.width
    tempCanvas.height = dims.height
    frameImageDataRef.current = tempCtx.createImageData(dims.width, dims.height)
  }

  frameImageDataRef.current.data.set(frame.patch)
  tempCtx.putImageData(frameImageDataRef.current, 0, 0)
  ctx.drawImage(tempCanvas, dims.left, dims.top)
}

function createGifPlayer(frames: ParsedFrame[], width: number, height: number) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Canvas 2D unavailable')

  const tempCanvas = document.createElement('canvas')
  const tempCtx = tempCanvas.getContext('2d')
  if (!tempCtx) throw new Error('Canvas 2D unavailable')

  const frameImageDataRef = { current: null as ImageData | null }
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace

  let frameIndex = 0
  let accumMs = 0

  const applyFrame = (frame: ParsedFrame) => {
    if (frame.disposalType === 2) {
      ctx.clearRect(0, 0, width, height)
    }
    drawPatch(ctx, tempCanvas, tempCtx, frameImageDataRef, frame)
    texture.needsUpdate = true
  }

  applyFrame(frames[0])

  return {
    texture,
    tick(deltaMs = 16) {
      const frame = frames[frameIndex]
      const delay = Math.max(frame.delay || 100, 20)
      accumMs += deltaMs
      if (accumMs < delay) return
      accumMs -= delay

      frameIndex = (frameIndex + 1) % frames.length
      applyFrame(frames[frameIndex])
    },
    dispose() {
      texture.dispose()
    },
  }
}

export async function loadAnimatedGifTexture(url: string): Promise<AnimatedGifTexture> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to load GIF: ${url}`)
  }

  const buffer = await response.arrayBuffer()
  const gif = parseGIF(buffer)
  const frames = decompressFrames(gif, true)
  if (!frames.length) {
    throw new Error(`GIF has no frames: ${url}`)
  }

  const player = createGifPlayer(frames, gif.lsd.width, gif.lsd.height)

  return {
    texture: player.texture,
    tick: (deltaMs) => player.tick(deltaMs),
    dispose: () => player.dispose(),
  }
}

export function isCanvasTexture(tex: Texture): tex is CanvasTexture {
  return tex instanceof CanvasTexture
}
