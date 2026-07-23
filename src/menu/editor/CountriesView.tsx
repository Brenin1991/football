import { useEffect, useMemo, useState } from 'react'
import { createCountry, deleteCountry, updateCountry } from '../../db/queries'
import { getDatabase } from '../../db/database'
import type { Country, EditionPlayer } from '../../db/types'
import { EntityImageUpload } from '../components/EntityImageUpload'
import { CrestThumb } from './EditionsView'
import { EmptyPreview } from './EmptyPreview'

export function CountriesView({
  editionId,
  countries,
  players,
  selectedId,
  search,
  refreshKey,
  onSelect,
  onRefresh,
}: {
  editionId: string
  countries: Country[]
  players: EditionPlayer[]
  selectedId: string | null
  search: string
  refreshKey: number
  onSelect: (id: string) => void
  onRefresh: () => void
}) {
  const [newName, setNewName] = useState('')

  const playerCountByCountry = useMemo(() => {
    const map = new Map<string, number>()
    for (const p of players) {
      if (!p.countryId) continue
      map.set(p.countryId, (map.get(p.countryId) ?? 0) + 1)
    }
    return map
  }, [players])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return countries
    return countries.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.code ?? '').toLowerCase().includes(q) ||
        (c.nationalityLabel ?? '').toLowerCase().includes(q),
    )
  }, [countries, search])

  const selected = countries.find((c) => c.id === selectedId) ?? null

  const create = () => {
    if (!newName.trim()) return
    const country = createCountry(getDatabase(), editionId, { name: newName.trim() })
    setNewName('')
    onRefresh()
    onSelect(country.id)
  }

  return (
    <>
      <div className="edash-list">
        <div className="edash-list__toolbar">
          <input
            className="ed-input"
            placeholder="Nome do novo país"
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
          <p className="edash-empty">Nenhum país encontrado.</p>
        ) : (
          <ul className="edash-rows">
            {filtered.map((country) => (
              <li key={country.id}>
                <button
                  type="button"
                  className={`edash-row${selectedId === country.id ? ' edash-row--active' : ''}`}
                  onClick={() => onSelect(country.id)}
                >
                  <CrestThumb
                    type="country"
                    id={country.id}
                    alt={country.name}
                    refreshKey={refreshKey}
                  />
                  <div className="edash-row__main">
                    <strong>{country.name}</strong>
                    <span className="edash-row__meta">
                      {country.code ? `${country.code} · ` : ''}
                      {playerCountByCountry.get(country.id) ?? 0} jogador
                      {(playerCountByCountry.get(country.id) ?? 0) === 1 ? '' : 'es'}
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
          <CountryPreview
            key={selected.id}
            country={selected}
            playerCount={playerCountByCountry.get(selected.id) ?? 0}
            refreshKey={refreshKey}
            onRefresh={onRefresh}
          />
        ) : (
          <EmptyPreview hint="Selecione um país para editar bandeira e nacionalidade." />
        )}
      </aside>
    </>
  )
}

function CountryPreview({
  country,
  playerCount,
  refreshKey,
  onRefresh,
}: {
  country: Country
  playerCount: number
  refreshKey: number
  onRefresh: () => void
}) {
  const [name, setName] = useState(country.name)
  const [code, setCode] = useState(country.code ?? '')
  const [nationality, setNationality] = useState(country.nationalityLabel ?? '')

  useEffect(() => {
    setName(country.name)
    setCode(country.code ?? '')
    setNationality(country.nationalityLabel ?? '')
  }, [country.id, country.name, country.code, country.nationalityLabel])

  const save = () => {
    if (!name.trim()) {
      setName(country.name)
      return
    }
    updateCountry(getDatabase(), country.id, {
      name: name.trim(),
      code: code.trim() || null,
      nationalityLabel: nationality.trim() || null,
    })
    onRefresh()
  }

  return (
    <div className="ed-preview">
      <header className="ed-preview__header">
        <div className="ed-preview__title-row">
          <CrestThumb
            type="country"
            id={country.id}
            alt={country.name}
            refreshKey={refreshKey}
          />
          <div>
            <h2>{country.name}</h2>
            <p className="ed-preview__sub">
              {playerCount} jogador{playerCount === 1 ? '' : 'es'}
            </p>
          </div>
        </div>
      </header>

      <EntityImageUpload
        entityType="country"
        entityId={country.id}
        label="Bandeira"
        refreshKey={refreshKey}
        onUpdated={onRefresh}
      />

      <label className="ed-field">
        <span>Nome</span>
        <input
          className="ed-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={save}
        />
      </label>

      <label className="ed-field">
        <span>Código (ex: BRA)</span>
        <input
          className="ed-input"
          value={code}
          maxLength={8}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          onBlur={save}
        />
      </label>

      <label className="ed-field">
        <span>Nacionalidade (rótulo)</span>
        <input
          className="ed-input"
          placeholder="Brasileiro"
          value={nationality}
          onChange={(e) => setNationality(e.target.value)}
          onBlur={save}
        />
      </label>

      <div className="ed-preview__actions">
        <button
          type="button"
          className="ed-btn ed-btn--danger"
          onClick={() => {
            if (confirm(`Excluir país "${country.name}"?`)) {
              deleteCountry(getDatabase(), country.id)
              onRefresh()
            }
          }}
        >
          Excluir país
        </button>
      </div>
    </div>
  )
}
