type OverviewStats = {
  editions: number
  leagues: number
  countries: number
  teams: number
  players: number
  customGlbs: number
  activeEditionName: string | null
}

export function OverviewView({
  stats,
  onNavigate,
}: {
  stats: OverviewStats
  onNavigate: (
    section: 'editions' | 'leagues' | 'countries' | 'teams' | 'players',
  ) => void
}) {
  return (
    <div className="ed-overview">
      <header className="ed-overview__hero">
        <p className="ed-overview__eyebrow">Painel de conteúdo</p>
        <h2>{stats.activeEditionName ?? 'Nenhuma edição ativa'}</h2>
        <p>
          Gerencie edições, países, ligas, times, uniformes e o pool de jogadores com
          atributos e nacionalidade.
        </p>
      </header>

      <div className="ed-stat-grid">
        {(
          [
            ['editions', 'Edições', stats.editions],
            ['leagues', 'Ligas', stats.leagues],
            ['countries', 'Países', stats.countries],
            ['teams', 'Times', stats.teams],
            ['players', 'Jogadores', stats.players],
          ] as const
        ).map(([id, label, value]) => (
          <button
            key={id}
            type="button"
            className="ed-stat"
            onClick={() => onNavigate(id)}
          >
            <span className="ed-stat__value">{value}</span>
            <span className="ed-stat__label">{label}</span>
          </button>
        ))}
      </div>

      <div className="ed-overview__note">
        <strong>{stats.customGlbs}</strong> jogador
        {stats.customGlbs === 1 ? '' : 'es'} com GLB customizado
      </div>

      <div className="ed-overview__actions">
        <button type="button" className="ed-btn ed-btn--primary" onClick={() => onNavigate('teams')}>
          Ir para times
        </button>
        <button type="button" className="ed-btn" onClick={() => onNavigate('players')}>
          Ir para jogadores
        </button>
        <button type="button" className="ed-btn" onClick={() => onNavigate('countries')}>
          Ir para países
        </button>
        <button type="button" className="ed-btn" onClick={() => onNavigate('editions')}>
          Gerenciar edições
        </button>
      </div>
    </div>
  )
}
