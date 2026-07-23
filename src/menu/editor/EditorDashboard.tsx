import { useEffect, useMemo, useRef, useState } from 'react'
import {
  getActiveEditionId,
  listCountries,
  listEditionPlayers,
  listEditions,
  listLeagues,
  listTeams,
} from '../../db/queries'
import { getDatabase } from '../../db/database'
import { useAppStore } from '../../store/appStore'
import { GraphicsToggle } from '../../components/GraphicsToggle'
import { EditionsView, exportActiveEdition, importSqliteFile } from './EditionsView'
import { CountriesView } from './CountriesView'
import { LeaguesView } from './LeaguesView'
import { TeamsView } from './TeamsView'
import { PlayersView } from './PlayersView'
import { OverviewView } from './OverviewView'
import './editorDashboard.css'

export type EditorSection =
  | 'overview'
  | 'editions'
  | 'leagues'
  | 'countries'
  | 'teams'
  | 'players'

const NAV: { id: EditorSection; label: string; hint: string }[] = [
  { id: 'overview', label: 'Visão geral', hint: 'Resumo da edição' },
  { id: 'editions', label: 'Edições', hint: 'Ativar / importar' },
  { id: 'leagues', label: 'Ligas', hint: 'Escudos e nomes' },
  { id: 'countries', label: 'Países', hint: 'Bandeiras e nacionalidade' },
  { id: 'teams', label: 'Times', hint: 'Kits e elencos' },
  { id: 'players', label: 'Jogadores', hint: 'Perfil e atributos' },
]

export function EditorDashboard() {
  const setView = useAppStore((s) => s.setView)
  const bumpDbVersion = useAppStore((s) => s.bumpDbVersion)
  const dbVersion = useAppStore((s) => s.dbVersion)
  const importRef = useRef<HTMLInputElement>(null)

  const [section, setSection] = useState<EditorSection>('overview')
  const [search, setSearch] = useState('')
  const [leagueFilter, setLeagueFilter] = useState('all')
  const [glbFilter, setGlbFilter] = useState<'all' | 'custom' | 'default'>('all')
  const [teamFilter, setTeamFilter] = useState('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const snapshot = useMemo(() => {
    void dbVersion
    const db = getDatabase()
    const editions = listEditions(db)
    const activeId = getActiveEditionId(db) ?? editions[0]?.id ?? null
    const leagues = activeId ? listLeagues(db, activeId) : []
    const countries = activeId ? listCountries(db, activeId) : []
    const teams = activeId ? listTeams(db, activeId) : []
    const players = activeId ? listEditionPlayers(db, activeId) : []
    return { editions, activeId, leagues, countries, teams, players }
  }, [dbVersion])

  const activeEdition = snapshot.editions.find((e) => e.id === snapshot.activeId) ?? null

  const refresh = () => bumpDbVersion()

  useEffect(() => {
    setSelectedId(null)
    setSearch('')
    setLeagueFilter('all')
    setGlbFilter('all')
    setTeamFilter('all')
  }, [section, snapshot.activeId])

  const counts = {
    editions: snapshot.editions.length,
    leagues: snapshot.leagues.length,
    countries: snapshot.countries.length,
    teams: snapshot.teams.length,
    players: snapshot.players.length,
  }

  const sectionTitle = NAV.find((n) => n.id === section)?.label ?? 'Editor'
  const showSearch = section !== 'overview'
  const showLeagueFilter = section === 'teams'
  const showPlayerFilters = section === 'players'

  return (
    <div className="edash">
      <aside className="edash-sidebar">
        <div className="edash-sidebar__brand">
          <button
            type="button"
            className="edash-back"
            onClick={() => setView('menu')}
          >
            ← Menu
          </button>
          <h1>Editor</h1>
          <p>Dashboard de conteúdo</p>
        </div>

        <nav className="edash-nav" aria-label="Seções do editor">
          {NAV.map((item) => {
            const count =
              item.id === 'overview'
                ? null
                : counts[item.id as keyof typeof counts]
            return (
              <button
                key={item.id}
                type="button"
                className={`edash-nav__item${section === item.id ? ' edash-nav__item--active' : ''}`}
                onClick={() => setSection(item.id)}
              >
                <span className="edash-nav__label">{item.label}</span>
                <span className="edash-nav__hint">{item.hint}</span>
                {count != null ? <span className="edash-nav__count">{count}</span> : null}
              </button>
            )
          })}
        </nav>

        <div className="edash-sidebar__foot">
          <div className="edash-active-edition">
            <span>Edição ativa</span>
            <strong>{activeEdition?.name ?? '—'}</strong>
          </div>
          <GraphicsToggle className="edash-graphics" />
        </div>
      </aside>

      <div className="edash-main">
        <header className="edash-topbar">
          <div className="edash-topbar__titles">
            <h2>{sectionTitle}</h2>
            {activeEdition && section !== 'editions' && section !== 'overview' ? (
              <p>Escopo: {activeEdition.name}</p>
            ) : null}
          </div>

          <div className="edash-topbar__controls">
            {showSearch ? (
              <label className="edash-search">
                <span className="edash-search__icon" aria-hidden>
                  ⌕
                </span>
                <input
                  className="ed-input ed-input--search"
                  placeholder={
                    section === 'players'
                      ? 'Buscar jogador…'
                      : section === 'teams'
                        ? 'Buscar time…'
                        : section === 'leagues'
                          ? 'Buscar liga…'
                          : section === 'countries'
                            ? 'Buscar país…'
                            : 'Buscar edição…'
                  }
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </label>
            ) : null}

            {showLeagueFilter ? (
              <select
                className="ed-select"
                value={leagueFilter}
                onChange={(e) => setLeagueFilter(e.target.value)}
                aria-label="Filtrar por liga"
              >
                <option value="all">Todas as ligas</option>
                <option value="none">Sem liga</option>
                {snapshot.leagues.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            ) : null}

            {showPlayerFilters ? (
              <>
                <select
                  className="ed-select"
                  value={glbFilter}
                  onChange={(e) =>
                    setGlbFilter(e.target.value as 'all' | 'custom' | 'default')
                  }
                  aria-label="Filtrar por GLB"
                >
                  <option value="all">Todos os modelos</option>
                  <option value="custom">Com GLB custom</option>
                  <option value="default">Modelo padrão</option>
                </select>
                <select
                  className="ed-select"
                  value={teamFilter}
                  onChange={(e) => setTeamFilter(e.target.value)}
                  aria-label="Filtrar por time"
                >
                  <option value="all">Todos os times</option>
                  {snapshot.teams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </>
            ) : null}

            {section === 'editions' ? (
              <>
                <button
                  type="button"
                  className="ed-btn"
                  onClick={() => importRef.current?.click()}
                >
                  Importar .sqlite
                </button>
                <button
                  type="button"
                  className="ed-btn"
                  disabled={!activeEdition}
                  onClick={() =>
                    exportActiveEdition(activeEdition?.name ?? 'edicao')
                  }
                >
                  Exportar
                </button>
              </>
            ) : null}
          </div>
        </header>

        <div
          className={`edash-workspace${section === 'overview' ? ' edash-workspace--single' : ''}`}
        >
          {section === 'overview' ? (
            <OverviewView
              stats={{
                editions: counts.editions,
                leagues: counts.leagues,
                countries: counts.countries,
                teams: counts.teams,
                players: counts.players,
                customGlbs: snapshot.players.filter((p) => p.hasCustomGlb).length,
                activeEditionName: activeEdition?.name ?? null,
              }}
              onNavigate={setSection}
            />
          ) : null}

          {section === 'editions' ? (
            <EditionsView
              editions={snapshot.editions}
              activeId={snapshot.activeId}
              selectedId={selectedId}
              search={search}
              onSelect={setSelectedId}
              onRefresh={refresh}
            />
          ) : null}

          {section === 'leagues' && snapshot.activeId ? (
            <LeaguesView
              editionId={snapshot.activeId}
              leagues={snapshot.leagues}
              teams={snapshot.teams}
              countries={snapshot.countries}
              selectedId={selectedId}
              search={search}
              refreshKey={dbVersion}
              onSelect={setSelectedId}
              onRefresh={refresh}
            />
          ) : null}

          {section === 'countries' && snapshot.activeId ? (
            <CountriesView
              editionId={snapshot.activeId}
              countries={snapshot.countries}
              players={snapshot.players}
              selectedId={selectedId}
              search={search}
              refreshKey={dbVersion}
              onSelect={setSelectedId}
              onRefresh={refresh}
            />
          ) : null}

          {section === 'teams' && snapshot.activeId ? (
            <TeamsView
              editionId={snapshot.activeId}
              leagues={snapshot.leagues}
              teams={snapshot.teams}
              countries={snapshot.countries}
              editionPlayers={snapshot.players}
              selectedId={selectedId}
              search={search}
              leagueFilter={leagueFilter}
              refreshKey={dbVersion}
              onSelect={setSelectedId}
              onRefresh={refresh}
            />
          ) : null}

          {section === 'players' && snapshot.activeId ? (
            <PlayersView
              editionId={snapshot.activeId}
              editionPlayers={snapshot.players}
              teams={snapshot.teams}
              countries={snapshot.countries}
              selectedId={selectedId}
              search={search}
              glbFilter={glbFilter}
              teamFilter={teamFilter}
              refreshKey={dbVersion}
              onSelect={setSelectedId}
              onRefresh={refresh}
            />
          ) : null}

          {(section === 'leagues' ||
            section === 'countries' ||
            section === 'teams' ||
            section === 'players') &&
          !snapshot.activeId ? (
            <p className="edash-empty edash-empty--full">
              Crie ou ative uma edição para editar este conteúdo.
            </p>
          ) : null}
        </div>
      </div>

      <input
        ref={importRef}
        type="file"
        accept=".sqlite,.db,application/x-sqlite3"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void importSqliteFile(file, refresh)
          e.target.value = ''
        }}
      />
    </div>
  )
}
