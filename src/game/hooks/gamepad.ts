/** Mapeamento padrão Xbox (Gamepad API) */
export const XBOX = {
  A: 0,
  B: 1,
  X: 2,
  Y: 3,
  LB: 4,
  RB: 5,
  LT: 6,
  RT: 7,
  DPAD_UP: 12,
  DPAD_DOWN: 13,
  DPAD_LEFT: 14,
  DPAD_RIGHT: 15,
  AXIS_LX: 0,
  AXIS_LY: 1,
  AXIS_RX: 2,
  AXIS_RY: 3,
} as const

const STICK_DEADZONE = 0.18
const TRIGGER_SPRINT = 0.45

export function applyDeadzone(v: number, deadzone = STICK_DEADZONE): number {
  if (Math.abs(v) < deadzone) return 0
  const sign = v < 0 ? -1 : 1
  return sign * ((Math.abs(v) - deadzone) / (1 - deadzone))
}

export function getActiveGamepad(): Gamepad | null {
  const pads = navigator.getGamepads?.()
  if (!pads) return null
  for (const pad of pads) {
    if (pad?.connected) return pad
  }
  return null
}

export type GamepadEdgeState = {
  prevButtons: boolean[]
}

export function createGamepadEdgeState(): GamepadEdgeState {
  return { prevButtons: [] }
}

function buttonPressed(pad: Gamepad, index: number): boolean {
  return pad.buttons[index]?.pressed === true
}

function buttonJustPressed(
  pad: Gamepad,
  index: number,
  edge: GamepadEdgeState,
): boolean {
  const now = buttonPressed(pad, index)
  const was = edge.prevButtons[index] === true
  return now && !was
}

function triggerValue(pad: Gamepad, index: number): number {
  return pad.buttons[index]?.value ?? 0
}

export function pollXboxGamepad(
  edge: GamepadEdgeState,
  out: {
    moveX: number
    moveZ: number
    sprint: boolean
    passHeld: boolean
    passJustPressed: boolean
    throughHeld: boolean
    crossHeld: boolean
    kickHeld: boolean
    kickJustPressed: boolean
    slide: boolean
    switchPlayer: boolean
    shieldHeld: boolean
    aimLeft: boolean
    aimRight: boolean
  },
): boolean {
  const pad = getActiveGamepad()
  if (!pad) {
    out.moveX = 0
    out.moveZ = 0
    return false
  }

  const lx = applyDeadzone(pad.axes[XBOX.AXIS_LX] ?? 0)
  const ly = applyDeadzone(pad.axes[XBOX.AXIS_LY] ?? 0)
  out.moveX = -lx
  out.moveZ = -ly

  out.sprint = triggerValue(pad, XBOX.RT) > TRIGGER_SPRINT

  out.passHeld = buttonPressed(pad, XBOX.A)
  out.throughHeld = buttonPressed(pad, XBOX.Y)
  out.crossHeld = buttonPressed(pad, XBOX.B)
  if (buttonJustPressed(pad, XBOX.A, edge)) out.passJustPressed = true
  out.kickHeld = buttonPressed(pad, XBOX.X)
  if (buttonJustPressed(pad, XBOX.X, edge)) out.kickJustPressed = true
  if (buttonJustPressed(pad, XBOX.B, edge)) out.slide = true
  if (buttonJustPressed(pad, XBOX.LB, edge)) out.switchPlayer = true
  out.shieldHeld = buttonPressed(pad, XBOX.RB)

  const rx = applyDeadzone(pad.axes[XBOX.AXIS_RX] ?? 0, 0.22)
  out.aimLeft =
    buttonPressed(pad, XBOX.DPAD_LEFT) || rx < -0.35
  out.aimRight =
    buttonPressed(pad, XBOX.DPAD_RIGHT) || rx > 0.35

  edge.prevButtons = pad.buttons.map((b) => b.pressed)
  return true
}
