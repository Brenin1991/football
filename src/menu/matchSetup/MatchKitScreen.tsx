import { useCallback, useMemo, useState } from 'react'
import { listTeamKits } from '../../db/queries'
import { getDatabase } from '../../db/database'
import type { Team, TeamKit } from '../../db/types'
import { useAppStore } from '../../store/appStore'
import { useMatchSetupStore } from '../../store/matchSetupStore'
import { EntityImage } from '../../components/EntityImage'
import { withMenuSelect } from '../menuActions'
import { MenuPadHints } from '../components/MenuPadHints'
import { MenuShell } from '../components/MenuShell'
import { useMenuPad } from '../hooks/useMenuPad'
import { useMatchSetupData } from './useMatchSetupData'

type FocusZone = 'home-kit' | 'away-kit' | 'continue'

const FOCUS_ORDER: FocusZone[] = ['home-kit', 'away-kit', 'continue']

function kitColors(kits: TeamKit[], kitNumber: 1 | 2, team: Team | null) {
  const kit = kits.find((entry) => entry.kitNumber === kitNumber)
  return {
    shirt: kit?.shirtColor ?? team?.primaryColor ?? '#1a4fa0',
    shorts: kit?.shortsColor ?? team?.secondaryColor ?? '#ffffff',
    socks: kit?.socksColor ?? team?.primaryColor ?? '#1a4fa0',
  }
}

export function MatchKitScreen() {
  const dbVersion = useAppStore((s) => s.dbVersion)
  const setView = useAppStore((s) => s.setView)
  const draft = useMatchSetupStore((s) => s.draft)
  const patchDraft = useMatchSetupStore((s) => s.patchDraft)
  const setSetupStep = useMatchSetupStore((s) => s.setSetupStep)
  const backSetupStep = useMatchSetupStore((s) => s.backSetupStep)
  const { teams } = useMatchSetupData()

  const homeTeamId = draft?.homeTeamId ?? ''
  const awayTeamId = draft?.awayTeamId ?? ''
  const homeKit = draft?.homeKit ?? 1
  const awayKit = draft?.awayKit ?? 2

  const [focus, setFocus] = useState<FocusZone>('home-kit')

  const homeTeam = teams.find((team) => team.id === homeTeamId) ?? null
  const awayTeam = teams.find((team) => team.id === awayTeamId) ?? null

  const kits = useMemo(() => {
    void dbVersion
    const db = getDatabase()
    return {
      home: homeTeamId ? listTeamKits(db, homeTeamId) : [],
      away: awayTeamId ? listTeamKits(db, awayTeamId) : [],
    }
  }, [awayTeamId, dbVersion, homeTeamId])

  const confirm = useCallback(() => {
    setSetupStep('loading')
  }, [setSetupStep])

  const goBack = useCallback(() => {
    if (backSetupStep() === 'menu') setView('menu')
  }, [backSetupStep, setView])

  const cycleKit = useCallback(
    (side: 'home' | 'away', direction: -1 | 1) => {
      const current = side === 'home' ? homeKit : awayKit
      const next = current === 1 ? 2 : 1
      void direction
      patchDraft(side === 'home' ? { homeKit: next } : { awayKit: next })
    },
    [awayKit, homeKit, patchDraft],
  )

  const moveFocus = useCallback((delta: -1 | 1) => {
    setFocus((current) => {
      const index = FOCUS_ORDER.indexOf(current)
      return FOCUS_ORDER[(index + delta + FOCUS_ORDER.length) % FOCUS_ORDER.length]
    })
  }, [])

  useMenuPad({
    onUp: () => moveFocus(-1),
    onDown: () => moveFocus(1),
    onLeft: () => {
      if (focus === 'home-kit') cycleKit('home', -1)
      if (focus === 'away-kit') cycleKit('away', -1)
    },
    onRight: () => {
      if (focus === 'home-kit') cycleKit('home', 1)
      if (focus === 'away-kit') cycleKit('away', 1)
    },
    onConfirm: focus === 'continue' ? confirm : undefined,
    onBack: goBack,
  })

  const homeColors = kitColors(kits.home, homeKit, homeTeam)
  const awayColors = kitColors(kits.away, awayKit, awayTeam)

  return (
    <MenuShell
      variant="wide"
      title="Uniformes"
      subtitle="← → troca titular / reserva"
      padEnabled={false}
      onBack={goBack}
      footer={
        <>
          <MenuPadHints confirm="Iniciar" back="Times" />
          <button
            type="button"
            className={`menu-btn menu-btn--primary menu-btn--cta${focus === 'continue' ? ' menu-btn--focused' : ''}`}
            onClick={withMenuSelect(confirm)}
          >
            Iniciar partida
          </button>
        </>
      }
    >
      <div className="prekick prekick--kits">
        <div className="prekick-kits__compare menu-anim menu-anim--compare">
          <KitPanel
            side="home"
            label="Mandante"
            team={homeTeam}
            kitNumber={homeKit}
            colors={homeColors}
            refreshKey={dbVersion}
            focused={focus === 'home-kit'}
          />
          <span className="prekick-kits__vs">VS</span>
          <KitPanel
            side="away"
            label="Visitante"
            team={awayTeam}
            kitNumber={awayKit}
            colors={awayColors}
            refreshKey={dbVersion}
            focused={focus === 'away-kit'}
          />
        </div>
      </div>
    </MenuShell>
  )
}

function KitPanel({
  side,
  label,
  team,
  kitNumber,
  colors,
  refreshKey,
  focused,
}: {
  side: 'home' | 'away'
  label: string
  team: Team | null
  kitNumber: 1 | 2
  colors: { shirt: string; shorts: string; socks: string }
  refreshKey: number
  focused: boolean
}) {
  return (
    <section
      className={`prekick-kit-panel prekick-kit-panel--${side}${focused ? ' prekick-kit-panel--focused' : ''}`}
    >
      <span className="prekick-kit-panel__label">{label}</span>
      {team ? (
        <EntityImage
          entityType="team"
          entityId={team.id}
          alt={team.name}
          refreshKey={refreshKey}
          className="prekick-kit-panel__crest"
          fallback={<div className="prekick-kit-panel__crest prekick-kit-panel__crest--empty" />}
        />
      ) : (
        <div className="prekick-kit-panel__crest prekick-kit-panel__crest--empty" />
      )}
      <JerseyPreview colors={colors} />
      <span className="prekick-kit-panel__kit-name">
        {kitNumber === 1 ? 'Titular' : 'Reserva'}
      </span>
    </section>
  )
}

function JerseyPreview({ colors }: { colors: { shirt: string; shorts: string; socks: string } }) {
  return (
    <div className="prekick-jersey" aria-hidden>
      <div className="prekick-jersey__shirt" style={{ backgroundColor: colors.shirt }} />
      <div className="prekick-jersey__shorts" style={{ backgroundColor: colors.shorts }} />
      <div className="prekick-jersey__socks" style={{ backgroundColor: colors.socks }} />
    </div>
  )
}
