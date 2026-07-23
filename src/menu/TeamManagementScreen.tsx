import { useCallback, useEffect, useMemo, useState } from 'react'
import { EntityImage } from '../components/EntityImage'
import { getDatabase } from '../db/database'
import {
  applyFormationPreset,
  getTeamTactics,
  listFormationSlots,
  listRoster,
  swapRosterSlots,
  updatePlayerInstructions,
  updateTeamTactics,
} from '../db/queries'
import type { RosterSlot, TeamTactics } from '../db/types'
import {
  FORMATION_PRESET_LIST,
  STARTING_XI_SIZE,
  type AttackingRunsId,
  type BuildUpId,
  type ChanceCreationId,
  type DefensiveStyleId,
  type FormationPresetId,
  type InterceptionsId,
  type MentalityId,
  type PlayerInstructionsData,
  type PositioningFreedomId,
  type SupportRunsId,
} from '../game/data/formations'
import { getPlayerStamina } from '../game/systems/playerStamina'
import { useAppStore } from '../store/appStore'
import { useMatchSetupStore } from '../store/matchSetupStore'
import { useGameStore } from '../game/store/gameStore'
import { resyncLiveTeamFromDatabase } from '../game/systems/teamTactics'
import { MenuPadHints } from './components/MenuPadHints'
import { MenuShell } from './components/MenuShell'
import { useMenuPad } from './hooks/useMenuPad'
import { useMatchSetupData } from './matchSetup/useMatchSetupData'
import { deriveTeamRatings } from './matchSetup/teamRatings'

function playerOverall(player: RosterSlot) {
  return player.overall || 65
}

type FatigueBand = {
  id: 'fresh' | 'good' | 'medium' | 'tired' | 'exhausted'
  label: string
}

function teamFatigueFromAvg(avg: number): FatigueBand {
  if (avg >= 0.72) return { id: 'fresh', label: 'Frescos' }
  if (avg >= 0.55) return { id: 'good', label: 'Bom' }
  if (avg >= 0.38) return { id: 'medium', label: 'Cansados' }
  if (avg >= 0.2) return { id: 'tired', label: 'Muito cansados' }
  return { id: 'exhausted', label: 'Exaustos' }
}

function PlayerStaminaBar({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(100, Math.round(value * 100)))
  const tone =
    value <= 0.32 ? 'low' : value <= 0.5 ? 'mid' : value <= 0.72 ? 'ok' : 'full'
  return (
    <span
      className={`fifa-squad__stam fifa-squad__stam--${tone}`}
      aria-label={`Fadiga ${pct}%`}
      title={`Fadiga ${pct}%`}
    >
      <i style={{ width: `${pct}%` }} />
    </span>
  )
}

const MENTALITY_OPTIONS: Array<[MentalityId, string]> = [
  ['ultra_def', 'Ultra defensivo'],
  ['defensive', 'Defensivo'],
  ['balanced', 'Equilibrado'],
  ['attacking', 'Ofensivo'],
  ['ultra_att', 'Ultra ofensivo'],
]

const BUILD_UP_OPTIONS: Array<[BuildUpId, string]> = [
  ['short', 'Curto'],
  ['mixed', 'Misto'],
  ['long', 'Longo'],
]

const CHANCE_CREATION_OPTIONS: Array<[ChanceCreationId, string]> = [
  ['possession', 'Posse de bola'],
  ['balanced', 'Equilibrado'],
  ['direct', 'Direto'],
  ['forward_runs', 'Corridas de infiltração'],
]

const DEFENSIVE_STYLE_OPTIONS: Array<[DefensiveStyleId, string]> = [
  ['drop_back', 'Recuar linha'],
  ['balanced', 'Equilibrado'],
  ['press', 'Pressão'],
  ['constant_press', 'Pressão constante'],
]

const SUPPORT_RUNS_OPTIONS: Array<[SupportRunsId, string]> = [
  ['stay_back', 'Ficar atrás'],
  ['balanced', 'Equilibrado'],
  ['get_forward', 'Avançar'],
  ['free_roam', 'Liberdade total'],
]

const ATTACKING_RUNS_OPTIONS: Array<[AttackingRunsId, string]> = [
  ['stay_central', 'Ficar central'],
  ['mixed', 'Misto'],
  ['get_in_behind', 'Infiltrar nas costas'],
  ['target_man', 'Homem de referência'],
  ['false_9', 'Falso 9'],
]

const INTERCEPTIONS_OPTIONS: Array<[InterceptionsId, string]> = [
  ['conservative', 'Conservador'],
  ['normal', 'Normal'],
  ['aggressive', 'Agressivo'],
]

const POSITIONING_FREEDOM_OPTIONS: Array<[PositioningFreedomId, string]> = [
  ['stick', 'Seguir posição'],
  ['balanced', 'Equilibrado'],
  ['free', 'Livre'],
]

type ModalKind = 'tactics' | 'instructions' | null

type TacticRowId =
  | 'formation'
  | 'mentality'
  | 'buildUp'
  | 'chanceCreation'
  | 'defensiveStyle'
  | 'width'
  | 'depth'
  | 'pressIntensity'
  | 'tempo'

const TACTIC_ROWS: Array<{ id: TacticRowId; label: string; kind: 'enum' | 'slider' }> = [
  { id: 'formation', label: 'Esquema tático', kind: 'enum' },
  { id: 'mentality', label: 'Mentalidade', kind: 'enum' },
  { id: 'buildUp', label: 'Construção de jogadas', kind: 'enum' },
  { id: 'chanceCreation', label: 'Criação de chances', kind: 'enum' },
  { id: 'defensiveStyle', label: 'Estilo defensivo', kind: 'enum' },
  { id: 'width', label: 'Largura', kind: 'slider' },
  { id: 'depth', label: 'Linha defensiva', kind: 'slider' },
  { id: 'pressIntensity', label: 'Intensidade de pressão', kind: 'slider' },
  { id: 'tempo', label: 'Ritmo', kind: 'slider' },
]

type InstrRowId = keyof PlayerInstructionsData

const INSTR_ROWS: Array<{ id: InstrRowId; label: string }> = [
  { id: 'supportRuns', label: 'Apoio / corridas de suporte' },
  { id: 'attackingRuns', label: 'Corridas ofensivas' },
  { id: 'interceptions', label: 'Interceptações' },
  { id: 'positioningFreedom', label: 'Liberdade de posicionamento' },
]

function cycleOption<T extends string>(
  options: Array<[T, string]>,
  current: T,
  direction: -1 | 1,
): T {
  const index = Math.max(0, options.findIndex(([id]) => id === current))
  return options[(index + direction + options.length) % options.length][0]
}

function optionLabel<T extends string>(options: Array<[T, string]>, id: T): string {
  return options.find(([value]) => value === id)?.[1] ?? id
}

function clampSlider(value: number, direction: -1 | 1, step = 5): number {
  return Math.max(0, Math.min(100, value + direction * step))
}

function formationLabel(tactics: TeamTactics | null): string {
  if (!tactics) return '—'
  if (tactics.formationPresetId === 'custom') return 'Personalizada'
  return (
    FORMATION_PRESET_LIST.find((p) => p.id === tactics.formationPresetId)?.name ??
    tactics.formationPresetId
  )
}

export function TeamManagementScreen({
  mode = 'setup',
  onClose,
}: {
  /** setup = pré-partida · pause = menu de pause in-game (mesmo UI) */
  mode?: 'setup' | 'pause'
  onClose?: () => void
} = {}) {
  const setView = useAppStore((state) => state.setView)
  const dbVersion = useAppStore((state) => state.dbVersion)
  const bumpDbVersion = useAppStore((state) => state.bumpDbVersion)
  const draft = useMatchSetupStore((state) => state.draft)
  const session = useMatchSetupStore((state) => state.session)
  const { editionName, teams } = useMatchSetupData()
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [swapSourceSlot, setSwapSourceSlot] = useState<number | null>(null)
  const [modal, setModal] = useState<ModalKind>(null)
  const [tacticFocus, setTacticFocus] = useState(0)
  const [instrFocus, setInstrFocus] = useState(0)

  const isPause = mode === 'pause'

  const selectedTeamId = isPause
    ? session
      ? (session.playerSide === 'away' ? session.away.id : session.home.id)
      : draft?.playerSide === 'away'
        ? draft.awayTeamId
        : draft?.homeTeamId
    : draft?.playerSide === 'away'
      ? draft.awayTeamId
      : draft?.homeTeamId
  const team = teams.find((entry) => entry.id === selectedTeamId) ?? null
  const liveSide =
    session && team
      ? session.home.id === team.id
        ? ('home' as const)
        : session.away.id === team.id
          ? ('away' as const)
          : null
      : null

  const syncLiveIfPaused = useCallback(() => {
    if (!isPause || !team || !liveSide) return
    resyncLiveTeamFromDatabase(liveSide, team.id)
    useGameStore.getState().bumpTacticsRevision()
  }, [isPause, liveSide, team])

  const bumpAndSync = useCallback(() => {
    bumpDbVersion()
    // sync after React/db flush — next tick garante leitura do SQLite já persistido
    queueMicrotask(() => syncLiveIfPaused())
  }, [bumpDbVersion, syncLiveIfPaused])

  const roster = useMemo(() => {
    void dbVersion
    return team ? listRoster(getDatabase(), team.id) : []
  }, [dbVersion, team])

  const formationSlots = useMemo(() => {
    void dbVersion
    return team ? listFormationSlots(getDatabase(), team.id) : []
  }, [dbVersion, team])

  const tactics = useMemo(() => {
    void dbVersion
    return team ? getTeamTactics(getDatabase(), team.id) : null
  }, [dbVersion, team])

  useEffect(() => {
    setSelectedIndex(0)
    setSwapSourceSlot(null)
    setModal(null)
  }, [team?.id])

  const squad = roster
  const lineup = useMemo(
    () => roster.filter((r) => r.slotIndex < STARTING_XI_SIZE),
    [roster],
  )
  const bench = useMemo(
    () => roster.filter((r) => r.slotIndex >= STARTING_XI_SIZE),
    [roster],
  )

  const [staminaTick, setStaminaTick] = useState(0)
  useEffect(() => {
    if (!isPause || !liveSide) return
    const id = window.setInterval(() => setStaminaTick((n) => n + 1), 350)
    return () => window.clearInterval(id)
  }, [isPause, liveSide])

  const readSlotStamina = useCallback(
    (slotIndex: number) => {
      void staminaTick
      if (!isPause || !liveSide) return 1
      return getPlayerStamina(`${liveSide}-${slotIndex}`)
    },
    [isPause, liveSide, staminaTick],
  )

  const teamFatigue = useMemo(() => {
    if (!isPause || !liveSide || lineup.length === 0) return null
    void staminaTick
    let sum = 0
    for (const player of lineup) {
      sum += getPlayerStamina(`${liveSide}-${player.slotIndex}`)
    }
    const avg = sum / lineup.length
    return { ...teamFatigueFromAvg(avg), avg }
  }, [isPause, liveSide, lineup, staminaTick])

  const selectedPlayer = squad[selectedIndex] ?? null
  const selectedStamina = selectedPlayer ? readSlotStamina(selectedPlayer.slotIndex) : 1
  const ratings = deriveTeamRatings(team)
  const formationName = formationLabel(tactics)

  const cyclePlayer = useCallback(
    (direction: -1 | 1) => {
      if (squad.length === 0) return
      setSelectedIndex((index) => (index + direction + squad.length) % squad.length)
    },
    [squad.length],
  )

  const selectPlayerBySlot = useCallback(
    (slotIndex: number) => {
      const idx = squad.findIndex((p) => p.slotIndex === slotIndex)
      if (idx >= 0) setSelectedIndex(idx)
    },
    [squad],
  )

  const confirmPlayer = useCallback(() => {
    if (!selectedPlayer || !team) return
    if (swapSourceSlot === null) {
      setSwapSourceSlot(selectedPlayer.slotIndex)
      return
    }
    if (swapSourceSlot === selectedPlayer.slotIndex) {
      setSwapSourceSlot(null)
      return
    }
    swapRosterSlots(getDatabase(), team.id, swapSourceSlot, selectedPlayer.slotIndex)
    bumpAndSync()
    setSwapSourceSlot(null)
  }, [bumpAndSync, selectedPlayer, swapSourceSlot, team])

  const openTactics = useCallback(() => {
    setSwapSourceSlot(null)
    setTacticFocus(0)
    setModal('tactics')
  }, [])

  const openInstructions = useCallback(() => {
    if (!selectedPlayer) return
    setSwapSourceSlot(null)
    setInstrFocus(0)
    setModal('instructions')
  }, [selectedPlayer])

  const closeModal = useCallback(() => setModal(null), [])

  const patchTactics = useCallback(
    (patch: Parameters<typeof updateTeamTactics>[2]) => {
      if (!team) return
      updateTeamTactics(getDatabase(), team.id, patch)
      bumpAndSync()
    },
    [bumpAndSync, team],
  )

  const adjustTacticRow = useCallback(
    (direction: -1 | 1) => {
      if (!team || !tactics) return
      const row = TACTIC_ROWS[tacticFocus]
      if (!row) return

      if (row.id === 'formation') {
        const presets = FORMATION_PRESET_LIST
        const currentId =
          tactics.formationPresetId === 'custom'
            ? presets[0]?.id
            : tactics.formationPresetId
        const index = Math.max(0, presets.findIndex((p) => p.id === currentId))
        const next = presets[(index + direction + presets.length) % presets.length]
        applyFormationPreset(
          getDatabase(),
          team.id,
          next.id as Exclude<FormationPresetId, 'custom'>,
        )
        bumpAndSync()
        return
      }

      if (row.id === 'mentality') {
        patchTactics({ mentality: cycleOption(MENTALITY_OPTIONS, tactics.mentality, direction) })
        return
      }
      if (row.id === 'buildUp') {
        patchTactics({ buildUp: cycleOption(BUILD_UP_OPTIONS, tactics.buildUp, direction) })
        return
      }
      if (row.id === 'chanceCreation') {
        patchTactics({
          chanceCreation: cycleOption(CHANCE_CREATION_OPTIONS, tactics.chanceCreation, direction),
        })
        return
      }
      if (row.id === 'defensiveStyle') {
        patchTactics({
          defensiveStyle: cycleOption(DEFENSIVE_STYLE_OPTIONS, tactics.defensiveStyle, direction),
        })
        return
      }
      if (row.id === 'width') {
        patchTactics({ width: clampSlider(tactics.width, direction) })
        return
      }
      if (row.id === 'depth') {
        patchTactics({ depth: clampSlider(tactics.depth, direction) })
        return
      }
      if (row.id === 'pressIntensity') {
        patchTactics({ pressIntensity: clampSlider(tactics.pressIntensity, direction) })
        return
      }
      if (row.id === 'tempo') {
        patchTactics({ tempo: clampSlider(tactics.tempo, direction) })
      }
    },
    [bumpAndSync, patchTactics, tacticFocus, tactics, team],
  )

  const adjustInstructionRow = useCallback(
    (direction: -1 | 1) => {
      if (!team || !selectedPlayer) return
      const row = INSTR_ROWS[instrFocus]
      if (!row) return
      const current = selectedPlayer.instructions
      let patch: Partial<PlayerInstructionsData> = {}

      if (row.id === 'supportRuns') {
        patch = { supportRuns: cycleOption(SUPPORT_RUNS_OPTIONS, current.supportRuns, direction) }
      } else if (row.id === 'attackingRuns') {
        patch = {
          attackingRuns: cycleOption(ATTACKING_RUNS_OPTIONS, current.attackingRuns, direction),
        }
      } else if (row.id === 'interceptions') {
        patch = {
          interceptions: cycleOption(INTERCEPTIONS_OPTIONS, current.interceptions, direction),
        }
      } else if (row.id === 'positioningFreedom') {
        patch = {
          positioningFreedom: cycleOption(
            POSITIONING_FREEDOM_OPTIONS,
            current.positioningFreedom,
            direction,
          ),
        }
      }

      updatePlayerInstructions(getDatabase(), team.id, selectedPlayer.playerId, patch)
      bumpAndSync()
    },
    [bumpAndSync, instrFocus, selectedPlayer, team],
  )

  const tacticValueLabel = useCallback(
    (rowId: TacticRowId): string => {
      if (!tactics) return '—'
      switch (rowId) {
        case 'formation':
          return formationName
        case 'mentality':
          return optionLabel(MENTALITY_OPTIONS, tactics.mentality)
        case 'buildUp':
          return optionLabel(BUILD_UP_OPTIONS, tactics.buildUp)
        case 'chanceCreation':
          return optionLabel(CHANCE_CREATION_OPTIONS, tactics.chanceCreation)
        case 'defensiveStyle':
          return optionLabel(DEFENSIVE_STYLE_OPTIONS, tactics.defensiveStyle)
        case 'width':
          return `${tactics.width}`
        case 'depth':
          return `${tactics.depth}`
        case 'pressIntensity':
          return `${tactics.pressIntensity}`
        case 'tempo':
          return `${tactics.tempo}`
      }
    },
    [formationName, tactics],
  )

  const instrValueLabel = useCallback(
    (rowId: InstrRowId): string => {
      if (!selectedPlayer) return '—'
      const i = selectedPlayer.instructions
      switch (rowId) {
        case 'supportRuns':
          return optionLabel(SUPPORT_RUNS_OPTIONS, i.supportRuns)
        case 'attackingRuns':
          return optionLabel(ATTACKING_RUNS_OPTIONS, i.attackingRuns)
        case 'interceptions':
          return optionLabel(INTERCEPTIONS_OPTIONS, i.interceptions)
        case 'positioningFreedom':
          return optionLabel(POSITIONING_FREEDOM_OPTIONS, i.positioningFreedom)
      }
    },
    [selectedPlayer],
  )

  const leaveScreen = useCallback(() => {
    if (isPause) {
      onClose?.()
      return
    }
    setView(draft ? 'match-setup' : 'menu')
  }, [draft, isPause, onClose, setView])

  useMenuPad({
    enabled: modal === null,
    onUp: () => cyclePlayer(-1),
    onDown: () => cyclePlayer(1),
    onConfirm: confirmPlayer,
    onBack: leaveScreen,
    onY: openTactics,
    onX: openInstructions,
  })

  useMenuPad({
    enabled: modal === 'tactics',
    onUp: () => setTacticFocus((i) => (i - 1 + TACTIC_ROWS.length) % TACTIC_ROWS.length),
    onDown: () => setTacticFocus((i) => (i + 1) % TACTIC_ROWS.length),
    onLeft: () => adjustTacticRow(-1),
    onRight: () => adjustTacticRow(1),
    onConfirm: () => adjustTacticRow(1),
    onBack: closeModal,
  })

  useMenuPad({
    enabled: modal === 'instructions',
    onUp: () => setInstrFocus((i) => (i - 1 + INSTR_ROWS.length) % INSTR_ROWS.length),
    onDown: () => setInstrFocus((i) => (i + 1) % INSTR_ROWS.length),
    onLeft: () => adjustInstructionRow(-1),
    onRight: () => adjustInstructionRow(1),
    onConfirm: () => adjustInstructionRow(1),
    onBack: closeModal,
  })

  const goBack = () => {
    if (modal) {
      closeModal()
      return
    }
    leaveScreen()
  }

  return (
    <MenuShell
      variant="wide"
      title="Gestão da Equipe"
      subtitle={`${editionName} · ${team?.name ?? 'Time da partida'}`}
      showStadium={!isPause}
      animateEntrance={isPause}
      entranceKey={isPause ? 'pause-management' : undefined}
      padEnabled={false}
      onBack={goBack}
      footer={
        <>
          {modal === 'tactics' ? (
            <MenuPadHints confirm="Alterar" back="Fechar" />
          ) : modal === 'instructions' ? (
            <MenuPadHints confirm="Alterar" back="Fechar" />
          ) : (
            <MenuPadHints
              confirm={swapSourceSlot === null ? 'Selecionar' : 'Trocar'}
              back="Voltar"
              y="Táticas"
              x="Instruções"
            />
          )}
          <div className="fifa-squad__footer-tabs" aria-label="Áreas">
            <strong>Onze inicial</strong>
            <span>Substituições</span>
            <span className={modal === 'tactics' ? 'fifa-squad__footer-tabs--on' : undefined}>
              Táticas
            </span>
            <span className={modal === 'instructions' ? 'fifa-squad__footer-tabs--on' : undefined}>
              Instruções
            </span>
          </div>
        </>
      }
    >
      <div className="fifa-squad">
        {team ? (
          <section className="fifa-squad__frame">
            <header className="fifa-squad__team-bar">
              <div className="fifa-squad__identity">
                <EntityImage
                  entityType="team"
                  entityId={team.id}
                  alt={team.name}
                  refreshKey={dbVersion}
                  className="fifa-squad__crest"
                  fallback={
                    <span className="fifa-squad__crest-fallback">
                      {team.shortName?.slice(0, 3) ?? 'FC'}
                    </span>
                  }
                />
                <div>
                  <h2>{team.name}</h2>
                  <span>
                    Formação <b>{formationName}</b>
                    {tactics ? (
                      <>
                        {' '}
                        · {optionLabel(MENTALITY_OPTIONS, tactics.mentality)}
                      </>
                    ) : null}
                  </span>
                </div>
              </div>

              <div className="fifa-squad__tactics-quick">
                <button type="button" className="fifa-squad__modal-open" onClick={openTactics}>
                  <kbd className="menu-pad-hints__btn menu-pad-hints__btn--y">Y</kbd>
                  <span>Táticas</span>
                </button>
                <button
                  type="button"
                  className="fifa-squad__modal-open"
                  onClick={openInstructions}
                  disabled={!selectedPlayer}
                >
                  <kbd className="menu-pad-hints__btn menu-pad-hints__btn--x">X</kbd>
                  <span>Instruções</span>
                </button>
              </div>

              <div className="fifa-squad__rating">
                {teamFatigue ? (
                  <div
                    className={`fifa-squad__fatigue fifa-squad__fatigue--${teamFatigue.id}`}
                    title={`Fadiga média do onze: ${Math.round(teamFatigue.avg * 100)}%`}
                  >
                    <strong>{teamFatigue.label}</strong>
                    <span>Fadiga</span>
                  </div>
                ) : null}
                <div className="fifa-squad__rating-ger">
                  <strong>{Math.round((ratings.att + ratings.mid + ratings.def) / 3)}</strong>
                  <span>GER</span>
                </div>
              </div>
            </header>

            <div className="fifa-squad__body">
              <section className="fifa-squad__left">
                <div className="fifa-squad__pitch" aria-label={`Formação ${formationName}`}>
                  <span className="fifa-squad__halfway" aria-hidden />
                  <span className="fifa-squad__center-circle" aria-hidden />
                  <span className="fifa-squad__box fifa-squad__box--top" aria-hidden />
                  <span className="fifa-squad__box fifa-squad__box--bottom" aria-hidden />
                  <span className="fifa-squad__goal fifa-squad__goal--top" aria-hidden />
                  <span className="fifa-squad__goal fifa-squad__goal--bottom" aria-hidden />
                  {lineup.map((player) => {
                    const fs = formationSlots.find((s) => s.slotIndex === player.slotIndex)
                    const left = fs ? ((fs.x + 1) / 2) * 100 : 50
                    const top = fs ? fs.z * 100 : 50
                    const active = player.slotIndex === selectedPlayer?.slotIndex
                    const isSwap = player.slotIndex === swapSourceSlot
                    return (
                      <button
                        key={player.id}
                        type="button"
                        className={`fifa-squad__dot${active ? ' fifa-squad__dot--active' : ''}${isSwap ? ' fifa-squad__dot--swap' : ''}`}
                        style={{ left: `${left}%`, top: `${top}%` }}
                        title={player.name}
                        onClick={() => selectPlayerBySlot(player.slotIndex)}
                      >
                        {player.shirtNumber}
                      </button>
                    )
                  })}
                </div>

                <div className="fifa-squad__selected">
                  <EntityImage
                    entityType="player"
                    entityId={selectedPlayer?.playerId}
                    alt={selectedPlayer?.name ?? 'Jogador'}
                    refreshKey={dbVersion}
                    className="fifa-squad__player-photo"
                    fallback={
                      <div className="fifa-squad__silhouette" aria-hidden>
                        {selectedPlayer?.name.slice(0, 1) ?? '?'}
                      </div>
                    }
                  />
                  <div className="fifa-squad__selected-copy">
                    <span>
                      {selectedPlayer
                        ? `#${selectedPlayer.shirtNumber} · ${selectedPlayer.positionLabel}`
                        : '—'}
                    </span>
                    <strong>{selectedPlayer?.name ?? 'Sem jogador'}</strong>
                    <div className="fifa-squad__nat">
                      {selectedPlayer?.countryId ? (
                        <EntityImage
                          entityType="country"
                          entityId={selectedPlayer.countryId}
                          alt={
                            selectedPlayer.nationalityLabel ?? selectedPlayer.countryName ?? ''
                          }
                          refreshKey={dbVersion}
                          className="fifa-squad__flag"
                          fallback={<span />}
                        />
                      ) : null}
                      <span>
                        {selectedPlayer?.nationalityLabel ||
                          selectedPlayer?.countryName ||
                          'Sem nacionalidade'}
                      </span>
                    </div>
                  </div>
                  <div className="fifa-squad__selected-stats">
                    <span>
                      GER <b>{selectedPlayer ? playerOverall(selectedPlayer) : 0}</b>
                    </span>
                    <span>
                      POS <b>{selectedPlayer?.positionLabel ?? '—'}</b>
                    </span>
                    {isPause ? (
                      <span
                        className={
                          selectedStamina <= 0.32
                            ? 'fifa-squad__stat--low'
                            : selectedStamina <= 0.5
                              ? 'fifa-squad__stat--mid'
                              : undefined
                        }
                      >
                        FAT <b>{Math.round(selectedStamina * 100)}%</b>
                      </span>
                    ) : (
                      <span>
                        ATT <b>{selectedPlayer?.attributes.finishing ?? '—'}</b>
                      </span>
                    )}
                  </div>
                </div>
              </section>

              <section className="fifa-squad__roster" aria-label="Onze inicial">
                <header>
                  <strong>
                    {swapSourceSlot === null ? 'Onze inicial' : 'Escolha quem vai trocar'}
                  </strong>
                  <span>{formationName}</span>
                </header>
                <div className="fifa-squad__list">
                  {lineup.map((player) => {
                    const active = player.slotIndex === selectedPlayer?.slotIndex
                    const isSwap = player.slotIndex === swapSourceSlot
                    const stam = readSlotStamina(player.slotIndex)
                    return (
                      <button
                        key={player.id}
                        type="button"
                        className={`fifa-squad__player${active ? ' fifa-squad__player--active' : ''}${isSwap ? ' fifa-squad__player--swap' : ''}${isPause && stam <= 0.32 ? ' fifa-squad__player--fatigued' : ''}`}
                        onMouseEnter={() => selectPlayerBySlot(player.slotIndex)}
                        onClick={() => {
                          if (active) confirmPlayer()
                          else selectPlayerBySlot(player.slotIndex)
                        }}
                      >
                        <span className="fifa-squad__position">{player.positionLabel}</span>
                        <span className="fifa-squad__player-name">
                          <span className="fifa-squad__player-name-text">
                            <em className="fifa-squad__num">#{player.shirtNumber}</em> {player.name}
                          </span>
                          {isPause ? <PlayerStaminaBar value={stam} /> : null}
                        </span>
                        <strong>{playerOverall(player)}</strong>
                        <i aria-hidden />
                      </button>
                    )
                  })}
                </div>
              </section>

              <section className="fifa-squad__substitutions" aria-label="Substituições">
                <header>
                  <div>
                    <span className="fifa-squad__section-kicker">Banco</span>
                    <strong>Substituições</strong>
                  </div>
                  <span className="fifa-squad__section-count">{bench.length}</span>
                </header>
                <div className="fifa-squad__substitutions-list" role="list">
                  {bench.length === 0 ? (
                    <p className="fifa-squad__empty-bench">Nenhum reserva no banco.</p>
                  ) : (
                    bench.map((player) => {
                      const active = player.slotIndex === selectedPlayer?.slotIndex
                      const isSwap = player.slotIndex === swapSourceSlot
                      const stam = readSlotStamina(player.slotIndex)
                      return (
                        <button
                          key={player.id}
                          type="button"
                          role="listitem"
                          className={`fifa-squad__player fifa-squad__player--substitute${active ? ' fifa-squad__player--active' : ''}${isSwap ? ' fifa-squad__player--swap' : ''}${isPause && stam <= 0.32 ? ' fifa-squad__player--fatigued' : ''}`}
                          onMouseEnter={() => selectPlayerBySlot(player.slotIndex)}
                          onClick={() => {
                            if (active) confirmPlayer()
                            else selectPlayerBySlot(player.slotIndex)
                          }}
                        >
                          <span className="fifa-squad__position">{player.positionLabel}</span>
                          <span className="fifa-squad__player-name">
                            <span className="fifa-squad__player-name-text">
                              <em className="fifa-squad__num">#{player.shirtNumber}</em> {player.name}
                            </span>
                            {isPause ? <PlayerStaminaBar value={stam} /> : null}
                          </span>
                          <strong>{playerOverall(player)}</strong>
                          <i aria-hidden />
                        </button>
                      )
                    })
                  )}
                </div>
              </section>
            </div>

            {modal === 'tactics' && tactics ? (
              <div className="fifa-squad-modal" role="dialog" aria-modal="true" aria-label="Táticas">
                <div className="fifa-squad-modal__panel">
                  <header className="fifa-squad-modal__head">
                    <div>
                      <span className="fifa-squad-modal__kicker">Equipe</span>
                      <h3>Táticas coletivas</h3>
                    </div>
                    <button type="button" className="fifa-squad-modal__close" onClick={closeModal}>
                      Fechar
                    </button>
                  </header>
                  <p className="fifa-squad-modal__hint">
                    ↑↓ navegar · ←→ alterar · A ciclar · B fechar
                  </p>
                  <div className="fifa-squad-modal__list" role="listbox">
                    {TACTIC_ROWS.map((row, index) => {
                      const active = index === tacticFocus
                      const value = tacticValueLabel(row.id)
                      return (
                        <button
                          key={row.id}
                          type="button"
                          role="option"
                          aria-selected={active}
                          className={`fifa-squad-modal__row${active ? ' fifa-squad-modal__row--active' : ''}`}
                          onMouseEnter={() => setTacticFocus(index)}
                          onClick={() => {
                            setTacticFocus(index)
                            adjustTacticRow(1)
                          }}
                        >
                          <span className="fifa-squad-modal__row-label">{row.label}</span>
                          {row.kind === 'slider' ? (
                            <span className="fifa-squad-modal__slider" aria-hidden>
                              <i style={{ width: `${Number(value)}%` }} />
                              <em>{value}</em>
                            </span>
                          ) : (
                            <span className="fifa-squad-modal__row-value">
                              <b>‹</b> {value} <b>›</b>
                            </span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>
            ) : null}

            {modal === 'instructions' && selectedPlayer ? (
              <div
                className="fifa-squad-modal"
                role="dialog"
                aria-modal="true"
                aria-label="Instruções do jogador"
              >
                <div className="fifa-squad-modal__panel fifa-squad-modal__panel--instr">
                  <header className="fifa-squad-modal__head">
                    <div>
                      <span className="fifa-squad-modal__kicker">
                        #{selectedPlayer.shirtNumber} · {selectedPlayer.positionLabel}
                      </span>
                      <h3>{selectedPlayer.name}</h3>
                    </div>
                    <button type="button" className="fifa-squad-modal__close" onClick={closeModal}>
                      Fechar
                    </button>
                  </header>
                  <p className="fifa-squad-modal__hint">
                    Instruções individuais · ↑↓ navegar · ←→ alterar · B fechar
                  </p>
                  <div className="fifa-squad-modal__list" role="listbox">
                    {INSTR_ROWS.map((row, index) => {
                      const active = index === instrFocus
                      return (
                        <button
                          key={row.id}
                          type="button"
                          role="option"
                          aria-selected={active}
                          className={`fifa-squad-modal__row${active ? ' fifa-squad-modal__row--active' : ''}`}
                          onMouseEnter={() => setInstrFocus(index)}
                          onClick={() => {
                            setInstrFocus(index)
                            adjustInstructionRow(1)
                          }}
                        >
                          <span className="fifa-squad-modal__row-label">{row.label}</span>
                          <span className="fifa-squad-modal__row-value">
                            <b>‹</b> {instrValueLabel(row.id)} <b>›</b>
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>
            ) : null}
          </section>
        ) : (
          <div className="fifa-empty">Nenhuma equipe disponível nesta edição.</div>
        )}
      </div>
    </MenuShell>
  )
}
