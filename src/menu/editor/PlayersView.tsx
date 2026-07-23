import { useEffect, useMemo, useState } from 'react'
import {
  createEditionPlayer,
  deleteEditionPlayer,
  listPlayerTeamNames,
  listRoster,
  updateEditionPlayer,
} from '../../db/queries'
import { getDatabase } from '../../db/database'
import {
  PLAYER_ATTR_KEYS,
  PLAYER_ATTR_LABELS,
  clampPlayerAttr,
  derivePlayerOverall,
  type PlayerAttributes,
} from '../../db/playerAttributeDefaults'
import { SKIN_TONE_OPTIONS, getSkinToneColor } from '../../db/skinTones'
import type { Country, EditionPlayer, Team } from '../../db/types'
import { EntityImageUpload } from '../components/EntityImageUpload'
import { PlayerGlbUpload } from '../components/PlayerGlbUpload'
import { CrestThumb } from './EditionsView'
import { EmptyPreview } from './EmptyPreview'

export function PlayersView({
  editionId,
  editionPlayers,
  teams,
  countries,
  selectedId,
  search,
  glbFilter,
  teamFilter,
  refreshKey,
  onSelect,
  onRefresh,
}: {
  editionId: string
  editionPlayers: EditionPlayer[]
  teams: Team[]
  countries: Country[]
  selectedId: string | null
  search: string
  glbFilter: 'all' | 'custom' | 'default'
  teamFilter: string
  refreshKey: number
  onSelect: (id: string) => void
  onRefresh: () => void
}) {
  const [newName, setNewName] = useState('')

  const playersInTeam = useMemo(() => {
    if (teamFilter === 'all') return null
    const roster = listRoster(getDatabase(), teamFilter)
    return new Set(roster.map((r) => r.playerId))
  }, [teamFilter, refreshKey])

  const countryById = useMemo(() => {
    const map = new Map<string, Country>()
    for (const c of countries) map.set(c.id, c)
    return map
  }, [countries])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return editionPlayers.filter((p) => {
      if (glbFilter === 'custom' && !p.hasCustomGlb) return false
      if (glbFilter === 'default' && p.hasCustomGlb) return false
      if (playersInTeam && !playersInTeam.has(p.id)) return false
      if (q) {
        const country = p.countryId ? countryById.get(p.countryId) : null
        const hay = `${p.name} ${country?.name ?? ''} ${country?.nationalityLabel ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [editionPlayers, search, glbFilter, playersInTeam, countryById])

  const selected = editionPlayers.find((p) => p.id === selectedId) ?? null

  const create = () => {
    if (!newName.trim()) return
    const player = createEditionPlayer(getDatabase(), editionId, { name: newName.trim() })
    setNewName('')
    onRefresh()
    onSelect(player.id)
  }

  return (
    <>
      <div className="edash-list">
        <div className="edash-list__toolbar">
          <input
            className="ed-input"
            placeholder="Nome do jogador"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') create()
            }}
          />
          <button
            type="button"
            className="ed-btn ed-btn--primary"
            disabled={!newName.trim()}
            onClick={create}
          >
            Cadastrar
          </button>
          <span className="edash-list__count">
            {filtered.length} de {editionPlayers.length}
          </span>
        </div>

        {filtered.length === 0 ? (
          <p className="edash-empty">Nenhum jogador com esses filtros.</p>
        ) : (
          <ul className="edash-rows">
            {filtered.map((player) => {
              const country = player.countryId ? countryById.get(player.countryId) : null
              const ovr = derivePlayerOverall(player.attributes)
              return (
                <li key={player.id}>
                  <button
                    type="button"
                    className={`edash-row${selectedId === player.id ? ' edash-row--active' : ''}`}
                    onClick={() => onSelect(player.id)}
                  >
                    <CrestThumb
                      type="player"
                      id={player.id}
                      alt={player.name}
                      refreshKey={refreshKey}
                    />
                    <span
                      className="ed-swatch ed-swatch--round"
                      style={{ background: getSkinToneColor(player.skinTone) }}
                      title="Tom de pele"
                    />
                    <div className="edash-row__main">
                      <strong>{player.name}</strong>
                      <span className="edash-row__meta">
                        OVR {ovr}
                        {country ? ` · ${country.name}` : ''}
                        {player.hasCustomGlb ? ' · GLB' : ''}
                      </span>
                    </div>
                    <span className="ed-pill">{ovr}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <aside className="edash-preview">
        {selected ? (
          <PlayerPreview
            key={selected.id}
            player={selected}
            teams={teams}
            countries={countries}
            refreshKey={refreshKey}
            onRefresh={onRefresh}
          />
        ) : (
          <EmptyPreview hint="Selecione um jogador para editar perfil, atributos e GLB." />
        )}
      </aside>
    </>
  )
}

function PlayerPreview({
  player,
  teams,
  countries,
  refreshKey,
  onRefresh,
}: {
  player: EditionPlayer
  teams: Team[]
  countries: Country[]
  refreshKey: number
  onRefresh: () => void
}) {
  const [name, setName] = useState(player.name)
  const [preferredNumber, setPreferredNumber] = useState(
    player.preferredShirtNumber?.toString() ?? '',
  )
  const [attrs, setAttrs] = useState<PlayerAttributes>(player.attributes)
  const teamNames = useMemo(
    () => listPlayerTeamNames(getDatabase(), player.id),
    [player.id, refreshKey],
  )

  useEffect(() => {
    setName(player.name)
    setPreferredNumber(player.preferredShirtNumber?.toString() ?? '')
    setAttrs(player.attributes)
  }, [player])

  const overall = derivePlayerOverall(attrs)
  const country = countries.find((c) => c.id === player.countryId) ?? null

  const persistProfile = (patch: {
    name?: string
    skinTone?: EditionPlayer['skinTone']
    countryId?: string | null
    preferredShirtNumber?: number | null
    attributes?: Partial<PlayerAttributes>
  }) => {
    updateEditionPlayer(getDatabase(), player.id, {
      name: patch.name ?? player.name,
      skinTone: patch.skinTone ?? player.skinTone,
      countryId: patch.countryId !== undefined ? patch.countryId : player.countryId,
      preferredShirtNumber:
        patch.preferredShirtNumber !== undefined
          ? patch.preferredShirtNumber
          : player.preferredShirtNumber,
      attributes: patch.attributes,
    })
    onRefresh()
  }

  return (
    <div className="ed-preview ed-preview--wide">
      <header className="ed-preview__header">
        <div className="ed-preview__title-row">
          <CrestThumb
            type="player"
            id={player.id}
            alt={player.name}
            refreshKey={refreshKey}
          />
          <div>
            <h2>{player.name}</h2>
            <p className="ed-preview__sub">
              OVR {overall}
              {country ? ` · ${country.nationalityLabel || country.name}` : ''}
              {teamNames.length ? ` · ${teamNames.join(' · ')}` : ' · Sem time'}
            </p>
          </div>
        </div>
      </header>

      <div className="ed-preview__assets">
        <EntityImageUpload
          entityType="player"
          entityId={player.id}
          label="Rosto"
          variant="photo"
          refreshKey={refreshKey}
          onUpdated={onRefresh}
        />
        <PlayerGlbUpload
          playerId={player.id}
          hasCustomGlb={player.hasCustomGlb}
          refreshKey={refreshKey}
          onUpdated={onRefresh}
        />
      </div>

      <label className="ed-field">
        <span>Nome</span>
        <input
          className="ed-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            if (name.trim() && name.trim() !== player.name) {
              persistProfile({ name: name.trim() })
            } else {
              setName(player.name)
            }
          }}
        />
      </label>

      <label className="ed-field">
        <span>Nacionalidade</span>
        <select
          className="ed-select"
          value={player.countryId ?? ''}
          onChange={(e) => {
            persistProfile({ countryId: e.target.value || null })
          }}
        >
          <option value="">Sem país</option>
          {countries.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {c.nationalityLabel ? ` (${c.nationalityLabel})` : ''}
            </option>
          ))}
        </select>
      </label>

      <label className="ed-field">
        <span>Número preferido (1–99)</span>
        <input
          className="ed-input"
          type="number"
          min={1}
          max={99}
          placeholder="Automático no elenco"
          value={preferredNumber}
          onChange={(e) => setPreferredNumber(e.target.value)}
          onBlur={() => {
            const raw = preferredNumber.trim()
            if (!raw) {
              if (player.preferredShirtNumber != null) {
                persistProfile({ preferredShirtNumber: null })
              }
              return
            }
            const n = clampPlayerAttr(Number(raw))
            setPreferredNumber(String(n))
            if (n !== player.preferredShirtNumber) {
              persistProfile({ preferredShirtNumber: n })
            }
          }}
        />
      </label>

      <div className="ed-field">
        <span>Tom de pele</span>
        <div className="ed-skin-picker">
          {SKIN_TONE_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              className={`ed-skin-swatch${player.skinTone === opt.id ? ' ed-skin-swatch--active' : ''}`}
              style={{ background: getSkinToneColor(opt.id) }}
              title={opt.label}
              onClick={() => persistProfile({ skinTone: opt.id })}
            />
          ))}
        </div>
        <select
          className="ed-select"
          value={player.skinTone}
          onChange={(e) => {
            persistProfile({
              skinTone: e.target.value as EditionPlayer['skinTone'],
            })
          }}
        >
          {SKIN_TONE_OPTIONS.map((opt) => (
            <option key={opt.id} value={opt.id}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div className="ed-preview__section">
        <h3>Atributos (1–99) · OVR {overall}</h3>
        <div className="ed-attr-grid">
          {PLAYER_ATTR_KEYS.map((key) => (
            <label key={key} className="ed-field ed-field--attr">
              <span>{PLAYER_ATTR_LABELS[key]}</span>
              <input
                className="ed-input"
                type="number"
                min={1}
                max={99}
                value={attrs[key]}
                onChange={(e) => {
                  const n = clampPlayerAttr(Number(e.target.value))
                  setAttrs((prev) => ({ ...prev, [key]: n }))
                }}
                onBlur={() => {
                  if (attrs[key] !== player.attributes[key]) {
                    persistProfile({ attributes: { [key]: attrs[key] } })
                  }
                }}
              />
            </label>
          ))}
        </div>
      </div>

      {teams.length > 0 && teamNames.length > 0 ? (
        <div className="ed-preview__section">
          <h3>Times</h3>
          <ul className="ed-mini-list">
            {teamNames.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="ed-preview__actions">
        <button
          type="button"
          className="ed-btn ed-btn--danger"
          onClick={() => {
            if (confirm(`Excluir jogador "${player.name}"?`)) {
              deleteEditionPlayer(getDatabase(), player.id)
              onRefresh()
            }
          }}
        >
          Excluir jogador
        </button>
      </div>
    </div>
  )
}
