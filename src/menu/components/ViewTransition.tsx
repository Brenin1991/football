import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { AppView } from '../../store/appStore'
import { menuSfx } from '../menuSfx'
import { getViewTransitionMode, VIEW_TRANSITION_MS, type ViewTransitionMode } from '../viewTransition'

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

  useEffect(() => {
    if (view === shownView) return

    menuSfx.playOpen()

    const from = shownView
    const to = view
    const mode = getViewTransitionMode(from, to)
    const finishToken = ++finishTokenRef.current

    setTransition({ from, to, mode })

    const finishTimer = window.setTimeout(() => {
      if (finishTokenRef.current !== finishToken) return
      setShownView(to)
      setTransition(null)
    }, VIEW_TRANSITION_MS)

    return () => window.clearTimeout(finishTimer)
  }, [view, shownView])

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
        key={`out-${transition.from}`}
        className={`view-transition__layer view-transition__layer--out view-transition__layer--${transition.mode}`}
      >
        {children(transition.from)}
      </div>
      <div
        key={`in-${transition.to}`}
        className={`view-transition__layer view-transition__layer--in view-transition__layer--${transition.mode}`}
      >
        {children(transition.to)}
      </div>
      <div className="view-transition__curtain" aria-hidden />
    </div>
  )
}
