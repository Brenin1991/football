import { useGameStore } from '../store/gameStore'
import type { FieldBounds, Vec3 } from '../types'
import { ballRestY } from './fieldData'
import { ballRef, setBallPosition } from './entityRegistry'
import { setupKickoff } from './kickoff'
import { getKickoffPosition } from './rules'
import { entranceSystem } from './teamEntrance'

export function beginHalfTimeExit(bounds: FieldBounds) {
  entranceSystem.startExit(bounds)
  ballRef.velocity = { x: 0, y: 0, z: 0 }
  useGameStore.setState({
    ballFrozen: true,
    ballPossession: null,
    passIntent: null,
    message: 'Intervalo — times saindo do campo',
  })
}

export function beginHalfTimeEnter(bounds: FieldBounds) {
  entranceSystem.startEnter(bounds, { intro: false })
  useGameStore.setState({
    phase: 'half-time-enter',
    message: '2º tempo — times entrando',
    ballFrozen: true,
    ballPossession: null,
    passIntent: null,
  })
}

export function finishHalfTimeEnter(center: Vec3) {
  entranceSystem.finish()
  const kickoffCenter = { ...center, y: ballRestY() }
  setBallPosition(kickoffCenter)
  setupKickoff('away', kickoffCenter, '2º tempo — passe (Espaço / E)')
}

export function beginFullTimeExit(bounds: FieldBounds) {
  entranceSystem.startFinalExit(bounds)
  ballRef.velocity = { x: 0, y: 0, z: 0 }
  useGameStore.setState({
    ballFrozen: true,
    ballPossession: null,
    passIntent: null,
    message: 'Fim de jogo — times saindo do campo',
  })
}

export function finishFullTimeExit() {
  entranceSystem.finish()
  useGameStore.setState({
    phase: 'full-time',
    message: 'Fim de jogo',
    ballFrozen: true,
    ballPossession: null,
  })
}

export function getHalfTimeKickoffCenter(bounds: FieldBounds): Vec3 {
  return getKickoffPosition(bounds)
}
