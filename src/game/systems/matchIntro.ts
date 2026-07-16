import { useGameStore } from '../store/gameStore'
import type { FieldBounds, Vec3 } from '../types'
import { getBallSpawnPosition } from './fieldData'
import { setBallPosition } from './entityRegistry'
import { setupKickoff } from './kickoff'
import { narrationSfx } from './narrationSfx'
import { entranceSystem } from './teamEntrance'

export function beginMatchIntro(bounds: FieldBounds, _spawn: Vec3) {
  const kickoffCenter = getBallSpawnPosition(bounds)
  entranceSystem.start(bounds)
  setBallPosition(kickoffCenter)

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
  const center =
    store.setPiecePosition ??
    (store.fieldBounds ? getBallSpawnPosition(store.fieldBounds) : null)
  if (!center) {
    entranceSystem.finish()
    return
  }

  entranceSystem.finish()
  setupKickoff('home', center, 'Saída de bola — passe (Espaço / E)')
}
