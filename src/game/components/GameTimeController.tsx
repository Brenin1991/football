import { useEffect } from 'react'
import { stepTimeScale } from '../systems/gameTime'
import { useGameStore } from '../store/gameStore'

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable
}

/** Teclas: P pausa · [ mais lento · ] mais rápido · \\ normal (1×) */
export function GameTimeController() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat || isTypingTarget(e.target)) return

      const store = useGameStore.getState()

      if (e.code === 'KeyP') {
        e.preventDefault()
        store.togglePause()
        return
      }

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

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return null
}
