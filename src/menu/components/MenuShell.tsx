import { useLayoutEffect, useMemo, useRef, type CSSProperties, type ReactNode } from 'react'
import { GraphicsToggle } from '../../components/GraphicsToggle'
import { getDatabase } from '../../db/database'
import { getTeam, listTeamKits } from '../../db/queries'
import { useAppStore } from '../../store/appStore'
import { useMatchSetupStore } from '../../store/matchSetupStore'
import { MenuPadHints } from './MenuPadHints'
import { useMenuPad } from '../hooks/useMenuPad'
import { tweenElement } from '../menuTween'
import { isViewTransitionActive } from '../viewTransition'

type MenuShellProps = {
  title: string
  subtitle?: string
  backgroundColors?: {
    home: string
    homeSecondary: string
    away: string
    awaySecondary: string
  }
  onBack?: () => void
  backLabel?: string
  confirmLabel?: string
  variant?: 'default' | 'wide'
  padEnabled?: boolean
  children: ReactNode
  footer?: ReactNode
  showDefaultHints?: boolean
  /** Fundo com imagem do estádio (desligar em overlays in-game). */
  showStadium?: boolean
  /** Entrada header/body/footer + itens (mesmo padrão do match setup). */
  animateEntrance?: boolean
  /** Re-dispara a entrada quando muda (painéis do pause, etc.). */
  entranceKey?: string | number
}

export function MenuShell({
  title,
  subtitle,
  backgroundColors,
  onBack,
  backLabel = 'Voltar',
  confirmLabel,
  variant: _variant = 'default',
  padEnabled = true,
  children,
  footer,
  showDefaultHints = true,
  showStadium = true,
  animateEntrance = false,
  entranceKey,
}: MenuShellProps) {
  void _variant
  const rootRef = useRef<HTMLDivElement>(null)

  useMenuPad({
    enabled: padEnabled && Boolean(onBack),
    onBack,
  })

  const draft = useMatchSetupStore((state) => state.draft)
  const dbVersion = useAppStore((state) => state.dbVersion)
  const savedBackgroundColors = useMemo(() => {
    void dbVersion
    if (!draft?.homeTeamId && !draft?.awayTeamId) return undefined

    const db = getDatabase()
    const sideColors = (teamId: string | null, kitNumber: 1 | 2) => {
      if (!teamId) return { primary: '#343b46', secondary: '#111820' }
      const team = getTeam(db, teamId)
      const kit = listTeamKits(db, teamId).find((entry) => entry.kitNumber === kitNumber)
      return {
        primary: kit?.shirtColor ?? team?.primaryColor ?? '#343b46',
        secondary: kit?.shortsColor ?? team?.secondaryColor ?? '#111820',
      }
    }

    const home = sideColors(draft.homeTeamId, draft.homeKit)
    const away = sideColors(draft.awayTeamId, draft.awayKit)
    return {
      home: home.primary,
      homeSecondary: home.secondary,
      away: away.primary,
      awaySecondary: away.secondary,
    }
  }, [
    dbVersion,
    draft?.awayKit,
    draft?.awayTeamId,
    draft?.homeKit,
    draft?.homeTeamId,
  ])

  useLayoutEffect(() => {
    if (!animateEntrance) return
    const root = rootRef.current
    if (!root) return
    if (isViewTransitionActive()) return

    const animations: Array<{
      selector: string
      from: { opacity: number; x?: number; y?: number; scale?: number }
      delay: number
      all?: boolean
    }> = [
      { selector: '.fifa-header', from: { opacity: 0, y: -18 }, delay: 0 },
      { selector: '.fifa-footer', from: { opacity: 0, y: 18 }, delay: 110 },
      { selector: '.fifa-trap', from: { opacity: 0, x: -28 }, delay: 70, all: true },
      {
        selector: '.fifa-pause__panel, .fifa-squad__frame, .fifa-pause__nav .fifa-main__hint',
        from: { opacity: 0, y: 16 },
        delay: 100,
        all: true,
      },
    ]

    const cancelTweens = animations.flatMap(({ selector, from, delay, all }) => {
      if (all) {
        return Array.from(root.querySelectorAll<HTMLElement>(selector)).map((element, index) =>
          tweenElement(element, from, { duration: 430, delay: delay + index * 42 }),
        )
      }
      const element = root.querySelector<HTMLElement>(selector)
      return element ? [tweenElement(element, from, { duration: 430, delay })] : []
    })

    return () => cancelTweens.forEach((cancel) => cancel())
  }, [animateEntrance, entranceKey])

  const appliedBackgroundColors = backgroundColors ?? savedBackgroundColors
  const screenStyle = appliedBackgroundColors
    ? ({
        '--fifa-bg-home': appliedBackgroundColors.home,
        '--fifa-bg-home-secondary': appliedBackgroundColors.homeSecondary,
        '--fifa-bg-away': appliedBackgroundColors.away,
        '--fifa-bg-away-secondary': appliedBackgroundColors.awaySecondary,
      } as CSSProperties)
    : undefined

  return (
    <div
      ref={rootRef}
      className={`fifa-screen${showStadium ? '' : ' fifa-screen--overlay'}`}
      style={screenStyle}
    >
      {showStadium ? <div className="fifa-screen__stadium" aria-hidden /> : null}
      <div className="fifa-screen__vignette" aria-hidden />

      <div className="fifa-shell">
        <header className="fifa-header">
          <h1 className="fifa-header__title">{title}</h1>
          {subtitle ? <p className="fifa-header__sub">{subtitle}</p> : <span />}
          <div className="fifa-header__right">
            <GraphicsToggle />
          </div>
        </header>

        <div className="fifa-body">{children}</div>

        <footer className="fifa-footer">
          {showDefaultHints && !footer ? (
            <MenuPadHints confirm={confirmLabel ?? 'Confirmar'} back={backLabel} />
          ) : (
            footer ?? <span />
          )}
        </footer>
      </div>
    </div>
  )
}
