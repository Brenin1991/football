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
    <div className={`psx-player-card psx-player-card--${team}`} aria-hidden>
      <div className="psx-player-card-icon" title="Condição">
        <span />
        <span />
        <span />
      </div>

      <div className="psx-player-card-body">
        <div className="psx-player-card-header">
          <span className="psx-player-card-role">{info.position}</span>
          <span className="psx-player-card-name">{info.name}</span>
        </div>
        <div className="psx-player-card-stamina-track">
          <div
            className="psx-player-card-stamina-fill"
            style={{
              width: `${staminaPct}%`,
              background: `linear-gradient(90deg, #facc15 0%, #eab308 ${tiredStart}%, #ef4444 100%)`,
            }}
          />
        </div>
      </div>
    </div>
  )
}
