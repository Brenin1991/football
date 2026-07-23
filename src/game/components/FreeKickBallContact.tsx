import { useRef } from 'react'
import { useGameStore, getUserTeam } from '../store/gameStore'
import { isAttackingFreeKickPresentation } from '../systems/setPiece'

/**
 * Seletor de ponto de contato na bola — estilo PES.
 * X = curva · Y = loft · centro = knuckle.
 */
export function FreeKickBallContact() {
  const phase = useGameStore((s) => s.phase)
  const ballFrozen = useGameStore((s) => s.ballFrozen)
  const setPieceTeam = useGameStore((s) => s.setPieceTeam)
  const position = useGameStore((s) => s.setPiecePosition)
  const fieldBounds = useGameStore((s) => s.fieldBounds)
  const contactX = useGameStore((s) => s.setPieceContactX)
  const contactY = useGameStore((s) => s.setPieceContactY)
  const dragging = useRef(false)
  const ballRef = useRef<HTMLDivElement>(null)

  const show =
    phase === 'free-kick' &&
    ballFrozen &&
    setPieceTeam === getUserTeam() &&
    position != null &&
    isAttackingFreeKickPresentation(phase, setPieceTeam, position, fieldBounds)

  if (!show) return null

  const pctX = 50 - contactX * 42
  const pctY = 50 - contactY * 42

  const sideLabel =
    Math.abs(contactX) < 0.12
      ? Math.abs(contactY) < 0.12
        ? 'Knuckle'
        : contactY < 0
          ? 'Bica / elevação'
          : 'Rasteiro'
      : contactX > 0
        ? 'Curva →'
        : 'Curva ←'

  const setFromClient = (clientX: number, clientY: number) => {
    const el = ballRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const nx = -(((clientX - rect.left) / rect.width) * 2 - 1)
    const ny = -(((clientY - rect.top) / rect.height) * 2 - 1)
    useGameStore.getState().setSetPieceContact(nx, ny)
  }

  return (
    <div className="fk-contact" aria-label="Ponto de contato na bola">
      <span className="fk-contact-label">Contato</span>
      <div
        ref={ballRef}
        className="fk-contact-ball"
        onPointerDown={(e) => {
          dragging.current = true
          e.currentTarget.setPointerCapture(e.pointerId)
          setFromClient(e.clientX, e.clientY)
        }}
        onPointerMove={(e) => {
          if (!dragging.current) return
          setFromClient(e.clientX, e.clientY)
        }}
        onPointerUp={(e) => {
          dragging.current = false
          try {
            e.currentTarget.releasePointerCapture(e.pointerId)
          } catch {
            /* ignore */
          }
        }}
      >
        <span className="fk-contact-cross fk-contact-cross--h" />
        <span className="fk-contact-cross fk-contact-cross--v" />
        <span
          className="fk-contact-cursor"
          style={{ left: `${pctX}%`, top: `${pctY}%` }}
        />
      </div>
      <span className="fk-contact-hint">{sideLabel}</span>
      <span className="fk-contact-help">Esq = mira · Dir = só a bolinha</span>
    </div>
  )
}
