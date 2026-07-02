import { getPlayerCardInfo } from '../data/playerRoster'

type HudPlayerCardProps = {
  playerId: string
  team: 'home' | 'away'
}

export function HudPlayerCard({ playerId, team }: HudPlayerCardProps) {
  const info = getPlayerCardInfo(playerId)
  const staminaPct = Math.round(info.stamina * 100)
  const tiredStart = Math.max(55, staminaPct - 8)

  return (
    <div className={`psx-player-card pes-hud-surface pes-hud-surface--${team} psx-player-card--${team}`} aria-hidden>
      <div className="psx-player-card-icon" title="Condição">
        <span />
        <span />
        <span />
      </div>

      <div className="psx-player-card-body">
        <div className={`psx-player-card-header pes-hud-highlight pes-hud-highlight--accent-${team === 'home' ? 'left' : 'right'}`}>
          <span className="psx-player-card-role">{info.position}</span>
          <span className="psx-player-card-name">{info.name}</span>
        </div>
        <div className="psx-player-card-stamina-track">
          <div
            className="psx-player-card-stamina-fill"
            style={{
              width: `${staminaPct}%`,
              background: `linear-gradient(180deg, #fff878 0%, #fff878 42%, #facc15 43%, #eab308 ${tiredStart}%, #dc2626 100%)`,
            }}
          />
        </div>
      </div>
    </div>
  )
}
