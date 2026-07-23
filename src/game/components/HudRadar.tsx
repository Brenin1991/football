import { useEffect, useRef } from 'react'
import type { FieldBounds } from '../types'
import { getTeamPrimaryColor } from '../matchRuntime'
import { ballRef, playerRegistry } from '../systems/entityRegistry'
import { useGameStore, getUserTeam } from '../store/gameStore'

/** Paisagem: comprimento horizontal, largura vertical */
export const RADAR_W = 320
export const RADAR_H = 212
const PAD = 10

const BORDER_ALPHA = 0.18
const LINE_ALPHA = 0.38

function drawPitch(
  ctx: CanvasRenderingContext2D,
  pitchW: number,
  pitchH: number,
  ox: number,
  oy: number,
) {
  ctx.strokeStyle = `rgba(255,255,255,${LINE_ALPHA})`
  ctx.lineWidth = 2
  ctx.strokeRect(ox, oy, pitchW, pitchH)

  const midX = ox + pitchW / 2
  ctx.beginPath()
  ctx.moveTo(midX, oy)
  ctx.lineTo(midX, oy + pitchH)
  ctx.stroke()

  const cy = oy + pitchH / 2
  const circleR = pitchH * 0.12
  ctx.beginPath()
  ctx.arc(midX, cy, circleR, 0, Math.PI * 2)
  ctx.stroke()

  const boxW = pitchW * 0.16
  const boxH = pitchH * 0.56
  const boxY = oy + (pitchH - boxH) / 2
  ctx.strokeRect(ox, boxY, boxW, boxH)
  ctx.strokeRect(ox + pitchW - boxW, boxY, boxW, boxH)

  const sixW = boxW * 0.45
  const sixH = boxH * 0.52
  const sixY = oy + (pitchH - sixH) / 2
  ctx.strokeRect(ox, sixY, sixW, sixH)
  ctx.strokeRect(ox + pitchW - sixW, sixY, sixW, sixH)
}

function buildRadarMapper(bounds: FieldBounds) {
  const spanX = bounds.maxX - bounds.minX
  const spanZ = bounds.maxZ - bounds.minZ
  const pitchW = RADAR_W - PAD * 2
  const pitchH = RADAR_H - PAD * 2

  const goalDeltaZ = Math.abs(bounds.homeScoringGoalZ - bounds.awayScoringGoalZ)
  const lengthOnZ = goalDeltaZ > spanX * 0.25 || spanZ >= spanX

  if (lengthOnZ) {
    return (x: number, z: number) => ({
      x: PAD + ((z - bounds.minZ) / spanZ) * pitchW,
      y: PAD + ((bounds.maxX - x) / spanX) * pitchH,
    })
  }

  return (x: number, z: number) => ({
    x: PAD + ((x - bounds.minX) / spanX) * pitchW,
    y: PAD + ((bounds.maxZ - z) / spanZ) * pitchH,
  })
}

export function HudRadar() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fieldBounds = useGameStore((s) => s.fieldBounds)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !fieldBounds) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.imageSmoothingEnabled = false
    const toRadar = buildRadarMapper(fieldBounds)

    let raf = 0
    const draw = () => {
      const activePlayerId = useGameStore.getState().activePlayerId

      ctx.clearRect(0, 0, RADAR_W, RADAR_H)

      const bgGrad = ctx.createLinearGradient(0, 0, 0, RADAR_H)
      bgGrad.addColorStop(0, 'rgba(48, 52, 60, 0.05)')
      bgGrad.addColorStop(0.45, 'rgba(28, 32, 38, 0.07)')
      bgGrad.addColorStop(1, 'rgba(14, 16, 20, 0.09)')
      ctx.fillStyle = bgGrad
      ctx.fillRect(0, 0, RADAR_W, RADAR_H)

      ctx.strokeStyle = `rgba(90, 90, 96, ${BORDER_ALPHA})`
      ctx.lineWidth = 2
      ctx.strokeRect(0.5, 0.5, RADAR_W - 1, RADAR_H - 1)

      const pitchW = RADAR_W - PAD * 2
      const pitchH = RADAR_H - PAD * 2
      drawPitch(ctx, pitchW, pitchH, PAD, PAD)

      for (const p of playerRegistry.values()) {
        const pt = toRadar(p.position.x, p.position.z)
        const px = Math.round(pt.x)
        const py = Math.round(pt.y)
        const isActive = p.team === getUserTeam() && p.id === activePlayerId

        if (isActive) {
          ctx.fillStyle = '#facc15'
          ctx.fillRect(px - 3, py - 3, 7, 7)
        }

        ctx.fillStyle = p.team === 'home' ? getTeamPrimaryColor('home') : '#f2f2f2'
        ctx.fillRect(px - 2, py - 2, 5, 5)
      }

      const ball = ballRef.current
      const bt = toRadar(ball.x, ball.z)
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(Math.round(bt.x) - 2, Math.round(bt.y) - 2, 5, 5)

      raf = requestAnimationFrame(draw)
    }

    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [fieldBounds])

  if (!fieldBounds) return null

  return (
    <div className="psx-radar-wrap" aria-hidden>
      <canvas
        ref={canvasRef}
        className="psx-radar"
        width={RADAR_W}
        height={RADAR_H}
      />
    </div>
  )
}
