import { getPlayerCardInfo, getPlayerRoleAbbrev, getPlayerRoleGroup } from '../data/playerRoster'

type HudPlayerCardProps = {
  playerId: string
  team: 'home' | 'away'
}

export function HudPlayerCard({ playerId, team }: HudPlayerCardProps) {
  const info = getPlayerCardInfo(playerId)
  const staminaPct = Math.round(info.stamina * 100)
  const roleGroup = getPlayerRoleGroup(info.position)
  const roleLabel = getPlayerRoleAbbrev(info.position)

  return (
    <div className={`psx-player-card psx-player-card--${team}`} aria-hidden>
      <div className="psx-player-card-frame">
        <div className={`psx-player-card-role psx-player-card-role--${roleGroup}`}>
          {roleLabel}
        </div>
        <div className="psx-player-card-main">
          <div className="psx-player-card-nameplate">
            <span className="psx-player-card-name">{info.name}</span>
          </div>
        </div>
      </div>
      <div className="psx-player-card-stamina-track">
        <div
          className="psx-player-card-stamina-fill"
          style={{ width: `${staminaPct}%` }}
        />
      </div>
    </div>
  )
}
