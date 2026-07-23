import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { useAppStore } from '../store/appStore'
import { useMatchSetupStore } from '../store/matchSetupStore'
import { GraphicsToggle } from '../components/GraphicsToggle'
import { withMenuNavigate, withMenuSelect } from './menuActions'
import { MenuPadHints } from './components/MenuPadHints'
import { useMenuPad } from './hooks/useMenuPad'
import { tweenElement } from './menuTween'
import { isViewTransitionActive } from './viewTransition'

const MENU_ITEMS = [
  {
    id: 'match',
    label: 'PARTIDA',
    hint: 'Escolha lado, times e uniformes.',
    view: 'match-setup' as const,
  },
  {
    id: 'editor',
    label: 'EDITAR',
    hint: 'Edições, ligas, times e elencos.',
    view: 'editor' as const,
  },
]

export function MainMenu() {
  const rootRef = useRef<HTMLDivElement>(null)
  const setView = useAppStore((s) => s.setView)
  const startSetup = useMatchSetupStore((s) => s.startSetup)
  const [focusIndex, setFocusIndex] = useState(0)
  const focused = MENU_ITEMS[focusIndex]

  const openMatchSetup = useCallback(() => {
    startSetup()
    setView('match-setup')
  }, [setView, startSetup])

  const confirm = useCallback(() => {
    if (focused.view === 'match-setup') {
      openMatchSetup()
      return
    }
    setView(focused.view)
  }, [focused.view, openMatchSetup, setView])

  useMenuPad({
    onUp: () => setFocusIndex((index) => (index - 1 + MENU_ITEMS.length) % MENU_ITEMS.length),
    onDown: () => setFocusIndex((index) => (index + 1) % MENU_ITEMS.length),
    onConfirm: confirm,
  })

  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return
    // Let the view transition own the motion when arriving from another screen.
    if (isViewTransitionActive()) return

    const animations = [
      { selector: '.fifa-main__graphics', from: { opacity: 0, y: -14 }, delay: 40 },
      { selector: '.fifa-main__brand', from: { opacity: 0, x: -34 }, delay: 40 },
      { selector: '.fifa-main__nav', from: { opacity: 0, x: -42 }, delay: 100 },
      { selector: '.fifa-main__hint', from: { opacity: 0, y: 14 }, delay: 170 },
      { selector: '.fifa-main__bar', from: { opacity: 0, y: 20 }, delay: 210 },
    ]

    const cancelTweens = animations.flatMap(({ selector, from, delay }) => {
      const element = root.querySelector<HTMLElement>(selector)
      return element ? [tweenElement(element, from, { duration: 470, delay })] : []
    })

    return () => cancelTweens.forEach((cancel) => cancel())
  }, [])

  return (
    <div ref={rootRef} className="fifa-screen">
      <div className="fifa-screen__stadium" aria-hidden />
      <div className="fifa-screen__vignette" aria-hidden />

      <div className="fifa-main__graphics">
        <GraphicsToggle />
      </div>

      <div className="fifa-main">
        <div className="fifa-main__left">
          {/* <header className="fifa-main__brand">
            <span className="fifa-main__logo-mark">FUTEBOL</span>
            <span className="fifa-main__logo-sub">KICK OFF</span>
          </header> */}

          <nav className="fifa-main__nav" aria-label="Menu principal">
            {MENU_ITEMS.map((item, index) => {
              const active = index === focusIndex
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`fifa-trap${active ? ' fifa-trap--active' : ''}`}
                  onMouseEnter={withMenuNavigate(() => {
                    if (index !== focusIndex) setFocusIndex(index)
                  })}
                  onFocus={withMenuNavigate(() => {
                    if (index !== focusIndex) setFocusIndex(index)
                  })}
                  onClick={withMenuSelect(() => {
                    if (item.view === 'match-setup') {
                      openMatchSetup()
                      return
                    }
                    setView(item.view)
                  })}
                >
                  {item.label}
                </button>
              )
            })}
          </nav>

          <p className="fifa-main__hint">{focused.hint}</p>
        </div>

        

        <footer className="fifa-main__bar">
          <MenuPadHints confirm="Selecionar" back="Sair" />
          <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.12em', color: 'var(--fifa-muted)' }}>
            V1.0.0
          </span>
        </footer>
      </div>
    </div>
  )
}
