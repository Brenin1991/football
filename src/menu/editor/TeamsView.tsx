import { useEffect, useMemo, useRef, useState } from 'react'
import {
  applyFormationPreset,
  createTeam,
  deleteTeam,
  getTeamTactics,
  listFormationSlots,
  listRoster,
  listTeamKits,
  removeFromRoster,
  setRosterShirtNumber,
  setRosterSlot,
  swapRosterSlots,
  updateFormationSlot,
  updatePlayerInstructions,
  updateRosterPosition,
  updateTeam,
  updateTeamTactics,
  upsertTeamKit,
} from '../../db/queries'
import { getDatabase } from '../../db/database'
import type {
  Country,
  EditionPlayer,
  League,
  RosterSlot,
  Team,
  TeamFormationSlot,
} from '../../db/types'
import {
  ALL_POSITION_LABELS,
  FORMATION_PRESET_LIST,
  MAX_SQUAD_SIZE,
  STARTING_XI_SIZE,
  roleFromPositionLabel,
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
} from '../../game/data/formations'
import { EntityImageUpload } from '../components/EntityImageUpload'
import { TeamShirtTextureEditor } from '../components/TeamKitPreviewEditor'
import { CrestThumb } from './EditionsView'
import { EmptyPreview } from './EmptyPreview'
import { ColorField, KitEditor, RosterSlotRow } from './editorShared'

type PreviewTab = 'info' | 'kits' | 'roster' | 'formation' | 'tactics'

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

function computeSquadWarnings(
  roster: RosterSlot[],
  formationSlots: TeamFormationSlot[],
): string[] {
  const warnings: string[] = []
  const starters = Array.from({ length: STARTING_XI_SIZE }, (_, i) =>
    roster.find((r) => r.slotIndex === i),
  )
  const filledCount = starters.filter(Boolean).length
  if (filledCount < STARTING_XI_SIZE) {
    warnings.push(`Time incompleto: ${filledCount}/${STARTING_XI_SIZE} titulares definidos.`)
  }

  const gkFormationSlot = formationSlots.find((s) => s.role === 'gk')
  const gkAssigned = gkFormationSlot
    ? roster.some((r) => r.slotIndex === gkFormationSlot.slotIndex)
    : false
  if (!gkFormationSlot || !gkAssigned) {
    warnings.push('Nenhum goleiro definido na formação.')
  }

  const slotsByPlayer = new Map<string, number[]>()
  for (const r of roster) {
    const list = slotsByPlayer.get(r.playerId) ?? []
    list.push(r.slotIndex)
    slotsByPlayer.set(r.playerId, list)
  }
  for (const [, idxs] of slotsByPlayer) {
    if (idxs.length > 1) {
      warnings.push(`Jogador duplicado nos postos ${idxs.map((i) => i + 1).join(', ')}.`)
    }
  }

  for (const r of starters) {
    if (!r) continue
    const role = roleFromPositionLabel(r.positionLabel)
    if (role === 'gk' && r.instructions.attackingRuns !== 'stay_central') {
      warnings.push(`Instruções de ataque incompatíveis para o goleiro ${r.name}.`)
    }
    if (role === 'gk' && r.instructions.positioningFreedom === 'free') {
      warnings.push(`Liberdade de posicionamento arriscada para o goleiro ${r.name}.`)
    }
  }

  return warnings
}

function TacticSlider({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (value: number) => void
}) {
  return (
    <label className="ed-field ed-field--slider">
      <span>
        {label} <b>{value}</b>
      </span>
      <input
        className="ed-slider"
        type="range"
        min={0}
        max={100}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  )
}

function MiniPitch({
  slots,
  roster,
  selectedSlot,
  onSelect,
  onDrag,
  onDragEnd,
}: {
  slots: TeamFormationSlot[]
  roster: RosterSlot[]
  selectedSlot: number | null
  onSelect: (slotIndex: number) => void
  onDrag: (slotIndex: number, x: number, z: number) => void
  onDragEnd: (slotIndex: number, x: number, z: number) => void
}) {
  const pitchRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ slotIndex: number; x: number; z: number } | null>(null)

  return (
    <div className="ed-mini-pitch" ref={pitchRef}>
      <span className="ed-mini-pitch__halfway" aria-hidden />
      <span className="ed-mini-pitch__box ed-mini-pitch__box--top" aria-hidden />
      <span className="ed-mini-pitch__box ed-mini-pitch__box--bottom" aria-hidden />
      <span className="ed-mini-pitch__goal ed-mini-pitch__goal--top" aria-hidden />
      <span className="ed-mini-pitch__goal ed-mini-pitch__goal--bottom" aria-hidden />
      {slots.map((s) => {
        const player = roster.find((r) => r.slotIndex === s.slotIndex)
        const active = selectedSlot === s.slotIndex
        return (
          <button
            key={s.slotIndex}
            type="button"
            className={`ed-mini-pitch__post ed-mini-pitch__post--${s.role}${active ? ' ed-mini-pitch__post--active' : ''}`}
            style={{ left: `${((s.x + 1) / 2) * 100}%`, top: `${s.z * 100}%` }}
            title={player ? `${player.name} · ${s.positionLabel}` : `Posto ${s.slotIndex + 1} · ${s.positionLabel}`}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId)
              onSelect(s.slotIndex)
              dragRef.current = { slotIndex: s.slotIndex, x: s.x, z: s.z }
            }}
            onPointerMove={(e) => {
              if (dragRef.current?.slotIndex !== s.slotIndex) return
              const rect = pitchRef.current?.getBoundingClientRect()
              if (!rect) return
              const x = Math.max(-1, Math.min(1, ((e.clientX - rect.left) / rect.width) * 2 - 1))
              const z = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height))
              dragRef.current = { slotIndex: s.slotIndex, x, z }
              onDrag(s.slotIndex, x, z)
            }}
            onPointerUp={(e) => {
              if (dragRef.current?.slotIndex !== s.slotIndex) return
              const rect = pitchRef.current?.getBoundingClientRect()
              const fallback = dragRef.current
              const x = rect
                ? Math.max(-1, Math.min(1, ((e.clientX - rect.left) / rect.width) * 2 - 1))
                : fallback.x
              const z = rect
                ? Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height))
                : fallback.z
              dragRef.current = null
              onDragEnd(s.slotIndex, x, z)
            }}
          >
            {s.positionLabel}
          </button>
        )
      })}
    </div>
  )
}

export function TeamsView({
  editionId,
  leagues,
  teams,
  countries,
  editionPlayers,
  selectedId,
  search,
  leagueFilter,
  refreshKey,
  onSelect,
  onRefresh,
}: {
  editionId: string
  leagues: League[]
  teams: Team[]
  countries: Country[]
  editionPlayers: EditionPlayer[]
  selectedId: string | null
  search: string
  leagueFilter: string
  refreshKey: number
  onSelect: (id: string) => void
  onRefresh: () => void
}) {
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState({
    name: '',
    primaryColor: '#3b82f6',
    secondaryColor: '#1d4ed8',
    gkColor: '#facc15',
    leagueId: leagues[0]?.id ?? '',
    countryId: '',
    isNationalTeam: false,
    nationalTeamLabel: '',
  })

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return teams.filter((t) => {
      if (leagueFilter === 'none' && t.leagueId) return false
      if (leagueFilter !== 'all' && leagueFilter !== 'none' && t.leagueId !== leagueFilter) {
        return false
      }
      if (q && !t.name.toLowerCase().includes(q)) return false
      return true
    })
  }, [teams, search, leagueFilter])

  const selected = teams.find((t) => t.id === selectedId) ?? null
  const leagueName = (id: string | null) =>
    id ? (leagues.find((l) => l.id === id)?.name ?? 'Liga') : 'Sem liga'

  const create = () => {
    if (!draft.name.trim()) return
    const team = createTeam(getDatabase(), editionId, {
      name: draft.name.trim(),
      primaryColor: draft.primaryColor,
      secondaryColor: draft.secondaryColor,
      gkColor: draft.gkColor,
      leagueId: draft.leagueId || null,
      countryId: draft.countryId || null,
      isNationalTeam: draft.isNationalTeam,
      nationalTeamLabel: draft.isNationalTeam
        ? draft.nationalTeamLabel.trim() || null
        : null,
    })
    setDraft({
      name: '',
      primaryColor: '#3b82f6',
      secondaryColor: '#1d4ed8',
      gkColor: '#facc15',
      leagueId: leagues[0]?.id ?? '',
      countryId: '',
      isNationalTeam: false,
      nationalTeamLabel: '',
    })
    setCreating(false)
    onRefresh()
    onSelect(team.id)
  }

  return (
    <>
      <div className="edash-list">
        <div className="edash-list__toolbar">
          <button
            type="button"
            className="ed-btn ed-btn--primary"
            onClick={() => setCreating((v) => !v)}
          >
            {creating ? 'Fechar' : 'Novo time'}
          </button>
          <span className="edash-list__count">{filtered.length} de {teams.length}</span>
        </div>

        {creating ? (
          <div className="ed-create-card">
            <label className="ed-field">
              <span>Nome</span>
              <input
                className="ed-input"
                value={draft.name}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                autoFocus
              />
            </label>
            <label className="ed-field">
              <span>Liga</span>
              <select
                className="ed-select"
                value={draft.leagueId}
                onChange={(e) => setDraft((d) => ({ ...d, leagueId: e.target.value }))}
              >
                <option value="">Sem liga</option>
                {leagues.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="ed-field">
              <span>País</span>
              <select
                className="ed-select"
                value={draft.countryId}
                onChange={(e) => setDraft((d) => ({ ...d, countryId: e.target.value }))}
              >
                <option value="">Sem país</option>
                {countries.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="ed-field ed-field--check">
              <input
                type="checkbox"
                checked={draft.isNationalTeam}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, isNationalTeam: e.target.checked }))
                }
              />
              <span>É uma seleção nacional</span>
            </label>
            {draft.isNationalTeam ? (
              <label className="ed-field">
                <span>Variante da seleção</span>
                <input
                  className="ed-input"
                  placeholder="Principal, Sub-20, Clássica…"
                  value={draft.nationalTeamLabel}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, nationalTeamLabel: e.target.value }))
                  }
                />
              </label>
            ) : null}
            <div className="ed-create-card__colors">
              <ColorField
                label="Principal"
                value={draft.primaryColor}
                onChange={(v) => setDraft((d) => ({ ...d, primaryColor: v }))}
              />
              <ColorField
                label="Secundária"
                value={draft.secondaryColor}
                onChange={(v) => setDraft((d) => ({ ...d, secondaryColor: v }))}
              />
              <ColorField
                label="Goleiro"
                value={draft.gkColor}
                onChange={(v) => setDraft((d) => ({ ...d, gkColor: v }))}
              />
            </div>
            <button
              type="button"
              className="ed-btn ed-btn--primary"
              disabled={!draft.name.trim()}
              onClick={create}
            >
              Criar time
            </button>
          </div>
        ) : null}

        {filtered.length === 0 ? (
          <p className="edash-empty">Nenhum time com esses filtros.</p>
        ) : (
          <ul className="edash-rows">
            {filtered.map((team) => (
              <li key={team.id}>
                <button
                  type="button"
                  className={`edash-row${selectedId === team.id ? ' edash-row--active' : ''}`}
                  onClick={() => onSelect(team.id)}
                >
                  <CrestThumb
                    type="team"
                    id={team.id}
                    alt={team.name}
                    refreshKey={refreshKey}
                  />
                  <span className="ed-swatch" style={{ background: team.primaryColor }} />
                  <div className="edash-row__main">
                    <strong>{team.name}</strong>
                    <span className="edash-row__meta">{leagueName(team.leagueId)}</span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <aside className="edash-preview">
        {selected ? (
          <TeamPreview
            key={selected.id}
            team={selected}
            leagues={leagues}
            countries={countries}
            editionPlayers={editionPlayers}
            refreshKey={refreshKey}
            onRefresh={onRefresh}
          />
        ) : (
          <EmptyPreview hint="Selecione um time para editar escudo, uniforme e elenco." />
        )}
      </aside>
    </>
  )
}

function TeamPreview({
  team,
  leagues,
  countries,
  editionPlayers,
  refreshKey,
  onRefresh,
}: {
  team: Team
  leagues: League[]
  countries: Country[]
  editionPlayers: EditionPlayer[]
  refreshKey: number
  onRefresh: () => void
}) {
  const [draft, setDraft] = useState(team)
  const [tab, setTab] = useState<PreviewTab>('info')
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null)
  const [swapSource, setSwapSource] = useState<number | null>(null)

  useEffect(() => {
    setDraft(team)
    setSelectedSlot(null)
    setSwapSource(null)
  }, [team])

  const kits = useMemo(
    () => listTeamKits(getDatabase(), team.id),
    [team.id, refreshKey],
  )
  const roster = useMemo(
    () => listRoster(getDatabase(), team.id),
    [team.id, refreshKey],
  )
  const tactics = useMemo(
    () => getTeamTactics(getDatabase(), team.id),
    [team.id, refreshKey],
  )
  const formationSlots = useMemo(
    () => listFormationSlots(getDatabase(), team.id),
    [team.id, refreshKey],
  )

  const [pitchSlots, setPitchSlots] = useState(formationSlots)
  useEffect(() => setPitchSlots(formationSlots), [formationSlots])

  const warnings = useMemo(
    () => computeSquadWarnings(roster, formationSlots),
    [roster, formationSlots],
  )

  const kit1 = kits.find((k) => k.kitNumber === 1)
  const kit2 = kits.find((k) => k.kitNumber === 2)

  const selectedPlayer =
    selectedSlot != null ? roster.find((r) => r.slotIndex === selectedSlot) ?? null : null
  const selectedFormationSlot =
    selectedSlot != null ? formationSlots.find((s) => s.slotIndex === selectedSlot) ?? null : null

  const saveInfo = () => {
    updateTeam(getDatabase(), team.id, {
      name: draft.name.trim(),
      shortName: draft.shortName,
      primaryColor: kit1?.shirtColor ?? draft.primaryColor,
      secondaryColor: kit1?.shortsColor ?? draft.secondaryColor,
      gkColor: draft.gkColor,
      leagueId: draft.leagueId,
      countryId: draft.countryId,
      isNationalTeam: draft.isNationalTeam,
      nationalTeamLabel: draft.isNationalTeam
        ? draft.nationalTeamLabel?.trim() || null
        : null,
    })
    onRefresh()
  }

  const countryName = (id: string | null) =>
    id ? countries.find((c) => c.id === id)?.name ?? null : null

  const doSwap = (slotIndex: number) => {
    if (swapSource === null) {
      setSwapSource(slotIndex)
      return
    }
    if (swapSource === slotIndex) {
      setSwapSource(null)
      return
    }
    swapRosterSlots(getDatabase(), team.id, swapSource, slotIndex)
    setSwapSource(null)
    onRefresh()
  }

  const patchInstructions = (patch: Partial<PlayerInstructionsData>) => {
    if (!selectedPlayer) return
    updatePlayerInstructions(getDatabase(), team.id, selectedPlayer.playerId, patch)
    onRefresh()
  }

  const renderInstructionsPanel = () => {
    if (!selectedPlayer) return null
    return (
      <div className="ed-instructions">
        <h4>
          Instruções — {selectedPlayer.name}{' '}
          <span className="ed-instructions__num">#{selectedPlayer.shirtNumber}</span>
        </h4>
        <div className="ed-instructions__grid">
          <label className="ed-field">
            <span>Apoio ao ataque</span>
            <select
              className="ed-select"
              value={selectedPlayer.instructions.supportRuns}
              onChange={(e) =>
                patchInstructions({ supportRuns: e.target.value as SupportRunsId })
              }
            >
              {SUPPORT_RUNS_OPTIONS.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="ed-field">
            <span>Movimentação ofensiva</span>
            <select
              className="ed-select"
              value={selectedPlayer.instructions.attackingRuns}
              onChange={(e) =>
                patchInstructions({ attackingRuns: e.target.value as AttackingRunsId })
              }
            >
              {ATTACKING_RUNS_OPTIONS.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="ed-field">
            <span>Interceptações</span>
            <select
              className="ed-select"
              value={selectedPlayer.instructions.interceptions}
              onChange={(e) =>
                patchInstructions({ interceptions: e.target.value as InterceptionsId })
              }
            >
              {INTERCEPTIONS_OPTIONS.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="ed-field">
            <span>Liberdade de posicionamento</span>
            <select
              className="ed-select"
              value={selectedPlayer.instructions.positioningFreedom}
              onChange={(e) =>
                patchInstructions({
                  positioningFreedom: e.target.value as PositioningFreedomId,
                })
              }
            >
              {POSITIONING_FREEDOM_OPTIONS.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
    )
  }

  const renderRosterRow = (slotIndex: number) => {
    const slot = roster.find((r) => r.slotIndex === slotIndex)
    const isSelected = selectedSlot === slotIndex
    const isSwapSource = swapSource === slotIndex
    const isBench = slotIndex >= STARTING_XI_SIZE

    return (
      <div
        key={slotIndex}
        className={`ed-roster-row-wrap${isSelected ? ' ed-roster-row-wrap--active' : ''}${isSwapSource ? ' ed-roster-row-wrap--swap' : ''}`}
      >
        <RosterSlotRow
          slotIndex={slotIndex}
          slot={slot}
          editionPlayers={editionPlayers}
          onAssign={(playerId, position) => {
            setRosterSlot(getDatabase(), team.id, slotIndex, playerId, position)
            onRefresh()
          }}
          onPosition={(position) => {
            updateRosterPosition(getDatabase(), team.id, slotIndex, position)
            onRefresh()
          }}
          onShirtNumber={(shirtNumber) => {
            try {
              setRosterShirtNumber(getDatabase(), team.id, slotIndex, shirtNumber)
              onRefresh()
            } catch (err) {
              alert(err instanceof Error ? err.message : 'Número inválido')
              onRefresh()
            }
          }}
        />
        <div className="ed-roster-row__actions">
          <button
            type="button"
            className={`ed-btn ed-btn--ghost ed-btn--sm${isSelected ? ' ed-btn--active' : ''}`}
            disabled={!slot}
            onClick={() => setSelectedSlot(isSelected ? null : slotIndex)}
          >
            Instruções
          </button>
          <button
            type="button"
            className={`ed-btn ed-btn--ghost ed-btn--sm${isSwapSource ? ' ed-btn--active' : ''}`}
            onClick={() => doSwap(slotIndex)}
          >
            {isSwapSource ? 'Cancelar troca' : 'Trocar'}
          </button>
          {isBench && slot ? (
            <button
              type="button"
              className="ed-btn ed-btn--danger ed-btn--sm"
              onClick={() => {
                removeFromRoster(getDatabase(), team.id, slotIndex)
                if (selectedSlot === slotIndex) setSelectedSlot(null)
                onRefresh()
              }}
            >
              Remover
            </button>
          ) : null}
        </div>
      </div>
    )
  }

  return (
    <div className="ed-preview ed-preview--wide">
      <header className="ed-preview__header">
        <div className="ed-preview__title-row">
          <CrestThumb type="team" id={team.id} alt={team.name} refreshKey={refreshKey} />
          <div>
            <h2>{team.name}</h2>
            <p className="ed-preview__sub">
              {team.isNationalTeam
                ? `Seleção${team.nationalTeamLabel ? ` · ${team.nationalTeamLabel}` : ''}${
                    countryName(team.countryId) ? ` · ${countryName(team.countryId)}` : ''
                  }`
                : leagues.find((l) => l.id === team.leagueId)?.name ?? 'Sem liga'}
            </p>
          </div>
        </div>
      </header>

      <div className="ed-tabs">
        {(
          [
            ['info', 'Info'],
            ['kits', 'Uniformes'],
            ['roster', 'Elenco'],
            ['formation', 'Formação'],
            ['tactics', 'Táticas'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`ed-tabs__btn${tab === id ? ' ed-tabs__btn--active' : ''}`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'info' ? (
        <div className="ed-preview__body">
          <EntityImageUpload
            entityType="team"
            entityId={team.id}
            label="Escudo"
            refreshKey={refreshKey}
            onUpdated={onRefresh}
          />
          <label className="ed-field">
            <span>Nome</span>
            <input
              className="ed-input"
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            />
          </label>
          <label className="ed-field">
            <span>Liga</span>
            <select
              className="ed-select"
              value={draft.leagueId ?? ''}
              onChange={(e) =>
                setDraft((d) => ({ ...d, leagueId: e.target.value || null }))
              }
            >
              <option value="">Sem liga</option>
              {leagues.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          <label className="ed-field">
            <span>País</span>
            <select
              className="ed-select"
              value={draft.countryId ?? ''}
              onChange={(e) =>
                setDraft((d) => ({ ...d, countryId: e.target.value || null }))
              }
            >
              <option value="">Sem país</option>
              {countries.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="ed-field ed-field--check">
            <input
              type="checkbox"
              checked={draft.isNationalTeam}
              onChange={(e) =>
                setDraft((d) => ({ ...d, isNationalTeam: e.target.checked }))
              }
            />
            <span>É uma seleção nacional</span>
          </label>
          {draft.isNationalTeam ? (
            <label className="ed-field">
              <span>Variante da seleção</span>
              <input
                className="ed-input"
                placeholder="Principal, Sub-20, Clássica…"
                value={draft.nationalTeamLabel ?? ''}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, nationalTeamLabel: e.target.value }))
                }
              />
              {!draft.countryId ? (
                <span className="ed-hint">Selecione um país para vincular a seleção.</span>
              ) : null}
            </label>
          ) : null}
          <ColorField
            label="Camisa goleiro"
            value={draft.gkColor}
            onChange={(v) => setDraft((d) => ({ ...d, gkColor: v }))}
          />
          <div className="ed-preview__actions">
            <button type="button" className="ed-btn ed-btn--primary" onClick={saveInfo}>
              Salvar
            </button>
            <button
              type="button"
              className="ed-btn ed-btn--danger"
              onClick={() => {
                if (confirm(`Excluir time "${team.name}"?`)) {
                  deleteTeam(getDatabase(), team.id)
                  onRefresh()
                }
              }}
            >
              Excluir time
            </button>
          </div>
        </div>
      ) : null}

      {tab === 'kits' ? (
        <div className="ed-preview__body">
          <KitEditor
            label="Uniforme 1"
            kit={kit1}
            fallbackShirt={draft.primaryColor}
            fallbackShorts={draft.secondaryColor ?? '#1a1a2e'}
            onChange={(data) => {
              upsertTeamKit(getDatabase(), team.id, 1, data)
              onRefresh()
            }}
          />
          <KitEditor
            label="Uniforme 2"
            kit={kit2}
            fallbackShirt={draft.secondaryColor ?? draft.primaryColor}
            fallbackShorts="#1a1a2e"
            onChange={(data) => {
              upsertTeamKit(getDatabase(), team.id, 2, data)
              onRefresh()
            }}
          />
          <TeamShirtTextureEditor teamId={team.id} kits={kits} refreshKey={refreshKey} />
        </div>
      ) : null}

      {tab === 'roster' ? (
        <div className="ed-preview__body">
          <p className="ed-hint">
            O mesmo jogador pode estar em vários times. Número do time sobrescreve o
            preferido do jogador; vazio usa preferido ou slot+1. Clique em "Trocar" em dois
            postos para trocar os jogadores entre eles.
          </p>

          {warnings.length > 0 ? (
            <ul className="ed-warnings">
              {warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          ) : null}

          <h4 className="ed-roster-heading">Titulares ({STARTING_XI_SIZE})</h4>
          <div className="ed-roster">
            {Array.from({ length: STARTING_XI_SIZE }, (_, slotIndex) =>
              renderRosterRow(slotIndex),
            )}
          </div>

          <h4 className="ed-roster-heading">
            Banco (até {MAX_SQUAD_SIZE - STARTING_XI_SIZE})
          </h4>
          <div className="ed-roster">
            {Array.from({ length: MAX_SQUAD_SIZE - STARTING_XI_SIZE }, (_, i) =>
              renderRosterRow(STARTING_XI_SIZE + i),
            )}
          </div>

          {renderInstructionsPanel()}
        </div>
      ) : null}

      {tab === 'formation' ? (
        <div className="ed-preview__body">
          <label className="ed-field">
            <span>Esquema tático</span>
            <select
              className="ed-select"
              value={tactics.formationPresetId}
              onChange={(e) => {
                const val = e.target.value
                if (val === 'custom') return
                applyFormationPreset(
                  getDatabase(),
                  team.id,
                  val as Exclude<FormationPresetId, 'custom'>,
                )
                onRefresh()
              }}
            >
              {tactics.formationPresetId === 'custom' ? (
                <option value="custom">Personalizada (arrastada)</option>
              ) : null}
              {FORMATION_PRESET_LIST.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>

          <MiniPitch
            slots={pitchSlots}
            roster={roster}
            selectedSlot={selectedSlot}
            onSelect={setSelectedSlot}
            onDrag={(slotIndex, x, z) => {
              setPitchSlots((prev) =>
                prev.map((s) => (s.slotIndex === slotIndex ? { ...s, x, z } : s)),
              )
            }}
            onDragEnd={(slotIndex, x, z) => {
              updateFormationSlot(getDatabase(), team.id, slotIndex, { x, z })
              onRefresh()
            }}
          />
          <p className="ed-hint">
            Arraste os postos para reposicionar (isso marca a formação como
            "Personalizada"). Clique em um posto para selecioná-lo e editar a posição ou
            as instruções do jogador.
          </p>

          {selectedFormationSlot ? (
            <label className="ed-field">
              <span>Posição do posto selecionado (#{selectedFormationSlot.slotIndex + 1})</span>
              <select
                className="ed-select"
                value={selectedFormationSlot.positionLabel}
                onChange={(e) => {
                  updateFormationSlot(getDatabase(), team.id, selectedFormationSlot.slotIndex, {
                    positionLabel: e.target.value,
                  })
                  onRefresh()
                }}
              >
                {ALL_POSITION_LABELS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {warnings.length > 0 ? (
            <ul className="ed-warnings">
              {warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          ) : null}

          {renderInstructionsPanel()}
        </div>
      ) : null}

      {tab === 'tactics' ? (
        <div className="ed-preview__body">
          <div className="ed-tactics-grid">
            <label className="ed-field">
              <span>Mentalidade</span>
              <select
                className="ed-select"
                value={tactics.mentality}
                onChange={(e) => {
                  updateTeamTactics(getDatabase(), team.id, {
                    mentality: e.target.value as MentalityId,
                  })
                  onRefresh()
                }}
              >
                {MENTALITY_OPTIONS.map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="ed-field">
              <span>Construção de jogadas</span>
              <select
                className="ed-select"
                value={tactics.buildUp}
                onChange={(e) => {
                  updateTeamTactics(getDatabase(), team.id, {
                    buildUp: e.target.value as BuildUpId,
                  })
                  onRefresh()
                }}
              >
                {BUILD_UP_OPTIONS.map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="ed-field">
              <span>Criação de chances</span>
              <select
                className="ed-select"
                value={tactics.chanceCreation}
                onChange={(e) => {
                  updateTeamTactics(getDatabase(), team.id, {
                    chanceCreation: e.target.value as ChanceCreationId,
                  })
                  onRefresh()
                }}
              >
                {CHANCE_CREATION_OPTIONS.map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="ed-field">
              <span>Estilo defensivo</span>
              <select
                className="ed-select"
                value={tactics.defensiveStyle}
                onChange={(e) => {
                  updateTeamTactics(getDatabase(), team.id, {
                    defensiveStyle: e.target.value as DefensiveStyleId,
                  })
                  onRefresh()
                }}
              >
                {DEFENSIVE_STYLE_OPTIONS.map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="ed-tactics-sliders">
            <TacticSlider
              label="Largura"
              value={tactics.width}
              onChange={(width) => {
                updateTeamTactics(getDatabase(), team.id, { width })
                onRefresh()
              }}
            />
            <TacticSlider
              label="Linha defensiva"
              value={tactics.depth}
              onChange={(depth) => {
                updateTeamTactics(getDatabase(), team.id, { depth })
                onRefresh()
              }}
            />
            <TacticSlider
              label="Intensidade de pressão"
              value={tactics.pressIntensity}
              onChange={(pressIntensity) => {
                updateTeamTactics(getDatabase(), team.id, { pressIntensity })
                onRefresh()
              }}
            />
            <TacticSlider
              label="Ritmo"
              value={tactics.tempo}
              onChange={(tempo) => {
                updateTeamTactics(getDatabase(), team.id, { tempo })
                onRefresh()
              }}
            />
          </div>
        </div>
      ) : null}
    </div>
  )
}
