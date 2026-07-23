import { useEffect, useState } from 'react'
import { useGameStore } from '../store/gameStore'
import { getPlayerCardInfo, getPlayerRoleAbbrev, getPlayerRoleGroup } from '../data/playerRoster'
import { getPlayerStamina } from '../systems/playerStamina'

type HudPlayerCardProps = {
  playerId: string
  team: 'home' | 'away'
  controlled?: boolean
}

export function HudPlayerCard({ playerId, team, controlled = false }: HudPlayerCardProps) {
  const info = getPlayerCardInfo(playerId)
  const [stamina, setStamina] = useState(() => getPlayerStamina(playerId))
  const roleGroup = getPlayerRoleGroup(info.position)
  const roleLabel = getPlayerRoleAbbrev(info.position)
  const shotChargeActive = useGameStore((s) => s.shotChargeActive)
  const shotChargePower = useGameStore((s) => s.shotChargePower)

  useEffect(() => {
    let raf = 0
    const tick = () => {
      setStamina(getPlayerStamina(playerId))
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playerId])

  const staminaPct = Math.round(stamina * 100)
  const showShotBar = controlled && shotChargeActive
  const powerPct = Math.max(0, Math.min(100, shotChargePower * 100))
  const staminaLow = stamina < 0.38

  return (
    <div
      className={`psx-player-card psx-player-card--${team}${controlled ? ' psx-player-card--controlled' : ''}`}
      aria-hidden
    >
      <div className="psx-player-card-frame">
        <div className={`psx-player-card-role psx-player-card-role--${roleGroup}`}>
          {roleLabel}
        </div>
        <div className="psx-player-card-main">
          {showShotBar && (
            <div className="psx-player-card-shot" aria-hidden>
              <div className="psx-player-card-shot-track">
                <div className="psx-player-card-shot-fill" style={{ width: `${powerPct}%` }} />
              </div>
            </div>
          )}
          <div className="psx-player-card-nameplate">
            <span key={playerId} className="psx-player-card-name psx-player-card-name--change">
              <em className="psx-player-card-num">{info.shirtNumber}</em> {info.name}
            </span>
          </div>
        </div>
      </div>
      <div
        className={`psx-player-card-stamina-track${staminaLow ? ' psx-player-card-stamina-track--low' : ''}`}
      >
        <div
          className="psx-player-card-stamina-fill"
          style={{ width: `${staminaPct}%` }}
        />
      </div>
    </div>
  )
}
