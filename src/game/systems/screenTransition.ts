const FADE_OUT_MS = 400
const HOLD_MS = 140
const FADE_IN_MS = 550

let opacity = 0
let introOpacity = 0
let active = false
let chain: Promise<void> = Promise.resolve()
const listeners = new Set<(value: number) => void>()

function combinedOpacity() {
  return Math.max(opacity, introOpacity)
}

function emit() {
  const value = combinedOpacity()
  for (const listener of listeners) listener(value)
}

function easeInOut(t: number) {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2
}

function animateTo(target: number, duration: number): Promise<void> {
  const from = opacity
  const start = performance.now()

  return new Promise((resolve) => {
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      opacity = from + (target - from) * easeInOut(t)
      emit()
      if (t < 1) requestAnimationFrame(step)
      else resolve()
    }
    requestAnimationFrame(step)
  })
}

export function subscribeScreenFade(listener: (value: number) => void) {
  listeners.add(listener)
  listener(combinedOpacity())
  return () => {
    listeners.delete(listener)
  }
}

export function getScreenFadeOpacity() {
  return combinedOpacity()
}

export function setIntroFadeOpacity(value: number) {
  introOpacity = Math.max(0, Math.min(1, value))
  emit()
}

export function clearIntroFade() {
  introOpacity = 0
  emit()
}

export function isScreenTransitionActive() {
  return active || combinedOpacity() > 0.02
}

export function runFadeOut(duration = FADE_OUT_MS): Promise<void> {
  chain = chain.then(async () => {
    active = true
    await animateTo(1, duration)
  })
  return chain
}

export function runFadeIn(duration = FADE_IN_MS): Promise<void> {
  chain = chain.then(async () => {
    await animateTo(0, duration)
    active = false
  })
  return chain
}

/** Fade out → reposiciona → fade in (estilo PES) */
export function runScreenTransition(midpoint: () => void): Promise<void> {
  chain = chain.then(async () => {
    active = true
    await animateTo(1, FADE_OUT_MS)
    midpoint()
    await new Promise((resolve) => setTimeout(resolve, HOLD_MS))
    await animateTo(0, FADE_IN_MS)
    active = false
  })
  return chain
}
