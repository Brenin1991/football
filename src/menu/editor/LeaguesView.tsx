import { useEffect, useMemo, useState } from 'react'
import { createLeague, deleteLeague, updateLeague } from '../../db/queries'
import { getDatabase } from '../../db/database'
import type { Country, League, Team } from '../../db/types'
import { EntityImageUpload } from '../components/EntityImageUpload'
import { CrestThumb } from './EditionsView'
import { EmptyPreview } from './EmptyPreview'

export function LeaguesView({
  editionId,
  leagues,
  teams,
  countries,
  selectedId,
  search,
  refreshKey,
  onSelect,
  onRefresh,
}: {
  editionId: string
  leagues: League[]
  teams: Team[]
  countries: Country[]
  selectedId: string | null
  search: string
  refreshKey: number
  onSelect: (id: string) => void
  onRefresh: () => void
}) {
  const [newName, setNewName] = useState('')

  const teamCountByLeague = useMemo(() => {
    const map = new Map<string, number>()
    for (const t of teams) {
      if (!t.leagueId) continue
      map.set(t.leagueId, (map.get(t.leagueId) ?? 0) + 1)
    }
    return map
  }, [teams])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return leagues
    return leagues.filter((l) => l.name.toLowerCase().includes(q))
  }, [leagues, search])

  const selected = leagues.find((l) => l.id === selectedId) ?? null

  const create = () => {
    if (!newName.trim()) return
    const league = createLeague(getDatabase(), editionId, newName.trim())
    setNewName('')
    onRefresh()
    onSelect(league.id)
  }

  return (
    <>
      <div className="edash-list">
        <div className="edash-list__toolbar">
          <input
            className="ed-input"
            placeholder="Nome da nova liga"
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
            Adicionar
          </button>
        </div>

        {filtered.length === 0 ? (
          <p className="edash-empty">Nenhuma liga encontrada.</p>
        ) : (
          <ul className="edash-rows">
            {filtered.map((league) => (
              <li key={league.id}>
                <button
                  type="button"
                  className={`edash-row${selectedId === league.id ? ' edash-row--active' : ''}`}
                  onClick={() => onSelect(league.id)}
                >
                  <CrestThumb
                    type="league"
                    id={league.id}
                    alt={league.name}
                    refreshKey={refreshKey}
                  />
                  <div className="edash-row__main">
                    <strong>{league.name}</strong>
                    <span className="edash-row__meta">
                      {teamCountByLeague.get(league.id) ?? 0} time
                      {(teamCountByLeague.get(league.id) ?? 0) === 1 ? '' : 's'}
                    </span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <aside className="edash-preview">
        {selected ? (
          <LeaguePreview
            key={selected.id}
            league={selected}
            countries={countries}
            teamCount={teamCountByLeague.get(selected.id) ?? 0}
            teams={teams.filter((t) => t.leagueId === selected.id)}
            refreshKey={refreshKey}
            onRefresh={onRefresh}
          />
        ) : (
          <EmptyPreview hint="Selecione uma liga para editar escudo e nome." />
        )}
      </aside>
    </>
  )
}

function LeaguePreview({
  league,
  countries,
  teamCount,
  teams,
  refreshKey,
  onRefresh,
}: {
  league: League
  countries: Country[]
  teamCount: number
  teams: Team[]
  refreshKey: number
  onRefresh: () => void
}) {
  const [name, setName] = useState(league.name)

  useEffect(() => {
    setName(league.name)
  }, [league.id, league.name])

  return (
    <div className="ed-preview">
      <header className="ed-preview__header">
        <h2>{league.name}</h2>
        <span className="ed-pill">
          {teamCount} time{teamCount === 1 ? '' : 's'}
        </span>
      </header>

      <EntityImageUpload
        entityType="league"
        entityId={league.id}
        label="Escudo da liga"
        refreshKey={refreshKey}
        onUpdated={onRefresh}
      />

      <label className="ed-field">
        <span>Nome</span>
        <input
          className="ed-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            if (name.trim() && name.trim() !== league.name) {
              updateLeague(getDatabase(), league.id, name.trim())
              onRefresh()
            } else {
              setName(league.name)
            }
          }}
        />
      </label>

      <label className="ed-field">
        <span>País</span>
        <select
          className="ed-select"
          value={league.countryId ?? ''}
          onChange={(e) => {
            updateLeague(getDatabase(), league.id, league.name, {
              countryId: e.target.value || null,
            })
            onRefresh()
          }}
        >
          <option value="">Sem país</option>
          {countries.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>

      {teams.length > 0 ? (
        <div className="ed-preview__section">
          <h3>Times nesta liga</h3>
          <ul className="ed-mini-list">
            {teams.map((t) => (
              <li key={t.id}>
                <span className="ed-swatch" style={{ background: t.primaryColor }} />
                {t.name}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="ed-preview__actions">
        <button
          type="button"
          className="ed-btn ed-btn--danger"
          onClick={() => {
            if (confirm(`Excluir liga "${league.name}"?`)) {
              deleteLeague(getDatabase(), league.id)
              onRefresh()
            }
          }}
        >
          Excluir liga
        </button>
      </div>
    </div>
  )
}
