import { useCallback, useState } from 'react'
import { useAppStore } from '../../store/appStore'
import { useMatchSetupStore } from '../../store/matchSetupStore'
import { withMenuNavigate, withMenuSelect } from '../menuActions'
import { MenuPadHints } from '../components/MenuPadHints'
import { MenuShell } from '../components/MenuShell'
import { useMenuPad } from '../hooks/useMenuPad'

export function MatchSideScreen() {
  const setView = useAppStore((s) => s.setView)
  const playerSide = useMatchSetupStore((s) => s.draft?.playerSide ?? 'home')
  const patchDraft = useMatchSetupStore((s) => s.patchDraft)
  const setSetupStep = useMatchSetupStore((s) => s.setSetupStep)
  const backSetupStep = useMatchSetupStore((s) => s.backSetupStep)

  const [focusContinue, setFocusContinue] = useState(false)

  const confirm = useCallback(() => {
    setSetupStep('team')
  }, [setSetupStep])

  const goBack = useCallback(() => {
    if (backSetupStep() === 'menu') setView('menu')
  }, [backSetupStep, setView])

  const selectSide = useCallback(
    (side: 'home' | 'away') => {
      patchDraft({ playerSide: side })
      setFocusContinue(false)
    },
    [patchDraft],
  )

  useMenuPad({
    onLeft: () => selectSide('home'),
    onRight: () => selectSide('away'),
    onDown: () => setFocusContinue(true),
    onUp: () => setFocusContinue(false),
    onConfirm: confirm,
    onBack: goBack,
  })

  return (
    <MenuShell
      variant="wide"
      title="Select Sides"
      subtitle="← → escolhe o lado"
      padEnabled={false}
      onBack={goBack}
      footer={
        <>
          <MenuPadHints confirm="Continuar" back="Menu" />
          <button
            type="button"
            className={`fifa-cta${focusContinue ? ' fifa-cta--focused' : ''}`}
            onClick={withMenuSelect(confirm)}
          >
            Continuar
          </button>
        </>
      }
    >
      <div className="fifa-sides">
        <div className="fifa-sides__arena">
          <div
            role="button"
            tabIndex={-1}
            className={`fifa-side-panel fifa-side-panel--home${playerSide === 'home' ? ' fifa-side-panel--active' : ''}${!focusContinue && playerSide === 'home' ? ' fifa-side-panel--focused' : ''}`}
            onClick={withMenuNavigate(() => selectSide('home'))}
          >
            <span className="fifa-side-panel__label">Mandante</span>
            <span className="fifa-side-panel__role">Home</span>
            <div className="fifa-side-panel__pad" aria-hidden>
              {playerSide === 'home' ? 'P1' : 'CPU'}
            </div>
          </div>

          <div className="fifa-sides__vs" aria-hidden>
            VS
          </div>

          <div
            role="button"
            tabIndex={-1}
            className={`fifa-side-panel fifa-side-panel--away${playerSide === 'away' ? ' fifa-side-panel--active' : ''}${!focusContinue && playerSide === 'away' ? ' fifa-side-panel--focused' : ''}`}
            onClick={withMenuNavigate(() => selectSide('away'))}
          >
            <span className="fifa-side-panel__label">Visitante</span>
            <span className="fifa-side-panel__role">Away</span>
            <div className="fifa-side-panel__pad" aria-hidden>
              {playerSide === 'away' ? 'P1' : 'CPU'}
            </div>
          </div>
        </div>
      </div>
    </MenuShell>
  )
}
