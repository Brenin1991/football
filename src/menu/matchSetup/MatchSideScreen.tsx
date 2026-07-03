import { useCallback, useState } from 'react'
import { useAppStore } from '../../store/appStore'
import { useMatchSetupStore } from '../../store/matchSetupStore'
import { withMenuNavigate, withMenuSelect } from '../menuActions'
import { MenuPadHints } from '../components/MenuPadHints'
import { MenuShell } from '../components/MenuShell'
import { useMenuPad } from '../hooks/useMenuPad'

type FocusZone = 'side' | 'continue'

export function MatchSideScreen() {
  const setView = useAppStore((s) => s.setView)
  const playerSide = useMatchSetupStore((s) => s.draft?.playerSide ?? 'home')
  const patchDraft = useMatchSetupStore((s) => s.patchDraft)
  const setSetupStep = useMatchSetupStore((s) => s.setSetupStep)
  const backSetupStep = useMatchSetupStore((s) => s.backSetupStep)

  const [focus, setFocus] = useState<FocusZone>('side')

  const confirm = useCallback(() => {
    setSetupStep('team')
  }, [setSetupStep])

  const goBack = useCallback(() => {
    if (backSetupStep() === 'menu') setView('menu')
  }, [backSetupStep, setView])

  const selectSide = useCallback(
    (side: 'home' | 'away') => {
      patchDraft({ playerSide: side })
      setFocus('side')
    },
    [patchDraft],
  )

  useMenuPad({
    onLeft: () => selectSide('home'),
    onRight: () => selectSide('away'),
    onDown: () => setFocus('continue'),
    onUp: () => setFocus('side'),
    onConfirm: focus === 'continue' ? confirm : undefined,
    onBack: goBack,
  })

  return (
    <MenuShell
      variant="wide"
      title="Seleção de lado"
      subtitle="Escolha mandante ou visitante"
      padEnabled={false}
      onBack={goBack}
      footer={
        <>
          <MenuPadHints confirm="Continuar" back="Menu" />
          <button
            type="button"
            className={`menu-btn menu-btn--primary menu-btn--cta${focus === 'continue' ? ' menu-btn--focused' : ''}`}
            onClick={withMenuSelect(confirm)}
          >
            Continuar
          </button>
        </>
      }
    >
      <div className="prekick prekick--sides">
        <div className="prekick-sides__hint">← → escolhe o lado · ↓ continuar</div>
        <div className="prekick-sides__arena">
          <div
            role="button"
            tabIndex={-1}
            className={`prekick-side-panel prekick-side-panel--home${playerSide === 'home' ? ' prekick-side-panel--active' : ''}${focus === 'side' && playerSide === 'home' ? ' prekick-side-panel--focused' : ''}`}
            onClick={withMenuNavigate(() => selectSide('home'))}
          >
            <span className="prekick-side-panel__label">Mandante</span>
            <span className="prekick-side-panel__role">Home</span>
            {playerSide === 'home' ? <span className="prekick-side-panel__badge">Seu lado</span> : null}
          </div>

          <div className="prekick-sides__center" aria-hidden>
            <span className="prekick-sides__vs">VS</span>
          </div>

          <div
            role="button"
            tabIndex={-1}
            className={`prekick-side-panel prekick-side-panel--away${playerSide === 'away' ? ' prekick-side-panel--active' : ''}${focus === 'side' && playerSide === 'away' ? ' prekick-side-panel--focused' : ''}`}
            onClick={withMenuNavigate(() => selectSide('away'))}
          >
            <span className="prekick-side-panel__label">Visitante</span>
            <span className="prekick-side-panel__role">Away</span>
            {playerSide === 'away' ? <span className="prekick-side-panel__badge">Seu lado</span> : null}
          </div>
        </div>
      </div>
    </MenuShell>
  )
}
