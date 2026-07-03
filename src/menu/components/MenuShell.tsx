import type { ReactNode } from 'react'
import { GraphicsToggle } from '../../components/GraphicsToggle'
import { withMenuNavigate } from '../menuActions'
import { useMenuPad } from '../hooks/useMenuPad'

type MenuShellProps = {
  title: string
  subtitle?: string
  onBack?: () => void
  backLabel?: string
  variant?: 'default' | 'wide'
  padEnabled?: boolean
  children: ReactNode
  footer?: ReactNode
}

export function MenuShell({
  title,
  subtitle,
  onBack,
  backLabel = 'Voltar',
  variant = 'default',
  padEnabled = true,
  children,
  footer,
}: MenuShellProps) {
  useMenuPad({
    enabled: padEnabled && Boolean(onBack),
    onBack,
  })

  return (
    <div className={`menu-screen menu-screen--shell menu-screen--shell-${variant}`}>
      <div className="menu-screen__stadium" aria-hidden />
      <div className="menu-screen__vignette" aria-hidden />

      <div className={`menu-shell menu-shell--${variant} pes-hud-surface menu-anim menu-anim--shell`}>
        <header className="menu-shell__header">
          {onBack ? (
            <button
              type="button"
              className="menu-btn menu-btn--ghost menu-btn--back"
              onClick={onBack ? withMenuNavigate(onBack) : undefined}
            >
              ‹ {backLabel}
            </button>
          ) : (
            <span />
          )}
          <div className="menu-shell__titles">
            <h1>{title}</h1>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <GraphicsToggle />
        </header>

        <div className="menu-shell__body">{children}</div>

        {footer ? <footer className="menu-shell__footer">{footer}</footer> : null}
      </div>
    </div>
  )
}
