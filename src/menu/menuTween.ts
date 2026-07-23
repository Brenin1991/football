import { Easing, Tween } from '@tweenjs/tween.js'

export type TweenValues = {
  opacity: number
  x: number
  y: number
  scale: number
}

type TweenOptions = {
  from: Partial<TweenValues>
  to?: Partial<TweenValues>
  duration?: number
  delay?: number
  easing?: (amount: number) => number
  onUpdate: (values: TweenValues, progress: number) => void
  onComplete?: () => void
}

const DEFAULT_VALUES: TweenValues = {
  opacity: 1,
  x: 0,
  y: 0,
  scale: 1,
}

export function startMenuTween({
  from,
  to,
  duration = 460,
  delay = 0,
  easing = Easing.Cubic.Out,
  onUpdate,
  onComplete,
}: TweenOptions) {
  const state = { ...DEFAULT_VALUES, ...from, progress: 0 }
  const target = { ...DEFAULT_VALUES, ...to, progress: 1 }
  let frame = 0
  let cancelled = false

  const tween = new Tween(state)
    .to(target, duration)
    .delay(delay)
    .easing(easing)
    .onUpdate((values) => onUpdate(values, values.progress))
    .onComplete(() => {
      if (!cancelled) onComplete?.()
    })

  const tick = (time: number) => {
    if (cancelled) return
    const active = tween.update(time)
    if (active) frame = window.requestAnimationFrame(tick)
  }

  // Apply the initial "from" frame synchronously so the element never paints
  // at its final state before the animation starts (avoids a flash).
  onUpdate(state, 0)

  tween.start(performance.now())
  frame = window.requestAnimationFrame(tick)

  return () => {
    cancelled = true
    tween.stop()
    window.cancelAnimationFrame(frame)
  }
}

export function tweenElement(
  element: HTMLElement,
  from: Partial<TweenValues>,
  options: {
    to?: Partial<TweenValues>
    duration?: number
    delay?: number
    easing?: (amount: number) => number
  } = {},
) {
  element.style.willChange = 'transform, opacity'

  return startMenuTween({
    from,
    ...options,
    onUpdate: ({ opacity, x, y, scale }) => {
      element.style.opacity = String(opacity)
      element.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${scale})`
    },
    onComplete: () => {
      element.style.opacity = ''
      element.style.transform = ''
      element.style.willChange = ''
    },
  })
}
