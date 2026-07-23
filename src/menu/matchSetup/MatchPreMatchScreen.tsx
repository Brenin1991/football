import { useCallback, useEffect, useMemo, useState } from 'react'
import { listRoster, listTeamKits } from '../../db/queries'
import { getDatabase } from '../../db/database'
import type { Team, TeamKit } from '../../db/types'
import {
  DIFFICULTY_LABELS,
  DIFFICULTY_ORDER,
} from '../../game/systems/difficulty'
import { useAppStore } from '../../store/appStore'
import {
  type ControlMode,
  useMatchSetupStore,
} from '../../store/matchSetupStore'
import { withMenuNavigate, withMenuSelect } from '../menuActions'
import { MenuPadHints } from '../components/MenuPadHints'
import { MenuShell } from '../components/MenuShell'
import { useMenuPad } from '../hooks/useMenuPad'
import { useMatchSetupData } from './useMatchSetupData'

type MenuItem = 'start' | 'management' | 'player' | 'kits' | 'mode' | 'difficulty'

const BASE_MENU_ITEMS: { id: MenuItem; label: string }[] = [
  { id: 'start', label: 'Start Match' },
  { id: 'management', label: 'Gerenciar time' },
  { id: 'kits', label: 'Select Kits' },
  { id: 'mode', label: 'Control Mode' },
  { id: 'difficulty', label: 'Difficulty' },
]

const CONTROL_MODES: { id: ControlMode; label: string }[] = [
  { id: 'team', label: 'Team' },
  { id: 'pro', label: 'Pro' },
]

function kitColors(kits: TeamKit[], kitNumber: 1 | 2, team: Team | null) {
  const kit = kits.find((entry) => entry.kitNumber === kitNumber)
  return {
    shirt: kit?.shirtColor ?? team?.primaryColor ?? '#1a4fa0',
    shorts: kit?.shortsColor ?? team?.secondaryColor ?? '#ffffff',
    socks: kit?.socksColor ?? team?.primaryColor ?? '#1a4fa0',
  }
}

export function MatchPreMatchScreen() {
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
  const difficulty = draft?.difficulty ?? 'medium'
  const controlMode = draft?.controlMode ?? 'team'
  const playerSide = draft?.playerSide ?? 'home'
  const proSlotIndex = draft?.proSlotIndex ?? 9

  const menuItems = useMemo(() => {
    if (controlMode !== 'pro') return BASE_MENU_ITEMS
    return [
      ...BASE_MENU_ITEMS.slice(0, 2),
      { id: 'player' as const, label: 'Selecionar jogador' },
      ...BASE_MENU_ITEMS.slice(2),
    ]
  }, [controlMode])

  const [menuIndex, setMenuIndex] = useState(0)
  const focused = menuItems[menuIndex]?.id ?? 'start'

  useEffect(() => {
    setMenuIndex((index) => Math.min(index, menuItems.length - 1))
  }, [menuItems.length])

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

  const homeColors = kitColors(kits.home, homeKit, homeTeam)
  const awayColors = kitColors(kits.away, awayKit, awayTeam)
  const proTeamId = playerSide === 'home' ? homeTeamId : awayTeamId
  const proPlayer = useMemo(() => {
    void dbVersion
    if (!proTeamId) return null
    return listRoster(getDatabase(), proTeamId).find((slot) => slot.slotIndex === proSlotIndex) ?? null
  }, [dbVersion, proSlotIndex, proTeamId])

  const confirmStart = useCallback(() => {
    const mode = useMatchSetupStore.getState().draft?.controlMode ?? 'team'
    setSetupStep(mode === 'pro' ? 'player' : 'loading')
  }, [setSetupStep])

  const goBack = useCallback(() => {
    if (backSetupStep() === 'menu') setView('menu')
  }, [backSetupStep, setView])

  const cycleMode = useCallback(
    (direction: -1 | 1) => {
      const index = CONTROL_MODES.findIndex((m) => m.id === controlMode)
      const next =
        CONTROL_MODES[(index + direction + CONTROL_MODES.length) % CONTROL_MODES.length]
      patchDraft({ controlMode: next.id })
    },
    [controlMode, patchDraft],
  )

  const cycleDifficulty = useCallback(
    (direction: -1 | 1) => {
      const index = DIFFICULTY_ORDER.indexOf(difficulty)
      const next =
        DIFFICULTY_ORDER[(index + direction + DIFFICULTY_ORDER.length) % DIFFICULTY_ORDER.length]
      patchDraft({ difficulty: next })
    },
    [difficulty, patchDraft],
  )

  const cycleKits = useCallback(
    (direction: -1 | 1) => {
      if (direction < 0) {
        patchDraft({ homeKit: homeKit === 1 ? 2 : 1 })
      } else {
        patchDraft({ awayKit: awayKit === 1 ? 2 : 1 })
      }
    },
    [awayKit, homeKit, patchDraft],
  )

  const onConfirm = useCallback(() => {
    if (focused === 'start') {
      confirmStart()
      return
    }
    if (focused === 'management') setView('team-management')
    else if (focused === 'player') setSetupStep('player')
    else if (focused === 'mode') cycleMode(1)
    else if (focused === 'difficulty') cycleDifficulty(1)
    else if (focused === 'kits') cycleKits(1)
  }, [confirmStart, cycleDifficulty, cycleKits, cycleMode, focused, setSetupStep, setView])

  useMenuPad({
    onUp: () => setMenuIndex((i) => (i - 1 + menuItems.length) % menuItems.length),
    onDown: () => setMenuIndex((i) => (i + 1) % menuItems.length),
    onLeft: () => {
      if (focused === 'player' || focused === 'management') return
      if (focused === 'mode') cycleMode(-1)
      else if (focused === 'difficulty') cycleDifficulty(-1)
      else if (focused === 'kits') cycleKits(-1)
      else cycleKits(-1)
    },
    onRight: () => {
      if (focused === 'player' || focused === 'management') return
      if (focused === 'mode') cycleMode(1)
      else if (focused === 'difficulty') cycleDifficulty(1)
      else if (focused === 'kits') cycleKits(1)
      else cycleKits(1)
    },
    onConfirm,
    onBack: goBack,
  })

  const modeLabel = CONTROL_MODES.find((m) => m.id === controlMode)?.label ?? 'Team'
  const sideLabel = playerSide === 'home' ? 'Home' : 'Away'

  return (
    <MenuShell
      variant="wide"
      title="Pre-Match Central"
      subtitle="L / R Select Kits"
      padEnabled={false}
      onBack={goBack}
      footer={
        <MenuPadHints confirm="Select" back="Times" />
      }
    >
      <div className="fifa-pm">
        <div className="fifa-pm__panel">
          <header className="fifa-pm__section-header">
            <span>Resumo da partida</span>
            <strong>
              {homeTeam?.shortName ?? homeTeam?.name ?? 'Mandante'}
              <i>VS</i>
              {awayTeam?.shortName ?? awayTeam?.name ?? 'Visitante'}
            </strong>
          </header>

          <div className="fifa-pm__kits">
            <JerseyBlock
              team={homeTeam}
              kitLabel={homeKit === 1 ? 'Home' : 'Away'}
              colors={homeColors}
              side="home"
            />
            <span className="fifa-pm__vs">VS</span>
            <JerseyBlock
              team={awayTeam}
              kitLabel={awayKit === 1 ? 'Home' : 'Away'}
              colors={awayColors}
              side="away"
            />
          </div>

          <div className="fifa-pm__info">
            <div className="fifa-pm__bar">
              <span>Half Length</span>
              <strong>5 mins</strong>
            </div>
            <div className="fifa-pm__bar fifa-pm__bar--split">
              <span>
                Location <strong>Arena Municipal</strong>
              </span>
              <span>
                Side <strong>{sideLabel}</strong>
              </span>
            </div>
            <div className="fifa-pm__bar fifa-pm__bar--split">
              <span>
                Mode <strong>{modeLabel}</strong>
              </span>
              <span>
                Difficulty <strong>{DIFFICULTY_LABELS[difficulty]}</strong>
              </span>
            </div>
          </div>

          <nav className="fifa-pm__menu" aria-label="Pre-match">
            {menuItems.map((item, index) => {
              const active = index === menuIndex
              let value = ''
              if (item.id === 'management') {
                const managedTeam = playerSide === 'home' ? homeTeam : awayTeam
                value = managedTeam?.shortName ?? managedTeam?.name ?? 'Time'
              } else if (item.id === 'player') {
                value = proPlayer?.name ?? 'Escolher'
              } else if (item.id === 'kits') {
                value = `${homeKit === 1 ? 'H' : 'A'} · ${awayKit === 1 ? 'H' : 'A'}`
              } else if (item.id === 'mode') {
                value = modeLabel
              } else if (item.id === 'difficulty') {
                value = DIFFICULTY_LABELS[difficulty]
              }

              return (
                <button
                  key={item.id}
                  type="button"
                  className={`fifa-pm__item${active ? ' fifa-pm__item--active' : ''}`}
                  onMouseEnter={withMenuNavigate(() => {
                    if (index !== menuIndex) setMenuIndex(index)
                  })}
                  onClick={withMenuSelect(() => {
                    setMenuIndex(index)
                    if (item.id === 'start') confirmStart()
                    else if (item.id === 'management') setView('team-management')
                    else if (item.id === 'player') setSetupStep('player')
                    else if (item.id === 'mode') cycleMode(1)
                    else if (item.id === 'difficulty') cycleDifficulty(1)
                    else cycleKits(1)
                  })}
                >
                  <span>{item.label}</span>
                  {value ? <span className="fifa-pm__item-value">{value}</span> : null}
                </button>
              )
            })}
          </nav>
        </div>
      </div>
    </MenuShell>
  )
}

function JerseyBlock({
  team,
  kitLabel,
  colors,
  side,
}: {
  team: Team | null
  kitLabel: string
  colors: { shirt: string; shorts: string; socks: string }
  side: 'home' | 'away'
}) {
  return (
    <div className={`fifa-pm-jersey fifa-pm-jersey--${side}`}>
      <div className="fifa-pm-jersey__shirt" style={{ backgroundColor: colors.shirt }}>
        <span className="fifa-pm-jersey__sleeve" style={{ backgroundColor: colors.shorts }} />
        <span className="fifa-pm-jersey__sleeve fifa-pm-jersey__sleeve--r" style={{ backgroundColor: colors.shorts }} />
      </div>
      <div className="fifa-pm-jersey__shorts" style={{ backgroundColor: colors.shorts }} />
      <div className="fifa-pm-jersey__socks" style={{ backgroundColor: colors.socks }} />
      <span className="fifa-pm-jersey__name">{team?.shortName ?? team?.name ?? '—'}</span>
      <span className="fifa-pm-jersey__kit">{kitLabel}</span>
    </div>
  )
}
