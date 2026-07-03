import { useCallback, useState } from 'react'
import { useAppStore } from '../store/appStore'
import { useMatchSetupStore } from '../store/matchSetupStore'
import { GraphicsToggle } from '../components/GraphicsToggle'
import { withMenuNavigate, withMenuSelect } from './menuActions'
import { MenuPadHints } from './components/MenuPadHints'
import { useMenuPad } from './hooks/useMenuPad'

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

  return (
    <div className="menu-screen menu-screen--pes menu-screen--enter">
      <div className="menu-screen__stadium" aria-hidden />
      <div className="menu-screen__vignette" aria-hidden />

      <div className="pes-main">
        <header className="pes-main__brand menu-anim menu-anim--logo">
          <div className="pes-main__logo">
            <span className="pes-main__logo-mark">FUT</span>
            <span className="pes-main__logo-edition">EBOL</span>
          </div>
        </header>

        <nav className="pes-main__nav" aria-label="Menu principal">
          {MENU_ITEMS.map((item, index) => {
            const active = index === focusIndex
            return (
              <button
                key={item.id}
                type="button"
                className={`pes-main__item menu-anim menu-anim--nav${active ? ' pes-main__item--active' : ''}`}
                style={{ animationDelay: `${120 + index * 70}ms` }}
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
                {active ? <span className="pes-main__bullet" aria-hidden /> : null}
                <span className="pes-main__item-label">{item.label}</span>
              </button>
            )
          })}
        </nav>

        <footer className="pes-main__footer menu-anim menu-anim--footer">
          <p>{focused.hint}</p>
          <MenuPadHints />
        </footer>
      </div>

      <div className="pes-main__graphics">
        <GraphicsToggle />
      </div>
    </div>
  )
}
