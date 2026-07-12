import { useEffect, useRef } from 'react'
import { sfx } from '../systems/sfx'
import {
  createGamepadEdgeState,
  pollXboxGamepad,
} from './gamepad'

export type ControlState = {
  forward: boolean
  backward: boolean
  left: boolean
  right: boolean
  sprint: boolean
  pass: boolean
  /** Passe em profundidade (R / Y) */
  throughPass: boolean
  /** Cruzamento (Q / B com bola) */
  cross: boolean
  /** Botão de chute pressionado (Espaço / X) */
  kick: boolean
  slide: boolean
  switchPlayer: boolean
  /** Segurar RB / F — protege a bola (parado, imune a roubo) */
  shield: boolean
  /** Cancela o carregamento de chute/passe/cruzamento (LT / Esc) */
  cancelCharge: boolean
  /** Analógico esquerdo — eixo X (-1..1) */
  moveX: number
  /** Analógico esquerdo — eixo Z (-1..1), para frente = positivo */
  moveZ: number
  /** Analógico direito — eixo X (-1..1) */
  skillX: number
  /** Analógico direito — eixo Z (-1..1), para frente = positivo */
  skillZ: number
}

export type PlayerAction = 'pass' | 'kick' | 'slide' | 'cross' | 'throughPass' | 'switchPlayer'

type BooleanControlKey = Exclude<
  keyof ControlState,
  'moveX' | 'moveZ' | 'skillX' | 'skillZ'
>

const DEFAULT: ControlState = {
  forward: false,
  backward: false,
  left: false,
  right: false,
  sprint: false,
  pass: false,
  throughPass: false,
  cross: false,
  kick: false,
  slide: false,
  switchPlayer: false,
  shield: false,
  cancelCharge: false,
  moveX: 0,
  moveZ: 0,
  skillX: 0,
  skillZ: 0,
}

export function useKeyboardControls() {
  const controls = useRef<ControlState>({ ...DEFAULT })
  const gamepadEdge = useRef(createGamepadEdgeState())
  const keyboardSprint = useRef(false)
  const keyboardLeft = useRef(false)
  const keyboardRight = useRef(false)
  const keyboardPass = useRef(false)
  const keyboardThrough = useRef(false)
  const keyboardCross = useRef(false)
  const keyboardKick = useRef(false)
  const keyboardShield = useRef(false)
  const keyboardCancel = useRef(false)
  const kickPressEdge = useRef(false)
  const kickReleased = useRef(false)
  const prevKickHeld = useRef(false)
  const passPressEdge = useRef(false)

  useEffect(() => {
    const map: Record<string, BooleanControlKey> = {
      KeyW: 'forward',
      ArrowUp: 'forward',
      KeyS: 'backward',
      ArrowDown: 'backward',
      KeyA: 'left',
      ArrowLeft: 'left',
      KeyD: 'right',
      ArrowRight: 'right',
      ShiftLeft: 'sprint',
      ShiftRight: 'sprint',
      KeyE: 'pass',
      KeyR: 'throughPass',
      KeyQ: 'cross',
      KeyF: 'shield',
      Escape: 'cancelCharge',
      Backspace: 'cancelCharge',
      Space: 'kick',
      Tab: 'switchPlayer',
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') e.preventDefault()
      if (e.repeat) return
      const action = map[e.code]
      if (!action) return
      sfx.unlock()
      if (action === 'sprint') keyboardSprint.current = true
      if (action === 'left') keyboardLeft.current = true
      if (action === 'right') keyboardRight.current = true
      if (action === 'pass') {
        keyboardPass.current = true
        passPressEdge.current = true
      }
      if (action === 'throughPass') keyboardThrough.current = true
      if (action === 'cross') keyboardCross.current = true
      if (action === 'kick') {
        keyboardKick.current = true
        kickPressEdge.current = true
      }
      if (action === 'shield') keyboardShield.current = true
      if (action === 'cancelCharge') keyboardCancel.current = true
      controls.current[action] = true
    }

    const onKeyUp = (e: KeyboardEvent) => {
      const action = map[e.code]
      if (!action) return
      if (action === 'sprint') keyboardSprint.current = false
      if (action === 'left') keyboardLeft.current = false
      if (action === 'right') keyboardRight.current = false
      if (action === 'pass') keyboardPass.current = false
      if (action === 'throughPass') keyboardThrough.current = false
      if (action === 'cross') keyboardCross.current = false
      if (action === 'kick') {
        keyboardKick.current = false
        kickReleased.current = true
      }
      if (action === 'shield') keyboardShield.current = false
      if (action === 'cancelCharge') keyboardCancel.current = false
      controls.current[action] = false
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [])

  useEffect(() => {
    let raf = 0
    const tick = () => {
      const c = controls.current
      const gp = {
        moveX: 0,
        moveZ: 0,
        sprint: false,
        passHeld: false,
        passJustPressed: false,
        throughHeld: false,
        crossHeld: false,
        kickHeld: false,
        kickJustPressed: false,
        slide: false,
        switchPlayer: false,
        shieldHeld: false,
        cancelCharge: false,
        aimLeft: false,
        aimRight: false,
        skillX: 0,
        skillZ: 0,
      }

      const hasPad = pollXboxGamepad(gamepadEdge.current, gp)

      c.moveX = gp.moveX
      c.moveZ = gp.moveZ
      c.skillX = gp.skillX
      c.skillZ = gp.skillZ
      c.sprint = keyboardSprint.current || gp.sprint

      c.pass = keyboardPass.current || gp.passHeld
      c.throughPass = keyboardThrough.current || gp.throughHeld
      c.cross = keyboardCross.current || gp.crossHeld
      if (gp.slide) c.slide = true
      if (gp.switchPlayer) c.switchPlayer = true
      if (gp.kickJustPressed) kickPressEdge.current = true
      if (gp.passJustPressed) passPressEdge.current = true

      c.shield = keyboardShield.current || gp.shieldHeld
      c.cancelCharge = keyboardCancel.current || gp.cancelCharge
      c.kick = keyboardKick.current || gp.kickHeld

      if (prevKickHeld.current && !c.kick) {
        kickReleased.current = true
      }
      prevKickHeld.current = c.kick

      c.left = keyboardLeft.current || (hasPad && gp.aimLeft)
      c.right = keyboardRight.current || (hasPad && gp.aimRight)

      raf = requestAnimationFrame(tick)
    }

    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  const consumeAction = (action: PlayerAction) => {
    if (action === 'kick') {
      if (kickPressEdge.current) {
        kickPressEdge.current = false
        return true
      }
      return false
    }
    if (controls.current[action]) {
      controls.current[action] = false
      return true
    }
    return false
  }

  const consumeKickRelease = () => {
    if (kickReleased.current) {
      kickReleased.current = false
      return true
    }
    return false
  }

  const consumePassPress = () => {
    if (passPressEdge.current) {
      passPressEdge.current = false
      return true
    }
    return false
  }

  return { controls, consumeAction, consumeKickRelease, consumePassPress }
}
