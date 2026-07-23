import { Easing } from '@tweenjs/tween.js'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { AppView } from '../../store/appStore'
import { menuSfx } from '../menuSfx'
import { startMenuTween, tweenElement, type TweenValues } from '../menuTween'
import {
  beginViewTransitionWindow,
  getViewTransitionMode,
  VIEW_TRANSITION_MS,
  type ViewTransitionMode,
} from '../viewTransition'

type ViewTransitionProps = {
  view: AppView
  children: (activeView: AppView) => ReactNode
}

type ActiveTransition = {
  from: AppView
  to: AppView
  mode: ViewTransitionMode
}

export function ViewTransition({ view, children }: ViewTransitionProps) {
  const [shownView, setShownView] = useState(view)
  const [transition, setTransition] = useState<ActiveTransition | null>(null)
  const finishTokenRef = useRef(0)
  const inLayerRef = useRef<HTMLDivElement>(null)
  const outLayerRef = useRef<HTMLDivElement>(null)
  const curtainRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (view === shownView) return

    menuSfx.playOpen()

    const from = shownView
    const to = view
    const mode = getViewTransitionMode(from, to)
    const finishToken = ++finishTokenRef.current

    beginViewTransitionWindow()
    setTransition({ from, to, mode })

    const finishTimer = window.setTimeout(() => {
      if (finishTokenRef.current !== finishToken) return
      setShownView(to)
      setTransition(null)
    }, VIEW_TRANSITION_MS)

    return () => window.clearTimeout(finishTimer)
  }, [view, shownView])

  useLayoutEffect(() => {
    const inLayer = inLayerRef.current
    const outLayer = outLayerRef.current
    const curtain = curtainRef.current
    if (!transition || !inLayer || !outLayer || !curtain) return

    const duration = VIEW_TRANSITION_MS
    const incoming: Partial<TweenValues> =
      transition.mode === 'slide-forward'
        ? { opacity: 0, x: window.innerWidth * 0.32 }
        : transition.mode === 'slide-back'
          ? { opacity: 0, x: window.innerWidth * -0.32 }
          : { opacity: 0, scale: 1.05 }
    const outgoing: Partial<TweenValues> =
      transition.mode === 'slide-forward'
        ? { opacity: 0, x: window.innerWidth * -0.26 }
        : transition.mode === 'slide-back'
          ? { opacity: 0, x: window.innerWidth * 0.26 }
          : { opacity: 0, scale: 0.95 }

    const cancelIncoming = tweenElement(inLayer, incoming, {
      duration,
      easing: Easing.Cubic.Out,
    })
    const cancelOutgoing = tweenElement(outLayer, {}, {
      to: outgoing,
      duration,
      easing: Easing.Cubic.In,
    })
    const cancelCurtain = startMenuTween({
      from: { opacity: 0 },
      duration,
      easing: Easing.Quadratic.InOut,
      onUpdate: (_, progress) => {
        const opacity =
          progress < 0.2 ? (progress / 0.2) * 0.55 : (1 - (progress - 0.2) / 0.8) * 0.55
        curtain.style.opacity = String(Math.max(0, opacity))
      },
      onComplete: () => {
        curtain.style.opacity = ''
      },
    })

    return () => {
      cancelIncoming()
      cancelOutgoing()
      cancelCurtain()
    }
  }, [transition])

  if (!transition) {
    return (
      <div className="view-transition" data-view={shownView}>
        <div className="view-transition__layer view-transition__layer--steady">
          {children(shownView)}
        </div>
      </div>
    )
  }

  return (
    <div
      key={`${transition.from}->${transition.to}`}
      className="view-transition view-transition--busy"
      data-view={transition.to}
      data-from={transition.from}
    >
      <div
        ref={outLayerRef}
        key={`out-${transition.from}`}
        className={`view-transition__layer view-transition__layer--out view-transition__layer--${transition.mode}`}
      >
        {children(transition.from)}
      </div>
      <div
        ref={inLayerRef}
        key={`in-${transition.to}`}
        className={`view-transition__layer view-transition__layer--in view-transition__layer--${transition.mode}`}
      >
        {children(transition.to)}
      </div>
      <div ref={curtainRef} className="view-transition__curtain" aria-hidden />
    </div>
  )
}
