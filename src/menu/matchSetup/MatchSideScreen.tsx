import { useCallback, useState } from 'react'
import {
  DIFFICULTY_LABELS,
  DIFFICULTY_ORDER,
  type DifficultyId,
} from '../../game/systems/difficulty'
import { useAppStore } from '../../store/appStore'
import { useMatchSetupStore } from '../../store/matchSetupStore'
import { withMenuNavigate, withMenuSelect } from '../menuActions'
import { MenuPadHints } from '../components/MenuPadHints'
import { MenuShell } from '../components/MenuShell'
import { useMenuPad } from '../hooks/useMenuPad'

type FocusZone = 'side' | 'difficulty' | 'continue'

export function MatchSideScreen() {
  const setView = useAppStore((s) => s.setView)
  const playerSide = useMatchSetupStore((s) => s.draft?.playerSide ?? 'home')
  const difficulty = useMatchSetupStore((s) => s.draft?.difficulty ?? 'medium')
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

  const cycleDifficulty = useCallback(
    (direction: -1 | 1) => {
      const index = DIFFICULTY_ORDER.indexOf(difficulty)
      const next =
        DIFFICULTY_ORDER[
          (index + direction + DIFFICULTY_ORDER.length) % DIFFICULTY_ORDER.length
        ]
      patchDraft({ difficulty: next })
      setFocus('difficulty')
    },
    [difficulty, patchDraft],
  )

  const selectDifficulty = useCallback(
    (id: DifficultyId) => {
      patchDraft({ difficulty: id })
      setFocus('difficulty')
    },
    [patchDraft],
  )

  useMenuPad({
    onLeft: () => {
      if (focus === 'side') selectSide('home')
      else if (focus === 'difficulty') cycleDifficulty(-1)
    },
    onRight: () => {
      if (focus === 'side') selectSide('away')
      else if (focus === 'difficulty') cycleDifficulty(1)
    },
    onDown: () => {
      if (focus === 'side') setFocus('difficulty')
      else if (focus === 'difficulty') setFocus('continue')
    },
    onUp: () => {
      if (focus === 'continue') setFocus('difficulty')
      else if (focus === 'difficulty') setFocus('side')
    },
    onConfirm: focus === 'continue' ? confirm : undefined,
    onBack: goBack,
  })

  return (
    <MenuShell
      variant="wide"
      title="Seleção de lado"
      subtitle="Escolha mandante ou visitante e a dificuldade"
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
        <div className="prekick-sides__hint">
          ← → escolhe · ↓ dificuldade · continuar
        </div>
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

        <div
          className={`prekick-difficulty${focus === 'difficulty' ? ' prekick-difficulty--focused' : ''}`}
        >
          <span className="prekick-difficulty__label">Dificuldade</span>
          <div className="prekick-difficulty__options" role="listbox" aria-label="Dificuldade">
            {DIFFICULTY_ORDER.map((id) => (
              <button
                key={id}
                type="button"
                role="option"
                aria-selected={difficulty === id}
                className={`prekick-difficulty__chip${difficulty === id ? ' prekick-difficulty__chip--active' : ''}${focus === 'difficulty' && difficulty === id ? ' prekick-difficulty__chip--focused' : ''}`}
                onClick={withMenuNavigate(() => selectDifficulty(id))}
              >
                {DIFFICULTY_LABELS[id]}
              </button>
            ))}
          </div>
        </div>
      </div>
    </MenuShell>
  )
}
