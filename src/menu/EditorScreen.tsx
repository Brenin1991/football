import { useMemo, useRef, useState } from 'react'
import {
  createEdition,
  createEditionPlayer,
  createLeague,
  createTeam,
  deleteEdition,
  deleteEditionPlayer,
  deleteLeague,
  deleteTeam,
  getActiveEditionId,
  listEditionPlayers,
  listEditions,
  listLeagues,
  listPlayerTeamNames,
  listRoster,
  listTeamKits,
  listTeams,
  setActiveEditionId,
  setRosterSlot,
  updateEdition,
  updateEditionPlayer,
  updateLeague,
  updateRosterPosition,
  updateTeam,
  upsertTeamKit,
} from '../db/queries'
import { downloadDatabase, getDatabase, replaceDatabase } from '../db/database'
import { SKIN_TONE_OPTIONS, getSkinToneColor } from '../db/skinTones'
import type { EditionPlayer, League, RosterSlot, Team, TeamKit } from '../db/types'
import { FORMATION_POSITION_LABELS } from '../game/data/playerRoster'
import { useAppStore } from '../store/appStore'
import { MenuShell } from './components/MenuShell'
import { MenuPadHints } from './components/MenuPadHints'
import { EntityImage } from '../components/EntityImage'
import { EntityImageUpload } from './components/EntityImageUpload'
import { TeamShirtTextureEditor } from './components/TeamKitPreviewEditor'

type EditorTab = 'editions' | 'leagues' | 'teams' | 'players'

export function EditorScreen() {
  const setView = useAppStore((s) => s.setView)
  const bumpDbVersion = useAppStore((s) => s.bumpDbVersion)
  const dbVersion = useAppStore((s) => s.dbVersion)
  const [tab, setTab] = useState<EditorTab>('editions')
  const importRef = useRef<HTMLInputElement>(null)

  const snapshot = useMemo(() => {
    void dbVersion
    const db = getDatabase()
    const editions = listEditions(db)
    const activeId = getActiveEditionId(db) ?? editions[0]?.id ?? null
    const leagues = activeId ? listLeagues(db, activeId) : []
    const teams = activeId ? listTeams(db, activeId) : []
    return { editions, activeId, leagues, teams }
  }, [dbVersion])

  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(snapshot.teams[0]?.id ?? null)
  const editionPlayers = useMemo(() => {
    if (!snapshot.activeId) return []
    void dbVersion
    return listEditionPlayers(getDatabase(), snapshot.activeId)
  }, [snapshot.activeId, dbVersion])

  const roster = useMemo(() => {
    if (!selectedTeamId) return []
    void dbVersion
    return listRoster(getDatabase(), selectedTeamId)
  }, [selectedTeamId, dbVersion])

  const refresh = () => bumpDbVersion()

  const handleImport = async (file: File) => {
    const buffer = await file.arrayBuffer()
    replaceDatabase(new Uint8Array(buffer))
    refresh()
  }

  return (
    <MenuShell
      title="Editor"
      subtitle="Edições, ligas, times e elencos"
      onBack={() => setView('menu')}
      footer={<MenuPadHints back="Menu" />}
    >
      <div className="editor-tabs">
        {(
          [
            ['editions', 'Edições'],
            ['leagues', 'Ligas'],
            ['teams', 'Times'],
            ['players', 'Jogadores'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`editor-tab${tab === id ? ' editor-tab--active' : ''}`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'editions' ? (
        <EditionsPanel
          editions={snapshot.editions}
          activeId={snapshot.activeId}
          onRefresh={refresh}
          onImport={() => importRef.current?.click()}
          onExport={() => {
            const name = snapshot.editions.find((e) => e.id === snapshot.activeId)?.name ?? 'edicao'
            downloadDatabase(`${name.replace(/\s+/g, '-').toLowerCase()}.sqlite`)
          }}
        />
      ) : null}

      {tab === 'leagues' && snapshot.activeId ? (
        <LeaguesPanel
          editionId={snapshot.activeId}
          leagues={snapshot.leagues}
          refreshKey={dbVersion}
          onRefresh={refresh}
        />
      ) : null}

      {tab === 'teams' && snapshot.activeId ? (
        <TeamsPanel
          editionId={snapshot.activeId}
          leagues={snapshot.leagues}
          teams={snapshot.teams}
          editionPlayers={editionPlayers}
          refreshKey={dbVersion}
          onRefresh={refresh}
        />
      ) : null}

      {tab === 'players' && snapshot.activeId ? (
        <PlayersPanel
          editionId={snapshot.activeId}
          editionPlayers={editionPlayers}
          teams={snapshot.teams}
          selectedTeamId={selectedTeamId}
          roster={roster}
          refreshKey={dbVersion}
          onSelectTeam={setSelectedTeamId}
          onRefresh={refresh}
        />
      ) : null}

      <input
        ref={importRef}
        type="file"
        accept=".sqlite,.db,application/x-sqlite3"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void handleImport(file)
          e.target.value = ''
        }}
      />
    </MenuShell>
  )
}

function EditionsPanel({
  editions,
  activeId,
  onRefresh,
  onImport,
  onExport,
}: {
  editions: { id: string; name: string }[]
  activeId: string | null
  onRefresh: () => void
  onImport: () => void
  onExport: () => void
}) {
  const [name, setName] = useState('')

  return (
    <div className="editor-panel">
      <div className="editor-toolbar">
        <input
          className="menu-input"
          placeholder="Nome da nova edição"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button
          type="button"
          className="menu-btn menu-btn--primary"
          disabled={!name.trim()}
          onClick={() => {
            const edition = createEdition(getDatabase(), name.trim())
            setActiveEditionId(getDatabase(), edition.id)
            setName('')
            onRefresh()
          }}
        >
          Criar edição
        </button>
        <button type="button" className="menu-btn" onClick={onImport}>
          Importar .sqlite
        </button>
        <button type="button" className="menu-btn" onClick={onExport}>
          Exportar edição
        </button>
      </div>
      <ul className="editor-list">
        {editions.map((edition) => (
          <li key={edition.id} className="editor-list__item pes-hud-surface">
            <div>
              <strong>{edition.name}</strong>
              {activeId === edition.id ? <span className="editor-badge">Ativa</span> : null}
            </div>
            <div className="editor-list__actions">
              {activeId !== edition.id ? (
                <button
                  type="button"
                  className="menu-btn menu-btn--ghost"
                  onClick={() => {
                    setActiveEditionId(getDatabase(), edition.id)
                    onRefresh()
                  }}
                >
                  Ativar
                </button>
              ) : null}
              <button
                type="button"
                className="menu-btn menu-btn--ghost"
                onClick={() => {
                  const next = prompt('Renomear edição', edition.name)
                  if (next?.trim()) {
                    updateEdition(getDatabase(), edition.id, next.trim())
                    onRefresh()
                  }
                }}
              >
                Renomear
              </button>
              <button
                type="button"
                className="menu-btn menu-btn--danger"
                disabled={editions.length <= 1}
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
          </li>
        ))}
      </ul>
    </div>
  )
}

function LeaguesPanel({
  editionId,
  leagues,
  refreshKey,
  onRefresh,
}: {
  editionId: string
  leagues: League[]
  refreshKey: number
  onRefresh: () => void
}) {
  const [name, setName] = useState('')

  return (
    <div className="editor-panel">
      <div className="editor-toolbar">
        <input
          className="menu-input"
          placeholder="Nova liga"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button
          type="button"
          className="menu-btn menu-btn--primary"
          disabled={!name.trim()}
          onClick={() => {
            createLeague(getDatabase(), editionId, name.trim())
            setName('')
            onRefresh()
          }}
        >
          Adicionar liga
        </button>
      </div>
      <ul className="editor-list">
        {leagues.map((league) => (
          <li key={league.id} className="editor-list__item pes-hud-surface league-row">
            <EntityImage
              entityType="league"
              entityId={league.id}
              alt={`Escudo ${league.name}`}
              refreshKey={refreshKey}
              className="entity-crest entity-crest--sm"
              fallback={<div className="entity-image-fallback entity-image-fallback--crest entity-crest--sm" />}
            />
            <strong>{league.name}</strong>
            <div className="editor-list__actions">
              <EntityImageUpload
                entityType="league"
                entityId={league.id}
                label="Escudo da liga"
                refreshKey={refreshKey}
                onUpdated={onRefresh}
              />
              <button
                type="button"
                className="menu-btn menu-btn--ghost"
                onClick={() => {
                  const next = prompt('Renomear liga', league.name)
                  if (next?.trim()) {
                    updateLeague(getDatabase(), league.id, next.trim())
                    onRefresh()
                  }
                }}
              >
                Renomear
              </button>
              <button
                type="button"
                className="menu-btn menu-btn--danger"
                onClick={() => {
                  if (confirm(`Excluir liga "${league.name}"?`)) {
                    deleteLeague(getDatabase(), league.id)
                    onRefresh()
                  }
                }}
              >
                Excluir
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

function TeamsPanel({
  editionId,
  leagues,
  teams,
  editionPlayers,
  refreshKey,
  onRefresh,
}: {
  editionId: string
  leagues: League[]
  teams: Team[]
  editionPlayers: EditionPlayer[]
  refreshKey: number
  onRefresh: () => void
}) {
  const [draft, setDraft] = useState({
    name: '',
    primaryColor: '#3b82f6',
    secondaryColor: '#1d4ed8',
    gkColor: '#facc15',
    leagueId: leagues[0]?.id ?? '',
  })

  return (
    <div className="editor-panel">
      <div className="editor-form pes-hud-surface">
        <h3>Novo time</h3>
        <div className="editor-form__grid">
          <label className="menu-field">
            <span>Nome</span>
            <input
              className="menu-input"
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            />
          </label>
          <label className="menu-field">
            <span>Liga</span>
            <select
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
          <ColorField label="Cor principal" value={draft.primaryColor} onChange={(v) => setDraft((d) => ({ ...d, primaryColor: v }))} />
          <ColorField label="Cor secundária" value={draft.secondaryColor} onChange={(v) => setDraft((d) => ({ ...d, secondaryColor: v }))} />
          <ColorField label="Cor goleiro" value={draft.gkColor} onChange={(v) => setDraft((d) => ({ ...d, gkColor: v }))} />
        </div>
        <button
          type="button"
          className="menu-btn menu-btn--primary"
          disabled={!draft.name.trim()}
          onClick={() => {
            createTeam(getDatabase(), editionId, {
              name: draft.name.trim(),
              primaryColor: draft.primaryColor,
              secondaryColor: draft.secondaryColor,
              gkColor: draft.gkColor,
              leagueId: draft.leagueId || null,
            })
            setDraft({
              name: '',
              primaryColor: '#3b82f6',
              secondaryColor: '#1d4ed8',
              gkColor: '#facc15',
              leagueId: leagues[0]?.id ?? '',
            })
            onRefresh()
          }}
        >
          Criar time
        </button>
      </div>
      <ul className="editor-list">
        {teams.map((team) => (
          <TeamRow
            key={team.id}
            team={team}
            leagues={leagues}
            editionPlayers={editionPlayers}
            refreshKey={refreshKey}
            onRefresh={onRefresh}
          />
        ))}
      </ul>
    </div>
  )
}

function TeamRow({
  team,
  leagues,
  editionPlayers,
  refreshKey,
  onRefresh,
}: {
  team: Team
  leagues: League[]
  editionPlayers: EditionPlayer[]
  refreshKey: number
  onRefresh: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(team)
  const kits = useMemo(() => listTeamKits(getDatabase(), team.id), [team.id, refreshKey, editing])
  const roster = useMemo(() => listRoster(getDatabase(), team.id), [team.id, refreshKey, editing])

  if (!editing) {
    return (
      <li className="editor-list__item pes-hud-surface">
        <div className="team-row">
          <EntityImage
            entityType="team"
            entityId={team.id}
            alt={`Escudo ${team.name}`}
            refreshKey={refreshKey}
            className="entity-crest entity-crest--sm"
            fallback={<div className="entity-image-fallback entity-image-fallback--crest entity-crest--sm" />}
          />
          <span className="team-row__swatch" style={{ background: team.primaryColor }} />
          <div>
            <strong>{team.name}</strong>
            <small>{leagues.find((l) => l.id === team.leagueId)?.name ?? 'Sem liga'}</small>
          </div>
        </div>
        <div className="editor-list__actions">
          <button type="button" className="menu-btn menu-btn--ghost" onClick={() => setEditing(true)}>
            Editar
          </button>
          <button
            type="button"
            className="menu-btn menu-btn--danger"
            onClick={() => {
              if (confirm(`Excluir time "${team.name}"?`)) {
                deleteTeam(getDatabase(), team.id)
                onRefresh()
              }
            }}
          >
            Excluir
          </button>
        </div>
      </li>
    )
  }

  const kit1 = kits.find((k) => k.kitNumber === 1)
  const kit2 = kits.find((k) => k.kitNumber === 2)

  return (
    <li className="editor-list__item pes-hud-surface editor-list__item--form team-editor">
      <div className="editor-form__grid">
        <label className="menu-field">
          <span>Nome</span>
          <input
            className="menu-input"
            value={draft.name}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
          />
        </label>
        <label className="menu-field">
          <span>Liga</span>
          <select
            value={draft.leagueId ?? ''}
            onChange={(e) => setDraft((d) => ({ ...d, leagueId: e.target.value || null }))}
          >
            <option value="">Sem liga</option>
            {leagues.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <ColorField label="Camisa goleiro" value={draft.gkColor} onChange={(v) => setDraft((d) => ({ ...d, gkColor: v }))} />
      </div>

      <EntityImageUpload
        entityType="team"
        entityId={team.id}
        label="Escudo do time"
        refreshKey={refreshKey}
        onUpdated={onRefresh}
      />

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

      <TeamShirtTextureEditor
        teamId={team.id}
        kits={kits}
        refreshKey={refreshKey}
      />

      <div className="roster-editor">
        <h4>Elenco (11 titulares)</h4>
        <p className="roster-editor__hint">O mesmo jogador pode estar em vários times da edição.</p>
        {Array.from({ length: 11 }, (_, slotIndex) => {
          const slot = roster.find((r) => r.slotIndex === slotIndex)
          return (
            <RosterSlotRow
              key={slotIndex}
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
            />
          )
        })}
      </div>

      <div className="editor-list__actions">
        <button
          type="button"
          className="menu-btn menu-btn--primary"
          onClick={() => {
            updateTeam(getDatabase(), team.id, {
              name: draft.name.trim(),
              shortName: draft.shortName,
              primaryColor: kit1?.shirtColor ?? draft.primaryColor,
              secondaryColor: kit1?.shortsColor ?? draft.secondaryColor,
              gkColor: draft.gkColor,
              leagueId: draft.leagueId,
            })
            setEditing(false)
            onRefresh()
          }}
        >
          Salvar
        </button>
        <button type="button" className="menu-btn" onClick={() => setEditing(false)}>
          Cancelar
        </button>
      </div>
    </li>
  )
}

function KitEditor({
  label,
  kit,
  fallbackShirt,
  fallbackShorts,
  onChange,
}: {
  label: string
  kit?: TeamKit
  fallbackShirt: string
  fallbackShorts: string
  onChange: (data: { shirtColor: string; shortsColor: string; socksColor: string }) => void
}) {
  const shirt = kit?.shirtColor ?? fallbackShirt
  const shorts = kit?.shortsColor ?? fallbackShorts
  const socks = kit?.socksColor ?? shirt

  return (
    <div className="kit-editor pes-hud-surface">
      <h4>{label}</h4>
      <div className="kit-editor__grid">
        <ColorField
          label="Camisa (Ch38_Shirt)"
          value={shirt}
          onChange={(v) => onChange({ shirtColor: v, shortsColor: shorts, socksColor: socks })}
        />
        <ColorField
          label="Bermuda (Ch38_Shorts)"
          value={shorts}
          onChange={(v) => onChange({ shirtColor: shirt, shortsColor: v, socksColor: socks })}
        />
        <ColorField
          label="Meias (Ch38_Socks)"
          value={socks}
          onChange={(v) => onChange({ shirtColor: shirt, shortsColor: shorts, socksColor: v })}
        />
      </div>
      <div className="kit-editor__preview">
        <span style={{ background: shirt }} title="Camisa" />
        <span style={{ background: shorts }} title="Bermuda" />
        <span style={{ background: socks }} title="Meias" />
      </div>
    </div>
  )
}

function RosterSlotRow({
  slotIndex,
  slot,
  editionPlayers,
  onAssign,
  onPosition,
}: {
  slotIndex: number
  slot?: RosterSlot
  editionPlayers: EditionPlayer[]
  onAssign: (playerId: string, position: string) => void
  onPosition: (position: string) => void
}) {
  const position = slot?.positionLabel ?? FORMATION_POSITION_LABELS[slotIndex] ?? 'CM'

  return (
    <div className="player-row pes-hud-surface">
      <span className="player-row__num">{slotIndex + 1}</span>
      <select
        value={position}
        onChange={(e) => onPosition(e.target.value)}
      >
        {FORMATION_POSITION_LABELS.map((pos) => (
          <option key={pos} value={pos}>
            {pos}
          </option>
        ))}
      </select>
      <select
        value={slot?.playerId ?? ''}
        onChange={(e) => {
          if (e.target.value) onAssign(e.target.value, position)
        }}
      >
        <option value="">Selecionar jogador</option>
        {editionPlayers.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </div>
  )
}

function PlayersPanel({
  editionId,
  editionPlayers,
  teams,
  selectedTeamId,
  roster,
  refreshKey,
  onSelectTeam,
  onRefresh,
}: {
  editionId: string
  editionPlayers: EditionPlayer[]
  teams: Team[]
  selectedTeamId: string | null
  roster: RosterSlot[]
  refreshKey: number
  onSelectTeam: (id: string) => void
  onRefresh: () => void
}) {
  const [name, setName] = useState('')

  return (
    <div className="editor-panel">
      <div className="editor-toolbar">
        <input
          className="menu-input"
          placeholder="Nome do jogador"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button
          type="button"
          className="menu-btn menu-btn--primary"
          disabled={!name.trim()}
          onClick={() => {
            createEditionPlayer(getDatabase(), editionId, { name: name.trim() })
            setName('')
            onRefresh()
          }}
        >
          Cadastrar jogador
        </button>
      </div>

      <div className="players-pool">
        {editionPlayers.map((player) => (
          <EditionPlayerRow key={player.id} player={player} refreshKey={refreshKey} onRefresh={onRefresh} />
        ))}
      </div>

      <hr className="editor-divider" />

      <h3 className="editor-subtitle">Elenco por time</h3>
      <label className="menu-field">
        <span>Time</span>
        <select value={selectedTeamId ?? ''} onChange={(e) => onSelectTeam(e.target.value)}>
          {teams.map((team) => (
            <option key={team.id} value={team.id}>
              {team.name}
            </option>
          ))}
        </select>
      </label>
      <p className="roster-editor__hint">
        Edite posições aqui ou abra o time na aba Times para uniformes e elenco completo.
      </p>
      <div className="players-grid">
        {roster.map((slot) => (
          <div key={slot.id} className="player-row pes-hud-surface">
            <EntityImage
              entityType="player"
              entityId={slot.playerId}
              alt={slot.name}
              refreshKey={refreshKey}
              className="entity-photo entity-photo--xs"
              fallback={<div className="entity-image-fallback entity-image-fallback--photo entity-photo--xs" />}
            />
            <span className="player-row__num">{slot.slotIndex + 1}</span>
            <span>{slot.positionLabel}</span>
            <span>{slot.name}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function EditionPlayerRow({
  player,
  refreshKey,
  onRefresh,
}: {
  player: EditionPlayer
  refreshKey: number
  onRefresh: () => void
}) {
  const [name, setName] = useState(player.name)
  const teamNames = useMemo(() => listPlayerTeamNames(getDatabase(), player.id), [player.id, player.name])

  return (
    <div className="edition-player-row pes-hud-surface">
      <EntityImageUpload
        entityType="player"
        entityId={player.id}
        label="Rosto"
        variant="photo"
        refreshKey={refreshKey}
        onUpdated={onRefresh}
      />
      <input
        className="menu-input"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => {
          if (name.trim() && name !== player.name) {
            updateEditionPlayer(getDatabase(), player.id, {
              name: name.trim(),
              skinTone: player.skinTone,
            })
            onRefresh()
          }
        }}
      />
      <label className="menu-field skin-tone-field">
        <span>Pele (Ch38_Body)</span>
        <div className="skin-tone-picker">
          {SKIN_TONE_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              className={`skin-tone-swatch${player.skinTone === opt.id ? ' skin-tone-swatch--active' : ''}`}
              style={{ background: getSkinToneColor(opt.id) }}
              title={opt.label}
              onClick={() => {
                updateEditionPlayer(getDatabase(), player.id, {
                  name: player.name,
                  skinTone: opt.id,
                })
                onRefresh()
              }}
            />
          ))}
        </div>
        <select
          value={player.skinTone}
          onChange={(e) => {
            updateEditionPlayer(getDatabase(), player.id, {
              name: player.name,
              skinTone: e.target.value as EditionPlayer['skinTone'],
            })
            onRefresh()
          }}
        >
          {SKIN_TONE_OPTIONS.map((opt) => (
            <option key={opt.id} value={opt.id}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>
      <div className="edition-player-row__teams">
        {teamNames.length ? teamNames.join(' · ') : 'Sem time'}
      </div>
      <button
        type="button"
        className="menu-btn menu-btn--danger"
        onClick={() => {
          if (confirm(`Excluir jogador "${player.name}"?`)) {
            deleteEditionPlayer(getDatabase(), player.id)
            onRefresh()
          }
        }}
      >
        Excluir
      </button>
    </div>
  )
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <label className="menu-field menu-field--color">
      <span>{label}</span>
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} />
      <input className="menu-input" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  )
}
