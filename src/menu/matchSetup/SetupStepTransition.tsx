import { useLayoutEffect, useRef, type ReactNode } from 'react'
import type { MatchSetupStep } from '../../store/matchSetupStore'
import { tweenElement } from '../menuTween'
import { isViewTransitionActive } from '../viewTransition'

type SetupStepTransitionProps = {
  step: MatchSetupStep
  children: ReactNode
}

export function SetupStepTransition({ step, children }: SetupStepTransitionProps) {
  const rootRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return
    // Skip element entrance while the whole screen is sliding in — the
    // view transition already carries the motion for the first step.
    if (isViewTransitionActive()) return

    const animations = [
      { selector: '.fifa-header', from: { opacity: 0, y: -18 }, delay: 0 },
      { selector: '.fifa-body', from: { opacity: 0, y: 24, scale: 0.985 }, delay: 55 },
      { selector: '.fifa-footer', from: { opacity: 0, y: 18 }, delay: 110 },
    ]

    const cancelTweens = animations.flatMap(({ selector, from, delay }) => {
      const element = root.querySelector<HTMLElement>(selector)
      return element ? [tweenElement(element, from, { duration: 430, delay })] : []
    })

    return () => cancelTweens.forEach((cancel) => cancel())
  }, [step])

  return (
    <div ref={rootRef} key={step} className="setup-step">
      {children}
    </div>
  )
}
