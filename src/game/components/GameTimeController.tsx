import { useEffect, useRef } from 'react'
import {
  XBOX,
  createGamepadEdgeState,
  getActiveGamepad,
  seedGamepadEdgeState,
} from '../hooks/gamepad'
import { stepTimeScale } from '../systems/gameTime'
import { useGameStore } from '../store/gameStore'

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable
}

/** Teclas: P / Esc / START pausa · [ mais lento · ] mais rápido · \\ normal (1×) */
export function GameTimeController() {
  const edgeRef = useRef(createGamepadEdgeState())

  useEffect(() => {
    seedGamepadEdgeState(edgeRef.current)

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat || isTypingTarget(e.target)) return

      const store = useGameStore.getState()

      if (e.code === 'KeyP' || e.code === 'Escape') {
        e.preventDefault()
        if (store.pauseMenuOpen) {
          // Escape no submenu é tratado pelo useMenuPad; P fecha tudo
          if (e.code === 'KeyP') store.closePauseMenu()
        } else {
          store.openPauseMenu()
        }
        return
      }

      if (store.pauseMenuOpen) return

      if (e.code === 'BracketLeft') {
        e.preventDefault()
        const next = stepTimeScale(store.timeScale, -1)
        store.setTimeScale(next)
        return
      }

      if (e.code === 'BracketRight') {
        e.preventDefault()
        const next = stepTimeScale(store.timeScale, 1)
        store.setTimeScale(next)
        return
      }

      if (e.code === 'Backslash') {
        e.preventDefault()
        store.resetTimeScale()
      }
    }

    let raf = 0
    const tick = () => {
      const pad = getActiveGamepad()
      const edge = edgeRef.current
      if (pad) {
        const justPressed = (index: number) => {
          const now = pad.buttons[index]?.pressed === true
          const was = edge.prevButtons[index] === true
          return now && !was
        }
        if (justPressed(XBOX.START)) {
          const store = useGameStore.getState()
          if (store.pauseMenuOpen) store.closePauseMenu()
          else store.openPauseMenu()
        }
        edge.prevButtons = pad.buttons.map((button) => button.pressed)
      }
      raf = requestAnimationFrame(tick)
    }

    window.addEventListener('keydown', onKeyDown)
    raf = requestAnimationFrame(tick)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      cancelAnimationFrame(raf)
    }
  }, [])

  return null
}
