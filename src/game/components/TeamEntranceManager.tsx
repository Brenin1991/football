import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import { getSimDelta } from '../systems/gameTime'
import { finishMatchIntro } from '../systems/matchIntro'
import {
  beginFullTimeExit,
  beginHalfTimeEnter,
  beginHalfTimeExit,
  finishFullTimeExit,
  finishHalfTimeEnter,
  getHalfTimeKickoffCenter,
} from '../systems/matchBreak'
import { isFieldParadePhase } from '../systems/matchPhases'
import { entranceSystem } from '../systems/teamEntrance'
import { applyHalfTimeStaminaRecovery } from '../systems/playerStamina'
import { useGameStore } from '../store/gameStore'
import { runScreenTransition } from '../systems/screenTransition'

/** Avança entradas/saídas de campo (intro, intervalo, fim de jogo) */
export function TeamEntranceManager() {
  const introFinishedRef = useRef(false)
  const halfExitStartedRef = useRef(false)
  const halfEnterStartedRef = useRef(false)
  const halfEnterFinishedRef = useRef(false)
  const fullExitStartedRef = useRef(false)
  const fullExitFinishedRef = useRef(false)
  const transitionBusyRef = useRef(false)

  useFrame((_, delta) => {
    const store = useGameStore.getState()
    const phase = store.phase
    const bounds = store.fieldBounds
    const simDelta = getSimDelta(delta)

    if (phase === 'intro') {
      halfExitStartedRef.current = false
      halfEnterStartedRef.current = false
      halfEnterFinishedRef.current = false
      fullExitStartedRef.current = false
      fullExitFinishedRef.current = false

      if (!entranceSystem.isActive() || introFinishedRef.current) return
      entranceSystem.update(simDelta)
      if (entranceSystem.isComplete()) {
        introFinishedRef.current = true
        finishMatchIntro()
      }
      return
    }

    introFinishedRef.current = false

    if (phase === 'half-time-exit' && bounds) {
      if (!halfExitStartedRef.current) {
        beginHalfTimeExit(bounds)
        halfExitStartedRef.current = true
      }

      if (entranceSystem.isActive()) {
        entranceSystem.update(simDelta)
      }

      if (
        entranceSystem.isComplete() &&
        !halfEnterStartedRef.current &&
        !transitionBusyRef.current
      ) {
        halfEnterStartedRef.current = true
        transitionBusyRef.current = true
        void runScreenTransition(() => {
          entranceSystem.finish()
          applyHalfTimeStaminaRecovery()
          useGameStore.setState({ half: 2 })
          beginHalfTimeEnter(bounds)
        }).finally(() => {
          transitionBusyRef.current = false
        })
      }
      return
    }

    if (phase === 'half-time-enter' && bounds) {
      fullExitStartedRef.current = false
      fullExitFinishedRef.current = false

      if (entranceSystem.isActive()) {
        entranceSystem.update(simDelta)
      }

      if (entranceSystem.isComplete() && !halfEnterFinishedRef.current) {
        halfEnterFinishedRef.current = true
        finishHalfTimeEnter(getHalfTimeKickoffCenter(bounds))
        halfExitStartedRef.current = false
        halfEnterStartedRef.current = false
      }
      return
    }

    if (phase === 'full-time-exit' && bounds) {
      halfExitStartedRef.current = false
      halfEnterStartedRef.current = false
      halfEnterFinishedRef.current = false

      if (!fullExitStartedRef.current) {
        beginFullTimeExit(bounds)
        fullExitStartedRef.current = true
      }

      if (entranceSystem.isActive()) {
        entranceSystem.update(simDelta)
      }

      if (entranceSystem.isComplete() && !fullExitFinishedRef.current) {
        fullExitFinishedRef.current = true
        finishFullTimeExit()
      }
      return
    }

    if (!isFieldParadePhase(phase)) {
      halfExitStartedRef.current = false
      halfEnterStartedRef.current = false
      halfEnterFinishedRef.current = false
      fullExitStartedRef.current = false
      fullExitFinishedRef.current = false
    }
  })

  return null
}
