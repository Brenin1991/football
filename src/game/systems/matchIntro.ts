import { useGameStore } from '../store/gameStore'
import type { FieldBounds, Vec3 } from '../types'
import { ballRestY } from './fieldData'
import { ballRef } from './entityRegistry'
import { setupKickoff } from './kickoff'
import { narrationSfx } from './narrationSfx'
import { entranceSystem } from './teamEntrance'

export function beginMatchIntro(bounds: FieldBounds, center: Vec3) {
  const kickoffCenter = { ...center, y: ballRestY() }
  entranceSystem.start(bounds)
  // Só atualiza ref lógica — o Ball.tsx posiciona o corpo Rapier no useFrame
  ballRef.current = { ...kickoffCenter }
  ballRef.velocity = { x: 0, y: 0, z: 0 }

  useGameStore.setState({
    phase: 'intro',
    ballFrozen: true,
    ballPossession: null,
    passIntent: null,
    lastTouchTeam: null,
    message: '',
    setPiecePosition: kickoffCenter,
    setPieceTeam: null,
    setPieceKickerId: null,
  })

  narrationSfx.playIntro()
}

export function finishMatchIntro() {
  if (!entranceSystem.isActive()) return

  const store = useGameStore.getState()
  const center = store.setPiecePosition ?? store.fieldBounds?.center
  if (!center) {
    entranceSystem.finish()
    return
  }

  entranceSystem.finish()
  setupKickoff('home', center, 'Saída de bola — pressione Espaço para iniciar')
}
