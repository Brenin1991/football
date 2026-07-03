import { useEffect, useRef } from 'react'
import { XBOX, createGamepadEdgeState, getActiveGamepad } from '../../game/hooks/gamepad'
import { useAppStore } from '../../store/appStore'
import { menuSfx } from '../menuSfx'

export type MenuPadHandlers = {
  onUp?: () => void
  onDown?: () => void
  onLeft?: () => void
  onRight?: () => void
  onConfirm?: () => void
  onBack?: () => void
  enabled?: boolean
}

const KEY_ACTIONS: Record<string, keyof MenuPadHandlers> = {
  ArrowUp: 'onUp',
  ArrowDown: 'onDown',
  ArrowLeft: 'onLeft',
  ArrowRight: 'onRight',
  Enter: 'onConfirm',
  ' ': 'onConfirm',
  Escape: 'onBack',
  Backspace: 'onBack',
}

type PadRegistration = {
  id: number
  handlersRef: { current: MenuPadHandlers }
}

const registrations: PadRegistration[] = []
let registrationSeq = 0
let listenersBound = false
let edge = createGamepadEdgeState()
let raf = 0
let onKeyDown: ((event: KeyboardEvent) => void) | null = null

function getTopRegistration(): PadRegistration | null {
  for (let index = registrations.length - 1; index >= 0; index -= 1) {
    if (registrations[index].handlersRef.current.enabled !== false) {
      return registrations[index]
    }
  }
  return null
}

function menuInputAllowed() {
  return useAppStore.getState().view !== 'game'
}

function fire(action: keyof MenuPadHandlers) {
  if (!menuInputAllowed()) return
  const top = getTopRegistration()
  if (!top) return
  const fn = top.handlersRef.current[action]
  if (typeof fn !== 'function') return

  if (action === 'onConfirm') {
    menuSfx.playSelect()
  } else if (
    action === 'onUp' ||
    action === 'onDown' ||
    action === 'onLeft' ||
    action === 'onRight' ||
    action === 'onBack'
  ) {
    menuSfx.playNavigate()
  }

  fn()
}

function ensureListeners() {
  if (listenersBound) return
  listenersBound = true
  edge = createGamepadEdgeState()

  onKeyDown = (event: KeyboardEvent) => {
    if (event.repeat) return
    if (!menuInputAllowed()) return
    const action = KEY_ACTIONS[event.key]
    if (!action) return
    const top = getTopRegistration()
    if (!top) return
    const fn = top.handlersRef.current[action]
    if (typeof fn !== 'function') return
    event.preventDefault()
    fire(action)
  }

  const tick = () => {
    if (menuInputAllowed()) {
      const pad = getActiveGamepad()
      if (pad) {
        const prev = edge.prevButtons
        const justPressed = (index: number) => {
          const now = pad.buttons[index]?.pressed === true
          const was = prev[index] === true
          return now && !was
        }

        if (justPressed(XBOX.DPAD_UP)) fire('onUp')
        if (justPressed(XBOX.DPAD_DOWN)) fire('onDown')
        if (justPressed(XBOX.DPAD_LEFT)) fire('onLeft')
        if (justPressed(XBOX.DPAD_RIGHT)) fire('onRight')
        if (justPressed(XBOX.A)) fire('onConfirm')
        if (justPressed(XBOX.B)) fire('onBack')

        edge.prevButtons = pad.buttons.map((button) => button.pressed)
      }
    }

    raf = requestAnimationFrame(tick)
  }

  window.addEventListener('keydown', onKeyDown)
  raf = requestAnimationFrame(tick)
}

function releaseListenersIfIdle() {
  if (registrations.length > 0 || !listenersBound) return
  listenersBound = false
  if (onKeyDown) window.removeEventListener('keydown', onKeyDown)
  cancelAnimationFrame(raf)
  onKeyDown = null
}

export function useMenuPad(handlers: MenuPadHandlers) {
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers

  const idRef = useRef(0)
  if (idRef.current === 0) {
    registrationSeq += 1
    idRef.current = registrationSeq
  }

  useEffect(() => {
    if (handlers.enabled === false) return

    const registration: PadRegistration = { id: idRef.current, handlersRef }
    registrations.push(registration)
    ensureListeners()

    return () => {
      const index = registrations.findIndex((entry) => entry.id === idRef.current)
      if (index >= 0) registrations.splice(index, 1)
      releaseListenersIfIdle()
    }
  }, [handlers.enabled])
}
