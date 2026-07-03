import type { Database } from 'sql.js'
import { createTeam } from './queries'

const DEFAULT_HOME_NAMES = [
  'Alisson',
  'Alex',
  'Marquinhos',
  'Breno',
  'Dani',
  'Casemiro',
  'Oscar',
  'Lucas',
  'Rodrygo',
  'Neymar',
  'Rivaldo',
]

const DEFAULT_AWAY_NAMES = [
  'Martinez',
  'Garcia',
  'Santos',
  'Lima',
  'Costa',
  'Silva',
  'Souza',
  'Pereira',
  'Alves',
  'Torres',
  'Bojinov',
]

function uid(): string {
  return crypto.randomUUID()
}

export function seedDefaultEdition(db: Database): string {
  const editionId = uid()
  const leagueId = uid()
  const now = Date.now()

  db.run(
    'INSERT INTO editions (id, name, created_at) VALUES (?, ?, ?)',
    [editionId, 'Edição Padrão', now],
  )
  db.run(
    'INSERT INTO leagues (id, edition_id, name, sort_order) VALUES (?, ?, ?, ?)',
    [leagueId, editionId, 'Amistosos', 0],
  )

  createTeam(db, editionId, {
    name: 'Brasil',
    shortName: 'BRA',
    primaryColor: '#3b82f6',
    secondaryColor: '#1d4ed8',
    gkColor: '#facc15',
    leagueId,
    rosterNames: [...DEFAULT_HOME_NAMES],
  })

  createTeam(db, editionId, {
    name: 'Visitante',
    shortName: 'VIS',
    primaryColor: '#ef4444',
    secondaryColor: '#b91c1c',
    gkColor: '#fb923c',
    leagueId,
    rosterNames: [...DEFAULT_AWAY_NAMES],
  })

  db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [
    'active_edition_id',
    editionId,
  ])

  return editionId
}
