import { useEffect, useMemo, useState } from 'react'
import {
  createEdition,
  deleteEdition,
  setActiveEditionId,
  updateEdition,
} from '../../db/queries'
import { downloadDatabase, getDatabase, replaceDatabase } from '../../db/database'
import type { Edition } from '../../db/types'
import { EntityImage } from '../../components/EntityImage'
import { EmptyPreview } from './EmptyPreview'

export function EditionsView({
  editions,
  activeId,
  selectedId,
  search,
  onSelect,
  onRefresh,
}: {
  editions: Edition[]
  activeId: string | null
  selectedId: string | null
  search: string
  onSelect: (id: string) => void
  onRefresh: () => void
}) {
  const [newName, setNewName] = useState('')
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return editions
    return editions.filter((e) => e.name.toLowerCase().includes(q))
  }, [editions, search])

  const selected = editions.find((e) => e.id === selectedId) ?? null

  const create = () => {
    if (!newName.trim()) return
    const edition = createEdition(getDatabase(), newName.trim())
    setActiveEditionId(getDatabase(), edition.id)
    setNewName('')
    onRefresh()
    onSelect(edition.id)
  }

  return (
    <>
      <div className="edash-list">
        <div className="edash-list__toolbar">
          <input
            className="ed-input"
            placeholder="Nome da nova edição"
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
            Criar
          </button>
        </div>

        {filtered.length === 0 ? (
          <p className="edash-empty">Nenhuma edição encontrada.</p>
        ) : (
          <ul className="edash-rows">
            {filtered.map((edition) => (
              <li key={edition.id}>
                <button
                  type="button"
                  className={`edash-row${selectedId === edition.id ? ' edash-row--active' : ''}`}
                  onClick={() => onSelect(edition.id)}
                >
                  <div className="edash-row__main">
                    <strong>{edition.name}</strong>
                    <span className="edash-row__meta">
                      {new Date(edition.createdAt).toLocaleDateString('pt-BR')}
                    </span>
                  </div>
                  {activeId === edition.id ? (
                    <span className="ed-pill ed-pill--accent">Ativa</span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <aside className="edash-preview">
        {selected ? (
          <EditionPreview
            key={selected.id}
            edition={selected}
            isActive={activeId === selected.id}
            canDelete={editions.length > 1}
            onRefresh={onRefresh}
          />
        ) : (
          <EmptyPreview hint="Selecione uma edição para gerenciar." />
        )}
      </aside>
    </>
  )
}

function EditionPreview({
  edition,
  isActive,
  canDelete,
  onRefresh,
}: {
  edition: Edition
  isActive: boolean
  canDelete: boolean
  onRefresh: () => void
}) {
  const [name, setName] = useState(edition.name)

  useEffect(() => {
    setName(edition.name)
  }, [edition.id, edition.name])

  return (
    <div className="ed-preview">
      <header className="ed-preview__header">
        <h2>{edition.name}</h2>
        {isActive ? <span className="ed-pill ed-pill--accent">Edição ativa</span> : null}
      </header>

      <label className="ed-field">
        <span>Nome</span>
        <input
          className="ed-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            if (name.trim() && name.trim() !== edition.name) {
              updateEdition(getDatabase(), edition.id, name.trim())
              onRefresh()
            } else {
              setName(edition.name)
            }
          }}
        />
      </label>

      <div className="ed-preview__actions">
        {!isActive ? (
          <button
            type="button"
            className="ed-btn ed-btn--primary"
            onClick={() => {
              setActiveEditionId(getDatabase(), edition.id)
              onRefresh()
            }}
          >
            Ativar edição
          </button>
        ) : null}
        <button
          type="button"
          className="ed-btn ed-btn--danger"
          disabled={!canDelete}
          onClick={() => {
            if (confirm(`Excluir "${edition.name}"?`)) {
              deleteEdition(getDatabase(), edition.id)
              onRefresh()
            }
          }}
        >
          Excluir
        </button>
      </div>
    </div>
  )
}

export async function importSqliteFile(file: File, onRefresh: () => void) {
  const buffer = await file.arrayBuffer()
  replaceDatabase(new Uint8Array(buffer))
  onRefresh()
}

export function exportActiveEdition(name: string) {
  downloadDatabase(`${name.replace(/\s+/g, '-').toLowerCase() || 'edicao'}.sqlite`)
}

export function CrestThumb({
  type,
  id,
  alt,
  refreshKey,
}: {
  type: 'league' | 'team' | 'player' | 'country'
  id: string
  alt: string
  refreshKey: number
}) {
  if (type === 'player') {
    return (
      <EntityImage
        entityType="player"
        entityId={id}
        alt={alt}
        refreshKey={refreshKey}
        className="ed-thumb ed-thumb--photo"
        fallback={<div className="ed-thumb ed-thumb--photo ed-thumb--fallback" />}
      />
    )
  }
  return (
    <EntityImage
      entityType={type}
      entityId={id}
      alt={alt}
      refreshKey={refreshKey}
      className="ed-thumb ed-thumb--crest"
      fallback={<div className="ed-thumb ed-thumb--crest ed-thumb--fallback" />}
    />
  )
}
